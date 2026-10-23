"""Turn state machine: lease, safety, retrieval, reply, gated ingest."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from safety.patterns import SAFETY_REPLY, is_crisis
from olo.context import Persona, assemble, wants_topic
from olo.db import connect
from olo.llm import iter_first_token
from olo import canon as olo_canon
from olo import mood as olo_mood
from olo.segments import join_segments, polish_segments, split_segments
from olo.memory.io_lock import IoResult
from olo.metrics import record_ingest, record_rb_ms, record_timeout, record_ttft, record_turn
from olo.salience import commitment_body, closes_commitment, decide
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.subscription import enforce_quota

class _Discard(Exception):
    pass


logger = logging.getLogger(__name__)

SEARCH_WAIT_S = 0.4
ASR_WAIT_S = 3.0
LEASE_SECONDS = 30
FIRST_TOKEN_TIMEOUT_S = 8.0
MAX_AUDIO_BYTES = 8 * 1024 * 1024
CLIENT_MSG_ID = __import__("re").compile(r"^[A-Za-z0-9_-]{1,64}$")
ALLOWED_AUDIO = {
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-caf": ".caf",
}
ASR_FAILED_TEXT = "这条约没听清，打几个字给我吧。"
LLM_FAILED_TEXT = "我这会儿没能把话说出来，你刚才的话还在。"
MEMORY_BANNER = "我还想不起以前的事，但这会儿听得见你"
REPO_ROOT = Path(__file__).resolve().parents[2]
SPACE = "demo"
VOICEMEM_USER_ID = str(SEEDED_USER_ID)

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


@dataclass
class Incoming:
    session_id: uuid.UUID
    client_msg_id: str
    text: str
    modality: str
    audio_bytes: bytes | None = None
    audio_suffix: str = ".m4a"
    accept_sse: bool = False


@dataclass
class Prepared:
    incoming: Incoming
    persisted: bool
    user_message_id: uuid.UUID | None = None
    turn_id: uuid.UUID | None = None
    generation: int | None = None
    replay_body: str | None = None
    persona: Persona | None = None
    audio_path: Path | None = None
    user_text: str = ""


@dataclass
class Retrieval:
    status: str
    degraded: str | None
    consulted_left: bool
    consulted_right: bool
    left_count: int
    right_count: int
    lock_held: bool
    result: object | None = None
    emotion: str | None = None
    timing_ms: dict = field(default_factory=dict)
    search_ok: bool = False


def _runtime(request: Request):
    runtime = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
    return runtime


def _allow(runtime, token: str) -> bool:
    now = time.monotonic()
    lock = getattr(runtime, "rate_lock", None)
    if lock is None:
        runtime.rate_lock = threading.Lock()
        lock = runtime.rate_lock
    with lock:
        hits: dict = getattr(runtime, "rate_hits", None)
        if hits is None:
            runtime.rate_hits = {}
            hits = runtime.rate_hits
        window = [stamp for stamp in hits.get(token, []) if now - stamp < 60]
        if len(window) >= runtime.rate_limit_per_minute:
            hits[token] = window
            return False
        window.append(now)
        hits[token] = window
        return True


def _token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, rest = header.partition(" ")
    if scheme.lower() == "bearer":
        return rest.strip()
    return ""


def validate_client_msg_id(value: object) -> str:
    if value is None or (isinstance(value, str) and value == ""):
        raise ApiError(422, "VALIDATION_FAILED", "client_msg_id is required")
    if not isinstance(value, str) or CLIENT_MSG_ID.fullmatch(value) is None:
        raise ApiError(422, "VALIDATION_FAILED", "client_msg_id is invalid")
    return value


async def read_incoming(request: Request, session_id: uuid.UUID) -> Incoming:
    content_type = request.headers.get("content-type", "")
    accept = request.headers.get("accept", "")
    sse = "text/event-stream" in accept
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        client_msg_id = validate_client_msg_id(form.get("client_msg_id"))
        upload = form.get("audio")
        if upload is None or not hasattr(upload, "read"):
            raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "audio file is required")
        media = (upload.content_type or "").split(";", 1)[0].strip().lower()
        if media not in ALLOWED_AUDIO:
            raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "unsupported audio type")
        data = await upload.read()
        if len(data) > MAX_AUDIO_BYTES:
            raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "audio exceeds 8 MB")
        return Incoming(
            session_id=session_id,
            client_msg_id=client_msg_id,
            text="",
            modality="voice_note",
            audio_bytes=data,
            audio_suffix=ALLOWED_AUDIO[media],
            accept_sse=sse,
        )
    try:
        payload = await request.json()
    except Exception:
        payload = None
    if not isinstance(payload, dict):
        raise ApiError(422, "VALIDATION_FAILED", "client_msg_id is required")
    return Incoming(
        session_id=session_id,
        client_msg_id=validate_client_msg_id(payload.get("client_msg_id")),
        text="" if payload.get("text") is None else str(payload.get("text")),
        modality="text",
        accept_sse=sse,
    )


def _uploads_dir(runtime) -> Path:
    path = runtime.uploads_dir or (REPO_ROOT / "data" / "uploads")
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    return path


def _save_audio(runtime, incoming: Incoming) -> Path | None:
    if not incoming.audio_bytes:
        return None
    dest = _uploads_dir(runtime) / f"{uuid.uuid4()}{incoming.audio_suffix}"
    dest.write_bytes(incoming.audio_bytes)
    return dest


def _nickname(conn) -> str | None:
    from olo.persona import get_user_nickname

    return get_user_nickname(conn)


def _load_persona(conn, runtime) -> Persona:
    row = conn.execute(
        """
        SELECT name, stable_card, version, tone, appearance
        FROM companion_personas
        WHERE user_id = %s
        ORDER BY version DESC
        LIMIT 1
        """,
        (SEEDED_USER_ID,),
    ).fetchone()
    if row is None:
        raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
    appearance = row[4] if isinstance(row[4], dict) else {}
    persona = Persona(
        name=row[0],
        stable_card=row[1],
        version=row[2],
        tone=row[3] or "curious",
        form=appearance.get("form", "buddy"),
        user_nickname=_nickname(conn),
        look={k: v for k, v in appearance.items() if k in ("hair", "eyes", "cheeks")},
    )
    runtime.persona = persona
    return persona


def _session_exists(conn, session_id: uuid.UUID) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sessions WHERE id = %s AND user_id = %s",
        (session_id, SEEDED_USER_ID),
    ).fetchone()
    return row is not None


def prepare(runtime, incoming: Incoming) -> Prepared:
    audio_path = _save_audio(runtime, incoming)
    try:
        with connect() as conn:
            if not _session_exists(conn, incoming.session_id):
                raise ApiError(404, "SESSION_NOT_FOUND", "session not found")
            persona = _load_persona(conn, runtime)
            prepared = _lease(conn, runtime, incoming, persona, audio_path)
    except ApiError:
        raise
    except Exception as exc:
        logger.warning("turn persist failed: %s", type(exc).__name__)
        if runtime.persona is None:
            raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable") from None
        return Prepared(
            incoming=incoming,
            persisted=False,
            persona=runtime.persona,
            audio_path=audio_path,
            user_text=incoming.text,
        )
    return prepared


def _lease(conn, runtime, incoming: Incoming, persona: Persona, audio_path: Path | None) -> Prepared:
    relpath = str(audio_path.relative_to(REPO_ROOT)) if audio_path else None
    row = conn.execute(
        """
        SELECT id, user_message_id, assistant_message_id, state, generation,
               started_at > now() - interval '30 seconds'
        FROM turn_requests
        WHERE session_id = %s AND client_msg_id = %s
        """,
        (incoming.session_id, incoming.client_msg_id),
    ).fetchone()
    if row is None:
        user_message_id = uuid.uuid4()
        turn_id = uuid.uuid4()
        try:
            with conn.transaction():
                conn.execute(
                    """
                    INSERT INTO messages (
                      id, session_id, client_msg_id, role, modality, body, audio_relpath
                    )
                    VALUES (%s, %s, %s, 'user', %s, %s, %s)
                    """,
                    (
                        user_message_id,
                        incoming.session_id,
                        incoming.client_msg_id,
                        incoming.modality,
                        incoming.text,
                        relpath,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO turn_requests (
                      id, session_id, client_msg_id, user_message_id, state, generation
                    )
                    VALUES (%s, %s, %s, %s, 'in_progress', 1)
                    """,
                    (turn_id, incoming.session_id, incoming.client_msg_id, user_message_id),
                )
        except psycopg.errors.UniqueViolation:
            row = conn.execute(
                """
                SELECT id, user_message_id, assistant_message_id, state, generation,
                       started_at > now() - interval '30 seconds'
                FROM turn_requests
                WHERE session_id = %s AND client_msg_id = %s
                """,
                (incoming.session_id, incoming.client_msg_id),
            ).fetchone()
        else:
            return Prepared(
                incoming=incoming,
                persisted=True,
                user_message_id=user_message_id,
                turn_id=turn_id,
                generation=1,
                persona=persona,
                audio_path=audio_path,
                user_text=incoming.text,
            )
    if row is None:
        raise ApiError(409, "TURN_IN_PROGRESS", "turn is still in progress")
    turn_id, user_message_id, assistant_message_id, state, generation, lease_fresh = row
    if assistant_message_id is not None:
        body = conn.execute(
            "SELECT body FROM messages WHERE id = %s",
            (assistant_message_id,),
        ).fetchone()[0]
        return Prepared(
            incoming=incoming,
            persisted=True,
            user_message_id=user_message_id,
            turn_id=turn_id,
            generation=generation,
            replay_body=body,
            persona=persona,
            audio_path=audio_path,
            user_text=incoming.text,
        )
    if state == "in_progress" and lease_fresh:
        raise ApiError(409, "TURN_IN_PROGRESS", "turn is still in progress")
    updated = conn.execute(
        """
        UPDATE turn_requests
        SET generation = generation + 1,
            started_at = now(),
            state = 'in_progress'
        WHERE id = %s AND generation = %s AND assistant_message_id IS NULL
        RETURNING generation
        """,
        (turn_id, generation),
    ).fetchone()
    if updated is None:
        raise ApiError(409, "TURN_IN_PROGRESS", "turn is still in progress")
    return Prepared(
        incoming=incoming,
        persisted=True,
        user_message_id=user_message_id,
        turn_id=turn_id,
        generation=updated[0],
        persona=persona,
        audio_path=audio_path,
        user_text=incoming.text,
    )


