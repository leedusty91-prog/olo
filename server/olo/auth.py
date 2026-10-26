"""Email one-time-code login. Per-user bearer tokens, stored only as SHA-256 hashes.

Sender is pluggable (OLO_EMAIL_SENDER):
  log   (default) - writes "login code for <email>" to the server log; dev only
  smtp            - any SMTP account via OLO_SMTP_HOST/PORT/USER/PASSWORD/FROM (e.g. a free Gmail app password)
Production refuses to start with the log sender when OLO_PUBLIC=1 (see main.require_startup).
"""
import hashlib
import hmac
import logging
import os
import re
import secrets
import smtplib
import uuid
from email.message import EmailMessage

from fastapi import APIRouter, FastAPI, Header
from pydantic import BaseModel

from olo.db import connect
from olo.userctx import current_user_id

logger = logging.getLogger(__name__)

CODE_TTL_MIN = 10
RESEND_AFTER_S = 60
MAX_ATTEMPTS = 5
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
STABLE_CARD_SQL = "SELECT stable_card FROM companion_personas WHERE user_id = %s ORDER BY version LIMIT 1"


def _h(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not EMAIL_RE.match(email):
        from olo.sessions import ApiError

        raise ApiError(400, "BAD_EMAIL", "invalid email")
    return email


# ---------------------------------------------------------------- senders
class LogSender:
    name = "log"

    def send(self, email: str, code: str, locale: str = "zh-CN") -> None:
        # Dev only: the code is in the server log so a local tester can sign in.
        logger.warning("login code for %s: %s", email, code)


class SmtpSender:
    name = "smtp"

    def send(self, email: str, code: str, locale: str = "zh-CN") -> None:
        msg = EmailMessage()
        msg["From"] = os.environ.get("OLO_SMTP_FROM") or os.environ.get("OLO_SMTP_USER", "")
        msg["To"] = email
        if locale == "en":
            msg["Subject"] = f"olo login code: {code}"
            msg.set_content(f"Your olo login code is {code}. It expires in {CODE_TTL_MIN} minutes.")
        else:
            msg["Subject"] = f"olo 登录验证码：{code}"
            msg.set_content(f"你的 olo 登录验证码是 {code}，{CODE_TTL_MIN} 分钟内有效。")
        host = os.environ.get("OLO_SMTP_HOST", "")
        port = int(os.environ.get("OLO_SMTP_PORT") or 587)
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.starttls()
            s.login(os.environ.get("OLO_SMTP_USER", ""), os.environ.get("OLO_SMTP_PASSWORD", ""))
            s.send_message(msg)


_test_sender = None  # tests inject a recorder


def sender():
    if _test_sender is not None:
        return _test_sender
    return SmtpSender() if os.environ.get("OLO_EMAIL_SENDER", "log").strip() == "smtp" else LogSender()


# ---------------------------------------------------------------- core
def provision_user(conn, user_id: uuid.UUID, email: str | None, locale: str = "zh-CN") -> None:
    """Rows every user needs (mirrors the seed migrations). Idempotent."""
    from olo.userctx import SEEDED_USER_ID

    conn.execute(
        "INSERT INTO users (id, display_name, email, locale) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
        (user_id, "", email, locale),
    )
    if not conn.execute("SELECT 1 FROM companion_personas WHERE user_id = %s", (user_id,)).fetchone():
        row = conn.execute(STABLE_CARD_SQL, (SEEDED_USER_ID,)).fetchone()
        card = row[0] if row else "你叫 olo，是一颗灯籽，只负责陪伴聊天。"
        conn.execute(
            "INSERT INTO companion_personas (id, user_id, name, stable_card, version) VALUES (%s, %s, 'olo', %s, 1)",
            (uuid.uuid4(), user_id, card),
        )
    conn.execute("INSERT INTO subscriptions (user_id, tier, status) VALUES (%s, 'free', 'active') ON CONFLICT (user_id) DO NOTHING", (user_id,))
    conn.execute("INSERT INTO wallets (user_id, tokens) VALUES (%s, 100) ON CONFLICT (user_id) DO NOTHING", (user_id,))


def request_code(email: str, locale: str = "zh-CN") -> None:
    from olo.sessions import ApiError

    code = f"{secrets.randbelow(1_000_000):06d}"
    with connect() as conn:
        row = conn.execute(
            "SELECT now() - sent_at < make_interval(secs => %s) FROM auth_codes WHERE email = %s", (RESEND_AFTER_S, email)
        ).fetchone()
        if row and row[0]:
            raise ApiError(429, "TOO_SOON", "wait before requesting another code")
        conn.execute(
            """INSERT INTO auth_codes (email, code_hash, expires_at, attempts, sent_at)
               VALUES (%s, %s, now() + make_interval(mins => %s), 0, now())
               ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash,
                 expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()""",
            (email, _h(email + ":" + code), CODE_TTL_MIN),
        )
    sender().send(email, code, locale)


def verify_code(email: str, code: str, locale: str = "zh-CN") -> tuple[str, uuid.UUID, bool]:
    """Returns (token, user_id, created). Codes are single use; 5 wrong tries burn the code."""
    from olo.sessions import ApiError

    bad = ApiError(401, "BAD_CODE", "wrong or expired code")
    with connect() as conn:
        row = conn.execute(
            "SELECT code_hash, expires_at > now(), attempts FROM auth_codes WHERE email = %s FOR UPDATE", (email,)
        ).fetchone()
        if not row or not row[1] or row[2] >= MAX_ATTEMPTS:
            raise bad
        if not hmac.compare_digest(row[0], _h(email + ":" + (code or "").strip())):
            conn.execute("UPDATE auth_codes SET attempts = attempts + 1 WHERE email = %s", (email,))
            conn.commit()
            raise bad
        conn.execute("DELETE FROM auth_codes WHERE email = %s", (email,))
        found = conn.execute("SELECT id FROM users WHERE lower(email) = %s", (email,)).fetchone()
        created = found is None
        user_id = uuid.uuid4() if created else found[0]
        if created:
            provision_user(conn, user_id, email, locale)
        token = secrets.token_urlsafe(32)
        conn.execute("INSERT INTO auth_tokens (token_hash, user_id) VALUES (%s, %s)", (_h(token), user_id))
    return token, user_id, created


def user_for_token(token: str) -> uuid.UUID | None:
    with connect() as conn:
        row = conn.execute(
            "UPDATE auth_tokens SET last_used_at = now() WHERE token_hash = %s RETURNING user_id", (_h(token),)
        ).fetchone()
    return row[0] if row else None


def user_locale(conn, user_id=None) -> str:
    row = conn.execute("SELECT locale FROM users WHERE id = %s", (user_id or current_user_id(),)).fetchone()
    return row[0] if row and row[0] in ("zh-CN", "en") else "zh-CN"


# ---------------------------------------------------------------- routes
class CodeRequest(BaseModel):
    email: str
    locale: str = "zh-CN"


class VerifyRequest(BaseModel):
    email: str
    code: str
    locale: str = "zh-CN"


class LocaleBody(BaseModel):
    locale: str


def _loc(v: str) -> str:
    return "en" if (v or "").lower().startswith("en") else "zh-CN"


public = APIRouter(prefix="/v1/auth")


@public.post("/request-code")
def post_request_code(body: CodeRequest) -> dict:
    request_code(normalize_email(body.email), _loc(body.locale))
    return {"sent": True}


@public.post("/verify")
def post_verify(body: VerifyRequest) -> dict:
    token, uid, created = verify_code(normalize_email(body.email), body.code, _loc(body.locale))
    return {"token": token, "user_id": str(uid), "created": created}


def _register_private() -> None:
    from olo.sessions import router

    @router.post("/auth/logout")
    def logout(authorization: str | None = Header(default=None)) -> dict:
        from olo.sessions import _presented_token

        token = _presented_token(authorization)
        with connect() as conn:
            conn.execute("DELETE FROM auth_tokens WHERE token_hash = %s AND user_id = %s", (_h(token), current_user_id()))
        return {"ok": True}

    @router.get("/me")
    def me() -> dict:
        with connect() as conn:
            row = conn.execute("SELECT email, locale FROM users WHERE id = %s", (current_user_id(),)).fetchone()
        return {"user_id": str(current_user_id()), "email": row[0] if row else None, "locale": row[1] if row else "zh-CN"}

    @router.put("/me/locale")
    def put_locale(body: LocaleBody) -> dict:
        loc = _loc(body.locale)
        with connect() as conn:
            conn.execute("UPDATE users SET locale = %s WHERE id = %s", (loc, current_user_id()))
        return {"locale": loc}



_register_private()


def register_auth(app: FastAPI) -> None:
    app.include_router(public)
