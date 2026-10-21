import os
from pathlib import Path

import psycopg

CONNECT_TIMEOUT_SECONDS = 2


def load_dotenv(path: Path) -> None:
    """Fill unset variables from a local env file. Existing process env wins."""
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit("refusing to start: cannot read .env") from exc
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def connect() -> psycopg.Connection:
    return psycopg.connect(database_url(), connect_timeout=CONNECT_TIMEOUT_SECONDS)
