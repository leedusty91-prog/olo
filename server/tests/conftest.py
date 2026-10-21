import os
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from alembic import command
from alembic.config import Config

SERVER_ROOT = Path(__file__).resolve().parents[1]
TEST_DB_NAME = "olo_test"


def swap_database(url: str, database: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, parts.fragment))


def alembic_config() -> Config:
    cfg = Config(str(SERVER_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER_ROOT / "alembic"))
    return cfg


def terminate_and_drop(admin_url: str) -> None:
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = %s AND pid <> pg_backend_pid()
            """,
            (TEST_DB_NAME,),
        )
        conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB_NAME}")


def reset_public(database_url: str) -> None:
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
        conn.execute("CREATE SCHEMA public")


@pytest.fixture(scope="session")
def test_database_url() -> Iterator[str]:
    admin_url = os.environ.get("DATABASE_URL", "").strip()
    if not admin_url:
        pytest.fail("DATABASE_URL is required so tests can reach Postgres")
    terminate_and_drop(admin_url)
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(f"CREATE DATABASE {TEST_DB_NAME}")
    yield swap_database(admin_url, TEST_DB_NAME)
    terminate_and_drop(admin_url)


@pytest.fixture
def database_url(test_database_url: str, monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setenv("DATABASE_URL", test_database_url)
    return test_database_url


@pytest.fixture
def head_database(database_url: str) -> str:
    reset_public(database_url)
    command.upgrade(alembic_config(), "head")
    return database_url


@pytest.fixture
def schema_0001(database_url: str) -> str:
    reset_public(database_url)
    command.upgrade(alembic_config(), "20261010_0001_init")
    return database_url
