"""Who the current request (or background job) is acting for.

Set by the auth dependency per request; background jobs copy the context when
they are submitted (see runtime.IngestQueue). Outside any request the default is
the original single seeded user, so CLI scripts and nightly jobs behave as before.
"""
import contextvars
import uuid

SEEDED_USER_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")

_current: contextvars.ContextVar[uuid.UUID] = contextvars.ContextVar("olo_user_id", default=SEEDED_USER_ID)


def current_user_id() -> uuid.UUID:
    return _current.get()


def set_current_user(user_id: uuid.UUID | str) -> contextvars.Token:
    return _current.set(user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id)))


def reset_current_user(token: contextvars.Token) -> None:
    _current.reset(token)


def all_user_ids(conn) -> list[uuid.UUID]:
    return [r[0] for r in conn.execute("SELECT id FROM users ORDER BY created_at NULLS FIRST, id").fetchall()]


def for_each_user(fn, *, log=None) -> dict:
    """Run fn() once per user with that user as the current user.

    One user's failure is logged and does not stop the others. Returns {user_id: result}."""
    from olo.db import connect

    with connect() as conn:
        ids = all_user_ids(conn)
    out: dict = {}
    for uid in ids:
        token = set_current_user(uid)
        try:
            out[uid] = fn()
        except Exception as exc:  # noqa: BLE001
            if log is not None:
                log.warning("per-user job failed for one user: %s", type(exc).__name__)
            out[uid] = exc
        finally:
            reset_current_user(token)
    return out
