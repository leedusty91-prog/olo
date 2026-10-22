"""Per-user timezone: every "today", quiet hour and nightly job uses the user's local clock.

The browser / app sends its IANA zone (Intl resolvedOptions().timeZone); anything
zoneinfo doesn't know falls back to Asia/Shanghai (or OLO_TZ).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from olo.sessions import SEEDED_USER_ID

FALLBACK = "Asia/Shanghai"
WEEKDAYS = "一二三四五六日"


def default_name() -> str:
    return normalize(os.environ.get("OLO_TZ", "")) or FALLBACK


def normalize(name: object) -> str | None:
    """Return a valid IANA zone name or None."""
    if not isinstance(name, str):
        return None
    name = name.strip()
    if not name or len(name) > 64 or ".." in name or name.startswith("/"):
        return None
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None
    return name


def user_tz_name(conn, user_id=SEEDED_USER_ID) -> str:
    row = conn.execute("SELECT timezone FROM users WHERE id = %s", (user_id,)).fetchone()
    return normalize(row[0] if row else None) or default_name()


def user_tz(conn, user_id=SEEDED_USER_ID) -> ZoneInfo:
    return ZoneInfo(user_tz_name(conn, user_id))


def set_user_tz(conn, name: object, user_id=SEEDED_USER_ID) -> str | None:
    """Store a valid zone; silently ignore invalid ones. Returns the stored name or None."""
    valid = normalize(name)
    if valid:
        conn.execute("UPDATE users SET timezone = %s WHERE id = %s", (valid, user_id))
    return valid


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(timezone.utc)


def local_now(tz: ZoneInfo, now: datetime | None = None) -> datetime:
    return _now(now).astimezone(tz)


def local_today(tz: ZoneInfo, now: datetime | None = None) -> date:
    return local_now(tz, now).date()


def day_start(tz: ZoneInfo, now: datetime | None = None) -> datetime:
    return local_now(tz, now).replace(hour=0, minute=0, second=0, microsecond=0)


def part_of_day(hour: int) -> str:
    if 5 <= hour < 8:
        return "清晨"
    if 8 <= hour < 11:
        return "上午"
    if 11 <= hour < 13:
        return "中午"
    if 13 <= hour < 17:
        return "下午"
    if 17 <= hour < 19:
        return "傍晚"
    if 19 <= hour < 23:
        return "晚上"
    return "深夜"


def time_context(tz: ZoneInfo, now: datetime | None = None) -> str:
    local = local_now(tz, now)
    return (
        f"对方那边现在是 {local:%Y-%m-%d %H:%M}（星期{WEEKDAYS[local.weekday()]}，{part_of_day(local.hour)}，"
        f"时区 {tz.key}）。只在自然的时候参考时间（比如深夜别劝对方出门），不要每次都报时。"
    )
