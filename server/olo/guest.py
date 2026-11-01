"""Portfolio demo switches (all default off; the owner's instance is unchanged).

* ``OLO_DEMO_SLIM=1``  hides side features: their API routes 404 and the web UI
  drops their entry points (see ``SLIM_BLOCKED``).
* ``OLO_DEMO_GUEST=1`` gives every browser its own olo. The page sends a random
  id in ``X-Olo-Guest``; the server maps it (uuid5) to an internal user id and
  binds that for the whole request through a context variable. Every module
  that used the single seeded user reads :data:`CURRENT_USER`, a UUID whose
  value follows that context, so sessions, persona, canon, learning, etc. are
  all per guest. The owner token is never handed to the page and is not
  accepted in this mode.
* Caps (guest mode): messages per guest per day, per site per day, and turn
  requests per IP per minute.
"""

from __future__ import annotations

import contextvars
import json
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone

OWNER_USER_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
GUEST_HEADER = "x-olo-guest"
_GUEST_NS = uuid.UUID("6f6c6f2d-6465-6d6f-2d67-756573742d31")
_GUEST_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")

_current: contextvars.ContextVar[int | None] = contextvars.ContextVar("olo_user", default=None)


def slim() -> bool:
    return os.environ.get("OLO_DEMO_SLIM", "0").strip() == "1"


def guest_mode() -> bool:
    return os.environ.get("OLO_DEMO_GUEST", "0").strip() == "1"


class _CurrentUser(uuid.UUID):
    """A UUID whose value is the user bound to the current context (owner by default)."""

    __slots__ = ()

    def __new__(cls):
        return object.__new__(cls)

    def __init__(self) -> None:  # noqa: D401 - nothing to set; value is dynamic
        pass

    @property
    def int(self):  # type: ignore[override]
        value = _current.get()
        return OWNER_USER_ID.int if value is None else value

    @property
    def is_safe(self):  # type: ignore[override]
        return uuid.SafeUUID.unknown

    def __reduce__(self):
        return (uuid.UUID, (str(self),))

    def __repr__(self) -> str:
        return f"CurrentUser({str(self)!r})"


CURRENT_USER = _CurrentUser()


def current_user_id() -> uuid.UUID:
    """A plain (frozen) UUID of the user bound right now."""
    return uuid.UUID(int=CURRENT_USER.int)


def bind_user(user_id: uuid.UUID | None):
    return _current.set(None if user_id is None else user_id.int)


def reset_user(token) -> None:
    _current.reset(token)


def guest_user_id(raw: str | None) -> uuid.UUID | None:
    """Validate the browser's guest id and map it into the guest namespace."""
    if not raw or not _GUEST_RE.fullmatch(raw.strip()):
        return None
    mapped = uuid.uuid5(_GUEST_NS, raw.strip().lower())
    return None if mapped == OWNER_USER_ID else mapped


def carry(fn):
    """Run ``fn`` later (another thread) as the user bound now."""
    ctx = contextvars.copy_context()
    return lambda *a, **k: ctx.run(fn, *a, **k)


# ----------------------------------------------------------------- slim routes

# (method or None for any, path regex) under /v1 that the slim demo hides.
SLIM_BLOCKED = [
    r"/v1/world(/.*)?",
    r"/v1/garden",
    r"/v1/olo/chapters",
    r"/v1/postcards(/.*)?",
    r"/v1/shop(/.*)?",
    r"/v1/debug(/.*)?",
    r"/v1/subscription/activate",
    r"/v1/subscription/cancel",
    r"/v1/notebook(/.*)?",
    r"/v1/insights(/.*)?",
    r"/v1/mood",
    r"/v1/proactive(/.*)?",
    r"/v1/check-ins(/.*)?",
    r"/v1/speech(/.*)?",
    r"/v1/messages/[^/]+/audio",
    r"/v1/memory/consolidate",
    r"/v1/asr(/.*)?",
    r"/metrics",
    r"/insights(/.*)?",
    r"/docs.*",
    r"/redoc.*",
    r"/openapi\.json",
]
_SLIM_RE = re.compile("^(?:" + "|".join(SLIM_BLOCKED) + ")/?$")


