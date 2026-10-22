"""olo 主动找你：根据记忆里还没下文的事（比如快到的面试），在合适的时候轻轻问一句。

规则：
* 用户可在设置里关掉（users.checkins_enabled）。
* 安静时段不发（按用户自己的时区 23:00–08:00，OLO_QUIET_HOURS 可改；无时区时回落 OLO_TZ / Asia/Shanghai）。
* 每个自然日最多 1 条（按本地时区算）。
* 用户最近 OLO_CHECKIN_IDLE_HOURS（默认 4）小时里聊过就不打扰——短期内有上下文。
* 没有值得问的事，模型回 SKIP，就不发。

文字由聊天模型（CHAT_*，即 DeepSeek）生成；发出去的是一条普通的 assistant 消息，
同时在 check_ins 里记一行 source='proactive'，网页用 seen_at 显示未读角标。
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer

logger = logging.getLogger(__name__)

MAX_LEN = 120

PROMPT = """你是 olo，一粒住在用户小花园里的灯籽，是用户的陪伴伙伴。现在你想主动给用户发一条消息。

你记得的关于用户的事：
{memories}

用户最近几天说过的话（越靠后越新）：
{recent}

现在是 {now}（{weekday}）。

任务：从上面找一件「还没有下文」的事——比如用户说过要去面试、考试、看病、见人、搬家、出差、做决定，
或者情绪不太好的事——写一条轻轻关心的消息，问问后来怎么样了。
要求：
- 像朋友随口发来的一句话，大白话，1～2 句，不超过 50 字。
- 只提上面真实出现过的事，不编任何细节；时间还没到的事就说「快到了吧」这类，别问结果。
- 最多一个问号；不说教、不催促、不提「记忆」「系统」。
- 不要开场白，不要表情包代码。
如果上面没有值得问的事，或者都太琐碎，只输出：SKIP
否则只输出那条消息本身。"""

WEEKDAYS = "一二三四五六日"


# ---------------------------------------------------------------- settings

def local_tz(conn=None, user_id=SEEDED_USER_ID) -> ZoneInfo:
    """The user's own zone (users.timezone); server default when no conn."""
    from olo.usertz import default_name, user_tz

    if conn is not None:
        return user_tz(conn, user_id)
    return ZoneInfo(default_name())


def quiet_hours() -> tuple[time, time]:
    raw = os.environ.get("OLO_QUIET_HOURS", "").strip() or "23:00-08:00"
    a, b = raw.split("-")
    return time.fromisoformat(a.strip()), time.fromisoformat(b.strip())


def in_quiet_hours(now: datetime, tz: ZoneInfo | None = None) -> bool:
    start, end = quiet_hours()
    t = now.astimezone(tz or local_tz()).time()
    if start <= end:
        return start <= t < end
    return t >= start or t < end


def _local_day_start(now: datetime, tz: ZoneInfo) -> datetime:
    local = now.astimezone(tz)
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


# ---------------------------------------------------------------- db helpers

def checkins_enabled(conn, user_id=SEEDED_USER_ID) -> bool:
    row = conn.execute("SELECT checkins_enabled FROM users WHERE id = %s", (user_id,)).fetchone()
    return bool(row and row[0])


def sent_today(conn, now: datetime, user_id=SEEDED_USER_ID) -> int:
    start = _local_day_start(now, local_tz(conn, user_id))
    row = conn.execute(
        """
        SELECT count(*) FROM check_ins
        WHERE user_id = %s AND source = 'proactive' AND status = 'sent' AND sent_at >= %s
        """,
        (user_id, start),
    ).fetchone()
    return int(row[0])


def last_user_message_at(conn, user_id=SEEDED_USER_ID) -> datetime | None:
    row = conn.execute(
        """
        SELECT max(m.created_at) FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND m.role = 'user'
        """,
        (user_id,),
    ).fetchone()
    return row[0] if row else None


