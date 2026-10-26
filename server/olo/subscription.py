"""订阅与免费额度。

开发期模拟内购：没有接 StoreKit。`activate` 默认关闭（403），只有 OLO_DEV_SUBSCRIPTIONS=1 时才直接把用户标成 plus。
真实产品里这里应该由 App Store 收据校验驱动，额度仍由服务端判断。
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from olo.userctx import current_user_id
from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])

FREE_LIMITS = {"messages": 20, "notebook": 1, "insights": 1}
PLAN_DAYS = {"monthly": 30, "yearly": 365}
FREE_DAILY_TOKENS = 5
PLUS_DAILY_TOKENS = 10
PLUS_SHOP_DISCOUNT = 0.2


class ActivateRequest(BaseModel):
    plan: str = "monthly"


def _subscription_row(conn: psycopg.Connection, user_id=None):
    if user_id is None:
        user_id = current_user_id()
    return conn.execute(
        """
        SELECT tier, status, plan, started_at, renews_at
        FROM subscriptions WHERE user_id = %s
        """,
        (user_id,),
    ).fetchone()


def is_plus(row, *, now: datetime | None = None) -> bool:
    if row is None:
        return False
    tier, status, _plan, _started, renews_at = row
    if tier != "plus" or status not in {"active", "canceled"}:
        return False
    if renews_at is None:
        return True
    return renews_at > (now or datetime.now(timezone.utc))


def usage(conn: psycopg.Connection, user_id=None) -> dict[str, int]:
    if user_id is None:
        user_id = current_user_id()
    from olo.usertz import user_tz_name

    tz = user_tz_name(conn, user_id)
    messages = conn.execute(
        """
        SELECT count(*) FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE m.role = 'user' AND s.user_id = %s
          AND (m.created_at AT TIME ZONE %s)::date = (now() AT TIME ZONE %s)::date
        """,
        (user_id, tz, tz),
    ).fetchone()[0]
    entries = conn.execute(
        """
        SELECT count(*) FROM notebook_entries
        WHERE user_id = %s AND entry_date = (now() AT TIME ZONE %s)::date
        """,
        (user_id, tz),
    ).fetchone()[0]
    insights = conn.execute(
        """
        SELECT count(*) FROM insights
        WHERE user_id = %s
          AND (created_at AT TIME ZONE %s)::date = (now() AT TIME ZONE %s)::date
        """,
        (user_id, tz, tz),
    ).fetchone()[0]
    return {"messages": messages, "notebook": entries, "insights": insights}


def state(conn: psycopg.Connection, user_id=None) -> dict:
    if user_id is None:
        user_id = current_user_id()
    row = _subscription_row(conn, user_id)
    plus = is_plus(row)
    tier, status, plan, started_at, renews_at = row if row is not None else (
        "free",
        "active",
        None,
        None,
        None,
    )
    return {
        "tier": tier,
        "is_plus": plus,
        "status": status,
        "plan": plan,
        "started_at": started_at.isoformat() if started_at else None,
        "renews_at": renews_at.isoformat() if renews_at else None,
        "limits": None if plus else dict(FREE_LIMITS),
        "usage": usage(conn, user_id),
        "perks": {
            "daily_tokens": PLUS_DAILY_TOKENS if plus else FREE_DAILY_TOKENS,
            "shop_discount": PLUS_SHOP_DISCOUNT if plus else 0.0,
        },
    }


def enforce_quota(conn: psycopg.Connection, feature: str, user_id=None) -> None:
    """免费档超过当日额度时抛 402；plus 不限制。"""
    if user_id is None:
        user_id = current_user_id()
    row = _subscription_row(conn, user_id)
    if is_plus(row):
        return
    used = usage(conn, user_id)[feature]
    limit = FREE_LIMITS[feature]
    if used >= limit:
        raise ApiError(
            402,
            "LIMIT_REACHED",
            f"今天的免费额度用完了（{limit} 次）。升级 olo+ 可以继续。",
        )


@router.get("/subscription")
def get_subscription(request: Request) -> dict:
    with connect() as conn:
        return state(conn)


@router.post("/subscription/activate")
def activate(request: Request, payload: ActivateRequest) -> JSONResponse:
    # 还没接 App Store / Google Play 收据校验：直接开通只允许在显式打开的开发开关下使用，默认关闭
    if os.environ.get("OLO_DEV_SUBSCRIPTIONS", "0") != "1":
        raise ApiError(403, "RECEIPT_REQUIRED", "需要应用商店的购买凭证才能开通 olo+（还未上线）")
    if payload.plan not in PLAN_DAYS:
        raise ApiError(422, "VALIDATION_FAILED", "plan 只能是 monthly 或 yearly")
    days = PLAN_DAYS[payload.plan]
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO subscriptions
              (user_id, tier, status, plan, started_at, renews_at, updated_at)
            VALUES (%s, 'plus', 'active', %s, now(),
                    now() + make_interval(days => %s), now())
            ON CONFLICT (user_id) DO UPDATE
              SET tier = 'plus',
                  status = 'active',
                  plan = EXCLUDED.plan,
                  started_at = now(),
                  renews_at = EXCLUDED.renews_at,
                  updated_at = now()
            """,
            (current_user_id(), payload.plan, days),
        )
        conn.commit()
        return JSONResponse(status_code=201, content=state(conn))


@router.post("/subscription/cancel")
def cancel(request: Request) -> dict:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO subscriptions (user_id, tier, status, updated_at)
            VALUES (%s, 'free', 'canceled', now())
            ON CONFLICT (user_id) DO UPDATE
              SET status = 'canceled', updated_at = now()
            """,
            (current_user_id(),),
        )
        conn.commit()
        return state(conn)


def register_subscription(app: FastAPI) -> None:
    app.include_router(router)