def slim_blocked(path: str) -> bool:
    return _SLIM_RE.match(path) is not None


# ----------------------------------------------------------------------- caps

def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name) or default)
    except ValueError:
        return default


def guest_daily_cap() -> int:
    return _int_env("OLO_DEMO_GUEST_DAILY", 30)


def site_daily_cap() -> int:
    return _int_env("OLO_DEMO_SITE_DAILY", 2000)


def ip_per_minute() -> int:
    return _int_env("OLO_DEMO_IP_PER_MIN", 10)


CAP_GUEST_TEXT = "今天先聊到这儿吧，我有点困了～明天再来找我。 (Daily demo limit reached — come back tomorrow!)"
CAP_SITE_TEXT = "今天来找 olo 的人太多啦，演示额度用完了，明天再来吧。 (The demo is busy today — please come back tomorrow.)"
CAP_IP_TEXT = "说得有点快啦，歇一口气再说～ (Slow down a little and try again in a minute.)"

_ip_lock = threading.Lock()
_ip_hits: dict[str, list[float]] = {}


def client_ip(scope_headers: dict[str, str], client_host: str | None) -> str:
    # cloudflared sets CF-Connecting-IP; locally there is no proxy.
    return (scope_headers.get("cf-connecting-ip") or scope_headers.get("x-forwarded-for", "").split(",")[0]
            or client_host or "?").strip()


def ip_allowed(ip: str, now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    limit = ip_per_minute()
    with _ip_lock:
        window = [t for t in _ip_hits.get(ip, []) if now - t < 60]
        if len(window) >= limit:
            _ip_hits[ip] = window
            return False
        window.append(now)
        _ip_hits[ip] = window
        if len(_ip_hits) > 10_000:
            for key in [k for k, v in _ip_hits.items() if not v or now - v[-1] >= 60]:
                _ip_hits.pop(key, None)
        return True


def reset_ip_hits() -> None:
    with _ip_lock:
        _ip_hits.clear()


def daily_counts(conn, user_id: uuid.UUID) -> tuple[int, int]:
    """(this guest's, whole site's) user messages since UTC midnight."""
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    mine, site = conn.execute(
        """
        SELECT count(*) FILTER (WHERE s.user_id = %s), count(*)
        FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE m.role = 'user' AND m.created_at >= %s
        """,
        (user_id, start),
    ).fetchone()
    return int(mine), int(site)


def ensure_guest(conn, user_id: uuid.UUID) -> None:
    """First visit: create the guest's user row, persona and free subscription."""
    row = conn.execute("SELECT 1 FROM users WHERE id = %s", (user_id,)).fetchone()
    if row is not None:
        return
    seed = conn.execute(
        "SELECT name, stable_card FROM companion_personas WHERE user_id = %s ORDER BY version DESC LIMIT 1",
        (OWNER_USER_ID,),
    ).fetchone()
    conn.execute("INSERT INTO users (id, display_name) VALUES (%s, 'guest') ON CONFLICT (id) DO NOTHING", (user_id,))
    if seed is not None:
        conn.execute(
            "INSERT INTO companion_personas (id, user_id, name, stable_card, version) VALUES (%s, %s, %s, %s, 1)",
            (uuid.uuid4(), user_id, seed[0], seed[1]),
        )
    for sql in (
        "INSERT INTO subscriptions (user_id, tier, status) VALUES (%s, 'free', 'active') ON CONFLICT DO NOTHING",
        "INSERT INTO wallets (user_id, tokens) VALUES (%s, 0) ON CONFLICT DO NOTHING",
        "INSERT INTO memory_capture_runs (user_id, upto, n_messages) VALUES (%s, now(), 0) ON CONFLICT DO NOTHING",
    ):
        try:
            with conn.transaction():
                conn.execute(sql, (user_id,))
        except Exception:  # noqa: BLE001 - optional side tables
            pass


def json_error(status: int, code: str, message: str) -> tuple[int, bytes]:
    return status, json.dumps({"error": {"code": code, "message": message}}, ensure_ascii=False).encode()
