"""雾里集小世界：可收集物换代币（每个 find_id 只算一次，每天有上限），以及一小块存档（植物、彩蛋进度）。

find_id 由前端按「日期:场景:物件」生成，例如 2026-10-23:forest:shell-2；同一个 id 重复提交不会重复加币。
"""

from __future__ import annotations

import json
import re
import uuid

from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel, Field

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.shop import _ensure_wallet
from olo.usertz import user_tz_name

REWARDS = {"shell": 1, "mushroom": 1, "leaf": 1, "star": 2, "fish": 2, "bloom": 5, "egg": 5, "treasure": 5}

# 藏在雾里集的 6 件小东西：找到一件，olo 就在日记里记一笔（每件只记一次，永久）。前端 web/world-scenes.js 的 TREASURES 与这里同一份 id。
TREASURES = {
    "brass-key": ("小铜钥匙", "长椅底下有一把小铜钥匙，齿都磨圆了。不知道它开的是哪扇门，我先替那扇门收着。"),
    "paper-crane": ("纸鹤", "包子摊的棚顶上卡着一只纸鹤，翅膀上写着一行很小的字：「今天也辛苦啦」。我把它抚平，夹进了这一页。"),
    "music-roll": ("八音盒的纸带", "床底下滚出来一截八音盒纸带，上面的小孔排成一首我没听过的歌。等你来，我们一起把它装回去听。"),
    "message-bottle": ("漂流瓶", "灯籽湾边上冲来一个漂流瓶，里面的纸条只写了一个字：「在」。我想了很久，觉得是写给每一个在等的人。"),
    "fallen-star": ("落下来的星星", "屋顶的瓦缝里卡着一颗小小的星星石，还温温的。传说流星落进雾里集就会变成这样。"),
    "lantern-seed": ("一粒灯籽", "井边的苔藓里藏着一粒米粒大的灯籽，在发很弱的光。它还没认人，我把它放进口袋，等它慢慢长大。"),
}
DAILY_CAP = 25
STATE_MAX = 16_000
FIND_RE = re.compile(r"^[0-9a-z:_\-]{3,80}$")

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


class FindRequest(BaseModel):
    find_id: str = Field(max_length=80)
    kind: str


class StateRequest(BaseModel):
    state: dict


def _today_earned(conn, tz: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) FROM world_finds WHERE user_id = %s AND found_on = (now() AT TIME ZONE %s)::date",
        (SEEDED_USER_ID, tz),
    ).fetchone()
    return int(row[0])


def _payload(conn) -> dict:
    tz = user_tz_name(conn)
    tokens, _ = _ensure_wallet(conn)
    finds = conn.execute(
        "SELECT find_id FROM world_finds WHERE user_id = %s AND found_on = (now() AT TIME ZONE %s)::date",
        (SEEDED_USER_ID, tz),
    ).fetchall()
    row = conn.execute("SELECT state FROM world_state WHERE user_id = %s", (SEEDED_USER_ID,)).fetchone()
    return {
        "tokens": tokens,
        "today_earned": _today_earned(conn, tz),
        "daily_cap": DAILY_CAP,
        "finds": sorted(r[0] for r in finds),
        "state": row[0] if row else {},
        "rewards": REWARDS,
        "treasures": _found_treasures(conn),
        "treasure_total": len(TREASURES),
    }


def _found_treasures(conn) -> list[str]:
    rows = conn.execute(
        "SELECT kind FROM notebook_entries WHERE user_id = %s AND kind LIKE 'treasure-%%'", (SEEDED_USER_ID,)
    ).fetchall()
    return sorted(r[0].removeprefix("treasure-") for r in rows if r[0].removeprefix("treasure-") in TREASURES)


class TreasureRequest(BaseModel):
    id: str = Field(max_length=40)


@router.get("/world")
def get_world(request: Request) -> dict:
    with connect() as conn:
        body = _payload(conn)
        conn.commit()
    return body


@router.post("/world/find")
def post_find(payload: FindRequest, request: Request) -> dict:
    if payload.kind not in REWARDS:
        raise ApiError(422, "BAD_KIND", "没有这种东西")
    if not FIND_RE.match(payload.find_id):
        raise ApiError(422, "BAD_ID", "find_id 格式不对")
    with connect() as conn:
        tz = user_tz_name(conn)
        _ensure_wallet(conn)
        earned = _today_earned(conn, tz)
        amount = max(0, min(REWARDS[payload.kind], DAILY_CAP - earned))
        row = conn.execute(
            """
            INSERT INTO world_finds (user_id, find_id, kind, amount, found_on)
            VALUES (%s, %s, %s, %s, (now() AT TIME ZONE %s)::date)
            ON CONFLICT (user_id, find_id) DO NOTHING
            RETURNING amount
            """,
            (SEEDED_USER_ID, payload.find_id, payload.kind, amount, tz),
        ).fetchone()
        granted = row[0] if row else 0
        if granted:
            conn.execute("UPDATE wallets SET tokens = tokens + %s WHERE user_id = %s", (granted, SEEDED_USER_ID))
        body = _payload(conn)
        conn.commit()
    return {**body, "granted": granted, "duplicate": row is None, "capped": row is not None and granted < REWARDS[payload.kind]}