def recent_user_lines(conn, now: datetime, user_id=SEEDED_USER_ID, days: int = 4, limit: int = 30) -> list[str]:
    rows = conn.execute(
        """
        SELECT m.body, m.created_at FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND m.role = 'user' AND m.created_at >= %s
        ORDER BY m.created_at DESC LIMIT %s
        """,
        (user_id, now - timedelta(days=days), limit),
    ).fetchall()
    tz = local_tz(conn, user_id)
    return [f"[{r[1].astimezone(tz):%m-%d %H:%M}] {str(r[0])[:200]}" for r in reversed(rows)]


def latest_session(conn, user_id=SEEDED_USER_ID):
    row = conn.execute(
        "SELECT id FROM sessions WHERE user_id = %s ORDER BY last_turn_at DESC LIMIT 1", (user_id,)
    ).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------- generation

def memory_lines(memory, limit: int = 40) -> list[str]:
    lister = getattr(memory, "list_memories", None)
    if lister is None:
        return []
    try:
        items = lister()
    except Exception as exc:  # noqa: BLE001
        logger.warning("proactive: list memories failed: %s", type(exc).__name__)
        return []
    items = sorted(items, key=lambda m: m.get("created_at") or "")[-limit:]
    return [f"[{(m.get('created_at') or '')[:10]}] {m['text']}" for m in items]


def _llm_generate(prompt: str) -> str:
    """One non-streaming call to the chat model (CHAT_* -> DeepSeek)."""
    from olo.llm import OpenAIChat

    if os.environ.get("LLM_PROVIDER", "").strip().lower() in {"mock", "offline", "demo"}:
        return "SKIP"
    chat = OpenAIChat()
    if not chat.api_key:
        return "SKIP"
    return "".join(chat.stream([{"role": "user", "content": prompt}]))


GENERATOR: Callable[[str], str] = _llm_generate


def clean_message(text: str) -> str | None:
    text = (text or "").strip().strip("「」\"'")
    if not text or text.upper().startswith("SKIP"):
        return None
    # same deterministic polish as chat replies: ≤4 bubbles, ≤1 question, no stray separators
    from olo.segments import join_segments, polish_segments, split_segments

    text = join_segments(polish_segments(split_segments(text), keep="first"))
    return text[:MAX_LEN].strip() or None


def build_prompt(memories: list[str], recent: list[str], now: datetime, tz: ZoneInfo | None = None) -> str:
    local = now.astimezone(tz or local_tz())
    return PROMPT.format(
        memories="\n".join(f"- {m}" for m in memories) or "（暂时没有）",
        recent="\n".join(recent) or "（最近没聊）",
        now=f"{local:%Y-%m-%d %H:%M}",
        weekday="星期" + WEEKDAYS[local.weekday()],
    )