def _afconvert(runtime, src: Path) -> Path:
    dest = src.with_suffix(".16k.wav")
    converter = runtime.afconvert
    if converter is None:
        if shutil.which("afconvert"):  # macOS
            cmd = ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(src), str(dest)]
        else:  # Linux / Docker
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "16000", str(dest)]
        subprocess.run(cmd, check=True, capture_output=True)
    else:
        converter(src, dest)
    return dest


def _transcribe(runtime, prepared: Prepared) -> tuple[str | None, str, bool, Path | None]:
    """Return (text, retrieval_status, lock_held, audio_used). text None means asr_failed."""
    memory = runtime.memory
    first = runtime.io_lock.run_io(
        lambda: memory.transcribe(str(prepared.audio_path)),
        wait_s=runtime.asr_wait_s,
    )
    if first.status in {"busy", "timeout"}:
        return None, "skipped_asr", True, None
    if first.status == "error":
        try:
            wav = _afconvert(runtime, prepared.audio_path)
        except Exception:
            return None, "skipped_asr", False, None
        second = runtime.io_lock.run_io(
            lambda: memory.transcribe(str(wav)),
            wait_s=runtime.asr_wait_s,
        )
        if second.status in {"busy", "timeout"}:
            return None, "skipped_asr", True, None
        if second.status == "error":
            return None, "skipped_asr", False, None
        return str(second.value or ""), "ok", False, wav
    return str(first.value or ""), "ok", False, prepared.audio_path


