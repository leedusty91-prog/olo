"""小窝「出门」：olo 去雾里集的小广场 / 灯籽湾 / 屋顶转一圈，带回一张像素明信片和两句话的小故事。

- 用辅助模型（不开思考）生成，提示里带世界规则和相关设定，保证不和 olo 讲过的话矛盾；
- 模型失败或离线模式时退回内置的小故事，出门这件事永远不会失败；
- 每天最多 DAILY_LIMIT 张，超出返回 429；明信片不发代币，刷不出东西。
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from olo.canon import WORLD_RULES, prompt_canon
from olo.db import connect
from olo.notebook import complete_json
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.usertz import local_today, user_tz

logger = logging.getLogger(__name__)

DAILY_LIMIT = 3
PLACES = {"plaza": "雾里集小广场", "lake": "灯籽湾", "roof": "屋顶"}
MAX_TITLE = 16
MAX_STORY = 90

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


class TripRequest(BaseModel):
    place: str


SYSTEM = (
    "你是陪伴角色 olo，刚出门转了一圈回到小窝，要给用户寄一张明信片。"
    + WORLD_RULES
    + "\n要求：只输出 JSON，形如 {\"title\": \"地点 · 时段\", \"story\": \"两句话\"}。"
    "story 恰好两句中文，总共不超过 60 字，第一人称，写这次出门看见的一个具体小画面和一个小发现；"
    "温柔、具体、不说教，不提用户的隐私，不编造新的熟人和地名，不和设定矛盾（olo 不吃饭不睡觉）。"
)

FALLBACK = {
    "plaza": ["晾话廊上又挂满了别人的话，风一吹就轻轻地响。我挑了一句最暖的，悄悄记下来带给你。",
              "广场边的老灯树今天掉了一片发光的叶子。我把它夹进书架第三层了，晚上会亮一下。"],
    "lake": ["今天灯籽湾的水像一块橘子糖，芦婆婆的船在远处慢慢划。我数到第七圈涟漪的时候，想起你了。",
             "湖边的雾今天很薄，能看见对岸的灯一盏一盏醒过来。我在码头坐了一会儿，听见豆灯又迷路了。"],
    "roof": ["屋顶上能看见整个雾里集，晚霞把每片瓦都染成了粉色。我在烟囱旁边找到一颗被风吹来的小星星。",
             "我在屋顶数了数亮着的窗子，一共十二扇。有一扇一直亮着，像在等谁回家。"],
}


def _clean_story(text: str) -> str:
    text = " ".join(text.split())
    parts = [p for p in re.split(r"(?<=[。！？!?])", text) if p.strip()]
    story = "".join(parts[:2]) if parts else text
    return story[:MAX_STORY]


def _fallback(place: str, day: date, n: int) -> dict:
    options = FALLBACK[place]
    seed = int(hashlib.sha256(f"{day}:{place}:{n}".encode()).hexdigest(), 16)
    return {"title": f"{PLACES[place]}", "story": options[seed % len(options)], "source": "fallback"}


def write_postcard(runtime, place: str, *, day: date, n: int) -> dict:
    try:
        if runtime is None:
            raise RuntimeError("no runtime")
        canon = prompt_canon(PLACES[place])
        parsed = complete_json(runtime, SYSTEM + ("\n" + canon if canon else ""), f"这次去的是：{PLACES[place]}。")
        title = str(parsed.get("title") or PLACES[place]).strip()[:MAX_TITLE] or PLACES[place]
        story = _clean_story(str(parsed.get("story") or ""))
        if len(story) < 8:
            raise ValueError("story too short")
        return {"title": title, "story": story, "source": "llm"}
    except Exception as exc:  # 模型挂了也要能回家
        logger.info("postcard fallback: %s", type(exc).__name__)
        return _fallback(place, day, n)


def _row(r) -> dict:
    return {"id": str(r[0]), "place": r[1], "place_name": PLACES.get(r[1], r[1]), "title": r[2], "story": r[3], "made_on": r[4].isoformat(), "created_at": r[5].isoformat()}


COLS = "id, place, title, story, made_on, created_at"


def _today_count(conn, day: date) -> int:
    return int(conn.execute("SELECT count(*) FROM postcards WHERE user_id = %s AND made_on = %s", (SEEDED_USER_ID, day)).fetchone()[0])


@router.post("/postcards")
def post_trip(payload: TripRequest, request: Request) -> JSONResponse:
    if payload.place not in PLACES:
        raise ApiError(422, "BAD_PLACE", "olo 不认识这个地方")
    runtime = getattr(request.app.state, "runtime", None)
    with connect() as conn:
        day = local_today(user_tz(conn))
        # 加锁再数：并发连点也不会超额
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('postcards'))")
        used = _today_count(conn, day)
        if used >= DAILY_LIMIT:
            raise ApiError(429, "DAILY_LIMIT", "今天已经出门好几趟啦，明天再去吧")
        card = write_postcard(runtime, payload.place, day=day, n=used)
        row = conn.execute(
            f"INSERT INTO postcards (id, user_id, place, title, story, made_on, source) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING {COLS}",
            (uuid.uuid4(), SEEDED_USER_ID, payload.place, card["title"], card["story"], day, card["source"]),
        ).fetchone()
        conn.commit()
    return JSONResponse(status_code=201, content={**_row(row), "left_today": DAILY_LIMIT - used - 1})


@router.get("/postcards")
def list_postcards(request: Request, limit: int = 30) -> dict:
    limit = max(1, min(limit, 100))
    with connect() as conn:
        day = local_today(user_tz(conn))
        rows = conn.execute(f"SELECT {COLS} FROM postcards WHERE user_id = %s ORDER BY created_at DESC LIMIT %s", (SEEDED_USER_ID, limit)).fetchall()
        left = DAILY_LIMIT - _today_count(conn, day)
    return {"postcards": [_row(r) for r in rows], "left_today": max(0, left), "daily_limit": DAILY_LIMIT}


def register_postcards(app: FastAPI) -> None:
    app.include_router(router)
