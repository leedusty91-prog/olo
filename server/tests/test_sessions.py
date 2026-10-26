import logging
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from olo.main import app
from olo.sessions import SEEDED_USER_ID, ApiError, check_bearer

TOKEN = "test-api-token"


@pytest.fixture
def runtime_env(monkeypatch: pytest.MonkeyPatch, tmp_path, database_url: str) -> str:
    cert = tmp_path / "lan.pem"
    key = tmp_path / "lan-key.pem"
    cert.write_text("cert\n", encoding="utf-8")
    key.write_text("key\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("olo.main.DEFAULT_CERT_FILE", cert)
    monkeypatch.setattr("olo.main.DEFAULT_KEY_FILE", key)
    return database_url


@pytest.fixture
def client(runtime_env: str) -> object:
    with TestClient(app) as test_client:
        yield test_client


def auth_headers(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


UNAUTHORIZED = {
    "error": {
        "code": "UNAUTHORIZED",
        "message": "missing or invalid bearer token",
    }
}


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong-token"},
        {"Authorization": "Basic test-api-token"},
        {"Authorization": "Bearer"},
    ],
)
def test_post_sessions_without_valid_bearer_is_401(
    runtime_env: str,
    headers: dict[str, str],
) -> None:
    with TestClient(app) as test_client:
        denied = test_client.post("/v1/sessions", headers=headers)
        health = test_client.get("/healthz")
        ready = test_client.get("/readyz")
        metrics = test_client.get("/metrics")
    assert denied.status_code == 401
    assert denied.json() == UNAUTHORIZED
    assert TOKEN not in denied.text
    assert "wrong-token" not in denied.text
    assert health.status_code == 200
    assert health.json() == {"ok": True}
    assert ready.status_code == 200
    ready_body = ready.json()
    assert ready_body["postgres"] is True
    assert "voicemem" in ready_body
    assert "openai_key_present" in ready_body
    assert metrics.status_code == 403


def test_post_sessions_rejects_latin1_bearer_without_logging(
    runtime_env: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    presented = "caf\xe9"
    # httpx encodes str headers as ASCII. Pass the latin-1 byte the bug sends.
    header = f"Bearer {presented}".encode("latin-1")
    with caplog.at_level(logging.DEBUG, logger="olo.sessions"):
        with TestClient(app) as test_client:
            denied = test_client.post("/v1/sessions", headers={"Authorization": header})
    assert denied.status_code == 401
    assert denied.json() == UNAUTHORIZED
    assert presented not in denied.text
    assert TOKEN not in denied.text
    assert presented not in caplog.text
    assert TOKEN not in caplog.text


def test_post_sessions_rejects_non_ascii_configured_token_without_logging(
    runtime_env: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    configured = "tok\xe9n"
    monkeypatch.setenv("OLO_API_TOKEN", configured)
    with caplog.at_level(logging.DEBUG, logger="olo.sessions"):
        with TestClient(app) as test_client:
            denied = test_client.post(
                "/v1/sessions",
                headers={"Authorization": "Bearer wrong-token"},
            )
    assert denied.status_code == 401
    assert denied.json() == UNAUTHORIZED
    assert configured not in denied.text
    assert "wrong-token" not in denied.text
    assert configured not in caplog.text
    assert "wrong-token" not in caplog.text


def test_require_bearer_treats_unencodable_header_as_401(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("OLO_API_TOKEN", TOKEN)
    with caplog.at_level(logging.DEBUG, logger="olo.sessions"):
        with pytest.raises(ApiError) as caught:
            check_bearer("Bearer bad\udcfftoken")
    assert caught.value.status_code == 401
    assert caught.value.code == "UNAUTHORIZED"
    assert caught.value.message == "missing or invalid bearer token"
    assert TOKEN not in caplog.text


def test_post_sessions_reuses_open_session_within_six_hours(
    client: TestClient,
    head_database: str,
) -> None:
    first = client.post("/v1/sessions", headers=auth_headers())
    second = client.post("/v1/sessions", headers=auth_headers())
    assert first.status_code == 200
    assert second.status_code == 200
    first_body = first.json()
    assert set(first_body) == {"id", "reused"}
    assert first_body["reused"] is False
    uuid.UUID(first_body["id"])
    assert second.json() == {"id": first_body["id"], "reused": True}
    assert TOKEN not in second.text
    with psycopg.connect(head_database) as conn:
        count = conn.execute("SELECT count(*) FROM sessions").fetchone()
    assert count == (1,)


def test_post_sessions_skips_stale_or_ended_sessions(
    client: TestClient,
    head_database: str,
) -> None:
    created = client.post("/v1/sessions", headers=auth_headers())
    assert created.status_code == 200
    stale_id = created.json()["id"]
    with psycopg.connect(head_database) as conn:
        conn.execute(
            """
            UPDATE sessions
            SET last_turn_at = now() - interval '7 hours'
            WHERE id = %s
            """,
            (stale_id,),
        )
    fresh = client.post("/v1/sessions", headers=auth_headers())
    assert fresh.status_code == 200
    fresh_body = fresh.json()
    assert fresh_body["reused"] is False
    assert fresh_body["id"] != stale_id

    ended_id = fresh_body["id"]
    with psycopg.connect(head_database) as conn:
        conn.execute(
            """
            UPDATE sessions
            SET ended_at = now(), last_turn_at = now()
            WHERE id = %s
            """,
            (ended_id,),
        )
    after_end = client.post("/v1/sessions", headers=auth_headers())
    assert after_end.status_code == 200
    after_body = after_end.json()
    assert after_body["reused"] is False
    assert after_body["id"] not in {stale_id, ended_id}


def test_post_sessions_reuses_latest_open_session(
    client: TestClient,
    head_database: str,
) -> None:
    created = client.post("/v1/sessions", headers=auth_headers())
    assert created.status_code == 200
    older_id = created.json()["id"]
    newer_id = uuid.uuid4()
    with psycopg.connect(head_database) as conn:
        conn.execute(
            """
            INSERT INTO sessions (id, user_id, last_turn_at)
            VALUES (%s, %s, now())
            """,
            (newer_id, SEEDED_USER_ID),
        )
        conn.execute(
            """
            UPDATE sessions
            SET last_turn_at = now() - interval '1 hour'
            WHERE id = %s
            """,
            (older_id,),
        )
    reused = client.post("/v1/sessions", headers=auth_headers())
    assert reused.status_code == 200
    assert reused.json() == {"id": str(newer_id), "reused": True}
