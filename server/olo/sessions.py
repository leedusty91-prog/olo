import hmac
import logging
import os
import uuid

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

from olo.db import connect

logger = logging.getLogger(__name__)

SEEDED_USER_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")


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


def require_bearer(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("OLO_API_TOKEN", "")
    presented = ""
    if authorization:
        scheme, separator, rest = authorization.partition(" ")
        if separator == " " and scheme.lower() == "bearer":
            token = rest.strip()
            if token and " " not in token:
                presented = token
    matched = False
    if presented and expected.strip():
        try:
            # compare_digest rejects non-ASCII str on Python 3.12.
            matched = hmac.compare_digest(
                presented.encode("utf-8"),
                expected.encode("utf-8"),
            )
        except UnicodeEncodeError:
            matched = False
    if not matched:
        raise ApiError(401, "UNAUTHORIZED", "missing or invalid bearer token")


router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


def open_session(conn: psycopg.Connection, fresh: bool = False) -> tuple[str, bool]:
    if fresh:
        conn.execute(
            "UPDATE sessions SET ended_at = now() WHERE user_id = %s AND ended_at IS NULL",
            (SEEDED_USER_ID,),
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
        (SEEDED_USER_ID,),
    ).fetchone()
    if row is not None:
        return row[0], True
    session_id = uuid.uuid4()
    conn.execute(
        """
        INSERT INTO sessions (id, user_id)
        VALUES (%s, %s)
        """,
        (session_id, SEEDED_USER_ID),
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
