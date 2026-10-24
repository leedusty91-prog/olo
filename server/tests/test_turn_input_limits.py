import pytest

from fastapi.testclient import TestClient


@pytest.fixture
def client(head_database: str, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("OLO_API_TOKEN", "t")
    from olo.main import app

    with TestClient(app) as c:
        yield c


def _session(client) -> str:
    return client.post("/v1/sessions", json={}, headers={"Authorization": "Bearer t"}).json()["id"]


@pytest.mark.parametrize("text", ["", "   ", None, "啊" * 2001])
def test_blank_or_huge_text_is_rejected(client, text) -> None:
    sid = _session(client)
    r = client.post(
        f"/v1/sessions/{sid}/turns",
        json={"client_msg_id": "c1", "text": text},
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_FAILED"
    msgs = client.get(f"/v1/sessions/{sid}/messages", headers={"Authorization": "Bearer t"}).json()
    assert msgs["messages"] == []
