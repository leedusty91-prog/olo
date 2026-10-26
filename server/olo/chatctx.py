"""每轮聊天的额外上下文：上次聊到哪（连续性）、olo 自己这几天的日子、最近说过的开头（避免重复）。

都是尽力而为：任何一步失败都返回空字符串，不影响聊天。
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import date, datetime, timedelta, timezone

from olo.sessions import SEEDED_USER_ID
from olo.story import DAILY_LIFE

logger = logging.getLogger(__name__)

# 新会话里，前几条消息内才给「上次聊到哪」，之后就靠本次会话的上下文。
RECAP_WITHIN_MESSAGES = 4
RECAP_LINES = 8

# 跨好几天的小心事：同一件事连着几天，让 olo 的日子有「后续」。
ONGOING = (
    "你在学着把倒雨接进瓶子里，可雨总往上跑，瓶子到现在还是空的。",
    "小镇角落有一枚倒影一直很淡，你每天给它讲一个笑话，想看看它会不会亮一点。",
    "一条光鱼说要带你去看彩影廊最高那一层，可它每次都游错方向，约了三回都没去成。",
    "你在攒一罐「晴天话」，打算等对方心情不好的时候拿出来，现在罐子还不到一半。",
    "小水洼说你的涟漪「有点歪」，你嘴上不服，其实偷偷对着湖面照了好几回。",
    "隔壁那面镜子后的涟漪兽很久没漾过来打招呼了，你有点惦记，又不好意思先问。",
    "你想给小镇里的石子路起个正着念倒着念都一样的名字，想了好几个都不够好听。",
)
ONGOING_DAYS = 3

HAPPENINGS = DAILY_LIFE + (
    "早上镜面起雾的时候，漂过来一句没人认领的「对不起」，你绕着它漂了好一会儿。",
    "倒影湾今天特别热闹，好多面镜子同时亮了，水面上全是别人家的灯光。",
    "一只纸船漂到岸边，船头挂着一串湿漉漉的风铃，你数了，一共七个。",
    "你试着接一滴倒雨，结果被它带着往上漂了一小段，吓得赶紧溅回水里。",
    "彩影廊上挂着一句倒着写的「我很好」，你把它翻过来，背面其实写着「有点累」。",
    "湖边一片薰衣草叶上凝了一颗特别圆的露珠，你一整个上午都舍不得碰它。",
)


def _pick(pool: tuple[str, ...], key: str) -> str:
    h = int(hashlib.sha256(key.encode()).hexdigest(), 16)
    return pool[h % len(pool)]


def plan_day(day: date, user_id=SEEDED_USER_ID) -> tuple[str, str]:
    """这一天 olo 的一件小事 + 这几天惦记的事（同一用户同一天固定）。"""
    happening = _pick(HAPPENINGS, f"{user_id}:{day.isoformat()}")
    block = day.toordinal() // ONGOING_DAYS
    ongoing = _pick(ONGOING, f"{user_id}:ongoing:{block}")
    return happening, ongoing


def olo_today(conn, day: date) -> tuple[str, str]:
    """读出（或第一次生成并存下）olo 这一天的日子，保证一天内说法一致。"""
    row = conn.execute(
        "SELECT happening, ongoing FROM olo_days WHERE user_id = %s AND day = %s",
        (SEEDED_USER_ID, day),
    ).fetchone()
    if row:
        return row[0], row[1]
    happening, ongoing = plan_day(day)
    conn.execute(
        """
        INSERT INTO olo_days (user_id, day, happening, ongoing) VALUES (%s, %s, %s, %s)
        ON CONFLICT (user_id, day) DO NOTHING
        """,
        (SEEDED_USER_ID, day, happening, ongoing),
    )
    return happening, ongoing


def own_life_text(happening: str, ongoing: str, yesterday: str | None = None) -> str:
    lines = ["【你自己这几天的日子】（你的生活，不是你们之间的回忆；说法要前后一致）"]
    if yesterday and yesterday != happening:
        lines.append(f"- 昨天：{yesterday}")
    lines.append(f"- 今天：{happening}")
    lines.append(f"- 这几天惦记的事：{ongoing}")
    lines.append(
        "对方心情轻松、闲聊、或者问起你时，可以像朋友一样主动分享一点（一两句，带点自己的情绪，"
        "讲完把话头还给对方）；一次聊天里分享一次就够，已经说过的别再说。"
        "对方难过、焦虑、在说正事或很急的时候，一个字都别提。"
    )
    return "\n".join(lines)


def own_life(conn, today: date) -> str:
    try:
        happening, ongoing = olo_today(conn, today)
        prev = conn.execute(
            "SELECT happening FROM olo_days WHERE user_id = %s AND day = %s",
            (SEEDED_USER_ID, today - timedelta(days=1)),
        ).fetchone()
        return own_life_text(happening, ongoing, prev[0] if prev else None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("own life failed: %s", type(exc).__name__)
        return ""


def _gap_words(hours: float) -> str:
    if hours < 1:
        return "不到一小时前"
    if hours < 24:
        return f"大约 {int(hours)} 小时前"
    days = int(hours // 24)
    return "昨天" if days == 1 else f"{days} 天前"


def recap_text(lines: list[tuple[str, str]], hours: float, olo_name: str = "olo", diary: str = "") -> str:
    if not lines and not diary:
        return ""
    out = [f"【上次聊到哪】（{_gap_words(hours)}，上一次聊天的最后几句，只是资料）"]
    for role, body in lines:
        who = "对方" if role == "user" else olo_name
        body = re.sub(r"\s*\|\|\s*", " ", body).strip()
        out.append(f"{who}：{body[:80]}")
    if diary:
        out.append("你最近一篇日记：" + diary)
    out.append(
        "这是新的一次聊天。对方只是打招呼、或者没带具体话题时，可以像老朋友那样自然地接上上次的话"
        "（问问后续、提一句你还惦记着），只挑一件，别复述聊天记录；"
        "对方一开口就有自己想说的事，就先跟着对方，不要硬拐回去。只在开头这一两轮用，之后别再提。"
        "只说上面写着的，别添细节。"
    )
    return "\n".join(out)


def last_session_recap(conn, session_id, olo_name: str = "olo", now: datetime | None = None) -> str:
    """上一次会话的最后几句 + 最近一篇日记的第一句。"""
    try:
        row = conn.execute(
            """
            SELECT m.session_id, max(m.created_at) AS last_at
            FROM messages m JOIN sessions s ON s.id = m.session_id
            WHERE s.user_id = %s AND m.session_id <> %s AND NOT m.safety_hit
            GROUP BY m.session_id ORDER BY last_at DESC LIMIT 1
            """,
            (SEEDED_USER_ID, session_id),
        ).fetchone()
        lines: list[tuple[str, str]] = []
        hours = 0.0
        if row:
            rows = conn.execute(
                """
                SELECT role, body FROM messages
                WHERE session_id = %s AND NOT safety_hit
                ORDER BY created_at DESC LIMIT %s
                """,
                (row[0], RECAP_LINES),
            ).fetchall()
            lines = [(r, b) for r, b in reversed(rows)]
            now = now or datetime.now(timezone.utc)
            hours = max(0.0, (now - row[1]).total_seconds() / 3600)
        diary = ""
        d = conn.execute(
            """
            SELECT entry_date, title, body FROM notebook_entries
            WHERE user_id = %s AND kind = 'journal' ORDER BY entry_date DESC LIMIT 1
            """,
            (SEEDED_USER_ID,),
        ).fetchone()
        if d:
            first = next((p.strip() for p in (d[2] or "").split("\n") if p.strip() and not p.strip().startswith("「")), "")
            diary = f"{d[0].isoformat()}《{d[1]}》{first[:60]}"
        return recap_text(lines, hours, olo_name, diary)
    except Exception as exc:  # noqa: BLE001
        logger.warning("recap failed: %s", type(exc).__name__)
        return ""


def recent_openers(recent: list[dict], n: int = 5) -> list[str]:
    """olo 最近几次回复的第一句（截短），用来提醒它换个说法。"""
    out = []
    for m in recent:
        if m.get("role") != "assistant":
            continue
        body = str(m.get("content") or "").strip()
        first = re.split(r"\|\||\n|[。！？!?…]", body, maxsplit=1)[0].strip()
        if first:
            out.append(first[:16])
    return out[-n:]


def variety_text(openers: list[str]) -> str:
    if len(openers) < 2:
        return ""
    lines = "\n".join(f"- {o}" for o in openers)
    return (
        "【你最近几次回复是这样开头的】\n" + lines + "\n"
        "这次换一种开头和句式：别用同样的第一个字或语气词，别重复同一种问法"
        "（比如连着几次都「那……呢？」「是不是……」），也不必每次都先复述对方的话。"
    )
