"""Design tests 1-10 and 12. Memory port is a fake. VoiceMem() is never constructed."""

import json
import threading
import uuid
from pathlib import Path

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from safety.patterns import SAFETY_REPLY, is_crisis
from olo.context import Persona, assemble
from olo.llm import OpenAIChat
from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.memory.port import Hit, RbHit, SearchView
from olo.runtime import Runtime
from olo.salience import decide
from olo.sessions import SEEDED_USER_ID
from olo.turns import ASR_FAILED_TEXT, ASR_WAIT_S, SEARCH_WAIT_S
from olo.memory.compat import build_memory_context

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class ScriptedLLM:
    def __init__(self, text: str = "我在。") -> None:
        self.text = text
        self.calls: list[list[dict]] = []
        self.release_first = threading.Event()
        self.first_entered = threading.Event()
        self.block_first = False
        self._lock = threading.Lock()

    def stream(self, messages):
        with self._lock:
            self.calls.append(messages)
            should_block = self.block_first
            if should_block:
                self.block_first = False
        if should_block:
            self.first_entered.set()
            self.release_first.wait(timeout=5)
            yield "first-reply"
            return
        if callable(self.text):
            yield self.text()
            return
        yield self.text


def make_runtime(memory: FakeMemory | None = None, llm: object | None = None) -> Runtime:
    return Runtime(
        memory=memory or FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=llm or ScriptedLLM(),
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
    )


