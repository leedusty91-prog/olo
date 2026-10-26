import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

import olo.auth as auth
from olo.context import LANGUAGE_LINES
from olo.main import app, require_startup
from olo.memory.per_user import PerUserMemory
from olo.runtime import IngestQueue
from olo.userctx import SEEDED_USER_ID, current_user_id, reset_current_user, set_current_user

TOKEN = "test-api-token"
LEGACY = {"Authorization": f"Bearer {TOKEN}"}


class Recorder:
    name = "test"

    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, email, code, locale="zh-CN"):
        self.sent.append((email, code, locale))


@pytest.fixture
def mail(monkeypatch):
    r = Recorder()
    monkeypatch.setattr(auth, "_test_sender", r)
    return r


@pytest.fixture
def client(monkeypatch, head_database):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    from olo.runtime import testing_disabled_runtime

    app.state.runtime = testing_disabled_runtime()  # other test modules leave their own runtime on the app
    with TestClient(app) as c:
        yield c


def login(client, mail, email, locale="zh-CN"):
    assert client.post("/v1/auth/request-code", json={"email": email, "locale": locale}).status_code == 200
    code = [c for e, c, _ in mail.sent if e == email.lower()][-1]
    r = client.post("/v1/auth/verify", json={"email": email, "code": code, "locale": locale})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()


def test_email_code_login_creates_user_and_token_works(client, mail, head_database):
    h, body = login(client, mail, "A@Example.com")
    assert body["created"] is True
    me = client.get("/v1/me", headers=h).json()
    assert me["email"] == "a@example.com" and me["user_id"] != str(SEEDED_USER_ID)
    with psycopg.connect(head_database) as conn:
        # only a hash is stored, never the token or the code
        raw = h["Authorization"].split()[1]
        assert not conn.execute("SELECT 1 FROM auth_tokens WHERE token_hash = %s", (raw,)).fetchone()
        assert conn.execute("SELECT tokens FROM wallets WHERE user_id = %s", (uuid.UUID(me["user_id"]),)).fetchone()[0] == 100
    # second login reuses the same account
    _, again = login_after_cooldown(client, mail, "a@example.com", head_database)
    assert again["created"] is False and again["user_id"] == me["user_id"]


def login_after_cooldown(client, mail, email, db):
    with psycopg.connect(db) as conn:
        conn.execute("UPDATE auth_codes SET sent_at = now() - interval '2 minutes'")
    return login(client, mail, email)


def test_wrong_code_rejected_and_burns_after_five(client, mail):
    client.post("/v1/auth/request-code", json={"email": "b@example.com"})
    code = mail.sent[-1][1]
    for _ in range(5):
        assert client.post("/v1/auth/verify", json={"email": "b@example.com", "code": "000000" if code != "000000" else "111111"}).status_code == 401
    assert client.post("/v1/auth/verify", json={"email": "b@example.com", "code": code}).status_code == 401


def test_resend_is_rate_limited_and_bad_email_rejected(client, mail):
    assert client.post("/v1/auth/request-code", json={"email": "c@example.com"}).status_code == 200
    assert client.post("/v1/auth/request-code", json={"email": "c@example.com"}).status_code == 429
    assert client.post("/v1/auth/request-code", json={"email": "not-an-email"}).status_code == 400


def test_users_are_isolated(client, mail):
    ha, a = login(client, mail, "iso-a@example.com")
    hb, b = login(client, mail, "iso-b@example.com")
    sa = client.post("/v1/sessions", headers=ha).json()["id"]
    sb = client.post("/v1/sessions", headers=hb).json()["id"]
    assert sa != sb
    # B cannot read A's session
    assert client.get(f"/v1/sessions/{sa}/messages", headers=hb).status_code in (403, 404)
    assert client.get(f"/v1/sessions/{sa}/messages", headers=ha).status_code == 200
    # export only has your own rows
    ex = client.get("/v1/account/export", headers=hb).json()
    assert [r["id"] for r in ex["tables"]["sessions"]] == [sb]


