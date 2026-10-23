"""小窝出门明信片：两句话、存档、每日上限、不发代币、模型挂了退回内置故事。"""

import json

import pytest
from fastapi.testclient import TestClient

from olo import postcards
from olo.main import app

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


def test_trip_story_saved_and_capped(client, monkeypatch) -> None:
    seen = {}

    def fake(runtime, system, payload):
        seen["system"] = system
        return {"title": "灯籽湾 · 傍晚", "story": "湖水像橘子糖。芦婆婆在远处划船。第三句不该留下。"}

    monkeypatch.setattr(postcards, "complete_json", fake)
    tokens = client.get("/v1/shop", headers=AUTH).json()["tokens"]
    r = client.post("/v1/postcards", headers=AUTH, json={"place": "lake"})
    assert r.status_code == 201
    card = r.json()
    assert card["story"] == "湖水像橘子糖。芦婆婆在远处划船。"
    assert card["place"] == "lake" and card["left_today"] == postcards.DAILY_LIMIT - 1
    assert "不吃饭不睡觉" in seen["system"] and "只输出 JSON" in seen["system"]
    for _ in range(postcards.DAILY_LIMIT - 1):
        assert client.post("/v1/postcards", headers=AUTH, json={"place": "roof"}).status_code == 201
    over = client.post("/v1/postcards", headers=AUTH, json={"place": "plaza"})
    assert over.status_code == 429 and over.json()["error"]["code"] == "DAILY_LIMIT"
    listed = client.get("/v1/postcards", headers=AUTH).json()
    assert len(listed["postcards"]) == postcards.DAILY_LIMIT and listed["left_today"] == 0
    assert client.get("/v1/shop", headers=AUTH).json()["tokens"] == tokens  # 不发代币


def test_fallback_and_validation(client, monkeypatch) -> None:
    def boom(*_a, **_k):
        raise RuntimeError("down")

    monkeypatch.setattr(postcards, "complete_json", boom)
    card = client.post("/v1/postcards", headers=AUTH, json={"place": "plaza"}).json()
    assert card["story"] in postcards.FALLBACK["plaza"]
    assert client.post("/v1/postcards", headers=AUTH, json={"place": "moon"}).status_code == 422
    assert client.get("/v1/postcards").status_code == 401


def test_demo_llm_writes_postcard() -> None:
    from olo.demo import DemoChat

    out = "".join(DemoChat().stream([{"role": "system", "content": postcards.SYSTEM}, {"role": "user", "content": "这次去的是：屋顶。"}]))
    data = json.loads(out)
    assert data["title"] and postcards._clean_story(data["story"]).count("。") == 2