def _perceive_emotion(runtime, text: str, audio_path: Path | None) -> str | None:
    if audio_path is None:
        return None
    outcome = runtime.io_lock.run_io(
        lambda: runtime.memory.perceive(text, str(audio_path)),
        wait_s=runtime.asr_wait_s,
    )
    if outcome.status != "ok" or outcome.value is None:
        return None
    return getattr(outcome.value, "emotion", None)


def _topic_material(runtime, recent: list[dict]) -> str:
    """对方让 olo 找话题时：记得的事 + 前几天的日记（尽力而为，不抛错）。"""
    from olo.notebook import diary_memories, past_diaries

    parts: list[str] = []
    try:
        msgs = [{"role": m.get("role"), "body": str(m.get("content") or "")} for m in recent]
        if not any(m["role"] == "user" and m["body"].strip() for m in msgs):
            msgs = [{"role": "user", "body": "最近 在意的人 计划 喜欢 烦恼"}]
        mem = diary_memories(runtime, msgs)
        if mem:
            parts.append(mem.split("\n", 1)[-1])
        with connect() as conn:
            diaries = past_diaries(conn, date.today() + timedelta(days=1), 3)
        if diaries:
            parts.append("你最近写的日记：\n" + diaries.split("\n", 1)[-1])
    except Exception as exc:  # noqa: BLE001
        logger.warning("topic material failed: %s", type(exc).__name__)
    return "\n".join(parts)


def _retrieve(runtime, query: str, emotion: str | None) -> Retrieval:
    if runtime.voicemem_status == "warming":
        return Retrieval("warming", "voicemem_warming", False, False, 0, 0, False)
    if runtime.voicemem_status != "ready":
        return Retrieval("unavailable", "voicemem_unavailable", False, False, 0, 0, False)

    started = time.perf_counter()

    def classify_then_search():
        found = runtime.memory.classify(query)
        classify_ms = (time.perf_counter() - started) * 1000
        result = runtime.memory.search(
            query,
            slots=list(found.slots),
            entities=list(found.entities),
            top_k=5,
            emotion=emotion,
        )
        return classify_ms, result

    outcome = runtime.io_lock.run_io(classify_then_search, wait_s=runtime.search_wait_s)
    if outcome.status != "ok":
        lock_held = outcome.status in {"busy", "timeout"} or outcome.lock_held
        record_timeout(lock_held)
        return Retrieval("timeout", "retrieval_timeout", False, False, 0, 0, lock_held)
    classify_ms, result = outcome.value
    timing = dict(getattr(result, "timing", {}) or {})
    timing["classify_ms"] = classify_ms
    rb = timing.get("rb_ms")
    if isinstance(rb, (int, float)):
        record_rb_ms(float(rb))
    left = list(getattr(result, "result_leftbrain", []) or [])
    right = list(getattr(result, "result_rightbrain", []) or [])
    return Retrieval(
        "ok",
        None,
        True,
        True,
        len(left),
        len(right),
        False,
        result=result,
        emotion=emotion,
        timing_ms=timing,
        search_ok=True,
    )


