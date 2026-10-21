"""花园成长投影：只读统计，不依赖 LLM 或运行时。"""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo.main import app
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


def seed_growth(database_url: str) -> None:
    now = datetime.now(timezone.utc)
    with psycopg.connect(database_url) as conn:
        session_id = uuid.uuid4()
        conn.execute(
            "INSERT INTO sessions (id, user_id) VALUES (%s, %s)",
            (session_id, SEEDED_USER_ID),
        )
        for index in range(5):
            conn.execute(
                """
                INSERT INTO messages (id, session_id, role, modality, body, created_at)
                VALUES (%s, %s, 'user', 'text', '聊一句', %s)
                """,
                (
                    uuid.uuid4(),
                    session_id,
                    now - timedelta(days=index % 3, minutes=index),
                ),
            )
        conn.execute(
            """
            INSERT INTO notebook_entries (id, user_id, entry_date, title, body)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (uuid.uuid4(), SEEDED_USER_ID, now.date(), "第一篇", "正文"),
        )
        conn.execute(
            """
            INSERT INTO insights (id, user_id, category, body)
            VALUES (%s, %s, 'wellbeing', '你最近有点累。')
            """,
            (uuid.uuid4(), SEEDED_USER_ID),
        )
        conn.commit()


def test_fresh_garden_starts_at_level_one(client) -> None:
    response = client.get("/v1/garden", headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["level"] == 1
    assert body["max_level"] == 5
    assert body["growth"] == 0
    assert body["score"] == 0
    assert body["next_level_score"] == 20
    assert body["messages"] == body["entries"] == body["insights"] == body["days"] == 0
    assert all(item["reached"] is False for item in body["milestones"])


def test_garden_grows_with_activity(client, database_url: str) -> None:
    seed_growth(database_url)
    body = client.get("/v1/garden", headers=AUTH).json()

    # 5 条消息 *2 + 1 篇日记 *12 + 1 条洞察 *8 = 30
    assert body["score"] == 30
    assert body["level"] == 2
    assert body["growth"] == 25
    assert body["next_level_score"] == 60
    assert body["messages"] == 5
    assert body["entries"] == 1
    assert body["insights"] == 1
    assert body["days"] == 3

    reached = {item["key"]: item["reached"] for item in body["milestones"]}
    assert reached == {
        "first_talk": True,
        "five_talks": True,
        "first_entry": True,
        "first_insight": True,
        "three_days": True,
        "ten_days": False,
    }


def test_garden_requires_bearer_token(client) -> None:
    assert client.get("/v1/garden").status_code == 401
