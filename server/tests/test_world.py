"""雾里集小世界：收集物加币一次、每日上限、存档往返。"""

import pytest
from fastapi.testclient import TestClient

from olo.main import app
from olo.world import DAILY_CAP

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


def test_find_grants_once(client) -> None:
    base = client.get("/v1/world", headers=AUTH).json()
    assert base["today_earned"] == 0 and base["finds"] == []
    r = client.post("/v1/world/find", headers=AUTH, json={"find_id": "2026-10-23:lake:shell-1", "kind": "shell"}).json()
    assert r["granted"] == 1 and r["tokens"] == base["tokens"] + 1
    again = client.post("/v1/world/find", headers=AUTH, json={"find_id": "2026-10-23:lake:shell-1", "kind": "shell"}).json()
    assert again["granted"] == 0 and again["duplicate"] is True and again["tokens"] == r["tokens"]
    assert client.get("/v1/shop", headers=AUTH).json()["tokens"] == r["tokens"]


def test_daily_cap_and_bad_input(client) -> None:
    total = 0
    for i in range(10):
        total += client.post("/v1/world/find", headers=AUTH, json={"find_id": f"d:egg-{i}", "kind": "egg"}).json()["granted"]
    assert total == DAILY_CAP
    assert client.post("/v1/world/find", headers=AUTH, json={"find_id": "d:x", "kind": "gold"}).status_code == 422
    assert client.post("/v1/world/find", headers=AUTH, json={"find_id": "BAD ID!", "kind": "shell"}).status_code == 422
    assert client.get("/v1/world").status_code == 401


def test_state_roundtrip(client) -> None:
    st = {"plants": {"pot-1": {"stage": 2, "watered": "2026-10-23"}}, "lore": [0, 1]}
    assert client.put("/v1/world/state", headers=AUTH, json={"state": st}).json() == {"ok": True}
    assert client.get("/v1/world", headers=AUTH).json()["state"] == st
    assert client.put("/v1/world/state", headers=AUTH, json={"state": {"x": "a" * 20000}}).status_code == 413
