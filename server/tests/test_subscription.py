"""订阅状态、模拟内购与免费额度。"""

import json
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime
from olo.sessions import SEEDED_USER_ID

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

NOTEBOOK_JSON = json.dumps(
    {
        "title": "今天",
        "body": "今天的日记。",
        "image_prompt": "a warm room",
        "mood": "calm",
    },
    ensure_ascii=False,
)


class ScriptedLLM:
    def __init__(self) -> None:
        self.calls = 0

    def stream(self, messages):
        self.calls += 1
        yield NOTEBOOK_JSON


@pytest.fixture
def runtime(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path) -> Runtime:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setenv("OLO_IMAGES_DIR", str(tmp_path / "images"))
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    runtime = Runtime(
        memory=FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=ScriptedLLM(),
        image_generator=lambda prompt: None,
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
    )
    app.state.runtime = runtime
    return runtime


@pytest.fixture
def client(runtime: Runtime) -> object:
    with TestClient(app) as test_client:
        yield test_client


def seed_messages(database_url: str, count: int) -> str:
    with psycopg.connect(database_url) as conn:
        session_id = uuid.uuid4()
        conn.execute(
            "INSERT INTO sessions (id, user_id) VALUES (%s, %s)",
            (session_id, SEEDED_USER_ID),
        )
        for index in range(count):
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, modality, body)
                VALUES (%s, %s, 'user', 'text', %s)
                """,
                (uuid.uuid4(), session_id, f"第 {index} 句"),
            )
        conn.commit()
    return str(session_id)


def test_default_subscription_is_free(client) -> None:
    body = client.get("/v1/subscription", headers=AUTH).json()
    assert body["tier"] == "free"
    assert body["is_plus"] is False
    assert body["limits"] == {"messages": 20, "notebook": 1, "insights": 1}
    assert body["usage"] == {"messages": 0, "notebook": 0, "insights": 0}
    assert body["perks"] == {"daily_tokens": 5, "shop_discount": 0.0}


def test_activate_plus_monthly(client) -> None:
    response = client.post(
        "/v1/subscription/activate",
        headers=AUTH,
        json={"plan": "monthly"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["tier"] == "plus"
    assert body["is_plus"] is True
    assert body["limits"] is None
    assert body["plan"] == "monthly"
    assert body["perks"] == {"daily_tokens": 10, "shop_discount": 0.2}
    assert body["renews_at"]

    assert client.get("/v1/subscription", headers=AUTH).json()["is_plus"] is True


def test_activate_rejects_unknown_plan(client) -> None:
    response = client.post(
        "/v1/subscription/activate",
        headers=AUTH,
        json={"plan": "weekly"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_cancel_keeps_plus_until_renewal(client) -> None:
    client.post("/v1/subscription/activate", headers=AUTH, json={"plan": "yearly"})
    body = client.post("/v1/subscription/cancel", headers=AUTH).json()
    assert body["status"] == "canceled"
    assert body["is_plus"] is True


def test_free_notebook_quota_blocks_second_entry(client, runtime, database_url) -> None:
    session_id = seed_messages(database_url, 3)
    first = client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": session_id},
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": session_id},
    )
    assert second.status_code == 402
    assert second.json()["error"]["code"] == "LIMIT_REACHED"

    client.post("/v1/subscription/activate", headers=AUTH, json={"plan": "monthly"})
    third = client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": session_id},
    )
    assert third.status_code == 201, third.text


def test_free_message_quota_blocks_after_twenty(client, runtime, database_url) -> None:
    session_id = seed_messages(database_url, 20)
    blocked = client.post(
        f"/v1/sessions/{session_id}/turns",
        headers=AUTH,
        json={"client_msg_id": "quota-1", "text": "还能聊吗"},
    )
    assert blocked.status_code == 402
    assert blocked.json()["error"]["code"] == "LIMIT_REACHED"

    client.post("/v1/subscription/activate", headers=AUTH, json={"plan": "monthly"})
    allowed = client.post(
        f"/v1/sessions/{session_id}/turns",
        headers=AUTH,
        json={"client_msg_id": "quota-2", "text": "现在呢"},
    )
    assert allowed.status_code == 200, allowed.text


def test_subscription_requires_bearer_token(client) -> None:
    assert client.get("/v1/subscription").status_code == 401
    assert client.post("/v1/subscription/activate", json={"plan": "monthly"}).status_code == 401
    assert client.post("/v1/subscription/cancel").status_code == 401
