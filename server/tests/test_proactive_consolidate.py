"""主动关心（proactive check-in）与夜间记忆整理。"""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo import consolidate, proactive
from olo.main import app
from olo.memory.fake import FakeMemory
from olo.memory.io_lock import VoicememIoLock
from olo.runtime import Runtime
from olo.sessions import SEEDED_USER_ID

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SH = timezone(timedelta(hours=8))


class NoLLM:
    def stream(self, messages):
        yield "嗯。"


@pytest.fixture
def runtime(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path) -> Runtime:
    cert, key = tmp_path / "lan.pem", tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.delenv("OLO_QUIET_HOURS", raising=False)
    monkeypatch.delenv("OLO_TZ", raising=False)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    rt = Runtime(memory=FakeMemory(), io_lock=VoicememIoLock(), llm=NoLLM(),
                 voicemem_status="ready", rate_limit_per_minute=10_000)
    app.state.runtime = rt
    return rt


@pytest.fixture
def client(runtime):
    with TestClient(app) as c:
        yield c


def seed_chat(url: str, text: str, at: datetime) -> str:
    sid = uuid.uuid4()
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO sessions (id, user_id, last_turn_at) VALUES (%s, %s, %s)", (sid, SEEDED_USER_ID, at))
        conn.execute(
            "INSERT INTO messages (id, session_id, role, modality, body, created_at) VALUES (%s, %s, 'user', 'text', %s, %s)",
            (uuid.uuid4(), sid, text, at),
        )
        conn.commit()
    return str(sid)


# ---------------------------------------------------------------- quiet hours

@pytest.mark.parametrize(
    ("hh", "quiet"),
    [(23, True), (2, True), (7, True), (8, False), (14, False), (22, False)],
)
def test_quiet_hours_default_shanghai(hh, quiet, monkeypatch) -> None:
    monkeypatch.delenv("OLO_QUIET_HOURS", raising=False)
    monkeypatch.delenv("OLO_TZ", raising=False)
    assert proactive.in_quiet_hours(datetime(2026, 10, 22, hh, 30, tzinfo=SH)) is quiet


def test_clean_message_keeps_one_question() -> None:
    assert proactive.clean_message("SKIP") is None
    assert proactive.clean_message("面试是明天吧？紧张吗？") == "面试是明天吧？"


# ---------------------------------------------------------------- proactive

def test_proactive_gates_and_delivery(client, runtime, head_database, monkeypatch) -> None:
    prompts: list[str] = []
    monkeypatch.setattr(proactive, "GENERATOR", lambda p: prompts.append(p) or "周四的面试准备得怎么样啦？还紧张吗？")
    runtime.memory.memories = [{"id": "a", "text": "用户周四下午有一场产品经理面试", "created_at": "2026-10-20T10:00:00"}]
    now = datetime(2026, 10, 22, 15, 0, tzinfo=SH)
    sid = seed_chat(head_database, "周四要面试了，有点慌", now - timedelta(hours=6))

    with psycopg.connect(head_database) as conn:
        assert proactive.run_once(conn, runtime.memory, now=now.replace(hour=23, minute=30))["reason"] == "quiet_hours"
        assert proactive.run_once(conn, runtime.memory, now=now - timedelta(hours=5))["reason"] == "recently_active"
        sent = proactive.run_once(conn, runtime.memory, now=now)
        assert sent["sent"] and sent["message"] == "周四的面试准备得怎么样啦？"
        assert "产品经理面试" in prompts[0] and "有点慌" in prompts[0]
        assert proactive.run_once(conn, runtime.memory, now=now + timedelta(hours=2))["reason"] == "daily_cap"
        # next local day is allowed again
        assert proactive.run_once(conn, runtime.memory, now=now + timedelta(days=1))["sent"]

    msgs = client.get(f"/v1/sessions/{sid}/messages?limit=10", headers=AUTH).json()["messages"]
    assert msgs[-1]["role"] == "assistant"

    state = client.get("/v1/proactive", headers=AUTH).json()
    assert state["enabled"] and state["unread_count"] == 2 and state["quiet_hours"] == "23:00-08:00"
    assert client.post("/v1/proactive/seen", headers=AUTH).json()["marked"] == 2
    assert client.get("/v1/proactive", headers=AUTH).json()["unread_count"] == 0

    assert client.put("/v1/proactive", headers=AUTH, json={"enabled": False}).json() == {"enabled": False}
    r = client.post("/v1/proactive/run", headers=AUTH, json={"force": True}).json()
    assert r == {"sent": False, "reason": "disabled"}


def test_proactive_skip_sends_nothing(client, runtime, head_database, monkeypatch) -> None:
    monkeypatch.setattr(proactive, "GENERATOR", lambda p: "SKIP")
    now = datetime.now(timezone.utc)
    seed_chat(head_database, "今天吃了碗面", now - timedelta(hours=1))
    r = client.post("/v1/proactive/run", headers=AUTH, json={"force": True}).json()
    assert r == {"sent": False, "reason": "nothing_to_ask"}


# ---------------------------------------------------------------- consolidation

