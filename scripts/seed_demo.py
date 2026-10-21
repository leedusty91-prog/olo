#!/usr/bin/env python3
"""给演示环境填充一批可演示的数据：几天的对话、两篇日记、两条洞察。

用法：
    .venv/bin/python scripts/seed_demo.py            # 没有数据时写入
    .venv/bin/python scripts/seed_demo.py --reset    # 清空对话/日记/洞察后重写

只动应用数据表，不动 users / companion_personas / subscriptions。
"""

from __future__ import annotations

import argparse
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import psycopg  # noqa: E402

from olo.db import connect, load_dotenv  # noqa: E402
from olo.sessions import SEEDED_USER_ID  # noqa: E402

SESSION_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
RESET_ORDER = (
    "memory_write_audit",
    "turn_traces",
    "turn_requests",
    "messages",
    "commitments",
    "notebook_entries",
    "insights",
    "sessions",
)

CONVERSATION = [
    (2, "user", "这两周一直在赶论文，感觉脑子里全是浆糊。"),
    (2, "assistant", "先不急着把它写出来。今天最卡的是哪一段？"),
    (2, "user", "方法部分，越写越觉得自己在绕圈。"),
    (2, "assistant", "绕圈也算在往前走。明天要不要先只写三段，写完就停？"),
    (1, "user", "今天试着写了三段，居然真的写下去了。"),
    (1, "assistant", "我看出来了，你说话比昨天松一点。那三段里你自己最满意哪一段？"),
    (0, "user", "我发现我好像一到晚上就开始怀疑自己。"),
    (0, "assistant", "晚上的你和白天的你，说的是同一件事，但语气不一样。今晚想先照顾哪一个？"),
]

NOTEBOOK_ENTRIES = [
    (
        "22222222-2222-4222-8222-222222222221",
        -1,
        "绕圈也是在走",
        "你说方法部分越写越像在绕圈。我没有急着让你跳出来，"
        "只是觉得你愿意绕，说明你还在认真找路。明天先写三段，写完就停。",
        "a dim desk with scattered papers, warm desk lamp, late night",
        "soft",
    ),
    (
        "22222222-2222-4222-8222-222222222222",
        0,
        "晚上的你",
        "晚上一到，你就开始怀疑白天做过的决定。"
        "这不是你不够好，是这一天到这时候已经太满了。"
        "今晚先照顾那个还在怀疑的你，明天再继续。",
        "a quiet room at night, city lights outside the window, calm",
        "tender",
    ),
]

INSIGHTS = [
    ("wellbeing", "你总在晚上把白天的事重新审一遍。"),
    ("growth", "你开始用「先写三段」代替「必须写完」。"),
]


def reset(conn: psycopg.Connection) -> None:
    for table in RESET_ORDER:
        conn.execute(f"DELETE FROM {table}")
    conn.commit()


def seed(conn: psycopg.Connection) -> None:
    now = datetime.now(timezone.utc)
    conn.execute(
        """
        INSERT INTO sessions (id, user_id, started_at, last_turn_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (SESSION_ID, SEEDED_USER_ID, now - timedelta(days=2), now),
    )
    for days_ago, role, body in CONVERSATION:
        created = now - timedelta(days=days_ago, minutes=len(body) % 50)
        conn.execute(
            """
            INSERT INTO messages (id, session_id, role, modality, body, created_at)
            VALUES (%s, %s, %s, 'text', %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (uuid.uuid4(), SESSION_ID, role, body, created),
        )
    for entry_id, days_ago, title, body, prompt, mood in NOTEBOOK_ENTRIES:
        conn.execute(
            """
            INSERT INTO notebook_entries
              (id, user_id, entry_date, kind, title, body, image_prompt)
            VALUES (%s, %s, %s, 'journal', %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                uuid.UUID(entry_id),
                SEEDED_USER_ID,
                (now + timedelta(days=days_ago)).date(),
                title,
                body,
                prompt,
            ),
        )
    for category, body in INSIGHTS:
        conn.execute(
            """
            INSERT INTO insights (id, user_id, category, body, created_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (uuid.uuid4(), SEEDED_USER_ID, category, body, now),
        )
    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="先清空应用数据再写入")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    with connect() as conn:
        existing = conn.execute(
            "SELECT count(*) FROM messages WHERE session_id = %s",
            (SESSION_ID,),
        ).fetchone()[0]
        if existing and not args.reset:
            print(f"演示会话已有 {existing} 条消息，跳过。需要重写请加 --reset。")
            return 0
        if args.reset:
            reset(conn)
            print("已清空旧数据。")
        seed(conn)
        counts = {
            "messages": conn.execute("SELECT count(*) FROM messages").fetchone()[0],
            "notebook": conn.execute("SELECT count(*) FROM notebook_entries").fetchone()[0],
            "insights": conn.execute("SELECT count(*) FROM insights").fetchone()[0],
        }
    print(
        "演示数据已写入："
        f"{counts['messages']} 条消息、{counts['notebook']} 篇日记、{counts['insights']} 条洞察。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
