"""商店与代币：外观解锁、每日领取、购买。

当前版本把「非默认外观」设为需要代币解锁；默认外观始终免费。
"""

from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from olo.userctx import current_user_id
from olo.usertz import user_tz_name
from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.subscription import (
    FREE_DAILY_TOKENS,
    PLUS_DAILY_TOKENS,
    PLUS_SHOP_DISCOUNT,
    _subscription_row,
    is_plus,
)

ITEMS = [
    {"id": "eyes:almond", "kind": "eyes", "value": "almond", "name": "杏眼", "price": 15},
    {"id": "cheeks:dots", "kind": "cheeks", "value": "dots", "name": "小点腮红", "price": 10},
    {"id": "cheeks:triangle", "kind": "cheeks", "value": "triangle", "name": "三角腮红", "price": 10},
    {"id": "cheeks:warpaint", "kind": "cheeks", "value": "warpaint", "name": "战纹", "price": 10},
    {"id": "hair:bow", "kind": "hair", "value": "bow", "name": "蝴蝶结 发型", "price": 20},
    {"id": "hair:leaf", "kind": "hair", "value": "leaf", "name": "小叶子 发型", "price": 20},
    {"id": "hair:spikes", "kind": "hair", "value": "spikes", "name": "小刺刺 发型", "price": 20},
    {"id": "hair:curl", "kind": "hair", "value": "curl", "name": "卷卷 发型", "price": 20},
    {"id": "hair:max", "kind": "hair", "value": "crest", "name": "鸡冠 发型", "price": 20},
    {"id": "hair:bun", "kind": "hair", "value": "bun", "name": "丸子头 发型", "price": 20},
    {"id": "hair:sun", "kind": "hair", "value": "sun", "name": "小太阳 发型", "price": 20},
    {"id": "hair:halo", "kind": "hair", "value": "halo", "name": "光环 发型", "price": 20},
    {"id": "hair:straw", "kind": "hair", "value": "straw", "name": "斗笠", "price": 20},
    {"id": "voice:voice2", "kind": "voice", "value": "voice2", "name": "声音 2", "price": 30},
    {"id": "form:cloud", "kind": "form", "value": "cloud", "name": "云朵形态", "price": 50},
    {"id": "form:glow", "kind": "form", "value": "glow", "name": "微光形态", "price": 50},
    {"id": "form:bud", "kind": "form", "value": "bud", "name": "芽苞", "price": 50},
    {"id": "form:dew", "kind": "form", "value": "dew", "name": "露珠", "price": 50},
    {"id": "form:star", "kind": "form", "value": "star", "name": "星星", "price": 50},
    {"id": "form:peach", "kind": "form", "value": "peach", "name": "桃花", "price": 50},
    {"id": "form:acorn", "kind": "form", "value": "acorn", "name": "橡果", "price": 50},
    {"id": "form:moon", "kind": "form", "value": "moon", "name": "月牙", "price": 50},
    {"id": "form:amber", "kind": "form", "value": "amber", "name": "琥珀", "price": 50},
]

BY_ID = {item["id"]: item for item in ITEMS}
LOCKED = {(item["kind"], item["value"]): item for item in ITEMS}

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


class BuyRequest(BaseModel):
    item_id: str


def _ensure_wallet(conn) -> tuple[int, bool]:
    conn.execute(
        """
        INSERT INTO wallets (user_id, tokens)
        VALUES (%s, 0)
        ON CONFLICT (user_id) DO NOTHING
        """,
        (current_user_id(),),
    )
    row = conn.execute(
        """
        SELECT tokens, COALESCE(last_claim_date >= (now() AT TIME ZONE %s)::date, false)
        FROM wallets WHERE user_id = %s
        """,
        (user_tz_name(conn), current_user_id()),
    ).fetchone()
    return row[0], bool(row[1])


def owned_item_ids(conn) -> set[str]:
    rows = conn.execute(
        "SELECT item_id FROM purchases WHERE user_id = %s",
        (current_user_id(),),
    ).fetchall()
    return {row[0] for row in rows}


def owns_value(conn, kind: str, value: str) -> bool:
    """默认外观免费；非默认外观需要在 purchases 里有对应条目。"""
    item = LOCKED.get((kind, value))
    if item is None:
        return True
    return item["id"] in owned_item_ids(conn)