def test_validate_plan_whitelists_ids_and_newest_wins() -> None:
    keyed = {
        "m1": {"id": "x1", "text": "用户喜欢喝咖啡", "created_at": "2026-10-01"},
        "m2": {"id": "x2", "text": "用户最近戒咖啡了", "created_at": "2026-10-20"},
        "m3": {"id": "x3", "text": "用户养了柯基豆豆", "created_at": "2026-10-05"},
    }
    merges, drops = consolidate.validate_plan(
        {"groups": [{"ids": ["m1", "m2", "m99"], "text": "用户以前爱喝咖啡，最近戒了"}], "drop": ["m2", "m77"]}, keyed
    )
    assert len(merges) == 1
    keep, text, others = merges[0]
    assert keep["id"] == "x2" and [o["id"] for o in others] == ["x1"]
    assert drops == []  # m2 already used, m77 unknown

    merges, drops = consolidate.validate_plan(
        {"groups": [{"ids": ["m3"], "text": "改写"}],
         "drop": [{"id": "m1", "by": "m2"}, {"id": "m2", "by": "m1"}, {"id": "m3"}]}, keyed
    )
    assert merges == []  # single-entry group = silent rewrite, refused
    assert [d["id"] for d in drops] == ["x1"]  # only superseded-by-newer drops survive


def test_consolidate_endpoint_merges_memories_canon_and_builds_profile(client, runtime, head_database, monkeypatch) -> None:
    runtime.memory.memories = [
        {"id": "a", "text": "用户养了一只柯基叫豆豆", "created_at": "2026-10-01T00:00:00"},
        {"id": "b", "text": "用户家的柯基名叫豆豆", "created_at": "2026-10-03T00:00:00"},
        {"id": "c", "text": "用户在一家咖啡豆公司上班", "created_at": "2026-10-02T00:00:00"},
        {"id": "d", "text": "用户喜欢跑步", "created_at": "2026-10-04T00:00:00"},
    ]
    with psycopg.connect(head_database) as conn:
        for i, fact in enumerate(["olo 最早是楼道口的一团雾", "olo 最早是一团飘在楼道口的雾", "olo 的好朋友是小栗"]):
            conn.execute(
                "INSERT INTO olo_canon (id, user_id, fact, created_at) VALUES (%s, %s, %s, %s)",
                (uuid.uuid4(), SEEDED_USER_ID, fact, datetime(2026, 10, 1 + i, tzinfo=timezone.utc)),
            )
        conn.commit()

    def ids_with(lines, word):
        return [ln.split()[0] for ln in lines.splitlines() if word in ln]

    def planner(what, lines):
        if "olo" in what:
            return {"groups": [{"ids": ids_with(lines, "楼道口"), "text": "olo 最早是飘在楼道口的一团雾"}]}
        return {"groups": [{"ids": ids_with(lines, "柯基"), "text": "用户养了一只柯基，叫豆豆"}]}

    monkeypatch.setattr(consolidate, "PLANNER", planner)
    monkeypatch.setattr(consolidate, "PROFILER", lambda items: "你是会给柯基豆豆留门的人。")
    r = client.post("/v1/memory/consolidate", headers=AUTH).json()
    assert r["ok"] and r["memories"]["deleted"] == 1 and r["canon"]["deleted"] == 1 and r["profile_updated"]
    texts = sorted(m["text"] for m in runtime.memory.memories)
    assert set(texts) == {"用户喜欢跑步", "用户在一家咖啡豆公司上班", "用户养了一只柯基，叫豆豆"}
    assert [m["id"] for m in runtime.memory.memories if "柯基" in m["text"]] == ["b"]  # newest kept
    with psycopg.connect(head_database) as conn:
        facts = set(r[0] for r in conn.execute("SELECT fact FROM olo_canon").fetchall())
    assert facts == {"olo 最早是飘在楼道口的一团雾", "olo 的好朋友是小栗"}

    prof = client.get("/v1/profile", headers=AUTH).json()
    assert prof["profile"] == "你是会给柯基豆豆留门的人。" and prof["last_run"]["trigger"] == "manual"


def test_destructive_plan_is_refused(runtime, head_database, monkeypatch) -> None:
    runtime.memory.memories = [{"id": str(i), "text": f"事实{i}", "created_at": f"2026-10-0{i}"} for i in range(1, 6)]
    monkeypatch.setattr(consolidate, "PLANNER", lambda w, l: {"drop": [{"id": f"m{i}", "by": "m5"} for i in range(1, 5)]})
    stats = consolidate.consolidate_user_memories(runtime.memory)
    assert stats["skipped"] == "plan deletes too much" and len(runtime.memory.memories) == 5


def test_nightly_due_once_per_night(head_database, monkeypatch) -> None:
    monkeypatch.delenv("OLO_CONSOLIDATE_HOUR", raising=False)
    night = datetime(2026, 10, 23, 3, 10, tzinfo=SH)
    with psycopg.connect(head_database) as conn:
        assert not consolidate.nightly_due(conn, night.replace(hour=14))
        assert consolidate.nightly_due(conn, night)
        consolidate.run(conn, FakeMemory(), trigger="nightly")
        # run() stamps now(); emulate it happening on that night
        conn.execute("UPDATE consolidation_runs SET created_at = %s", (night,))
        conn.commit()
        assert not consolidate.nightly_due(conn, night + timedelta(minutes=30))
        assert consolidate.nightly_due(conn, night + timedelta(days=1))
