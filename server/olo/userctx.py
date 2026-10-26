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
