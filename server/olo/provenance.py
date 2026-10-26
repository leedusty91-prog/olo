"""Where a chat message came from: the real app, the demo seed, or a test/smoke run.

Only ``app`` messages are the user's own words. Seed and test turns must never become memory,
never ground a memory and never be cited. New rows carry ``messages.source``; old rows (before the
column) are classified by fallback: test client_msg_id prefixes, and id-less user rows in the
demo seed session.
"""
from __future__ import annotations

import re

SEED_SESSION_ID = "11111111-1111-4111-8111-111111111111"
TEST_ID = re.compile(r"^(smoke|test|mac|flash|eval|ci)[-_]", re.I)
SOURCES = ("app", "seed", "test")


def source_of(*, client_msg_id: str | None = None, source: str | None = None, header: str | None = None) -> str:
    """Source for an incoming turn: an explicit X-OLO-Source header wins, then the id prefix."""
    for s in (header, source):
        s = (s or "").strip().lower()
        if s in SOURCES:
            return s
    return "test" if client_msg_id and TEST_ID.match(client_msg_id) else "app"


def classify(rows: list[dict]) -> list[dict]:
    """Set ``source`` on each message row (ordered by time). Assistant rows inherit the source of
    the user turn they answer in the same session."""
    last: dict[str, str] = {}
    for m in rows:
        sid = str(m.get("session_id") or "")
        explicit = (m.get("source") or "").strip().lower()
        if explicit in SOURCES:
            src = explicit
        elif m.get("role") == "user":
            cid = m.get("client_msg_id")
            if cid and TEST_ID.match(cid):
                src = "test"
            elif not cid and sid == SEED_SESSION_ID:
                src = "seed"
            else:
                src = "app"
        else:
            src = last.get(sid, "seed" if sid == SEED_SESSION_ID else "app")
        if m.get("role") == "user":
            last[sid] = src
        m["source"] = src
    return rows


def app_only(rows: list[dict]) -> list[dict]:
    return [m for m in classify(rows) if m["source"] == "app"]


def has_source_column(conn) -> bool:
    row = conn.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'source'"
    ).fetchone()
    return row is not None


def source_sql(conn) -> str:
    return "m.source" if has_source_column(conn) else "NULL::text"


def tainted_memory_ids(conn) -> set[str]:
    """Memory ids VoiceMem wrote from a seed or test turn (per memory_write_audit)."""
    src = source_sql(conn)
    rows = conn.execute(
        f"""
        SELECT m.client_msg_id, {src}, m.session_id, a.left_memory_ids
        FROM memory_write_audit a JOIN messages m ON m.id = a.user_message_id
        WHERE a.left_memory_ids IS NOT NULL
        """
    ).fetchall()
    out: set[str] = set()
    for cid, s, sid, ids in rows:
        row = classify([{"role": "user", "client_msg_id": cid, "source": s, "session_id": str(sid)}])[0]
        if row["source"] != "app":
            out.update(str(i) for i in (ids or []))
    return out
