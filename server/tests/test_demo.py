"""离线演示模式：DemoChat 的 JSON 契约与完整 turn 流程。"""

import json

import pytest
from fastapi.testclient import TestClient

from olo.demo import DemoChat, make_demo_runtime
from olo.main import app

TOKEN = "test-api-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def test_demo_chat_streams_multiple_chunks() -> None:
    chat = DemoChat(chunk_size=4)
    pieces = list(chat.stream([{"role": "user", "content": "今天好累"}]))
    assert len(pieces) > 1
    assert "今天好累" in "".join(pieces)


def test_demo_chat_returns_notebook_json() -> None:
    chat = DemoChat()
    text = "".join(
        chat.stream(
            [
                {"role": "system", "content": "只输出 JSON 对象，写今天的日记。"},
                {"role": "user", "content": "我今天有点撑不住"},
            ]
        )
    )
    payload = json.loads(text)
    assert set(payload) == {"title", "body", "image_prompt", "mood", "quote_index"}
    assert "【原话】" in payload["body"] and payload["quote_index"] is None  # no candidate list given


def test_demo_chat_returns_insight_json() -> None:
    chat = DemoChat()
    text = "".join(
        chat.stream(
            [
                {"role": "system", "content": "只输出 JSON 对象，给一条观察。"},
                {"role": "user", "content": "我总在晚上怀疑自己"},
            ]
        )
    )
    payload = json.loads(text)
    assert set(payload) == {"category", "body"}


def test_demo_runtime_needs_no_network() -> None:
    runtime = make_demo_runtime()
    assert runtime.voicemem_status == "ready"
    assert "".join(runtime.llm.stream([{"role": "user", "content": "在吗"}]))


@pytest.fixture
def demo_client(head_database: str, monkeypatch: pytest.MonkeyPatch, tmp_path) -> object:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OLO_DEMO", "1")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", head_database)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    if hasattr(app.state, "runtime"):
        delattr(app.state, "runtime")
    with TestClient(app) as client:
        yield client


def _open_session(client) -> str:
    response = client.post("/v1/sessions", headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_demo_mode_runs_a_full_turn_offline(demo_client) -> None:
    session_id = _open_session(demo_client)
    turn = demo_client.post(
        f"/v1/sessions/{session_id}/turns",
        headers=AUTH,
        json={"client_msg_id": "demo-1", "text": "我今天有点撑不住"},
    )
    assert turn.status_code == 200, turn.text
    assert "撑不住" in turn.json()["assistant_message"]["body"]

    notebook = demo_client.post(
        "/v1/notebook/generate",
        headers=AUTH,
        json={"session_id": session_id},
    )
    assert notebook.status_code == 201, notebook.text
    assert notebook.json()["title"]
    assert notebook.json()["image_relpath"] is None

    insight = demo_client.post(
        "/v1/insights/generate",
        headers=AUTH,
        json={"session_id": session_id},
    )
    assert insight.status_code == 201, insight.text
    assert insight.json()["category"] == "wellbeing"

    garden = demo_client.get("/v1/garden", headers=AUTH).json()
    assert garden["messages"] >= 1
    assert garden["entries"] == 1
    assert garden["insights"] == 1
