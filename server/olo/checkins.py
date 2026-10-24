"""Check-ins：olo 按约定时间主动来找用户。

当前版本不接推送，到期时把一句话写进最近一次会话，用户回到聊天就能看到。
调度线程在 main 的 lifespan 里启动，测试直接调 `process_due`。
"""

from __future__ import annotations

from olo.forms import FORMS
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.speech import synthesize
from olo.voices import SUFFIX_BY_MEDIA, tts_dir

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_MESSAGES = {
    "text": "我在想你今天过得怎么样。",
    "call": "想听听你的声音，现在方便吗？",
}

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


class CheckInRequest(BaseModel):
    kind: str = "text"
    scheduled_for: datetime
    recurrence: str = "none"
    message: str | None = None


def _row(row) -> dict:
    return {
        "id": str(row[0]),
        "kind": row[1],
        "message": row[2],
        "scheduled_for": row[3].isoformat(),
        "recurrence": row[4],
        "status": row[5],
        "sent_at": row[6].isoformat() if row[6] else None,
    }


def _persona_voice(conn) -> tuple[str, str, str]:
    row = conn.execute(
        """
        SELECT tone, appearance FROM companion_personas
        WHERE user_id = %s
        ORDER BY version DESC
        LIMIT 1
        """,
        (SEEDED_USER_ID,),
    ).fetchone()
    tone, voice, form = "curious", "voice1", "buddy"
    if row is not None:
        tone = row[0] or tone
        appearance = row[1] if isinstance(row[1], dict) else {}
        if appearance.get("voice") in {"voice1", "voice2"}:
            voice = appearance["voice"]
        if appearance.get("form") in FORMS:
            form = appearance["form"]
    return tone, voice, form


def _voice_message(runtime, conn, text: str) -> str | None:
    """给 call 类型 check-in 生成一段 TTS 留言；失败就退回纯文字。"""
    if runtime is None:
        return None
    generator = getattr(runtime, "tts_generator", None) or synthesize
    tone, voice, form = _persona_voice(conn)
    try:
        result = generator(text, tone, voice, form)
    except Exception:
        return None
    if not result:
        return None
    data, media_type = result
    suffix = SUFFIX_BY_MEDIA.get(media_type)
    if suffix is None:
        return None
    path = tts_dir() / f"{uuid.uuid4().hex}{suffix}"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError:
        return None
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path.resolve())


def _latest_session(conn) -> uuid.UUID | None:
    row = conn.execute(
        """
        SELECT id FROM sessions
        WHERE user_id = %s
        ORDER BY last_turn_at DESC
        LIMIT 1
        """,
        (SEEDED_USER_ID,),
    ).fetchone()
    return row[0] if row else None


def process_due(conn, now: datetime | None = None, runtime=None) -> list[dict]:
    """把到期 check-in 写进最近会话；daily 会顺延到下一天。"""
    now = now or datetime.now(timezone.utc)
    rows = conn.execute(
        """
        SELECT id, kind, message, recurrence, scheduled_for
        FROM check_ins
        WHERE status = 'pending' AND scheduled_for <= %s
        ORDER BY scheduled_for
        """,
        (now,),
    ).fetchall()
    processed: list[dict] = []
    for check_id, kind, message, recurrence, scheduled_for in rows:
        session_id = _latest_session(conn)
        if session_id is not None:
            audio_path = _voice_message(runtime, conn, message) if kind == "call" else None
            conn.execute(
                """
                INSERT INTO messages
                  (id, session_id, role, modality, body, audio_relpath)
                VALUES (%s, %s, 'assistant', 'text', %s, %s)
                """,
                (uuid.uuid4(), session_id, message, audio_path),
            )
            conn.execute(
                "UPDATE sessions SET last_turn_at = now() WHERE id = %s",
                (session_id,),
            )
        conn.execute(
            "UPDATE check_ins SET status = 'sent', sent_at = %s WHERE id = %s",
            (now, check_id),
        )
        if recurrence == "daily":
            next_at = scheduled_for + timedelta(days=1)
            while next_at <= now:
                next_at += timedelta(days=1)
            conn.execute(
                """
                INSERT INTO check_ins
                  (id, user_id, kind, message, scheduled_for, recurrence, status)
                VALUES (%s, %s, %s, %s, %s, 'daily', 'pending')
                """,
                (uuid.uuid4(), SEEDED_USER_ID, kind, message, next_at),
            )
        processed.append(
            {
                "id": str(check_id),
                "kind": kind,
                "message": message,
                "delivered_to": str(session_id) if session_id else None,
            }
        )
    conn.commit()
    return processed


def process_due_once(runtime=None) -> list[dict]:
    with connect() as conn:
        return process_due(conn, runtime=runtime)


@router.get("/check-ins")
def list_check_ins(request: Request) -> dict:
    with connect() as conn:
        upcoming = conn.execute(
            """
            SELECT id, kind, message, scheduled_for, recurrence, status, sent_at
            FROM check_ins
            WHERE user_id = %s AND status = 'pending'
            ORDER BY scheduled_for
            LIMIT 50
            """,
            (SEEDED_USER_ID,),
        ).fetchall()
        recent = conn.execute(
            """
            SELECT id, kind, message, scheduled_for, recurrence, status, sent_at
            FROM check_ins
            WHERE user_id = %s AND status IN ('sent', 'cancelled')
            ORDER BY scheduled_for DESC
            LIMIT 20
            """,
            (SEEDED_USER_ID,),
        ).fetchall()
    return {
        "upcoming": [_row(row) for row in upcoming],
        "recent": [_row(row) for row in recent],
    }


@router.post("/check-ins")
def create_check_in(payload: CheckInRequest, request: Request) -> JSONResponse:
    if payload.kind not in DEFAULT_MESSAGES:
        raise ApiError(422, "VALIDATION_FAILED", "kind 只能是 text 或 call")
    if payload.recurrence not in {"none", "daily"}:
        raise ApiError(422, "VALIDATION_FAILED", "recurrence 只能是 none 或 daily")
    message = (payload.message or DEFAULT_MESSAGES[payload.kind]).strip()
    if not message or len(message) > 200:
        raise ApiError(422, "VALIDATION_FAILED", "留言长度要在 1–200 字之间")
    with connect() as conn:
        row = conn.execute(
            """
            INSERT INTO check_ins
              (id, user_id, kind, message, scheduled_for, recurrence)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, kind, message, scheduled_for, recurrence, status, sent_at
            """,
            (
                uuid.uuid4(),
                SEEDED_USER_ID,
                payload.kind,
                message,
                payload.scheduled_for,
                payload.recurrence,
            ),
        ).fetchone()
        conn.commit()
    return JSONResponse(status_code=201, content=_row(row))


@router.delete("/check-ins/{check_id}")
def cancel_check_in(check_id: uuid.UUID, request: Request) -> dict:
    with connect() as conn:
        row = conn.execute(
            """
            UPDATE check_ins
            SET status = 'cancelled'
            WHERE id = %s AND user_id = %s AND status = 'pending'
            RETURNING id
            """,
            (check_id, SEEDED_USER_ID),
        ).fetchone()
        conn.commit()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "没有这条 check-in，或已经触发过了")
    return {"cancelled": True}


def register_check_ins(app: FastAPI) -> None:
    app.include_router(router)
