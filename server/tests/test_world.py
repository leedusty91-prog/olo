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


def test_treasure_goes_into_diary_once(client) -> None:
    from olo.world import TREASURES

    base = client.get("/v1/world", headers=AUTH).json()
    assert base["treasures"] == [] and base["treasure_total"] == len(TREASURES) == 6
    r = client.post("/v1/world/treasure", headers=AUTH, json={"id": "paper-crane"}).json()
    assert r["new"] is True and r["granted"] == 5 and r["treasures"] == ["paper-crane"]
    again = client.post("/v1/world/treasure", headers=AUTH, json={"id": "paper-crane"}).json()
    assert again["new"] is False and again["granted"] == 0 and again["tokens"] == r["tokens"]
    entries = client.get("/v1/notebook", headers=AUTH).json()["entries"]
    crane = [e for e in entries if e["kind"] == "treasure-paper-crane"]
    assert len(crane) == 1 and "纸鹤" in crane[0]["title"] and "1/6" in crane[0]["title"]
    second = client.post("/v1/world/treasure", headers=AUTH, json={"id": "fallen-star"}).json()
    assert second["treasures"] == ["fallen-star", "paper-crane"]
    assert any("2/6" in e["title"] for e in client.get("/v1/notebook", headers=AUTH).json()["entries"])
    assert client.post("/v1/world/treasure", headers=AUTH, json={"id": "nope"}).status_code == 422


def test_photo_corner_llm_layout_is_sanitized(client, monkeypatch) -> None:
    from olo import corner

    seen = {}

    def fake(req):
        seen["req"] = req
        return {"title": "海边的下午好长的名字", "floor": "sand", "edge": "lava", "pond": True, "line": "咸咸的风。",
                "props": [{"type": "shell", "x": 2, "y": 2, "say": "贝壳里有海的声音。"}, {"type": "rock", "x": 2.3, "y": 2.2},
                          {"type": "laser", "x": 5, "y": 5}, {"type": "chime", "x": 6, "y": 1.5}, {"type": "reeds", "x": 1, "y": 5},
                          {"type": "crates", "x": 6.5, "y": 5.5, "label": "渔网箱"}, {"type": "bench", "x": 4, "y": 6.6}]}

    monkeypatch.setattr(corner, "GENERATOR", fake)
    body = {"palette": ["#88ccee", "#e8d49a", "nope"], "stats": {"blue": 0.7, "bright": 0.8}, "thumb": ["#112233"] * 108, "note": "海边"}
    r = client.post("/v1/world/corner", headers=AUTH, json=body).json()
    assert seen["req"].palette == ["#88ccee", "#e8d49a"]
    assert r["source"] == "llm" and r["title"] == "海边的下午好长的" and r["floor"] == "sand" and r["edge"] == "sand"
    types = [p["type"] for p in r["props"]]
    assert types == ["shell", "chime", "reeds", "crates"]  # 重叠的、不认识的、挡入口的都被丢掉
    assert r["props"][0]["say"] == "贝壳里有海的声音。" and r["props"][3]["label"] == "渔网箱" and r["props"][1]["label"] == "风铃"
    assert len(r["thumb"]) == 108
    listed = client.get("/v1/world/corners", headers=AUTH).json()["corners"]
    assert listed[0]["id"] == r["id"] and listed[0]["props"] == r["props"]


def test_photo_corner_falls_back_without_model(client, monkeypatch) -> None:
    from olo import corner

    monkeypatch.setattr(corner, "GENERATOR", lambda req: (_ for _ in ()).throw(RuntimeError("down")))
    r = client.post("/v1/world/corner", headers=AUTH, json={"palette": ["#4a7440"], "stats": {"green": 0.8}}).json()
    assert r["source"] == "fallback" and r["floor"] == "grass" and 4 <= len(r["props"]) <= 9 and r["thumb"] == []
    assert client.post("/v1/world/corner", headers=AUTH, json={"palette": ["red"]}).status_code == 422


def test_photo_corner_prompt_keeps_thinking_on(monkeypatch) -> None:
    from olo import corner
    from olo.llm import OpenAIChat

    captured = {}

    def stream(self, messages):
        captured["body"] = self.body(messages)
        yield '{"floor": "grass", "props": []}'

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("CHAT_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("CHAT_API_KEY", "test-key")
    monkeypatch.delenv("OLO_CHAT_THINKING", raising=False)
    monkeypatch.setattr(OpenAIChat, "stream", stream)
    out = corner._llm(corner.CornerRequest(palette=["#4a7440"], stats={"green": 0.8}))
    assert out == {"floor": "grass", "props": []}
    assert captured["body"]["thinking"] == {"type": "enabled"}
    assert "#4a7440" in captured["body"]["messages"][0]["content"]


def test_photo_corner_daily_cap(client, monkeypatch) -> None:
    monkeypatch.setenv("OLO_CORNER_DAILY_CAP", "2")
    body = {"palette": ["#4a7440"], "stats": {"green": 0.8}}
    assert client.post("/v1/world/corner", headers=AUTH, json=body).status_code == 200
    assert client.post("/v1/world/corner", headers=AUTH, json=body).status_code == 200
    r = client.post("/v1/world/corner", headers=AUTH, json=body)
    assert r.status_code == 429 and "明天" in r.text and "CORNER_DAILY_CAP" in r.text
    monkeypatch.setenv("OLO_CORNER_DAILY_CAP", "oops")  # 非法值 → 默认 5
    assert client.post("/v1/world/corner", headers=AUTH, json=body).status_code == 200
