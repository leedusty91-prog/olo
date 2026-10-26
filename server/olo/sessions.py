import hmac
import logging
import os
import uuid

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

from olo.db import connect

logger = logging.getLogger(__name__)

from olo.userctx import SEEDED_USER_ID, current_user_id, set_current_user  # noqa: F401  (re-exported)


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message


def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


def _presented_token(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, separator, rest = authorization.partition(" ")
    if separator == " " and scheme.lower() == "bearer":
        token = rest.strip()
        if token and " " not in token:
            return token
    return ""


def legacy_token_enabled() -> bool:
    """The single shared OLO_API_TOKEN acts as the seeded user (dev / existing install).

    Production sets OLO_LEGACY_TOKEN=0 so only per-user login tokens work.
    """
    return os.environ.get("OLO_LEGACY_TOKEN", "1").strip() != "0"


def check_bearer(authorization: str | None = None) -> uuid.UUID:
    """Validate the bearer token and return the user it belongs to (raises 401)."""
    presented = _presented_token(authorization)
    if presented and legacy_token_enabled():
        expected = os.environ.get("OLO_API_TOKEN", "")
        if expected.strip():
            try:
                # compare_digest rejects non-ASCII str on Python 3.12.
                if hmac.compare_digest(presented.encode("utf-8"), expected.encode("utf-8")):
                    return SEEDED_USER_ID
            except UnicodeEncodeError:
                pass
    if presented:
        from olo.auth import user_for_token

        try:
            uid = user_for_token(presented)
        except UnicodeEncodeError:
            uid = None
        except Exception as exc:  # noqa: BLE001 - database down: treat as unauthenticated, log type only
            logger.warning("token lookup failed: %s", type(exc).__name__)
            uid = None
        if uid is not None:
            return uid
    raise ApiError(401, "UNAUTHORIZED", "missing or invalid bearer token")


async def require_bearer(authorization: str | None = Header(default=None)) -> uuid.UUID:
    """Auth dependency: binds the request to its user (olo.userctx) for every query."""
    import asyncio

    uid = await asyncio.to_thread(check_bearer, authorization)
    set_current_user(uid)
    return uid


router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


def open_session(conn: psycopg.Connection, fresh: bool = False) -> tuple[str, bool]:
    if fresh:
        conn.execute(
            "UPDATE sessions SET ended_at = now() WHERE user_id = %s AND ended_at IS NULL",
            (current_user_id(),),
        )
    row = conn.execute(
        """
        SELECT id::text
        FROM sessions
        WHERE user_id = %s
          AND ended_at IS NULL
          AND last_turn_at >= now() - interval '6 hours'
        ORDER BY last_turn_at DESC
        LIMIT 1
        """,
        (current_user_id(),),
    ).fetchone()
    if row is not None:
        return row[0], True
    session_id = uuid.uuid4()
    conn.execute(
        """
        INSERT INTO sessions (id, user_id)
        VALUES (%s, %s)
        """,
        (session_id, current_user_id()),
    )
    return str(session_id), False


@router.post("/sessions")
def create_session(fresh: bool = False) -> dict[str, str | bool]:
    """Reuse the open session (6 h window); ``?fresh=true`` ends it and starts a new one."""
    try:
        with connect() as conn:
            session_id, reused = open_session(conn, fresh)
    except Exception as exc:
        # Exception text can include the DSN. Log the type only.
        logger.warning("session open failed: %s", type(exc).__name__)
        raise ApiError(503, "UNAVAILABLE", "database unavailable") from None
    return {"id": session_id, "reused": reused}


def register_sessions(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(router)
