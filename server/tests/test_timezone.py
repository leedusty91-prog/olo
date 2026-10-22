"""Per-user timezone: quiet hours, day rollover, nightly job, caps and prompt time all follow users.timezone."""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo import consolidate, mood, proactive, subscription, usertz
from olo.context import Persona, assemble
from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime
from olo.sessions import SEEDED_USER_ID

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
LA = ZoneInfo("America/Los_Angeles")
UTC = timezone.utc


class NoLLM:
    def stream(self, messages):
        yield "嗯。"


@pytest.fixture
def client(head_database, monkeypatch, tmp_path):
    cert, key = tmp_path / "lan.pem", tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.delenv("OLO_TZ", raising=False)
    monkeypatch.delenv("OLO_QUIET_HOURS", raising=False)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    app.state.runtime = Runtime(memory=FakeMemory(), io_lock=VoicememIoLock(), llm=NoLLM(),
                                voicemem_status="ready", rate_limit_per_minute=10_000)
    with TestClient(app) as c:
        yield c


def set_tz(url, name):
    with psycopg.connect(url) as conn:
        conn.execute("UPDATE users SET timezone = %s WHERE id = %s", (name, SEEDED_USER_ID))
        conn.commit()


def test_normalize_validates_with_zoneinfo(monkeypatch) -> None:
    monkeypatch.delenv("OLO_TZ", raising=False)
    assert usertz.normalize("America/Los_Angeles") == "America/Los_Angeles"
    for bad in ("", "Mars/Olympus", "../etc/passwd", None, 42, "x" * 100):
        assert usertz.normalize(bad) is None
    assert usertz.default_name() == "Asia/Shanghai"


def test_default_is_shanghai_and_persona_put_updates(client, head_database) -> None:
    assert client.get("/v1/persona", headers=AUTH).json()["timezone"] == "Asia/Shanghai"
    r = client.put("/v1/persona", headers=AUTH, json={"timezone": "America/Los_Angeles"})
    assert r.status_code == 200 and r.json()["timezone"] == "America/Los_Angeles"
    r = client.put("/v1/persona", headers=AUTH, json={"timezone": "Nope/Nowhere"})
    assert r.json()["timezone"] == "America/Los_Angeles"
    assert client.get("/v1/mood", headers=AUTH).json()["timezone"] == "America/Los_Angeles"
    assert client.get("/v1/proactive", headers=AUTH).json()["timezone"] == "America/Los_Angeles"


def test_quiet_hours_follow_user_zone(head_database) -> None:
    set_tz(head_database, "America/Los_Angeles")
    # 15:00 Shanghai == 00:00 LA (PDT) -> quiet for an LA user
    sh_afternoon = datetime(2026, 10, 22, 15, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
    with psycopg.connect(head_database) as conn:
        conn.execute("UPDATE users SET checkins_enabled = true WHERE id = %s", (SEEDED_USER_ID,))
        tz = proactive.local_tz(conn)
        assert tz.key == "America/Los_Angeles"
        assert proactive.in_quiet_hours(sh_afternoon, tz)
        assert not proactive.in_quiet_hours(datetime(2026, 10, 22, 14, 0, tzinfo=LA), tz)
        assert proactive.run_once(conn, FakeMemory(), now=sh_afternoon)["reason"] == "quiet_hours"


def test_day_rollover_and_nightly_in_user_zone(head_database, monkeypatch) -> None:
    monkeypatch.delenv("OLO_CONSOLIDATE_HOUR", raising=False)
    set_tz(head_database, "America/Los_Angeles")
    with psycopg.connect(head_database) as conn:
        tz = usertz.user_tz(conn)
        late = datetime(2026, 10, 23, 6, 30, tzinfo=UTC)  # 10-22 23:30 in LA
        assert usertz.local_today(tz, late).isoformat() == "2026-10-22"
        assert usertz.local_today(tz, late + timedelta(hours=1)).isoformat() == "2026-10-23"
        assert mood.today(late, tz).isoformat() == "2026-10-22"
        assert consolidate.nightly_due(conn, datetime(2026, 10, 23, 3, 10, tzinfo=LA))
        assert not consolidate.nightly_due(conn, datetime(2026, 10, 23, 3, 10, tzinfo=ZoneInfo("Asia/Shanghai")))


def test_daily_message_cap_uses_user_day(head_database) -> None:
    set_tz(head_database, "Pacific/Kiritimati")  # UTC+14
    with psycopg.connect(head_database) as conn:
        tz = usertz.user_tz(conn)
        sid = uuid.uuid4()
        conn.execute("INSERT INTO sessions (id, user_id, last_turn_at) VALUES (%s, %s, now())", (sid, SEEDED_USER_ID))
        start = usertz.day_start(tz)
        for at in (start + timedelta(minutes=1), start - timedelta(minutes=1)):
            conn.execute(
                "INSERT INTO messages (id, session_id, role, modality, body, created_at) VALUES (%s, %s, 'user', 'text', 'hi', %s)",
                (uuid.uuid4(), sid, at),
            )
        assert subscription.usage(conn)["messages"] == 1


def test_chat_prompt_carries_user_local_time() -> None:
    line = usertz.time_context(LA, datetime(2026, 10, 23, 6, 30, tzinfo=UTC))
    assert "2026-10-22 23:30" in line and "深夜" in line and "America/Los_Angeles" in line
    system = assemble(Persona(stable_card="你叫 olo。"), [], None, None, "嗨", [], time_line=line)[0]["content"]
    assert "2026-10-22 23:30" in system