def _plus(conn) -> bool:
    return is_plus(_subscription_row(conn))


def _claim_amount(conn) -> int:
    return PLUS_DAILY_TOKENS if _plus(conn) else FREE_DAILY_TOKENS


def _final_price(conn, price: int) -> int:
    if _plus(conn):
        return max(1, int(price * (1 - PLUS_SHOP_DISCOUNT)))
    return price


def _shop_payload(conn) -> dict:
    tokens, claimed_today = _ensure_wallet(conn)
    owned = owned_item_ids(conn)
    return {
        "tokens": tokens,
        "can_claim": not claimed_today,
        "claim_amount": _claim_amount(conn),
        "items": [
            {
                "id": item["id"],
                "kind": item["kind"],
                "value": item["value"],
                "name": item["name"],
                "price": _final_price(conn, item["price"]),
                "base_price": item["price"],
                "owned": item["id"] in owned,
            }
            for item in ITEMS
        ],
    }


@router.get("/shop")
def get_shop(request: Request) -> dict:
    with connect() as conn:
        payload = _shop_payload(conn)
        conn.commit()
    return payload


@router.post("/shop/claim")
def claim_tokens(request: Request) -> dict:
    with connect() as conn:
        _ensure_wallet(conn)
        tz = user_tz_name(conn)
        updated = conn.execute(
            """
            UPDATE wallets
            SET tokens = tokens + %s, last_claim_date = (now() AT TIME ZONE %s)::date
            WHERE user_id = %s
              AND (last_claim_date IS NULL OR last_claim_date < (now() AT TIME ZONE %s)::date)
            RETURNING tokens
            """,
            (_claim_amount(conn), tz, current_user_id(), tz),
        ).fetchone()
        if updated is None:
            conn.commit()
            raise ApiError(409, "ALREADY_CLAIMED", "今天已经领过了")
        conn.commit()
        return {"tokens": updated[0], "claimed": _claim_amount(conn)}


@router.post("/shop/buy")
def buy_item(payload: BuyRequest, request: Request) -> JSONResponse:
    item = BY_ID.get(payload.item_id)
    if item is None:
        raise ApiError(404, "NOT_FOUND", "没有这个商品")
    with connect() as conn:
        _ensure_wallet(conn)
        if item["id"] in owned_item_ids(conn):
            raise ApiError(409, "ALREADY_OWNED", "已经拥有这个外观")
        price = _final_price(conn, item["price"])
        paid = conn.execute(
            """
            UPDATE wallets SET tokens = tokens - %s
            WHERE user_id = %s AND tokens >= %s
            RETURNING tokens
            """,
            (price, current_user_id(), price),
        ).fetchone()
        if paid is None:
            conn.commit()
            raise ApiError(402, "INSUFFICIENT_TOKENS", "代币不够")
        conn.execute(
            """
            INSERT INTO purchases (id, user_id, item_id)
            VALUES (%s, %s, %s)
            """,
            (uuid.uuid4(), current_user_id(), item["id"]),
        )
        conn.commit()
        return JSONResponse(
            status_code=201,
            content={
                "item_id": item["id"],
                "tokens": paid[0],
                "tokens_spent": price,
            },
        )


def debug_enabled() -> bool:
    """Local testing only: OLO_DEBUG=1 adds a token-grant endpoint. Never set in production."""
    return os.environ.get("OLO_DEBUG", "0").strip() == "1"


DEBUG_GRANT = 100


@router.post("/debug/grant-tokens", include_in_schema=False)
def debug_grant_tokens(request: Request) -> dict:
    # Route answers 404 unless OLO_DEBUG=1 (default off; docker compose / .env.example keep it off).
    if not debug_enabled():
        raise ApiError(404, "NOT_FOUND", "Not Found")
    with connect() as conn:
        _ensure_wallet(conn)
        row = conn.execute(
            "UPDATE wallets SET tokens = tokens + %s WHERE user_id = %s RETURNING tokens",
            (DEBUG_GRANT, current_user_id()),
        ).fetchone()
        conn.commit()
    return {"tokens": row[0], "granted": DEBUG_GRANT}


def register_shop(app: FastAPI) -> None:
    app.include_router(router)
