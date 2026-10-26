"""照片 → 像素小角落。

原图不离开设备：网页端把照片缩成 12×9 的像素缩略图，再数出主色和几个画面特征（亮/暖/绿/蓝/饱和/杂），
只把这些数字（加上用户可选的一句话）发上来。服务端用现有的聊天模型（DeepSeek 时 thinking 开着）
把它们“读”成一个 8×8 的小场景：地面、边、6–9 个可以点的道具（各带一句 olo 的话）。
模型不可用 / mock / 输出不合法时，按特征确定性地拼一个，保证总能生成。
"""

from __future__ import annotations

import json
import os
import re
import uuid
from collections.abc import Callable

from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel, Field

from olo.userctx import current_user_id
from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.usertz import user_tz_name

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])

GRID = 8
FLOORS = ("grass", "forest", "sand", "path", "plaza", "wood", "stone", "dirt", "roof")
# 道具目录：只用雾里集已有的像素画，保证风格统一。type → (默认名, 点击框 [宽, 高])
PROPS: dict[str, tuple[str, list[int]]] = {
    "tree": ("小树", [30, 36]), "pine": ("松树", [20, 40]), "lamp": ("路灯", [12, 42]), "lantern": ("灯笼", [12, 22]),
    "bench": ("长椅", [28, 18]), "crates": ("木箱", [26, 24]), "pot": ("花盆", [16, 18]), "rock": ("石头", [18, 12]),
    "flowers": ("一丛花", [16, 10]), "mushroom": ("蘑菇", [12, 12]), "shell": ("贝壳", [12, 8]), "table": ("小桌", [24, 20]),
    "jar": ("坛子", [14, 18]), "cushion": ("坐垫", [18, 10]), "well": ("井", [30, 36]), "reeds": ("芦苇", [14, 18]),
    "telescope": ("望远镜", [22, 26]), "chime": ("风铃", [14, 32]), "snowman": ("雪人", [18, 28]),
}
def daily_cap() -> int:
    """每人每天（按用户本地日）最多生成几个角落：OLO_CORNER_DAILY_CAP，默认 5；非法值回到默认，0 = 关掉生成。"""
    try:
        return max(0, int(os.environ.get("OLO_CORNER_DAILY_CAP", "5").strip() or 5))
    except ValueError:
        return 5


HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class CornerRequest(BaseModel):
    palette: list[str] = Field(min_length=1, max_length=8)
    stats: dict[str, float] = Field(default_factory=dict)
    thumb: list[str] = Field(default_factory=list, max_length=12 * 9)
    note: str = Field(default="", max_length=60)


PROMPT = """你是像素游戏「雾里集」的关卡设计师。用户拍了一张照片，我们只拿到了它的「色彩摘要」（不是原图）：
主色（按占比从大到小）：{palette}
画面特征（0..1）：亮度 {bright:.2f}，暖色 {warm:.2f}，绿色 {green:.2f}，蓝色 {blue:.2f}，饱和 {sat:.2f}，细节多 {busy:.2f}
用户说：{note}

请根据这些，想象照片里大概是什么地方，设计一个 8×8 格、可以走进去的小角落，让 olo（一团小小的橘色光）在里面逛。
只输出一个 JSON 对象，不要解释：
{{"title": "≤8 个字的地名", "floor": 地面, "edge": 边缘地面, "pond": true/false（角落里要不要一小片水）,
 "props": [{{"type": 道具, "x": 0.5–7.5, "y": 0.5–7.5, "label": "≤6 字", "say": "olo 走过去会说的一句话，≤24 字，温柔有画面感"}}, ...6 到 9 个],
 "line": "olo 第一次走进来时说的一句话，≤24 字"}}
地面只能从这些里选：{floors}
道具 type 只能从这些里选：{props}
道具不要叠在一起（彼此至少隔 1.2 格），也不要放在 (4, 6.5) 附近——那是入口。"""


def _clamp(v, lo, hi, d):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d


def sanitize(raw: dict, req: CornerRequest) -> dict | None:
    """把模型输出收进白名单；不合格返回 None。"""
    if not isinstance(raw, dict):
        return None
    floor = raw.get("floor") if raw.get("floor") in FLOORS else None
    if not floor:
        return None
    edge = raw.get("edge") if raw.get("edge") in FLOORS else floor
    props, seen = [], []
    for p in raw.get("props") or []:
        if not isinstance(p, dict) or p.get("type") not in PROPS:
            continue
        x, y = _clamp(p.get("x"), 0.6, GRID - 0.6, None), _clamp(p.get("y"), 0.6, GRID - 0.6, None)
        if x is None or y is None or abs(x - 4) + abs(y - 6.8) < 1.4 or any(abs(x - a) + abs(y - b) < 1.2 for a, b in seen):
            continue
        seen.append((x, y))
        name, hit = PROPS[p["type"]]
        props.append({"type": p["type"], "x": round(x, 2), "y": round(y, 2), "label": str(p.get("label") or name)[:8],
                      "say": str(p.get("say") or "")[:40], "hit": hit})
        if len(props) == 9:
            break
    if len(props) < 4:
        return None
    return {
        "title": str(raw.get("title") or "照片里的角落")[:8],
        "floor": floor, "edge": edge, "pond": bool(raw.get("pond")),
        "props": props, "line": str(raw.get("line") or "")[:40],
    }


