"""Account data export and deletion (App Store 5.1.1(v) / Play data-deletion policy).

Tables are discovered from information_schema (any public table with a user_id column),
so new per-user tables are covered without editing this file.
"""
import datetime as dt
import decimal
import json
import uuid

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, router
from olo.userctx import current_user_id

CONFIRM_PHRASE = "DELETE"
SKIP_TABLES = {"alembic_version"}


def user_tables(conn) -> list[str]:
    rows = conn.execute(
        """SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'user_id' ORDER BY table_name"""
    ).fetchall()
    return [r[0] for r in rows if r[0] not in SKIP_TABLES]


def _child_tables(conn) -> list[tuple[str, str, str, str]]:
    """(child, child_col, parent, parent_col) FKs pointing at user-owned tables."""
    return conn.execute(
        """SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
           WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'"""
    ).fetchall()


def _jsonable(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (bytes, memoryview)):
        return None  # binary blobs (audio/images) are omitted from the JSON export
    return v


def export_user(conn, user_id=None) -> dict:
    user_id = user_id or current_user_id()
    tables = user_tables(conn)
    owned = set(tables)
    out: dict[str, list[dict]] = {}
    me = conn.execute("SELECT id, display_name, email, locale, created_at FROM users WHERE id = %s", (user_id,)).fetchone()
    if me:
        out["users"] = [dict(zip(("id", "display_name", "email", "locale", "created_at"), map(_jsonable, me)))]
    for t in tables:
        cur = conn.execute(f'SELECT * FROM "{t}" WHERE user_id = %s', (user_id,))
        cols = [c.name for c in cur.description]
        out[t] = [{k: _jsonable(v) for k, v in zip(cols, row)} for row in cur.fetchall()]
    for child, ccol, parent, pcol in _child_tables(conn):
        if child in owned or parent not in owned or child in out:
            continue
        cur = conn.execute(
            f'SELECT c.* FROM "{child}" c JOIN "{parent}" p ON c."{ccol}" = p."{pcol}" WHERE p.user_id = %s',
            (user_id,),
        )
        cols = [c.name for c in cur.description]
        out[child] = [{k: _jsonable(v) for k, v in zip(cols, row)} for row in cur.fetchall()]
    return {"user_id": str(user_id), "exported_at": dt.datetime.now(dt.timezone.utc).isoformat(), "tables": out}


def delete_user(conn, user_id=None) -> dict[str, int]:
    user_id = user_id or current_user_id()
    """Delete every row owned by user_id, children first. Runs in one transaction."""
    tables = user_tables(conn)
    owned = set(tables)
    counts: dict[str, int] = {}
    fks = _child_tables(conn)
    with conn.transaction():
        for child, ccol, parent, pcol in fks:
            if child in owned or parent not in owned:
                continue
            cur = conn.execute(
                f'DELETE FROM "{child}" c USING "{parent}" p WHERE c."{ccol}" = p."{pcol}" AND p.user_id = %s',
                (user_id,),
            )
            counts[child] = counts.get(child, 0) + cur.rowcount
        pending = list(tables)
        for _ in range(len(pending) + 1):  # retry order until FK constraints are satisfied
            if not pending:
                break
            left = []
            for t in pending:
                try:
                    with conn.transaction():
                        cur = conn.execute(f'DELETE FROM "{t}" WHERE user_id = %s', (user_id,))
                    counts[t] = counts.get(t, 0) + cur.rowcount
                except Exception:
                    left.append(t)
            pending = left
        if pending:
            raise RuntimeError(f"could not delete from {pending}")
        email = conn.execute("SELECT email FROM users WHERE id = %s", (user_id,)).fetchone()
        if email and email[0]:
            conn.execute("DELETE FROM auth_codes WHERE email = %s", (email[0],))
        counts["users"] = conn.execute("DELETE FROM users WHERE id = %s", (user_id,)).rowcount
        if user_id == SEEDED_USER_ID:
            # The shared dev token keeps working: start the seeded user over, empty.
            from olo.auth import provision_user

            provision_user(conn, SEEDED_USER_ID, None)
    return counts


@router.get("/account/export")
def get_export(request: Request) -> JSONResponse:
    with connect() as conn:
        data = export_user(conn)
    mem = getattr(getattr(request.app.state, "runtime", None), "memory", None)
    try:
        data["memories"] = list(mem.list_memories()) if mem is not None else []
    except Exception:  # noqa: BLE001 - memory store warming/unavailable
        data["memories"] = None
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="olo-export.json"'})


@router.delete("/account")
def delete_account(request: Request, x_confirm_delete: str | None = Header(default=None)) -> dict:
    if x_confirm_delete != CONFIRM_PHRASE:
        raise ApiError(400, "CONFIRM_REQUIRED", "send header X-Confirm-Delete: DELETE")
    uid = current_user_id()
    mem = getattr(getattr(request.app.state, "runtime", None), "memory", None)
    wiped = False
    if mem is not None:
        try:
            if hasattr(mem, "wipe_user"):
                mem.wipe_user(uid)
                wiped = True
            elif uid == SEEDED_USER_ID:  # single-store runtime (demo): the store belongs to the seeded user
                for row in list(mem.list_memories()):
                    mem.delete_memory(row["id"])
                wiped = True
        except Exception as exc:  # noqa: BLE001
            raise ApiError(503, "MEMORY_UNAVAILABLE", f"memory store busy, retry: {type(exc).__name__}") from None
    with connect() as conn:
        counts = delete_user(conn, uid)
    return {"deleted": counts, "vector_memory_wiped": wiped}


def register_account(app: FastAPI) -> None:
    """Routes live on the shared /v1 router; import this module before register_sessions()."""
    return None


@router.post("/messages/{message_id}/report")
def report_reply(message_id: uuid.UUID, body: dict | None = None) -> dict:
    """User flags an olo reply (App Store 1.2 / Play UGC+AI policy). Stored for review."""
    reason = str((body or {}).get("reason") or "")[:500]
    uid = current_user_id()
    with connect() as conn:
        owned = conn.execute(
            "SELECT 1 FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.id = %s AND s.user_id = %s",
            (message_id, uid),
        ).fetchone()
        if not owned:
            raise ApiError(404, "NOT_FOUND", "message not found")
        conn.execute(
            "INSERT INTO reply_reports (id, user_id, message_id, reason) VALUES (%s, %s, %s, %s)",
            (uuid.uuid4(), uid, message_id, reason),
        )
    return {"reported": True}