@router.post("/world/treasure")
def post_treasure(payload: TreasureRequest, request: Request) -> dict:
    """找到一件藏起来的东西：记进日记（kind = treasure-<id>），再按收集物发一次代币。重复提交不重复记。"""
    item = TREASURES.get(payload.id)
    if not item:
        raise ApiError(422, "BAD_TREASURE", "雾里集没藏这个")
    name, line = item
    with connect() as conn:
        tz = user_tz_name(conn)
        today = conn.execute("SELECT (now() AT TIME ZONE %s)::date", (tz,)).fetchone()[0]
        found_n = len(_found_treasures(conn))
        title = f"找到了：{name}（{found_n + 1}/{len(TREASURES)}）"
        row = conn.execute(
            """
            INSERT INTO notebook_entries (id, user_id, entry_date, kind, title, body)
            SELECT %s, %s, %s, %s, %s, %s
            WHERE NOT EXISTS (SELECT 1 FROM notebook_entries WHERE user_id = %s AND kind = %s)
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (uuid.uuid4(), SEEDED_USER_ID, today, f"treasure-{payload.id}", title, line, SEEDED_USER_ID, f"treasure-{payload.id}"),
        ).fetchone()
        conn.commit()
    granted = 0
    if row:
        granted = post_find(FindRequest(find_id=f"treasure:{payload.id}", kind="treasure"), request)["granted"]
    with connect() as conn:
        body = _payload(conn)
    return {**body, "new": row is not None, "granted": granted, "name": name, "line": line}


def living_summary(conn, user_id=SEEDED_USER_ID) -> dict:
    """「活的雾里集」用的数据摘要：只数这个用户自己的记录，按用户时区算日子。场景映射在共享前端 world-living.js 里做。"""
    tz = user_tz_name(conn, user_id)
    days = [r[0] for r in conn.execute(
        """
        SELECT DISTINCT (m.created_at AT TIME ZONE %s)::date AS d FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND m.role = 'user' ORDER BY d DESC LIMIT 400
        """,
        (tz, user_id),
    ).fetchall()]
    today = conn.execute("SELECT (now() AT TIME ZONE %s)::date", (tz,)).fetchone()[0]
    streak = 0
    if days and (today - days[0]).days <= 1:
        streak, prev = 1, days[0]
        for d in days[1:]:
            if (prev - d).days != 1:
                break
            streak, prev = streak + 1, d
    moods = conn.execute(
        "SELECT day, score_sum / NULLIF(turns, 0) FROM mood_daily WHERE user_id = %s AND day > %s - 7 AND turns > 0 ORDER BY day",
        (user_id, today),
    ).fetchall()
    mood = round(sum(float(m[1]) for m in moods) / len(moods), 3) if moods else None
    postcards = conn.execute("SELECT count(*), count(DISTINCT place) FROM postcards WHERE user_id = %s", (user_id,)).fetchone()
    diary = conn.execute("SELECT count(*) FROM notebook_entries WHERE user_id = %s", (user_id,)).fetchone()[0]
    return {
        "chat_days": len(days),
        "streak": streak,
        "mood": mood,  # 最近 7 天平均心情，-1…1；没数据是 None
        "mood_days": len(moods),
        "postcards": int(postcards[0]),
        "places": int(postcards[1]),
        "diary": int(diary),
        "today": today.isoformat(),
        "tz": tz,
    }


@router.get("/world/state")
def get_living(request: Request) -> dict:
    with connect() as conn:
        body = living_summary(conn)
    return body


@router.put("/world/state")
def put_state(payload: StateRequest, request: Request) -> dict:
    raw = json.dumps(payload.state, ensure_ascii=False)
    if len(raw) > STATE_MAX:
        raise ApiError(413, "TOO_BIG", "存档太大")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO world_state (user_id, state, updated_at) VALUES (%s, %s::jsonb, now())
            ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
            """,
            (SEEDED_USER_ID, raw),
        )
        conn.commit()
    return {"ok": True}


def register_world(app: FastAPI) -> None:
    app.include_router(router)