def fallback(req: CornerRequest) -> dict:
    """不依赖模型：按特征挑地面和道具，位置用固定的几个好看的点位。"""
    s = req.stats
    g, b, w, br = s.get("green", 0), s.get("blue", 0), s.get("warm", 0), s.get("bright", 0.5)
    if g >= max(b, w):
        floor, edge, kinds, title = "grass", "forest", ["tree", "pine", "flowers", "mushroom", "rock", "bench", "pine"], "绿荫小角"
    elif b >= w:
        floor, edge, kinds, title = "sand", "sand", ["shell", "reeds", "rock", "chime", "telescope", "crates", "shell"], "水边小角"
    else:
        floor, edge, kinds, title = ("wood", "plaza", ["table", "jar", "lantern", "cushion", "pot", "crates", "lamp"], "暖暖的小角") if br < 0.55 else ("plaza", "path", ["lamp", "bench", "pot", "flowers", "well", "tree", "lantern"], "晒太阳的小角")
    spots = [(1.6, 1.6), (4.2, 1.2), (6.6, 1.8), (1.4, 4.4), (6.6, 4.6), (3.6, 3.8), (2.2, 6.4)]
    raw = {"title": (req.note[:8] or title), "floor": floor, "edge": edge, "pond": b > 0.45 and floor != "wood",
           "props": [{"type": k, "x": x, "y": y, "say": f"{PROPS[k][0]}，和照片里的颜色好像。"} for k, (x, y) in zip(kinds, spots)],
           "line": "我好像走进了你的照片里。"}
    return sanitize(raw, req)


def _llm(req: CornerRequest) -> dict | None:
    if os.environ.get("LLM_PROVIDER", "").strip().lower() in {"mock", "offline", "demo"}:
        return None
    from olo.llm import OpenAIChat

    chat = OpenAIChat(purpose="chat")  # purpose=chat：DeepSeek 下 thinking = enabled（和聊天回复一致）
    if not chat.api_key:
        return None
    s = {k: _clamp(req.stats.get(k), 0, 1, 0.5) for k in ("bright", "warm", "green", "blue", "sat", "busy")}
    prompt = PROMPT.format(palette=", ".join(req.palette), note=req.note or "（没说）", floors=", ".join(FLOORS), props=", ".join(PROPS), **s)
    text = "".join(chat.stream([{"role": "user", "content": prompt}]))
    i, j = text.find("{"), text.rfind("}")
    return json.loads(text[i : j + 1]) if i >= 0 < j else None


GENERATOR: Callable[[CornerRequest], dict | None] = _llm


@router.post("/world/corner")
def post_corner(req: CornerRequest, request: Request) -> dict:
    palette = [c.lower() for c in req.palette if HEX.match(c)]
    if not palette:
        raise ApiError(422, "BAD_PALETTE", "颜色看不懂")
    req.palette = palette
    with connect() as conn:
        tz = user_tz_name(conn)
        made = conn.execute(
            "SELECT count(*) FROM world_corners WHERE user_id = %s AND (created_at AT TIME ZONE %s)::date = (now() AT TIME ZONE %s)::date",
            (current_user_id(), tz, tz),
        ).fetchone()[0]
    if made >= daily_cap():
        raise ApiError(429, "CORNER_DAILY_CAP", "今天的照片角落已经造够啦，olo 画得手都酸了～明天再拍一张给它吧。")
    req.thumb = [c.lower() if HEX.match(c) else "#000000" for c in req.thumb]
    source = "llm"
    try:
        layout = sanitize(GENERATOR(req) or {}, req)
    except Exception:
        layout = None
    if not layout:
        layout, source = fallback(req), "fallback"
    layout = {**layout, "palette": palette[:6], "thumb": req.thumb if len(req.thumb) == 12 * 9 else [], "source": source}
    cid = uuid.uuid4()
    with connect() as conn:
        conn.execute("INSERT INTO world_corners (id, user_id, layout) VALUES (%s, %s, %s::jsonb)", (cid, current_user_id(), json.dumps(layout, ensure_ascii=False)))
        conn.commit()
    return {"id": str(cid), **layout}


@router.get("/world/corners")
def list_corners(request: Request) -> dict:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, layout FROM world_corners WHERE user_id = %s ORDER BY created_at DESC LIMIT 6", (current_user_id(),)
        ).fetchall()
    return {"corners": [{"id": str(r[0]), **r[1]} for r in rows]}


def register_corner(app: FastAPI) -> None:
    app.include_router(router)
