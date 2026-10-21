"""Garden growth: 把「聊了多少、记了多少」投影成一座会长的花园。

只读投影，不落新表；等级阈值是产品参数，后续可以按真实体验调整。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, FastAPI, Request

from olo.db import connect
from olo.story import GARDEN_STAGES, LORE_BEATS
from olo.sessions import SEEDED_USER_ID, require_bearer

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])

# 每级所需累计分数（下标 0 是 1 级门槛）。
LEVEL_THRESHOLDS = [0, 20, 60, 120, 200]
MAX_LEVEL = len(LEVEL_THRESHOLDS)

MILESTONES = [
    ("first_talk", "第一次开口"),
    ("five_talks", "聊过五轮"),
    ("first_entry", "第一篇日记"),
    ("first_insight", "第一条洞察"),
    ("three_days", "来过三天"),
    ("ten_days", "来过十天"),
]


def levels_for(score: int) -> tuple[int, int, int]:
    """返回 (level, 当前等级下限, 下一等级门槛)；满级时上限等于下限。"""
    level = 1
    for index, threshold in enumerate(LEVEL_THRESHOLDS):
        if score >= threshold:
            level = index + 1
    if level >= MAX_LEVEL:
        return MAX_LEVEL, LEVEL_THRESHOLDS[-1], LEVEL_THRESHOLDS[-1]
    return level, LEVEL_THRESHOLDS[level - 1], LEVEL_THRESHOLDS[level]


def garden_state(conn) -> dict:
    messages = conn.execute(
        "SELECT count(*) FROM messages WHERE role = 'user'"
    ).fetchone()[0]
    entries = conn.execute(
        "SELECT count(*) FROM notebook_entries WHERE user_id = %s",
        (SEEDED_USER_ID,),
    ).fetchone()[0]
    insights = conn.execute(
        "SELECT count(*) FROM insights WHERE user_id = %s",
        (SEEDED_USER_ID,),
    ).fetchone()[0]
    days = conn.execute(
        """
        SELECT count(DISTINCT (created_at AT TIME ZONE 'UTC')::date)
        FROM messages WHERE role = 'user'
        """
    ).fetchone()[0]

    score = messages * 2 + entries * 12 + insights * 8
    level, low, high = levels_for(score)
    if high == low:
        growth = 100 if score >= low else 0
    else:
        growth = max(0, min(100, round((score - low) * 100 / (high - low))))

    reached = {
        "first_talk": messages >= 1,
        "five_talks": messages >= 5,
        "first_entry": entries >= 1,
        "first_insight": insights >= 1,
        "three_days": days >= 3,
        "ten_days": days >= 10,
    }

    return {
        "level": level,
        "max_level": MAX_LEVEL,
        "growth": growth,
        "score": score,
        "next_level_score": None if level >= MAX_LEVEL else high,
        "messages": messages,
        "entries": entries,
        "insights": insights,
        "days": days,
        "stage": GARDEN_STAGES[level - 1],
        "milestones": [
            {"key": key, "label": label, "reached": reached[key]}
            for key, label in MILESTONES
        ],
        "lore": [
            {"key": key, **LORE_BEATS[key]}
            for key, _label in MILESTONES
            if reached[key] and key in LORE_BEATS
        ],
    }


@router.get("/garden")
def get_garden(request: Request) -> dict:
    with connect() as conn:
        return garden_state(conn)


def register_garden(app: FastAPI) -> None:
    app.include_router(router)
