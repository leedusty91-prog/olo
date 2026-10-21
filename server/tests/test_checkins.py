"""Check-ins：创建、取消、到期投递与每日顺延。"""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo.checkins import process_due
from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime
from olo.sessions import SEEDED_USER_ID

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path) -> object:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    with TestClient(app) as test_client:
        yield test_client


def iso_in(hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def seed_session(database_url: str) -> str:
    session_id = uuid.uuid4()
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id) VALUES (%s, %s)",
            (session_id, SEEDED_USER_ID),
        )
        conn.commit()
    return str(session_id)


def test_create_list_cancel(client) -> None:
    created = client.post(
        "/v1/check-ins",
        headers=AUTH,
        json={"kind": "text", "scheduled_for": iso_in(2), "recurrence": "none"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "pending"
    assert body["message"] == "我在想你今天过得怎么样。"

    listed = client.get("/v1/check-ins", headers=AUTH).json()
    assert [item["id"] for item in listed["upcoming"]] == [body["id"]]

    cancelled = client.delete(f"/v1/check-ins/{body['id']}", headers=AUTH)
    assert cancelled.status_code == 200
    assert client.get("/v1/check-ins", headers=AUTH).json()["upcoming"] == []

    recent = client.get("/v1/check-ins", headers=AUTH).json()["recent"]
    assert [item["status"] for item in recent] == ["cancelled"]


def test_rejects_bad_input(client) -> None:
    assert (
        client.post(
            "/v1/check-ins",
            headers=AUTH,
            json={"kind": "video", "scheduled_for": iso_in(1)},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/check-ins",
            headers=AUTH,
            json={"kind": "text", "scheduled_for": iso_in(1), "recurrence": "weekly"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/check-ins",
            headers=AUTH,
            json={"kind": "text", "scheduled_for": iso_in(1), "message": "x" * 201},
        ).status_code
        == 422
    )
    assert client.get("/v1/check-ins").status_code == 401


def test_due_check_in_is_delivered_to_latest_session(client, database_url: str) -> None:
    session_id = seed_session(database_url)
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    created = client.post(
        "/v1/check-ins",
        headers=AUTH,
        json={"kind": "call", "scheduled_for": past},
    ).json()

    with psycopg.connect(database_url) as conn:
        processed = process_due(conn, datetime.now(timezone.utc))
    assert len(processed) == 1
    assert processed[0]["id"] == created["id"]
    assert processed[0]["delivered_to"] == session_id

    with psycopg.connect(database_url) as conn:
        row = conn.execute(
            """
            SELECT role, body FROM messages
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()
        status = conn.execute(
            "SELECT status, sent_at IS NOT NULL FROM check_ins WHERE id = %s",
            (created["id"],),
        ).fetchone()
    assert row == ("assistant", "想听听你的声音，现在方便吗？")
    assert status == ("sent", True)


def test_daily_check_in_reschedules(client, database_url: str) -> None:
    seed_session(database_url)
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    created = client.post(
        "/v1/check-ins",
        headers=AUTH,
        json={"kind": "text", "scheduled_for": past, "recurrence": "daily"},
    ).json()

    with psycopg.connect(database_url) as conn:
        process_due(conn, datetime.now(timezone.utc))

    upcoming = client.get("/v1/check-ins", headers=AUTH).json()["upcoming"]
    assert len(upcoming) == 1
    assert upcoming[0]["recurrence"] == "daily"
    assert upcoming[0]["id"] != created["id"]
    next_at = datetime.fromisoformat(upcoming[0]["scheduled_for"])
    assert next_at > datetime.now(timezone.utc)


def test_due_without_any_session_does_not_crash(client, database_url: str) -> None:
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    client.post("/v1/check-ins", headers=AUTH, json={"kind": "text", "scheduled_for": past})
    with psycopg.connect(database_url) as conn:
        processed = process_due(conn, datetime.now(timezone.utc))
    assert processed[0]["delivered_to"] is None


class FakeTTS:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def __call__(
        self, text: str, tone: str = "curious", voice: str = "voice1", form: str = "buddy"
    ):
        self.calls.append((text, tone, voice, form))
        return b"ID3fake-voice", "audio/mpeg"


def make_runtime() -> Runtime:
    return Runtime(
        memory=FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=None,
        tts_generator=FakeTTS(),
        voicemem_status="ready",
    )


def test_call_check_in_attaches_voice_and_serves_it(
    client, database_url: str, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OLO_TTS_DIR", str(tmp_path / "tts"))
    session_id = seed_session(database_url)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    client.post("/v1/check-ins", headers=AUTH, json={"kind": "call", "scheduled_for": past})

    runtime = make_runtime()
    with psycopg.connect(database_url) as conn:
        process_due(conn, datetime.now(timezone.utc), runtime)
        row = conn.execute(
            """
            SELECT id, audio_relpath FROM messages
            WHERE session_id = %s ORDER BY created_at DESC LIMIT 1
            """,
            (session_id,),
        ).fetchone()

    assert row[1], "call check-in 应该带语音"
    assert runtime.tts_generator.calls[0][0] == "想听听你的声音，现在方便吗？"
    assert runtime.tts_generator.calls[0][3] == "buddy"

    audio = client.get(f"/v1/messages/{row[0]}/audio", headers=AUTH)
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/mpeg"
    assert audio.content == b"ID3fake-voice"

    assert client.get(f"/v1/messages/{row[0]}/audio").status_code == 401

    history = client.get(f"/v1/sessions/{session_id}/messages", headers=AUTH).json()
    assert history["messages"][-1]["has_audio"] is True


def test_text_check_in_stays_text_only(
    client, database_url: str, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OLO_TTS_DIR", str(tmp_path / "tts"))
    session_id = seed_session(database_url)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    client.post("/v1/check-ins", headers=AUTH, json={"kind": "text", "scheduled_for": past})
    with psycopg.connect(database_url) as conn:
        process_due(conn, datetime.now(timezone.utc), make_runtime())
        row = conn.execute(
            """
            SELECT audio_relpath FROM messages
            WHERE session_id = %s ORDER BY created_at DESC LIMIT 1
            """,
            (session_id,),
        ).fetchone()
    assert row[0] is None