def test_delete_one_user_leaves_others(client, mail, head_database):
    ha, a = login(client, mail, "del-a@example.com")
    hb, b = login(client, mail, "del-b@example.com")
    client.post("/v1/sessions", headers=ha)
    client.post("/v1/sessions", headers=hb)
    r = client.delete("/v1/account", headers={**ha, "X-Confirm-Delete": "DELETE"})
    assert r.status_code == 200 and r.json()["vector_memory_wiped"] is True
    assert client.get("/v1/me", headers=ha).status_code == 401  # token gone with the account
    assert client.get("/v1/me", headers=hb).status_code == 200
    with psycopg.connect(head_database) as conn:
        assert not conn.execute("SELECT 1 FROM users WHERE id = %s", (uuid.UUID(a["user_id"]),)).fetchone()
        assert conn.execute("SELECT count(*) FROM sessions WHERE user_id = %s", (uuid.UUID(b["user_id"]),)).fetchone()[0] == 1


def test_logout_revokes_token(client, mail):
    h, _ = login(client, mail, "out@example.com")
    assert client.post("/v1/auth/logout", headers=h).status_code == 200
    assert client.get("/v1/me", headers=h).status_code == 401


def test_legacy_token_can_be_disabled(client, monkeypatch):
    assert client.get("/v1/me", headers=LEGACY).json()["user_id"] == str(SEEDED_USER_ID)
    monkeypatch.setenv("OLO_LEGACY_TOKEN", "0")
    assert client.get("/v1/me", headers=LEGACY).status_code == 401


def test_report_only_own_messages(client, mail):
    h, _ = login(client, mail, "rep@example.com")
    assert client.post(f"/v1/messages/{uuid.uuid4()}/report", headers=h, json={"reason": "x"}).status_code == 404


def test_locale_switch_and_reply_language(client, mail):
    h, _ = login(client, mail, "en@example.com", locale="en-US")
    assert client.get("/v1/me", headers=h).json()["locale"] == "en"
    assert client.put("/v1/me/locale", headers=h, json={"locale": "zh-CN"}).json()["locale"] == "zh-CN"
    assert "English" in LANGUAGE_LINES["en"]


def test_legal_pages_follow_language(client):
    assert "Privacy Policy" in client.get("/privacy?lang=en").text
    assert "隐私政策" in client.get("/privacy", headers={"Accept-Language": "zh-CN"}).text
    assert "leedusty91@gmail.com" in client.get("/terms?lang=en").text


def test_public_server_refuses_dev_settings(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("OLO_PUBLIC", "1")
    monkeypatch.setenv("OLO_EMAIL_SENDER", "log")
    with pytest.raises(SystemExit):
        require_startup()
    monkeypatch.setenv("OLO_EMAIL_SENDER", "smtp")
    with pytest.raises(SystemExit):  # legacy shared token still on
        require_startup()
    monkeypatch.setenv("OLO_LEGACY_TOKEN", "0")
    monkeypatch.setenv("OLO_WEB_EMBED_TOKEN", "0")
    require_startup()


def test_per_user_memory_routes_by_current_user():
    made = {}

    class M:
        def __init__(self, uid):
            self.uid = uid
            self.items = [{"id": "1"}]

        def list_memories(self):
            return self.items

        def delete_memory(self, mid):
            self.items = [i for i in self.items if i["id"] != mid]
            return True

    seeded = M(SEEDED_USER_ID)
    pm = PerUserMemory(seeded, lambda uid: made.setdefault(uid, M(uid)))
    assert pm.uid == SEEDED_USER_ID
    other = uuid.uuid4()
    tok = set_current_user(other)
    try:
        assert pm.uid == other
        pm.wipe_user(other)
        assert made[other].items == []
        assert seeded.items == [{"id": "1"}]
    finally:
        reset_current_user(tok)


def test_ingest_queue_carries_user_into_worker():
    q = IngestQueue()
    seen = []
    uid = uuid.uuid4()
    tok = set_current_user(uid)
    try:
        q.submit(lambda: seen.append(current_user_id()))
    finally:
        reset_current_user(tok)
    q.drain()
    assert seen == [uid]
