"""GET /v1/world/state：活的雾里集数据摘要——聊天天数/连续天数、近 7 天心情、明信片、日记；只算自己的数据。"""

import uuid
from datetime import timedelta

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
        yield test_client, head_database


def _chat(conn, user_id, days_ago: list[int]) -> None:
    sid = uuid.uuid4()
    conn.execute("INSERT INTO sessions (id, user_id) VALUES (%s, %s)", (sid, user_id))
    for d in days_ago:
        conn.execute(
            "INSERT INTO messages (id, session_id, role, modality, body, created_at) VALUES (%s, %s, 'user', 'text', 'hi', now() - make_interval(days => %s))",
            (uuid.uuid4(), sid, d),
        )


def test_new_user_is_quiet(client) -> None:
    c, _ = client
    body = c.get("/v1/world/state", headers=AUTH).json()
    assert body["chat_days"] == 0 and body["streak"] == 0 and body["mood"] is None
    assert body["postcards"] == 0 and body["diary"] == 0


def test_summary_counts_only_own_data(client) -> None:
    c, db = client
    c.get("/v1/world/state", headers=AUTH)  # 确保种子用户存在
    other = uuid.uuid4()
    with psycopg.connect(db) as conn:
        tz = conn.execute("SELECT timezone FROM users WHERE id = %s", (SEEDED_USER_ID,)).fetchone()[0] or "UTC"
        conn.execute("UPDATE users SET timezone = %s WHERE id = %s", (tz, SEEDED_USER_ID))
        conn.execute("INSERT INTO users (id, display_name) VALUES (%s, 'other')", (other,))
        _chat(conn, SEEDED_USER_ID, [0, 0, 1, 2, 5])  # 4 天，连续 3 天
        _chat(conn, other, [0, 1, 2, 3, 4, 6, 8])
        today = conn.execute("SELECT (now() AT TIME ZONE %s)::date", (tz,)).fetchone()[0]
        for k, (s, t) in enumerate([(1.0, 2), (0.5, 1), (-0.5, 1)]):
            conn.execute("INSERT INTO mood_daily (user_id, day, score_sum, turns) VALUES (%s, %s, %s, %s)", (SEEDED_USER_ID, today - timedelta(days=k), s, t))
        conn.execute("INSERT INTO mood_daily (user_id, day, score_sum, turns) VALUES (%s, %s, -1, 1)", (SEEDED_USER_ID, today - timedelta(days=20)))
        conn.execute("INSERT INTO mood_daily (user_id, day, score_sum, turns) VALUES (%s, %s, -5, 5)", (other, today))
        for place in ["lake", "lake", "forest"]:
            conn.execute("INSERT INTO postcards (id, user_id, place, title, story, made_on) VALUES (%s, %s, %s, 't', 's', %s)", (uuid.uuid4(), SEEDED_USER_ID, place, today))
        conn.execute("INSERT INTO postcards (id, user_id, place, title, story, made_on) VALUES (%s, %s, 'lake', 't', 's', %s)", (uuid.uuid4(), other, today))
        for k in range(2):
            conn.execute("INSERT INTO notebook_entries (id, user_id, entry_date, title, body) VALUES (%s, %s, %s, 't', 'b')", (uuid.uuid4(), SEEDED_USER_ID, today - timedelta(days=k)))
        conn.execute("INSERT INTO notebook_entries (id, user_id, entry_date, title, body) VALUES (%s, %s, %s, 't', 'b')", (uuid.uuid4(), other, today))
        conn.commit()
    body = c.get("/v1/world/state", headers=AUTH).json()
    assert body["chat_days"] == 4
    assert body["streak"] == 3
    assert body["mood_days"] == 3 and body["mood"] == pytest.approx((0.5 + 0.5 - 0.5) / 3, abs=1e-3)
    assert body["postcards"] == 3 and body["places"] == 2
    assert body["diary"] == 2
    assert body["today"] == today.isoformat()


def test_requires_token(client) -> None:
    c, _ = client
    assert c.get("/v1/world/state").status_code == 401