def _recent(conn, session_id: uuid.UUID, current_id: uuid.UUID | None) -> list[dict]:
    rows = conn.execute(
        """
        SELECT role, body
        FROM messages
        WHERE session_id = %s AND (%s::uuid IS NULL OR id <> %s)
        ORDER BY created_at DESC
        LIMIT 12
        """,
        (session_id, current_id, current_id),
    ).fetchall()
    return [{"role": role, "content": body} for role, body in reversed(rows)]


def _open_commitments(conn) -> list[str]:
    rows = conn.execute(
        """
        SELECT body FROM commitments
        WHERE user_id = %s AND status = 'open'
        ORDER BY created_at ASC
        LIMIT 5
        """,
        (SEEDED_USER_ID,),
    ).fetchall()
    return [row[0] for row in rows]


def _close_commitment(conn, user_text: str) -> None:
    if not closes_commitment(user_text):
        return
    conn.execute(
        """
        UPDATE commitments
        SET status = 'done', done_at = now()
        WHERE id = (
          SELECT id FROM commitments
          WHERE user_id = %s AND status = 'open'
          ORDER BY created_at ASC
          LIMIT 1
        )
        """,
        (SEEDED_USER_ID,),
    )


def _store_user_text(prepared: Prepared, text: str, emotion: str | None) -> None:
    if not prepared.persisted or prepared.user_message_id is None:
        return
    with connect() as conn:
        conn.execute(
            """
            UPDATE messages
            SET body = %s, emotion_label = %s
            WHERE id = %s AND role = 'user'
            """,
            (text, emotion, prepared.user_message_id),
        )


def _save_assistant(
    prepared: Prepared,
    body: str,
    *,
    safety_hit: bool,
    retrieval: Retrieval | None,
    decision: str,
    reason: str,
    audit_status: str,
) -> uuid.UUID | None:
    if not prepared.persisted or prepared.turn_id is None or prepared.generation is None:
        return None
    message_id = uuid.uuid4()
    try:
        with connect() as conn:
            with conn.transaction():
                locked = conn.execute(
                    """
                    SELECT generation, assistant_message_id
                    FROM turn_requests
                    WHERE id = %s
                    FOR UPDATE
                    """,
                    (prepared.turn_id,),
                ).fetchone()
                if locked is None or locked[0] != prepared.generation or locked[1] is not None:
                    return None
                conn.execute(
                    """
                    INSERT INTO messages (
                      id, session_id, client_msg_id, role, modality, body, safety_hit
                    )
                    VALUES (%s, %s, NULL, 'assistant', 'text', %s, %s)
                    """,
                    (message_id, prepared.incoming.session_id, body, safety_hit),
                )
                wrote = conn.execute(
                    """
                    UPDATE turn_requests
                    SET assistant_message_id = %s, state = 'completed'
                    WHERE id = %s AND generation = %s AND assistant_message_id IS NULL
                    RETURNING id
                    """,
                    (message_id, prepared.turn_id, prepared.generation),
                ).fetchone()
                if wrote is None:
                    raise _Discard()
                conn.execute(
                    "UPDATE sessions SET last_turn_at = now() WHERE id = %s",
                    (prepared.incoming.session_id,),
                )
                if retrieval is not None and prepared.user_message_id is not None:
                    conn.execute(
                        """
                        INSERT INTO turn_traces (
                          id, user_message_id, assistant_message_id, retrieval_status,
                          consulted_left, consulted_right, left_count, right_count,
                          timing_ms, lock_held, degraded
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                        """,
                        (
                            uuid.uuid4(),
                            prepared.user_message_id,
                            message_id,
                            retrieval.status,
                            retrieval.consulted_left,
                            retrieval.consulted_right,
                            retrieval.left_count,
                            retrieval.right_count,
                            json.dumps(retrieval.timing_ms),
                            retrieval.lock_held,
                            retrieval.degraded,
                        ),
                    )
                promise = commitment_body(body)
                if promise and not safety_hit:
                    exists = conn.execute(
                        """
                        SELECT 1 FROM commitments
                        WHERE user_id = %s AND status = 'open' AND body = %s
                        """,
                        (SEEDED_USER_ID, promise),
                    ).fetchone()
                    if exists is None:
                        conn.execute(
                            """
                            INSERT INTO commitments (id, user_id, source_message_id, body, status)
                            VALUES (%s, %s, %s, %s, 'open')
                            """,
                            (uuid.uuid4(), SEEDED_USER_ID, message_id, promise),
                        )
                if prepared.user_message_id is not None and audit_status != "pending":
                    _insert_audit(conn, prepared.user_message_id, decision, reason, audit_status, None)
    except _Discard:
        return None
    return message_id


