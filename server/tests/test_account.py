import psycopg
import pytest
from fastapi.testclient import TestClient

from olo.main import app, require_startup
from olo.sessions import SEEDED_USER_ID

TOKEN = "test-api-token"
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(monkeypatch, head_database):
    database_url = head_database
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", database_url)
    with TestClient(app) as c:
        yield c


def test_legal_pages_are_public(client):
    for path in ("/privacy", "/terms"):
        r = client.get(path)
        assert r.status_code == 200 and "olo" in r.text


def test_export_requires_auth(client):
    assert client.get("/v1/account/export").status_code == 401


def test_export_then_delete_removes_user_rows(client, head_database):
    database_url = head_database
    sid = client.post("/v1/sessions", headers=H).json()
    assert sid
    data = client.get("/v1/account/export", headers=H).json()
    assert data["user_id"] == str(SEEDED_USER_ID)
    assert data["tables"]["sessions"], list(data["tables"])
    assert client.delete("/v1/account", headers=H).status_code == 400  # needs confirmation
    r = client.delete("/v1/account", headers={**H, "X-Confirm-Delete": "DELETE"})
    assert r.status_code == 200
    with psycopg.connect(database_url) as conn:
        n = conn.execute("SELECT count(*) FROM sessions WHERE user_id = %s", (SEEDED_USER_ID,)).fetchone()[0]
    assert n == 0


def test_debug_refused_on_public_server(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("OLO_DEBUG", "1")
    monkeypatch.setenv("OLO_PUBLIC", "1")
    with pytest.raises(SystemExit):
        require_startup()
