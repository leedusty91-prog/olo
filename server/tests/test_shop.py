"""商店与代币：余额、每日领取、购买、外观解锁联动。"""

import pytest
from fastapi.testclient import TestClient

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


def test_shop_lists_balance_and_items(client) -> None:
    body = client.get("/v1/shop", headers=AUTH).json()
    assert body["tokens"] == 100
    assert body["can_claim"] is True
    assert body["claim_amount"] == 5
    assert len(body["items"]) == 16
    bow = next(item for item in body["items"] if item["id"] == "hair:bow")
    assert bow["price"] == 20
    assert bow["owned"] is False


def test_claim_once_per_day(client) -> None:
    first = client.post("/v1/shop/claim", headers=AUTH)
    assert first.status_code == 200, first.text
    assert first.json() == {"tokens": 105, "claimed": 5}

    second = client.post("/v1/shop/claim", headers=AUTH)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "ALREADY_CLAIMED"

    assert client.get("/v1/shop", headers=AUTH).json()["can_claim"] is False


def test_buy_unlocks_appearance(client) -> None:
    bought = client.post(
        "/v1/shop/buy", headers=AUTH, json={"item_id": "hair:bow"}
    )
    assert bought.status_code == 201, bought.text
    assert bought.json()["tokens"] == 80

    shop = client.get("/v1/shop", headers=AUTH).json()
    bow = next(item for item in shop["items"] if item["id"] == "hair:bow")
    assert bow["owned"] is True

    appearance = client.put(
        "/v1/persona", headers=AUTH, json={"appearance": {"hair": "bow"}}
    )
    assert appearance.status_code == 200, appearance.text


def test_duplicate_purchase_and_unknown_item(client) -> None:
    client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "cheeks:dots"})
    again = client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "cheeks:dots"})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "ALREADY_OWNED"

    missing = client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "hat:crown"})
    assert missing.status_code == 404


def test_insufficient_tokens(client) -> None:
    assert (
        client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "form:glow"}).status_code
        == 201
    )
    assert (
        client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "form:cloud"}).status_code
        == 201
    )
    poor = client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "voice:voice2"})
    assert poor.status_code == 402
    assert poor.json()["error"]["code"] == "INSUFFICIENT_TOKENS"


def test_shop_requires_bearer_token(client) -> None:
    assert client.get("/v1/shop").status_code == 401
    assert client.post("/v1/shop/claim").status_code == 401
    assert client.post("/v1/shop/buy", json={"item_id": "hair:bow"}).status_code == 401


def test_plus_gets_more_tokens_and_shop_discount(client) -> None:
    client.post("/v1/subscription/activate", headers=AUTH, json={"plan": "monthly"})

    shop = client.get("/v1/shop", headers=AUTH).json()
    assert shop["claim_amount"] == 10
    bow = next(item for item in shop["items"] if item["id"] == "hair:bow")
    assert bow["base_price"] == 20
    assert bow["price"] == 16

    claimed = client.post("/v1/shop/claim", headers=AUTH)
    assert claimed.json() == {"tokens": 110, "claimed": 10}

    bought = client.post("/v1/shop/buy", headers=AUTH, json={"item_id": "hair:bow"})
    assert bought.status_code == 201, bought.text
    assert bought.json() == {"item_id": "hair:bow", "tokens": 94, "tokens_spent": 16}


def test_debug_grant_is_off_by_default(client, monkeypatch) -> None:
    monkeypatch.delenv("OLO_DEBUG", raising=False)
    assert client.post("/v1/debug/grant-tokens", headers=AUTH).status_code == 404
    assert "debug" not in client.get("/app/config.js").text
    monkeypatch.setenv("OLO_DEBUG", "0")
    assert client.post("/v1/debug/grant-tokens", headers=AUTH).status_code == 404


def test_debug_grant_adds_tokens_when_enabled(client, monkeypatch) -> None:
    monkeypatch.setenv("OLO_DEBUG", "1")
    assert client.post("/v1/debug/grant-tokens").status_code == 401
    r = client.post("/v1/debug/grant-tokens", headers=AUTH)
    assert r.status_code == 200 and r.json() == {"tokens": 200, "granted": 100}
    assert '"debug": true' in client.get("/app/config.js").text
