"""Adapter, probe, and idle flush. These tests must not construct VoiceMem()."""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from olo.flush import flush_idle
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.memory.probe import probe_warmup
from olo.memory.voicemem_adapter import VoiceMemAdapter, build_config
from olo.sessions import SEEDED_USER_ID


class SpyVoiceMem:
    mode = "multi_modal"

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def Classify(self, query):
        self.calls.append(("Classify", query))

        class Found:
            slots = ["diet"]
            entities = ["坚果"]

        return Found()

    def search(self, query, **kwargs):
        self.calls.append(("search", query, kwargs))
        return object()

    def ingest(self, **kwargs):
        self.calls.append(("ingest", kwargs))
        return {"memory_ids": ["m1"], "speaker_id": "spk"}

    def classify(self, query):
        raise RuntimeError("probe classify")

    def warmup(self):
        raise AssertionError("probe must not call warmup")

    def warm_asr(self):
        return None

    def warm_vad(self):
        return None

    def warm_perceive(self):
        return None

    def flush(self):
        raise RuntimeError("flush boom")


def test_adapter_classify_then_search_and_ingest_shape() -> None:
    vm = SpyVoiceMem()
    adapter = VoiceMemAdapter(vm)
    assert adapter.mode == "multi_modal"
    found = adapter.classify("我对坚果过敏")
    adapter.search(
        "我对坚果过敏",
        slots=found.slots,
        entities=found.entities,
        top_k=5,
        emotion=None,
    )
    assert [call[0] for call in vm.calls] == ["Classify", "search"]
    assert vm.calls[1][2]["slots"] == ["diet"]
    assert "emotion" not in vm.calls[1][2]
    adapter.ingest_user(
        text="我对坚果过敏",
        agent_reply="记下了",
        session_id="s",
        observed_at="2026-10-12T00:00:00Z",
    )
    text_kwargs = vm.calls[-1][1]
    assert text_kwargs["speaker"] == "user"
    assert text_kwargs["async_facts"] is False
    assert "audio" not in text_kwargs
    adapter.ingest_user(
        text="语音",
        agent_reply="听到了",
        session_id="s",
        observed_at="2026-10-12T00:00:00Z",
        audio_path="/tmp/note.wav",
    )
    voice_kwargs = vm.calls[-1][1]
    assert voice_kwargs["audio"] == "/tmp/note.wav"
    assert "speaker" not in voice_kwargs
    assert voice_kwargs["async_facts"] is False
    config = build_config("test-key")
    assert config["mode"] == "normal"
    assert config["space"] == "demo"
    assert config["memory_language"] == "zh"
    assert config["embedding"] == {"provider": "local"}
    assert config["slots"] == {"provider": "local"}
    from olo.models import memory_model
    assert config["llm"]["config"]["model"] == memory_model()


def test_probe_reports_classify_without_calling_warmup() -> None:
    vm = SpyVoiceMem()
    failed = probe_warmup(vm)
    assert failed == ["classify"]


def test_flush_does_not_end_session_when_lock_held_or_flush_fails(head_database: str) -> None:
    session_id = uuid.uuid4()
    with psycopg.connect(head_database) as conn:
        conn.execute(
            """
            INSERT INTO sessions (id, user_id, last_turn_at)
            VALUES (%s, %s, now() - interval '7 hours')
            """,
            (session_id, SEEDED_USER_ID),
        )

    def connect():
        return psycopg.connect(head_database)

    lock = VoicememIoLock()
    assert lock.acquire(blocking=False)
    flush_idle(connect, FakeMemory(), lock)
    lock.release()
    with psycopg.connect(head_database) as conn:
        ended = conn.execute(
            "SELECT ended_at FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()[0]
    assert ended is None

    class Boom:
        def flush(self):
            raise RuntimeError("disk")

    flush_idle(connect, Boom(), VoicememIoLock())
    with psycopg.connect(head_database) as conn:
        ended = conn.execute(
            "SELECT ended_at FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()[0]
    assert ended is None

    released = {"during_mark": None}

    def before_mark():
        released["during_mark"] = not VoicememIoLock().locked()
        with psycopg.connect(head_database) as conn:
            conn.execute(
                "UPDATE sessions SET last_turn_at = now() WHERE id = %s",
                (session_id,),
            )

    # The lock used by flush is released before before_mark. A fresh lock is unlocked.
    seen = {}

    class Ok:
        def flush(self):
            return None

    real_release = None

    io = VoicememIoLock()

    def before():
        seen["locked"] = io.locked()
        with psycopg.connect(head_database) as conn:
            conn.execute(
                "UPDATE sessions SET last_turn_at = now() WHERE id = %s",
                (session_id,),
            )

    flush_idle(connect, Ok(), io, before_mark=before)
    assert seen["locked"] is False
    with psycopg.connect(head_database) as conn:
        ended = conn.execute(
            "SELECT ended_at FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()[0]
    assert ended is None

    with psycopg.connect(head_database) as conn:
        conn.execute(
            "UPDATE sessions SET last_turn_at = now() - interval '7 hours' WHERE id = %s",
            (session_id,),
        )
    flush_idle(connect, Ok(), VoicememIoLock())
    with psycopg.connect(head_database) as conn:
        ended = conn.execute(
            "SELECT ended_at FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()[0]
    assert ended is not None
