"""Mood curve: one score per user turn, aggregated per day (user's own timezone).

Text turns use a small Chinese lexicon (the same keyword-level emotion detection the
prompt rules rely on); voice turns use VoiceMem's acoustic emotion label when present.
Score range is -1 (low) .. +1 (bright); 0 means neutral.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, FastAPI, Query

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, require_bearer
from olo.usertz import user_tz, user_tz_name

logger = logging.getLogger(__name__)
TZ = ZoneInfo("Asia/Shanghai")

POSITIVE = ("开心", "高兴", "快乐", "顺利", "挺顺", "很顺", "太好了", "哈哈", "好耶", "期待", "喜欢", "爽", "舒服",
            "放松", "轻松", "满足", "幸福", "感动", "激动", "兴奋", "成功", "通过了", "过了", "升职", "加薪", "好玩", "温暖", "谢谢")
NEGATIVE = ("难过", "伤心", "累", "疲惫", "烦", "焦虑", "崩溃", "压力", "生气", "气死", "郁闷", "失眠", "哭", "委屈", "孤独",
            "害怕", "担心", "失望", "糟糕", "倒霉", "讨厌", "痛", "病了", "住院", "加班", "吵架", "分手", "丧", "心累", "憋")
NEGATORS = ("不", "没", "别", "不太", "没有")
ACOUSTIC = {"happy": 0.8, "joy": 0.8, "excited": 0.9, "surprise": 0.3, "neutral": 0.0, "calm": 0.2,
            "sad": -0.8, "angry": -0.8, "fear": -0.7, "disgust": -0.6, "tired": -0.5}


def _hits(text: str, words) -> int:
    n = 0
    for w in words:
        start = 0
        while (i := text.find(w, start)) >= 0:
            prefix = text[max(0, i - 2) : i]
            n += -1 if any(prefix.endswith(neg) for neg in NEGATORS) else 1
            start = i + len(w)
    return n


def score_text(text: str, emotion_label: str | None = None) -> float | None:
    """None = nothing to say about mood (don't count the turn)."""
    if emotion_label and emotion_label.lower() in ACOUSTIC and emotion_label.lower() != "neutral":
        return ACOUSTIC[emotion_label.lower()]
    t = text or ""
    raw = _hits(t, POSITIVE) - _hits(t, NEGATIVE)
    if raw == 0:
        return 0.0 if t.strip() else None
    return max(-1.0, min(1.0, raw * 0.5))


def today(now: datetime | None = None, tz: ZoneInfo | None = None) -> date:
    tz = tz or TZ
    return (now or datetime.now(tz)).astimezone(tz).date()


def record(text: str, emotion_label: str | None = None, *, user_id=SEEDED_USER_ID, now: datetime | None = None) -> float | None:
    s = score_text(text, emotion_label)
    if s is None:
        return None
    try:
        with connect() as conn:
            tz = user_tz(conn, user_id)
            conn.execute(
                """
                INSERT INTO mood_daily (user_id, day, score_sum, turns) VALUES (%s, %s, %s, 1)
                ON CONFLICT (user_id, day) DO UPDATE
                SET score_sum = mood_daily.score_sum + EXCLUDED.score_sum,
                    turns = mood_daily.turns + 1, updated_at = now()
                """,
                (user_id, today(now, tz), s),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("mood record failed: %s", type(exc).__name__)
    return s


def curve(conn, days: int = 14, *, user_id=SEEDED_USER_ID, now: datetime | None = None) -> list[dict]:
    end = today(now, user_tz(conn, user_id))
    start = end - timedelta(days=days - 1)
    rows = conn.execute(
        "SELECT day, score_sum, turns FROM mood_daily WHERE user_id = %s AND day BETWEEN %s AND %s",
        (user_id, start, end),
    ).fetchall()
    by_day = {r[0]: (r[1], r[2]) for r in rows}
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        s, n = by_day.get(d, (0.0, 0))
        out.append({"day": d.isoformat(), "mood": round(s / n, 3) if n else None, "turns": n})
    return out


router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


@router.get("/mood")
def get_mood(days: int = Query(14, ge=1, le=90)) -> dict:
    with connect() as conn:
        return {"timezone": user_tz_name(conn), "days": curve(conn, days)}


def register_mood(app: FastAPI) -> None:
    app.include_router(router)