def _insert_audit(conn, user_message_id, decision, reason, status, error) -> uuid.UUID:
    audit_id = uuid.uuid4()
    conn.execute(
        """
        INSERT INTO memory_write_audit (
          id, user_message_id, decision, reason, speaker_tag,
          voicemem_space, voicemem_user_id, status, error
        )
        VALUES (%s, %s, %s, %s, 'user', %s, %s, %s, %s)
        """,
        (
            audit_id,
            user_message_id,
            decision,
            reason,
            SPACE,
            VOICEMEM_USER_ID,
            status,
            error,
        ),
    )
    return audit_id


def _enqueue_ingest(
    runtime,
    prepared: Prepared,
    assistant_text: str,
    audio_path: str | None,
    reason: str,
) -> None:
    if not prepared.persisted or prepared.user_message_id is None:
        return
    audit_id = uuid.uuid4()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO memory_write_audit (
              id, user_message_id, decision, reason, speaker_tag,
              voicemem_space, voicemem_user_id, status
            )
            VALUES (%s, %s, 'write', %s, 'user', %s, %s, 'pending')
            """,
            (
                audit_id,
                prepared.user_message_id,
                reason,
                SPACE,
                VOICEMEM_USER_ID,
            ),
        )

    def write() -> None:
        def call():
            return runtime.memory.ingest_user(
                text=prepared.user_text,
                agent_reply=assistant_text,
                session_id=str(prepared.incoming.session_id),
                observed_at=datetime.now(timezone.utc).isoformat(),
                audio_path=audio_path,
            )

        if getattr(runtime.memory, "writes_bypass_io_lock", False):
            # API VoiceMem: the single-worker ingest pool already serializes
            # writes, and searches must not wait behind a write's LLM calls.
            try:
                outcome = IoResult(status="ok", value=call())
            except Exception as exc:  # noqa: BLE001
                outcome = IoResult(status="error", error=exc)
        else:
            outcome = runtime.io_lock.run_io(call, wait_s=None)
        try:
            with connect() as conn:
                if outcome.status == "ok" and outcome.value is not None:
                    conn.execute(
                        """
                        UPDATE memory_write_audit
                        SET status = 'completed', left_memory_ids = %s::jsonb
                        WHERE id = %s
                        """,
                        (json.dumps(list(getattr(outcome.value, "memory_ids", []) or [])), audit_id),
                    )
                    speaker_id = getattr(outcome.value, "speaker_id", None)
                    if speaker_id and audio_path:
                        conn.execute(
                            """
                            UPDATE users
                            SET voiceprint_person_id = %s
                            WHERE id = %s AND voiceprint_person_id IS NULL
                            """,
                            (speaker_id, SEEDED_USER_ID),
                        )
                else:
                    error = type(outcome.error).__name__ if outcome.error else outcome.status
                    conn.execute(
                        """
                        UPDATE memory_write_audit
                        SET status = 'failed', error = %s
                        WHERE id = %s
                        """,
                        (error, audit_id),
                    )
        except Exception as exc:
            logger.warning("audit update failed: %s", type(exc).__name__)

    runtime.ingest.submit(write)


def _story_state(conn) -> dict:
    """Garden level + user-turn count, for the per-turn story slice."""
    from olo.garden import garden_state

    try:
        g = garden_state(conn)
        return {"garden_level": g["level"], "turn_index": g["messages"]}
    except Exception as exc:  # noqa: BLE001
        logger.warning("story state failed: %s", type(exc).__name__)
        return {}


def _prompt_bits(runtime, prepared: Prepared) -> tuple[list[dict], list[str], dict]:
    if not prepared.persisted:
        return [], [], {}
    try:
        with connect() as conn:
            _close_commitment(conn, prepared.user_text)
            recent = _recent(conn, prepared.incoming.session_id, prepared.user_message_id)
            commitments = _open_commitments(conn)
            story = _story_state(conn)
            from olo.usertz import time_context, user_tz

            story["time_line"] = time_context(user_tz(conn))
        story["canon"] = olo_canon.prompt_canon(prepared.user_text)
        return recent, commitments, story
    except Exception as exc:
        logger.warning("prompt load failed: %s", type(exc).__name__)
        return [], [], {}


def _banner(degraded: str | None) -> str | None:
    if degraded in {"voicemem_warming", "voicemem_unavailable"}:
        return MEMORY_BANNER
    return None


def iter_events(runtime, prepared: Prepared) -> Iterator[tuple[str, dict]]:
    if prepared.replay_body is not None:
        yield (
            "ack",
            {"user_message_id": _id(prepared.user_message_id), "persisted": True},
        )
        yield ("delta", {"text": prepared.replay_body})
        yield (
            "done",
            {
                "assistant_message_id": None,
                "memory_decision": "skip",
                "memory_reason": "replay",
                "memory_status": "not_called",
                "body": prepared.replay_body,
            },
        )
        record_turn(prepared.incoming.modality, "none")
        return

    user_text = prepared.user_text
    audio_for_ingest: str | None = None
    emotion = None
    asr_lock_held = False
    if prepared.incoming.modality == "voice_note":
        if runtime.voicemem_status != "ready":
            retrieval = Retrieval(
                "warming" if runtime.voicemem_status == "warming" else "unavailable",
                runtime.degraded_name(),
                False,
                False,
                0,
                0,
                False,
            )
            user_text = "（一条还没转写的语音备忘）"
            prepared.user_text = user_text
        else:
            text, status, asr_lock_held, audio_used = _transcribe(runtime, prepared)
            if text is None:
                _finish_fixed(
                    runtime,
                    prepared,
                    ASR_FAILED_TEXT,
                    Retrieval("skipped_asr", "asr_failed", False, False, 0, 0, asr_lock_held),
                    "skip",
                    "skipped_asr",
                    safety_hit=False,
                    remember=False,
                    ingest=False,
                )
                yield from _fixed_events(prepared, ASR_FAILED_TEXT, "asr_failed", asr_lock_held, "skip", "skipped_asr")
                return
            user_text = text
            prepared.user_text = text
            audio_for_ingest = str(audio_used) if audio_used else None
            emotion = _perceive_emotion(runtime, text, audio_used)
            _store_user_text(prepared, text, emotion)
    else:
        _store_user_text(prepared, user_text, None)

    if is_crisis(user_text) and not (
        prepared.incoming.modality == "voice_note" and runtime.voicemem_status != "ready"
    ):
        retrieval = Retrieval("skipped_safety", None, False, False, 0, 0, False)
        _finish_fixed(
            runtime,
            prepared,
            SAFETY_REPLY,
            retrieval,
            "skip",
            "safety_withhold",
            safety_hit=True,
            remember=False,
            ingest=False,
        )
        if prepared.persisted and prepared.user_message_id is not None:
            with connect() as conn:
                conn.execute(
                    "UPDATE messages SET safety_hit = true, body = %s WHERE id = %s",
                    (user_text, prepared.user_message_id),
                )
        yield from _fixed_events(prepared, SAFETY_REPLY, None, False, "skip", "safety_withhold")
        return

    retrieval = _retrieve(runtime, user_text, emotion if prepared.incoming.modality == "voice_note" else None)
    recent, commitments, story = _prompt_bits(runtime, prepared)
    persona = prepared.persona or runtime.persona
    if persona is None:
        raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
    tone_emotion = emotion if prepared.incoming.modality == "voice_note" else None
    if wants_topic(user_text):
        story = {**story, "topic_material": _topic_material(runtime, recent)}
    messages = assemble(
        persona,
        recent,
        retrieval.result,
        tone_emotion if retrieval.search_ok or prepared.incoming.modality == "voice_note" else None,
        user_text,
        commitments,
        **story,
    )
    # Text turns keep the neutral tone even when retrieval ran. Voice uses acoustic label.
    if prepared.incoming.modality != "voice_note":
        messages = assemble(persona, recent, retrieval.result, None, user_text, commitments, **story)
    yield (
        "ack",
        {"user_message_id": _id(prepared.user_message_id), "persisted": prepared.persisted},
    )
    yield ("retrieval", _retrieval_payload(retrieval))

    started = time.perf_counter()
    parts: list[str] = []
    first_ms = None
    tokens = None
    try:
        tokens = iter_first_token(runtime.llm.stream(messages), runtime.first_token_timeout_s)
    except Exception as exc:
        logger.warning("llm failed: %s", type(exc).__name__)
    if tokens is not None:
        try:
            for piece in tokens:
                if first_ms is None:
                    first_ms = (time.perf_counter() - started) * 1000
                    record_ttft(first_ms)
                parts.append(piece)
                yield ("delta", {"text": piece})
        except Exception as exc:
            logger.warning("llm failed: %s", type(exc).__name__)
    assistant_text = "".join(parts).strip()
    if not assistant_text:
        assistant_text = LLM_FAILED_TEXT
        yield ("delta", {"text": assistant_text})
    segments = polish_segments(split_segments(assistant_text)) or [assistant_text]
    assistant_text = join_segments(segments)
    gate = decide(user_text, safety_hit=False, emotion_label=emotion)
    llm_failed = assistant_text == LLM_FAILED_TEXT
    should_write = (
        gate.decision == "write"
        and retrieval.search_ok
        and prepared.persisted
        and not llm_failed
    )
    if llm_failed:
        decision = "skip"
        reason = "llm_failed"
    elif not retrieval.search_ok and gate.decision == "write":
        decision = "skip"
        reason = "retrieval_timeout"
    else:
        decision = "write" if should_write else "skip"
        reason = gate.reason
    audit_status = "not_called"
    message_id = _save_assistant(
        prepared,
        assistant_text,
        safety_hit=False,
        retrieval=retrieval,
        decision=decision,
        reason=reason,
        audit_status="not_called" if not should_write else "pending",
    )
    if message_id is None and prepared.persisted:
        # Lost the generation race. Do not ingest or remember this output.
        yield (
            "done",
            {
                "assistant_message_id": None,
                "memory_decision": "skip",
                "memory_reason": "generation_mismatch",
                "memory_status": "not_called",
                "body": assistant_text,
                "user_body": user_text,
            },
        )
        return
    try:
        if message_id is not None or not prepared.persisted:
            with runtime.exchanges_lock:
                runtime.memory.remember_reply(user_text, assistant_text)
        if should_write and message_id is not None:
            _enqueue_ingest(runtime, prepared, assistant_text, audio_for_ingest, reason)
            audit_status = "pending"
        else:
            audit_status = "not_called"
    except Exception as exc:
        logger.warning("remember failed: %s", type(exc).__name__)
        audit_status = "failed"
        if prepared.persisted and prepared.user_message_id is not None:
            try:
                with connect() as conn:
                    conn.execute(
                        """
                        UPDATE memory_write_audit
                        SET status = 'failed', error = %s
                        WHERE user_message_id = %s AND status IN ('pending', 'not_called')
                        """,
                        (type(exc).__name__, prepared.user_message_id),
                    )
            except Exception:
                pass
    record_turn(prepared.incoming.modality, retrieval.degraded)
    record_ingest(decision, reason)
    _log_turn(prepared, retrieval, decision, reason, audit_status)
    yield (
        "done",
        {
            "assistant_message_id": _id(message_id),
            "memory_decision": decision,
            "memory_reason": reason,
            "memory_status": audit_status,
            "body": assistant_text,
            "segments": segments,
            "user_body": user_text,
            "modality": prepared.incoming.modality,
        },
    )
    if prepared.persisted:
        olo_mood.record(user_text, emotion)
    if message_id is not None and not llm_failed:
        olo_canon.submit_extract(user_text, assistant_text, message_id)


def _finish_fixed(runtime, prepared, body, retrieval, decision, reason, *, safety_hit, remember, ingest) -> None:
    message_id = _save_assistant(
        prepared,
        body,
        safety_hit=safety_hit,
        retrieval=retrieval,
        decision=decision,
        reason=reason,
        audit_status="not_called",
    )
    prepared._assistant_id = message_id  # type: ignore[attr-defined]
    record_turn(prepared.incoming.modality, retrieval.degraded)
    record_ingest(decision, reason)
    if retrieval.degraded == "retrieval_timeout":
        record_timeout(retrieval.lock_held)


def _fixed_events(prepared, body, degraded, lock_held, decision, reason):
    message_id = getattr(prepared, "_assistant_id", None)
    yield (
        "ack",
        {"user_message_id": _id(prepared.user_message_id), "persisted": prepared.persisted},
    )
    yield (
        "retrieval",
        {
            "degraded": degraded,
            "consulted_left": False,
            "consulted_right": False,
            "left_count": 0,
            "right_count": 0,
            "lock_held": lock_held,
            "banner": _banner(degraded),
        },
    )
    yield ("delta", {"text": body})
    yield (
        "done",
        {
            "assistant_message_id": _id(message_id),
            "memory_decision": decision,
            "memory_reason": reason,
            "memory_status": "not_called",
            "body": body,
            "segments": [body],
            "user_body": prepared.user_text,
            "modality": prepared.incoming.modality,
        },
    )


def _retrieval_payload(retrieval: Retrieval) -> dict:
    return {
        "degraded": retrieval.degraded,
        "consulted_left": retrieval.consulted_left,
        "consulted_right": retrieval.consulted_right,
        "left_count": retrieval.left_count,
        "right_count": retrieval.right_count,
        "lock_held": retrieval.lock_held,
        "banner": _banner(retrieval.degraded),
    }


def _id(value: uuid.UUID | None) -> str | None:
    return None if value is None else str(value)


def _log_turn(prepared, retrieval, decision, reason, status) -> None:
    logger.info(
        json.dumps(
            {
                "turn_id": _id(prepared.turn_id),
                "session_id": str(prepared.incoming.session_id),
                "modality": prepared.incoming.modality,
                "retrieval_status": retrieval.status,
                "consulted_left": retrieval.consulted_left,
                "consulted_right": retrieval.consulted_right,
                "left_count": retrieval.left_count,
                "right_count": retrieval.right_count,
                "timing_ms": retrieval.timing_ms,
                "lock_held": retrieval.lock_held,
                "memory_decision": decision,
                "memory_reason": reason,
                "memory_status": status,
                "degraded": retrieval.degraded,
            },
            ensure_ascii=False,
        )
    )


def _events(runtime, prepared: Prepared) -> list[tuple[str, dict]]:
    # Drop the duplicate ack I accidentally yield. Keep the last ack before retrieval.
    raw = list(iter_events(runtime, prepared))
    acks = [item for item in raw if item[0] == "ack"]
    rest = [item for item in raw if item[0] != "ack"]
    if acks:
        return [acks[-1], *rest]
    return rest


def collapse(events: list[tuple[str, dict]], prepared: Prepared) -> dict:
    deltas = [data["text"] for name, data in events if name == "delta"]
    done = next((data for name, data in events if name == "done"), {})
    retrieval = next((data for name, data in events if name == "retrieval"), {})
    ack = next((data for name, data in events if name == "ack"), {})
    body = "".join(deltas)
    user_body = done.get("user_body", prepared.user_text)
    user_id = ack.get("user_message_id")
    assistant_id = done.get("assistant_message_id")
    return {
        "user_message": {
            "id": user_id,
            "role": "user",
            "body": user_body,
            "modality": prepared.incoming.modality,
        },
        "assistant_message": {
            "id": assistant_id,
            "role": "assistant",
            "body": done.get("body", body),
            "segments": done.get("segments") or split_segments(done.get("body", body)),
            "modality": "text",
        },
        "degraded": retrieval.get("degraded"),
        "persisted": ack.get("persisted", prepared.persisted),
        "memory_decision": done.get("memory_decision"),
        "memory_reason": done.get("memory_reason"),
        "memory_status": done.get("memory_status"),
        "banner": retrieval.get("banner"),
        "consulted_left": retrieval.get("consulted_left"),
        "consulted_right": retrieval.get("consulted_right"),
        "left_count": retrieval.get("left_count"),
        "right_count": retrieval.get("right_count"),
        "lock_held": retrieval.get("lock_held", False),
    }


def sse_bytes(events: list[tuple[str, dict]]) -> Iterator[str]:
    for name, data in events:
        public = {key: value for key, value in data.items() if key not in {"body", "user_body", "modality"}}
        if name == "done":
            public = {
                "assistant_message_id": data.get("assistant_message_id"),
                "memory_decision": data.get("memory_decision"),
                "memory_reason": data.get("memory_reason"),
                "memory_status": data.get("memory_status"),
            }
        if name == "delta":
            public = {"text": data.get("text", "")}
        if name == "ack":
            public = {
                "user_message_id": data.get("user_message_id"),
                "persisted": data.get("persisted"),
            }
        if name == "retrieval":
            public = {
                "degraded": data.get("degraded"),
                "consulted_left": data.get("consulted_left"),
                "consulted_right": data.get("consulted_right"),
                "left_count": data.get("left_count"),
                "right_count": data.get("right_count"),
                "lock_held": data.get("lock_held"),
            }
        yield f"event: {name}\ndata: {json.dumps(public, ensure_ascii=False)}\n\n"


def run_turn(runtime, prepared: Prepared) -> list[tuple[str, dict]]:
    return _events(runtime, prepared)


def _sse_stream(runtime, prepared: Prepared) -> Iterator[str]:
    """逐事件转发；delta 在模型产出时立即发出，而不是整段生成完再发。"""
    for name, data in iter_events(runtime, prepared):
        yield from sse_bytes([(name, data)])


@router.post("/sessions/{session_id}/turns")
async def post_turn(session_id: uuid.UUID, request: Request):
    runtime = _runtime(request)
    if not _allow(runtime, _token(request)):
        raise ApiError(429, "RATE_LIMITED", "too many turns")
    incoming = await read_incoming(request, session_id)
    try:
        with connect() as conn:
            enforce_quota(conn, "messages")
    except ApiError:
        raise
    except Exception as exc:
        # 额度查询失败时不拦对话；真正的持久化失败会在下游显式降级。
        logger.warning("quota check failed: %s", type(exc).__name__)
    try:
        prepared = await asyncio.to_thread(prepare, runtime, incoming)
    except ApiError:
        raise
    if incoming.accept_sse:
        return StreamingResponse(_sse_stream(runtime, prepared), media_type="text/event-stream")
    events = await asyncio.to_thread(run_turn, runtime, prepared)
    return JSONResponse(collapse(events, prepared))


@router.get("/sessions/{session_id}/messages")
def list_messages(
    session_id: uuid.UUID,
    limit: int = 50,
    before: str | None = None,
):
    bounded = min(max(limit, 1), 200)
    try:
        with connect() as conn:
            if not _session_exists(conn, session_id):
                raise ApiError(404, "SESSION_NOT_FOUND", "session not found")
            rows = conn.execute(
                """
                SELECT id::text, role, body, modality, created_at, audio_relpath
                FROM messages
                WHERE session_id = %s
                  AND (%s::timestamptz IS NULL OR created_at < %s::timestamptz)
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (session_id, before, before, bounded),
            ).fetchall()
    except ApiError:
        raise
    except Exception as exc:
        logger.warning("message list failed: %s", type(exc).__name__)
        raise ApiError(503, "UNAVAILABLE", "database unavailable") from None
    messages = [
        {
            "id": row[0],
            "role": row[1],
            "body": row[2],
            "modality": row[3],
            "created_at": row[4].isoformat(),
            "has_audio": bool(row[5]),
        }
        for row in reversed(rows)
    ]
    return {"messages": messages}


def register_turns(app: FastAPI) -> None:
    app.include_router(router)
