"""Write diary drafts from the real database WITHOUT saving anything.

usage (from server/, with the usual env loaded): python scripts/diary_dry_run.py [YYYY-MM-DD ...]
No dates = the last 2 days that have messages.
"""
from __future__ import annotations

import sys
import time
from datetime import date

from olo.db import connect
from olo.llm import OpenAIChat
from olo.notebook import generate_notebook
from olo.sessions import SEEDED_USER_ID
from olo.usertz import user_tz_name


class _Runtime:
    llm = OpenAIChat()
    memory = None  # memory search needs the running VoiceMem; skipped in dry runs


def main() -> None:
    with connect() as conn:
        if sys.argv[1:]:
            days = [date.fromisoformat(d) for d in sys.argv[1:]]
        else:
            tz = user_tz_name(conn, SEEDED_USER_ID)
            days = [r[0] for r in conn.execute(
                "SELECT DISTINCT (m.created_at AT TIME ZONE %s)::date d FROM messages m "
                "JOIN sessions s ON s.id = m.session_id WHERE s.user_id = %s ORDER BY d DESC LIMIT 2",
                (tz, SEEDED_USER_ID),
            ).fetchall()]
        for day in days:
            t0 = time.time()
            entry = generate_notebook(conn, _Runtime(), entry_date=day, dry_run=True)
            conn.rollback()
            print(f"=== {day} 《{entry['title']}》 mood={entry['mood']} {time.time() - t0:.1f}s {len(entry['body'])}字\n{entry['body']}\n")


if __name__ == "__main__":
    main()