@pytest.fixture
def runtime(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Runtime:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    runtime = make_runtime()
    app.state.runtime = runtime
    return runtime


def _client():
    return TestClient(app)


def open_session(client: TestClient) -> str:
    response = client.post("/v1/sessions", headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def post_turn(client, session_id, text, msg_id, *, accept="application/json", runtime: Runtime | None = None):
    response = client.post(
        f"/v1/sessions/{session_id}/turns",
        headers={**AUTH, "Accept": accept},
        json={"client_msg_id": msg_id, "text": text},
    )
    if runtime is not None:
        runtime.ingest.drain(timeout=3)
    return response


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        name, data = "message", "{}"
        for line in block.splitlines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = line.split(":", 1)[1].strip()
        events.append((name, json.loads(data)))
    return events


def test_search_wait_constant() -> None:
    assert SEARCH_WAIT_S == 0.4
    assert ASR_WAIT_S == 3.0


def test_prompt_contains_real_memory_and_counts_empty_hits(runtime: Runtime) -> None:
    memory = runtime.memory
    assert isinstance(memory, FakeMemory)
    memory.classify_result.slots = ["diet"]
    memory.classify_result.entities = ["坚果"]
    memory.search_result = SearchView(
        hits=[Hit("用户对坚果过敏", "2026-10-01")],
        rb_hits=[RbHit("压力上来时会先闭嘴")],
        rb_directive="先接住，再问一句",
        result_leftbrain=["用户对坚果过敏"],
        result_rightbrain=["压力上来时会先闭嘴"],
        timing={"embed_ms": 1, "lb_ms": 2, "rb_ms": 3, "rank_ms": 4},
        scene_directive="不要把场景写进 system",
    )
    llm = runtime.llm
    with _client() as client:
        session_id = open_session(client)
        response = post_turn(client, session_id, "我对坚果过敏", "hit1", runtime=runtime)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["consulted_left"] is True
    assert body["consulted_right"] is True
    system = llm.calls[0][0]["content"]
    assert "factual memory CONTEXT you know about the user" in system
    assert "user's emotion & characteristics" in system
    assert "先接住，再问一句" in system
    assert "不要把场景写进 system" not in system
    assert memory.events[0][0] == "classify"
    assert memory.events[1][0] == "search"
    assert memory.events[1][2] == ("diet",)
    assert memory.events[1][3] == ("坚果",)

    memory.search_result = SearchView()
    memory.events.clear()
    with _client() as client:
        response = post_turn(client, session_id, "今天吃了米饭", "empty1", runtime=runtime)
    assert response.status_code == 200, response.text
    assert response.json()["consulted_left"] is True
    assert response.json()["consulted_right"] is True
    assert response.json()["left_count"] == 0
    assert response.json()["right_count"] == 0


def test_trivial_skips_ingest_but_remembers(runtime: Runtime) -> None:
    memory = runtime.memory
    with _client() as client:
        session_id = open_session(client)
        for index, text in enumerate(["嗯", "哈哈", "今天天气一般，我随便说说。"]):
            response = post_turn(client, session_id, text, f"triv{index}", runtime=runtime)
            assert response.status_code == 200, response.text
            assert response.json()["memory_decision"] == "skip"
            assert response.json()["memory_reason"] == "trivial"
            assert response.json()["memory_status"] == "not_called"
    assert memory.ingest_calls == []
    assert len(memory.remember_calls) == 3


def test_significant_ingest_text_and_voice(runtime: Runtime) -> None:
    memory = runtime.memory
    llm = runtime.llm
    llm.text = "记下了。"
    with _client() as client:
        session_id = open_session(client)
        response = post_turn(client, session_id, "我对坚果过敏", "fact1", runtime=runtime)
    assert response.status_code == 200, response.text
    assert len(memory.ingest_calls) == 1
    recorded = memory.ingest_calls[0]
    assert recorded["text"] == "我对坚果过敏"
    assert recorded["speaker"] == "user"
    assert recorded["agent_reply"] == "记下了。"
    assert recorded["async_facts"] is False
    assert "audio" not in recorded

    memory.transcribe_text = "我对坚果过敏"
    memory.ingest_calls.clear()
    with _client() as client:
        voice = client.post(
            f"/v1/sessions/{session_id}/turns",
            headers=AUTH,
            data={"client_msg_id": "voicefact"},
            files={"audio": ("note.m4a", b"not-really-audio", "audio/m4a")},
        )
        runtime.ingest.drain(timeout=3)
    assert voice.status_code == 200, voice.text
    assert len(memory.ingest_calls) == 1
    recorded = memory.ingest_calls[0]
    assert recorded["text"] == "我对坚果过敏"
    assert "audio" in recorded
    assert "speaker" not in recorded
    assert recorded["async_facts"] is False


def test_commitments_enter_prompt_and_close(runtime: Runtime, head_database: str) -> None:
    llm = runtime.llm
    llm.text = "我会记得提醒你喝水"
    memory = runtime.memory
    with _client() as client:
        session_id = open_session(client)
        first = post_turn(client, session_id, "嗯", "promise1", runtime=runtime)
        assert first.status_code == 200
        assert memory.ingest_calls == []
        with psycopg.connect(head_database) as conn:
            row = conn.execute(
                "SELECT body, status FROM commitments WHERE status = 'open'"
            ).fetchone()
        assert row == ("我会记得提醒你喝水", "open")
        second = post_turn(client, session_id, "在吗", "promise2", runtime=runtime)
        system = llm.calls[-1][0]["content"]
        assert "你答应过、还没完成的事（这是你的承诺，不是对方的事实）：" in system
        assert "喝水" in system
        llm.text = "好。"
        closed = post_turn(client, session_id, "不用提醒了", "promise3", runtime=runtime)
        assert closed.status_code == 200
        with psycopg.connect(head_database) as conn:
            done = conn.execute(
                "SELECT status, done_at IS NOT NULL FROM commitments WHERE body = %s",
                ("我会记得提醒你喝水",),
            ).fetchone()
        assert done == ("done", True)
        post_turn(client, session_id, "好", "promise4", runtime=runtime)
        assert "喝水" not in llm.calls[-1][0]["content"]

        with psycopg.connect(head_database) as conn:
            source = conn.execute("SELECT id FROM messages LIMIT 1").fetchone()[0]
            for index in range(6):
                conn.execute(
                    """
                    INSERT INTO commitments (
                      id, user_id, source_message_id, body, status, created_at
                    )
                    VALUES (%s, %s, %s, %s, 'open', now() + (%s || ' seconds')::interval)
                    """,
                    (uuid.uuid4(), SEEDED_USER_ID, source, f"承诺{index}", index),
                )
        post_turn(client, session_id, "好的", "promise5", runtime=runtime)
        prompt = llm.calls[-1][0]["content"]
        for index in range(5):
            assert f"承诺{index}" in prompt
        assert "承诺5" not in prompt


def test_identity_tone_does_not_rewrite_persona() -> None:
    persona = Persona(stable_card="你叫 olo，身份正文只出现一次。")
    result = SearchView(rb_hits=[RbHit("会先安静下来")], rb_directive="")
    sad = assemble(persona, [], result, "sad", "我很难过", [])
    neutral = assemble(persona, [], result, None, "我很难过", [])
    assert sad[0]["content"].count(persona.stable_card) == 1
    assert neutral[0]["content"].count(persona.stable_card) == 1
    assert "语气放轻" in sad[0]["content"]
    assert "语气放轻" not in neutral[0]["content"]
    assert "语气保持平时的温度" in neutral[0]["content"]
    rendered = build_memory_context(result, max_rb=5)
    assert rendered in sad[0]["content"]
    assert "user's emotion & characteristics" in rendered


def test_safety_short_circuit(runtime: Runtime) -> None:
    memory = runtime.memory
    llm = runtime.llm
    with _client() as client:
        session_id = open_session(client)
        response = post_turn(client, session_id, "我不想活了", "crisis1", runtime=runtime)
        assert response.status_code == 200, response.text
        assert response.json()["assistant_message"]["body"] == SAFETY_REPLY
        assert memory.classify_count() == 0
        assert memory.search_start_count() == 0
        assert memory.ingest_calls == []
        assert memory.remember_calls == []
        assert llm.calls == []
        assert response.json()["memory_reason"] == "safety_withhold"
        assert is_crisis("我不想活了")
        assert not is_crisis("我很伤心")
        assert not is_crisis("今天有点难过")
        assert not is_crisis("压力好大")
        assert decide("今天有点难过", safety_hit=False, emotion_label="sad").reason != "safety_withhold"
        sad = post_turn(client, session_id, "我很伤心", "neg0", runtime=runtime)
        assert sad.json()["assistant_message"]["body"] != SAFETY_REPLY
        assert sad.json()["memory_reason"] == "emotion_peak"
        for index, text in enumerate(["今天有点难过", "压力好大"], start=1):
            response = post_turn(client, session_id, text, f"neg{index}", runtime=runtime)
            assert response.json()["assistant_message"]["body"] != SAFETY_REPLY


def test_retrieval_timeout_holds_lock(runtime: Runtime) -> None:
    from olo.turns import Incoming, prepare, run_turn

    memory = runtime.memory
    memory.search_gate = threading.Event()
    runtime.search_wait_s = 0.2
    runtime.llm = ScriptedLLM("还在。")
    results = {}
    with _client() as client:
        session_id = uuid.UUID(open_session(client))

    def one(key, msg_id):
        incoming = Incoming(
            session_id=session_id,
            client_msg_id=msg_id,
            text="我对坚果过敏",
            modality="text",
        )
        prepared = prepare(runtime, incoming)
        results[key] = run_turn(runtime, prepared)

    first = threading.Thread(target=one, args=("a", "to1"))
    first.start()
    assert memory.search_started.wait(timeout=2)
    second = threading.Thread(target=one, args=("b", "to2"))
    second.start()
    second.join(timeout=3)
    first.join(timeout=3)
    memory.search_gate.set()
    runtime.ingest.drain(timeout=2)
    assert "a" in results and "b" in results
    degraded = []
    for events in results.values():
        retrieval = next(data for name, data in events if name == "retrieval")
        done = next(data for name, data in events if name == "done")
        degraded.append(retrieval["degraded"])
        assert done["body"]
    assert degraded == ["retrieval_timeout", "retrieval_timeout"] or set(degraded) == {"retrieval_timeout"}
    assert memory.search_start_count() == 1
    assert any(
        next(data for name, data in events if name == "retrieval")["lock_held"]
        for events in results.values()
    )
    assert memory.ingest_calls == []


def test_warming_and_unavailable_skip_search(runtime: Runtime) -> None:
    memory = runtime.memory
    with _client() as client:
        session_id = open_session(client)
        runtime.voicemem_status = "warming"
        warming = post_turn(client, session_id, "我对坚果过敏", "warm1", runtime=runtime)
        runtime.voicemem_status = "failed"
        failed = post_turn(client, session_id, "我对坚果过敏", "fail1", runtime=runtime)
    assert warming.json()["degraded"] == "voicemem_warming"
    assert failed.json()["degraded"] == "voicemem_unavailable"
    assert warming.json()["assistant_message"]["body"]
    assert failed.json()["assistant_message"]["body"]
    assert memory.search_start_count() == 0
    assert memory.ingest_calls == []
    assert len(memory.remember_calls) == 2


def test_postgres_down_uses_cached_persona(runtime: Runtime, monkeypatch) -> None:
    runtime.persona = Persona(stable_card="缓存人设")
    runtime.llm = ScriptedLLM("缓存回复")

    def boom(*_args, **_kwargs):
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr("olo.turns.connect", boom)
    with _client() as client:
        response = client.post(
            f"/v1/sessions/{uuid.uuid4()}/turns",
            headers=AUTH,
            json={"client_msg_id": "pg1", "text": "在吗"},
        )
    assert response.status_code == 200, response.text
    assert response.json()["persisted"] is False
    assert response.json()["assistant_message"]["body"] == "缓存回复"
    assert runtime.memory.ingest_calls == []

    runtime.persona = None
    with _client() as client:
        missing = client.post(
            f"/v1/sessions/{uuid.uuid4()}/turns",
            headers=AUTH,
            json={"client_msg_id": "pg2", "text": "在吗"},
        )
    assert missing.status_code == 503
    assert missing.json()["error"]["code"] == "PERSONA_UNAVAILABLE"


def test_idempotency_and_generation(runtime: Runtime, head_database: str) -> None:
    llm = runtime.llm
    llm.text = "第一句"
    with _client() as client:
        session_id = open_session(client)
        missing = client.post(
            f"/v1/sessions/{session_id}/turns",
            headers=AUTH,
            json={"text": "你好"},
        )
        assert missing.status_code == 422
        assert missing.json()["error"]["code"] == "VALIDATION_FAILED"
        first = post_turn(client, session_id, "你好呀", "same", runtime=runtime)
        assert first.status_code == 200
        calls = len(llm.calls)
        replay = post_turn(client, session_id, "你好呀", "same", runtime=runtime)
        assert replay.status_code == 200
        assert replay.json()["assistant_message"]["body"] == first.json()["assistant_message"]["body"]
        assert len(llm.calls) == calls
        sse = post_turn(
            client,
            session_id,
            "你好呀",
            "same",
            accept="text/event-stream",
            runtime=runtime,
        )
        events = parse_sse(sse.text)
        deltas = [data["text"] for name, data in events if name == "delta"]
        assert deltas == [first.json()["assistant_message"]["body"]]
        with psycopg.connect(head_database) as conn:
            assistant = conn.execute(
                """
                SELECT client_msg_id FROM messages
                WHERE session_id = %s AND role = 'assistant'
                """,
                (session_id,),
            ).fetchone()
        assert assistant[0] is None

        with psycopg.connect(head_database) as conn:
            user_id = uuid.uuid4()
            conn.execute(
                """
                INSERT INTO messages (id, session_id, client_msg_id, role, modality, body)
                VALUES (%s, %s, 'busy1', 'user', 'text', '挂起')
                """,
                (user_id, session_id),
            )
            conn.execute(
                """
                INSERT INTO turn_requests (
                  id, session_id, client_msg_id, user_message_id, state, generation, started_at
                )
                VALUES (%s, %s, 'busy1', %s, 'in_progress', 1, now())
                """,
                (uuid.uuid4(), session_id, user_id),
            )
        busy = post_turn(client, session_id, "挂起", "busy1", runtime=runtime)
        assert busy.status_code == 409
        assert busy.json()["error"]["code"] == "TURN_IN_PROGRESS"
        assert len(llm.calls) == calls

    from olo.turns import Incoming, prepare, run_turn

    llm.block_first = True
    llm.text = "second-reply"
    outcome = {}
    session_uuid = uuid.UUID(session_id)

    def blocked():
        incoming = Incoming(
            session_id=session_uuid,
            client_msg_id="race",
            text="第一轮还没写完",
            modality="text",
        )
        prepared = prepare(runtime, incoming)
        outcome["events"] = run_turn(runtime, prepared)

    worker = threading.Thread(target=blocked)
    worker.start()
    assert llm.first_entered.wait(timeout=3)
    with psycopg.connect(head_database) as conn:
        conn.execute(
            """
            UPDATE turn_requests
            SET started_at = now() - interval '31 seconds'
            WHERE client_msg_id = 'race'
            """
        )
    incoming = Incoming(
        session_id=session_uuid,
        client_msg_id="race",
        text="第一轮还没写完",
        modality="text",
    )
    second_events = run_turn(runtime, prepare(runtime, incoming))
    llm.release_first.set()
    worker.join(timeout=5)
    runtime.ingest.drain(timeout=2)
    second_body = next(data["body"] for name, data in second_events if name == "done")
    assert second_body == "second-reply"
    with psycopg.connect(head_database) as conn:
        row = conn.execute(
            """
            SELECT tr.generation, m.body
            FROM turn_requests AS tr
            JOIN messages AS m ON m.id = tr.assistant_message_id
            WHERE tr.client_msg_id = 'race'
            """
        ).fetchone()
    assert row[0] == 2
    assert row[1] == "second-reply"
    assert "events" in outcome


def test_asr_failure_matrix(runtime: Runtime) -> None:
    memory = runtime.memory
    converted = []

    def convert(src: Path, dest: Path) -> None:
        converted.append(src)
        dest.write_bytes(b"RIFF")

    runtime.afconvert = convert
    runtime.asr_wait_s = 0.05
    with _client() as client:
        session_id = open_session(client)

        def send(msg_id: str):
            return client.post(
                f"/v1/sessions/{session_id}/turns",
                headers=AUTH,
                data={"client_msg_id": msg_id},
                files={"audio": ("note.m4a", b"abcd", "audio/m4a")},
            )

        memory.transcribe_gate = threading.Event()
        blocked = send("asr-timeout")
        memory.transcribe_gate.set()
        memory.transcribe_gate = None
        assert blocked.status_code == 200, blocked.text
        assert blocked.json()["degraded"] == "asr_failed"
        assert blocked.json()["assistant_message"]["body"] == ASR_FAILED_TEXT
        assert converted == []
        assert memory.classify_count() == 0

        runtime.io_lock.acquire()
        busy = send("asr-busy")
        runtime.io_lock.release()
        assert busy.json()["degraded"] == "asr_failed"
        assert busy.json()["lock_held"] is True
        assert converted == []

        memory.transcribe_error = RuntimeError("decode")
        failed = send("asr-decode")
        assert failed.json()["degraded"] == "asr_failed"
        assert len(converted) == 1
        assert failed.json()["assistant_message"]["body"] == ASR_FAILED_TEXT
        assert memory.remember_calls == []
        assert memory.ingest_calls == []


def test_openai_client_is_not_used_by_fake(runtime: Runtime) -> None:
    assert not isinstance(runtime.llm, OpenAIChat)


class ChunkedLLM:
    def __init__(self, pieces: list[str]) -> None:
        self.pieces = pieces
        self.calls: list[list[dict]] = []

    def stream(self, messages):
        self.calls.append(messages)
        yield from self.pieces


def test_sse_emits_each_delta_as_it_arrives(runtime: Runtime, head_database: str) -> None:
    llm = ChunkedLLM(["先", "接住", "，再问一句。"])
    runtime.llm = llm
    with _client() as client:
        session_id = open_session(client)
        sse = post_turn(
            client,
            session_id,
            "我有点撑不住",
            "stream-1",
            accept="text/event-stream",
            runtime=runtime,
        )
        assert sse.status_code == 200, sse.text
        events = parse_sse(sse.text)
        names = [name for name, _ in events]
        assert names[0] == "ack"
        assert names[1] == "retrieval"
        assert [data["text"] for name, data in events if name == "delta"] == [
            "先",
            "接住",
            "，再问一句。",
        ]
        done = next(data for name, data in events if name == "done")
        assert done["assistant_message_id"]

    with psycopg.connect(head_database) as conn:
        body = conn.execute(
            "SELECT body FROM messages WHERE id = %s",
            (done["assistant_message_id"],),
        ).fetchone()[0]
    assert body == "先接住，再问一句。"