def run_once(
    conn,
    memory=None,
    *,
    now: datetime | None = None,
    force: bool = False,
    user_id=SEEDED_USER_ID,
) -> dict:
    """Try to send one proactive check-in. Returns {"sent": bool, "reason"|"message": ...}.

    ``force`` skips the idle/quiet/daily-cap gates (manual demo), never the toggle.
    """
    now = now or datetime.now(timezone.utc)
    if not checkins_enabled(conn, user_id):
        return {"sent": False, "reason": "disabled"}
    if not force:
        if in_quiet_hours(now, local_tz(conn, user_id)):
            return {"sent": False, "reason": "quiet_hours"}
        if sent_today(conn, now, user_id) >= 1:
            return {"sent": False, "reason": "daily_cap"}
        idle_h = float(os.environ.get("OLO_CHECKIN_IDLE_HOURS") or 4)
        last = last_user_message_at(conn, user_id)
        if last is None:
            return {"sent": False, "reason": "no_history"}
        if now - last < timedelta(hours=idle_h):
            return {"sent": False, "reason": "recently_active"}
    session_id = latest_session(conn, user_id)
    if session_id is None:
        return {"sent": False, "reason": "no_session"}
    memories = memory_lines(memory) if memory is not None else []
    recent = recent_user_lines(conn, now, user_id)
    if not memories and not recent:
        return {"sent": False, "reason": "nothing_to_ask"}
    try:
        raw = GENERATOR(build_prompt(memories, recent, now, local_tz(conn, user_id)))
    except Exception as exc:  # noqa: BLE001
        logger.warning("proactive generate failed: %s", type(exc).__name__)
        return {"sent": False, "reason": "llm_error"}
    message = clean_message(raw)
    if message is None:
        return {"sent": False, "reason": "nothing_to_ask"}
    message_id = uuid.uuid4()
    conn.execute(
        """
        INSERT INTO messages (id, session_id, role, modality, body)
        VALUES (%s, %s, 'assistant', 'text', %s)
        """,
        (message_id, session_id, message),
    )
    conn.execute("UPDATE sessions SET last_turn_at = now() WHERE id = %s", (session_id,))
    check_id = uuid.uuid4()
    conn.execute(
        """
        INSERT INTO check_ins
          (id, user_id, kind, message, scheduled_for, status, sent_at, source, message_id)
        VALUES (%s, %s, 'text', %s, %s, 'sent', %s, 'proactive', %s)
        """,
        (check_id, user_id, message, now, now, message_id),
    )
    conn.commit()
    logger.info("proactive check-in sent")
    return {"sent": True, "id": str(check_id), "message": message, "session_id": str(session_id)}


def tick(runtime=None, now: datetime | None = None) -> dict:
    """Scheduler entry; cheap gates run before any model call."""
    memory = getattr(runtime, "memory", None) if runtime is not None else None
    with connect() as conn:
        return run_once(conn, memory, now=now)


# ---------------------------------------------------------------- API

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


class RunRequest(BaseModel):
    force: bool = False


class SettingsRequest(BaseModel):
    enabled: bool


def _unread(conn, user_id=SEEDED_USER_ID) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, message, sent_at FROM check_ins
        WHERE user_id = %s AND source = 'proactive' AND status = 'sent' AND seen_at IS NULL
        ORDER BY sent_at DESC LIMIT 10
        """,
        (user_id,),
    ).fetchall()
    return [{"id": str(r[0]), "message": r[1], "sent_at": r[2].isoformat()} for r in rows]


@router.get("/proactive")
def get_proactive(request: Request) -> dict:
    with connect() as conn:
        unread = _unread(conn)
        return {
            "enabled": checkins_enabled(conn),
            "quiet_hours": "-".join(t.strftime("%H:%M") for t in quiet_hours()),
            "timezone": str(local_tz(conn)),
            "unread": unread,
            "unread_count": len(unread),
        }


@router.put("/proactive")
def put_proactive(payload: SettingsRequest, request: Request) -> dict:
    with connect() as conn:
        conn.execute("UPDATE users SET checkins_enabled = %s WHERE id = %s", (payload.enabled, SEEDED_USER_ID))
        conn.commit()
    return {"enabled": payload.enabled}


@router.post("/proactive/run")
def run_proactive(payload: RunRequest, request: Request) -> dict:
    runtime = getattr(request.app.state, "runtime", None)
    memory = getattr(runtime, "memory", None)
    with connect() as conn:
        return run_once(conn, memory, force=payload.force)


@router.post("/proactive/seen")
def mark_seen(request: Request) -> dict:
    with connect() as conn:
        cur = conn.execute(
            """
            UPDATE check_ins SET seen_at = now()
            WHERE user_id = %s AND source = 'proactive' AND seen_at IS NULL AND status = 'sent'
            """,
            (SEEDED_USER_ID,),
        )
        conn.commit()
    if cur.rowcount is None:
        raise ApiError(500, "INTERNAL", "seen update failed")
    return {"marked": cur.rowcount}


def register_proactive(app: FastAPI) -> None:
    app.include_router(router)
