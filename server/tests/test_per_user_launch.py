"""Launch gaps: background jobs run for every user, persona cache is per user,
crisis replies follow the user's language, and the demo diary keeps its quote."""
import time
import uuid
from datetime import datetime, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

import olo.auth as auth
from olo.main import app, run_jobs_once
from olo.context import Persona
from olo.runtime import Runtime, testing_disabled_runtime
from olo.userctx import SEEDED_USER_ID, current_user_id, for_each_user, reset_current_user, set_current_user
from safety.patterns import SAFETY_REPLY, SAFETY_REPLY_EN, is_crisis, safety_reply

TOKEN = "test-api-token"


@pytest.fixture
def db(monkeypatch, head_database):
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    return head_database


def _new_user(db, locale="zh-CN") -> uuid.UUID:
    uid = uuid.uuid4()
    with psycopg.connect(db) as conn:
        auth.provision_user(conn, uid, f"{uid.hex[:8]}@example.com", locale)
        conn.commit()
    return uid


def _token(conn, uid) -> str:
    import secrets

    t = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO auth_tokens (token_hash, user_id) VALUES (%s, %s)", (auth._h(t), uid))
    return t


def test_for_each_user_visits_every_user_and_isolates_failures(db):
    a, b = _new_user(db), _new_user(db)
    seen = []

    def job():
        seen.append(current_user_id())
        if current_user_id() == a:
            raise RuntimeError("one user's job fails")
        return "ok"

    out = for_each_user(job)
    assert {SEEDED_USER_ID, a, b} <= set(seen)
    assert isinstance(out[a], RuntimeError) and out[b] == "ok"
    assert current_user_id() == SEEDED_USER_ID  # context restored


def test_run_jobs_once_runs_every_job_for_every_user(db, monkeypatch):
    a = _new_user(db)
    from olo import capture, checkins, consolidate, notebook, proactive

    calls: dict[str, set] = {k: set() for k in ("checkins", "proactive", "nightly", "capture", "consolidate")}

    def rec(name, ret=None):
        def f(*_a, **_k):
            calls[name].add(current_user_id())
            return ret if ret is not None else {}
        return f

    monkeypatch.setattr(checkins, "process_due_once", rec("checkins", []))
    monkeypatch.setattr(proactive, "tick", rec("proactive", {"sent": False, "reason": "quiet"}))
    monkeypatch.setattr(notebook, "nightly_tick", rec("nightly", {"written": None}))
    monkeypatch.setattr(capture, "tick", rec("capture"))
    monkeypatch.setattr(consolidate, "tick", rec("consolidate"))
    run_jobs_once(None, [0.0], 60)
    for name, users in calls.items():
        assert {SEEDED_USER_ID, a} <= users, name


def test_due_check_ins_are_delivered_only_inside_their_own_user(db):
    from olo.checkins import process_due

    a = _new_user(db)
    past = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with psycopg.connect(db) as conn:
        for uid in (SEEDED_USER_ID, a):
            conn.execute(
                "INSERT INTO check_ins (id, user_id, kind, message, scheduled_for, status) VALUES (%s, %s, 'text', %s, %s, 'pending')",
                (uuid.uuid4(), uid, f"hi {uid}", past),
            )
        conn.commit()
        tok = set_current_user(a)
        try:
            done = process_due(conn)
        finally:
            reset_current_user(tok)
        assert [d["message"] for d in done] == [f"hi {a}"]
        left = conn.execute("SELECT user_id FROM check_ins WHERE status = 'pending' AND scheduled_for = %s", (past,)).fetchall()
        assert (SEEDED_USER_ID,) in left and (a,) not in left


def test_capture_tick_submits_a_job_per_user(db, monkeypatch):
    from olo import capture

    a = _new_user(db)
    got = []
    monkeypatch.setattr(capture, "capture_mode", lambda: "batch")
    monkeypatch.setattr(capture, "run_capture", lambda conn, memory, user_id, now=None: got.append(user_id) or {"ran": False})
    rt = testing_disabled_runtime()
    rt.voicemem_status = "ready"
    for_each_user(lambda: capture.tick(rt))
    rt.ingest.drain(10)
    assert {SEEDED_USER_ID, a} <= set(got)


def test_persona_cache_is_per_user():
    rt = Runtime(memory=object(), io_lock=None, llm=None)
    a, b = uuid.uuid4(), uuid.uuid4()
    ta = set_current_user(a)
    rt.persona = Persona(name="Amber", stable_card="a")
    reset_current_user(ta)
    tb = set_current_user(b)
    try:
        assert rt.persona is None  # b never sees a's persona
        rt.persona = Persona(name="Mochi", stable_card="b")
    finally:
        reset_current_user(tb)
    ta = set_current_user(a)
    try:
        assert rt.persona.name == "Amber"
    finally:
        reset_current_user(ta)


def test_turns_cache_persona_under_the_requesting_user(db, monkeypatch):
    monkeypatch.setattr(auth, "_test_sender", type("R", (), {"send": lambda *a, **k: None, "name": "t"})())
    rt = testing_disabled_runtime()
    app.state.runtime = rt
    uid = _new_user(db)
    with psycopg.connect(db) as conn:
        conn.execute("UPDATE companion_personas SET name = 'Pip' WHERE user_id = %s", (uid,))
        tok = _token(conn, uid)
        conn.commit()
    h = {"Authorization": f"Bearer {tok}"}
    with TestClient(app) as c:
        sid = c.post("/v1/sessions", headers=h, json={}).json()["id"]
        r = c.post(f"/v1/sessions/{sid}/turns", headers=h, json={"client_msg_id": "p1", "text": "hello"})
        assert r.status_code == 200, r.text
    assert rt.personas[uid].name == "Pip"
    assert SEEDED_USER_ID not in rt.personas or rt.personas[SEEDED_USER_ID].name != "Pip"


def test_english_crisis_detection_and_reply():
    for text in ("I want to end it all", "I don't want to live anymore", "thinking about self-harm", "I took an overdose"):
        assert is_crisis(text), text
    assert not is_crisis("this homework is killing me")
    assert safety_reply("en") == SAFETY_REPLY_EN and "988" in SAFETY_REPLY_EN
    assert safety_reply("zh-CN") == SAFETY_REPLY == safety_reply(None)


def test_crisis_turn_replies_in_the_users_language(db):
    app.state.runtime = testing_disabled_runtime()
    uid = _new_user(db, locale="en")
    with psycopg.connect(db) as conn:
        tok = _token(conn, uid)
        conn.commit()
    h = {"Authorization": f"Bearer {tok}"}
    with TestClient(app) as c:
        sid = c.post("/v1/sessions", headers=h, json={}).json()["id"]
        r = c.post(f"/v1/sessions/{sid}/turns", headers=h, json={"client_msg_id": "c1", "text": "I want to kill myself"})
    assert r.status_code == 200, r.text
    assert r.json()["assistant_message"]["body"] == SAFETY_REPLY_EN


def test_demo_diary_keeps_quote_through_repair_round():
    """Root cause of the failing e2e: the diary length check triggers a repair
    round whose last user message is the critique, so the mock lost the quote."""
    import json

    from olo.demo import DemoChat

    system = "只输出 JSON 对象。写日记。"
    first = {"role": "user", "content": "对话……\n\n【可引用的原话】\n0. 今天加班好累"}
    repair = [first, {"role": "assistant", "content": "{}"}, {"role": "user", "content": "这一稿有个问题：太短"}]
    out = json.loads("".join(DemoChat().stream([{"role": "system", "content": system}, *repair])))
    assert out["quote_index"] == 0
