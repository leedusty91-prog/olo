import asyncio

import pytest
from fastapi.testclient import TestClient

from olo.main import app, lifespan, require_startup


@pytest.fixture(autouse=True)
def runtime_env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", "test-api-token")
    monkeypatch.setenv("OLO_TLS", "1")
    monkeypatch.delenv("OLO_DEMO", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://olo:password@127.0.0.1:1/olo",
    )


def test_healthz_does_not_open_database(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_if_called() -> bool:
        raise AssertionError("healthz opened a database connection")

    monkeypatch.setattr("olo.main.postgres_reachable", fail_if_called)
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert "test-api-token" not in response.text
    assert "test-openai-key" not in response.text


def test_readyz_returns_503_when_postgres_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://olo:closed-port-secret@127.0.0.1:1/olo",
    )
    with TestClient(app) as client:
        response = client.get("/readyz")
    assert response.status_code == 503
    body = response.json()
    assert body["postgres"] is False
    assert body["voicemem"] in {"warming", "ready", "failed"}
    assert "warmup_failed" in body
    assert "openai_key_present" in body
    assert "closed-port-secret" not in response.text


@pytest.mark.parametrize(
    "client_addr",
    [
        ("testclient", 50000),
        ("192.168.1.20", 50000),
        ("localhost", 50000),
        ("", 50000),
        None,
    ],
)
def test_metrics_rejects_non_loopback_without_metric_text(
    client_addr: tuple[str, int] | None,
) -> None:
    with TestClient(app, client=client_addr) as client:
        response = client.get("/metrics")
    assert response.status_code == 403
    assert "olo_up" not in response.text
    assert "# HELP" not in response.text
    assert "# TYPE" not in response.text
    assert "test-api-token" not in response.text
    assert "test-openai-key" not in response.text


def test_metrics_returns_text_for_ipv4_loopback() -> None:
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        response = client.get("/metrics")
    assert response.status_code == 200
    assert "olo_up 1" in response.text
    assert "test-api-token" not in response.text
    assert "test-openai-key" not in response.text


def test_metrics_returns_text_for_ipv6_loopback() -> None:
    with TestClient(app, client=("::1", 50000)) as client:
        response = client.get("/metrics")
    assert response.status_code == 200
    assert "olo_up 1" in response.text


def test_require_startup_rejects_missing_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OLO_API_TOKEN", "   ")
    with pytest.raises(SystemExit, match="OLO_API_TOKEN"):
        require_startup()


def test_require_startup_rejects_missing_openai_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "")
    with pytest.raises(SystemExit, match="OPENAI_API_KEY"):
        require_startup()


def test_require_startup_rejects_missing_cert_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", tmp_path / "missing.pem")
    with pytest.raises(SystemExit, match="TLS cert pair"):
        require_startup()


def test_require_startup_rejects_missing_key_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", tmp_path / "missing-key.pem")
    with pytest.raises(SystemExit, match="TLS cert pair"):
        require_startup()


def test_lifespan_rejects_missing_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OLO_API_TOKEN", raising=False)

    async def enter() -> None:
        async with lifespan(app):
            return

    with pytest.raises(SystemExit, match="OLO_API_TOKEN"):
        asyncio.run(enter())


def test_require_startup_allows_plain_http_when_tls_disabled(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("OLO_TLS", "0")
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", tmp_path / "missing.pem")
    require_startup()


def test_mock_provider_does_not_need_openai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    require_startup()
