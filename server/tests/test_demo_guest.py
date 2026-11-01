"""Portfolio demo: OLO_DEMO_GUEST isolation, OLO_DEMO_SLIM hiding, caps, language, stretch."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from olo import guest
from olo.context import Persona, assemble, reply_language
from olo.main import app
from olo.turns import stretch_of
from tests.test_turns import TOKEN, AUTH, ScriptedLLM, runtime  # noqa: F401


def gh(gid: str) -> dict:
    return {"X-Olo-Guest": gid}


def new_guest() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def demo(runtime, monkeypatch):  # noqa: F811
    monkeypatch.setenv("OLO_DEMO_GUEST", "1")
    monkeypatch.setenv("OLO_DEMO_SLIM", "1")
    monkeypatch.setenv("OLO_WEB_EMBED_TOKEN", "1")
    monkeypatch.setenv("OLO_DEBUG", "1")
    guest.reset_ip_hits()
    return runtime


def turn(client, gid, sid, text, n):
    return client.post(f"/v1/sessions/{sid}/turns", headers={**gh(gid), "Accept": "application/json"},
                       json={"client_msg_id": f"m{n}", "text": text})


def session(client, gid):
    r = client.post("/v1/sessions", headers=gh(gid))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_flags_default_off(runtime, monkeypatch):  # noqa: F811
    for k in ("OLO_DEMO_GUEST", "OLO_DEMO_SLIM"):
        monkeypatch.delenv(k, raising=False)
    with TestClient(app) as c:
        assert c.post("/v1/sessions", headers=AUTH).status_code == 200
        assert c.get("/v1/shop", headers=AUTH).status_code == 200
        assert "guest" not in c.get("/app/config.js").text


def test_two_guests_are_isolated(demo):
    a, b = new_guest(), new_guest()
    with TestClient(app) as c:
        sa = session(c, a)
        assert turn(c, a, sa, "我叫小林，在学日语", 1).status_code == 200
        c.post("/v1/onboarding", headers=gh(a), json={"name": "阿啵", "form": "buddy"})
        sb = session(c, b)
        assert sb != sa
        # B cannot read or write A's session
        assert c.get(f"/v1/sessions/{sa}/messages", headers=gh(b)).status_code == 404
        assert turn(c, b, sa, "hi", 2).status_code == 404
        assert c.get(f"/v1/sessions/{sb}/messages", headers=gh(b)).json()["messages"] == []
        bodies = [m["body"] for m in c.get(f"/v1/sessions/{sa}/messages", headers=gh(a)).json()["messages"]]
        assert "我叫小林，在学日语" in bodies
        pa, pb = c.get("/v1/persona", headers=gh(a)).json(), c.get("/v1/persona", headers=gh(b)).json()
        assert pa["name"] == "阿啵" and pb["name"] != "阿啵"
        assert not pb.get("onboarded")


def test_guest_mode_rejects_owner_token_and_bad_ids(demo):
    with TestClient(app) as c:
        assert c.post("/v1/sessions", headers=AUTH).status_code == 401
        assert c.post("/v1/sessions", headers=gh("not-a-uuid")).status_code == 401
        # Even the owner's id as a guest id maps into the guest namespace, never to the owner.
        assert guest.guest_user_id(str(guest.OWNER_USER_ID)) != guest.OWNER_USER_ID
        cfg = c.get("/app/config.js").text
        assert TOKEN not in cfg and '"guest": true' in cfg and '"slim": true' in cfg and "debug" not in cfg


def test_guest_never_touches_owner_rows(demo, head_database):
    import psycopg

    a = new_guest()
    with TestClient(app) as c:
        turn(c, a, session(c, a), "hello there", 1)
    with psycopg.connect(head_database) as conn:
        n = conn.execute("SELECT count(*) FROM sessions WHERE user_id = %s", (guest.OWNER_USER_ID,)).fetchone()[0]
    assert n == 0


@pytest.mark.parametrize("path,method", [
    ("/v1/world", "get"), ("/v1/garden", "get"), ("/v1/olo/chapters", "get"), ("/v1/postcards", "get"),
    ("/v1/shop", "get"), ("/v1/debug/grant-tokens", "post"), ("/v1/subscription/activate", "post"),
    ("/v1/notebook", "get"), ("/v1/insights", "get"), ("/v1/mood", "get"), ("/v1/proactive", "get"),
    ("/v1/proactive/run", "post"), ("/v1/check-ins", "get"), ("/v1/speech", "post"),
    ("/v1/memory/consolidate", "post"), ("/metrics", "get"), ("/docs", "get"), ("/openapi.json", "get"),
])
def test_slim_hides_features(demo, path, method):
    with TestClient(app) as c:
        assert getattr(c, method)(path, headers=gh(new_guest())).status_code == 404


def test_slim_keeps_core(demo):
    g = new_guest()
    with TestClient(app) as c:
        assert c.get("/v1/persona", headers=gh(g)).status_code == 200
        assert c.get("/v1/profile", headers=gh(g)).status_code == 200


def test_guest_daily_cap(demo, monkeypatch):
    monkeypatch.setenv("OLO_DEMO_GUEST_DAILY", "3")
    a, b = new_guest(), new_guest()
    with TestClient(app) as c:
        sa = session(c, a)
        assert [turn(c, a, sa, f"第{i}句", i).status_code for i in range(3)] == [200, 200, 200]
        r = turn(c, a, sa, "再来", 9)
        assert r.status_code == 429 and r.json()["error"]["code"] == "DEMO_GUEST_LIMIT"
        assert "明天" in r.json()["error"]["message"]
        assert turn(c, b, session(c, b), "我是新来的", 1).status_code == 200  # others unaffected


def test_site_daily_cap(demo, monkeypatch):
    monkeypatch.setenv("OLO_DEMO_SITE_DAILY", "2")
    with TestClient(app) as c:
        for i in range(2):
            g = new_guest()
            assert turn(c, g, session(c, g), "hi there", i).status_code == 200
        g = new_guest()
        r = turn(c, g, session(c, g), "hi there", 5)
        assert r.status_code == 429 and r.json()["error"]["code"] == "DEMO_SITE_LIMIT"


def test_ip_rate_cap(demo, monkeypatch):
    monkeypatch.setenv("OLO_DEMO_IP_PER_MIN", "2")
    with TestClient(app) as c:
        codes = []
        for i in range(3):
            g = new_guest()
            codes.append(c.post(f"/v1/sessions/{session(c, g)}/turns",
                                headers={**gh(g), "CF-Connecting-IP": "203.0.113.9"},
                                json={"client_msg_id": f"x{i}", "text": "hey you"}).status_code)
        assert codes == [200, 200, 429]


def test_reply_language():
    assert reply_language("I had a long day at work") == "en"
    assert reply_language("今天加班到九点") == "zh"
    assert reply_language("ok") == "en"
    assert reply_language("我在学 Python") == "zh"


def test_english_user_gets_english_rule():
    p = Persona(name="olo", stable_card="你是 olo。")
    msgs = assemble(p, [], None, None, "how are you doing today?", [])
    assert "English" in msgs[0]["content"] and msgs[-2]["role"] == "system" and "English" in msgs[-2]["content"]
    zh = assemble(p, [], None, None, "你今天怎么样", [])
    assert "LANGUAGE" not in zh[0]["content"] and zh[-2]["role"] == "system"


def test_stretch_counts_only_current_conversation():
    now = datetime.now(timezone.utc)
    rows = [  # newest first
        ("assistant", "嗯", now - timedelta(minutes=1)),
        ("user", "刚洗完澡", now - timedelta(minutes=1)),
        ("assistant", "晚安", now - timedelta(hours=2)),
        ("user", "睡了", now - timedelta(hours=2, minutes=1)),
        ("user", "在吗", now - timedelta(hours=2, minutes=2)),
    ]
    out = stretch_of(rows, now)
    assert [m["content"] for m in out] == ["刚洗完澡", "嗯"]
