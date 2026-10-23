"""雾里集小世界：可收集物换代币（每个 find_id 只算一次，每天有上限），以及一小块存档（植物、彩蛋进度）。

find_id 由前端按「日期:场景:物件」生成，例如 2026-10-23:forest:shell-2；同一个 id 重复提交不会重复加币。
"""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel, Field

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.shop import _ensure_wallet
from olo.usertz import user_tz_name

REWARDS = {"shell": 1, "mushroom": 1, "leaf": 1, "star": 2, "fish": 2, "bloom": 5, "egg": 5}
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
    }


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
