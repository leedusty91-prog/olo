"""Dry-run olo.capture over the real chat history. READ-ONLY: never writes.

Replays all messages in windows of CAPTURE_EVERY user messages (also cutting at
idle gaps), starting from an EMPTY memory list (or --from-current to start from
the current VoiceMem memories), applies the planned ops to an in-memory list,
and prints the resulting memories plus token usage.
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psycopg  # noqa: E402

from olo import capture  # noqa: E402


class Mem:
    def __init__(self, items):
        self.items = [dict(i) for i in items]
        self.n = 0

    def list_memories(self):
        return [dict(i) for i in self.items]

    def add_fact(self, text, observed_at):
        self.n += 1
        self.items.append({"id": f"new{self.n}", "text": text, "created_at": observed_at[:10]})

    def update_memory(self, mid, text):
        for i in self.items:
            if i["id"] == mid:
                i["text"] = text
                return True
        return False

    def delete_memory(self, mid):
        self.items = [i for i in self.items if i["id"] != mid]
        return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", default=os.path.join(os.environ.get("OLO_VOICEMEM_DIR") or "data/voicemem", "olo", "olo.sqlite"))
    ap.add_argument("--from-current", action="store_true")
    ap.add_argument("--out", default=os.path.expanduser("~/olo-capture-dryrun.json"))
    a = ap.parse_args()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.read_only = True
        msgs = capture._rows(conn, """SELECT m.id, m.role, m.body, m.safety_hit, m.created_at, m.session_id
            FROM messages m ORDER BY m.created_at""", ())
    current = []
    if a.from_current:
        db = sqlite3.connect(f"file:{a.sqlite}?mode=ro", uri=True)
        current = [{"id": r[0], "text": r[1], "created_at": r[2]} for r in db.execute("select id, content, created_at from memories order by created_at")]
    mem = Mem(current)
    windows, cur = [], []
    for m in msgs:
        if cur and m["created_at"] - cur[-1]["created_at"] >= timedelta(minutes=capture.CAPTURE_IDLE_MIN):
            windows.append(cur); cur = []
        cur.append(m)
        if m["role"] == "user" and sum(x["role"] == "user" for x in cur) >= capture.CAPTURE_EVERY:
            windows.append(cur); cur = []
    if cur:
        windows.append(cur)
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "calls": 0, "failed": 0}
    log, done_before = [], []
    for w in windows:
        try:
            back = [m for m in done_before if m["created_at"] > w[0]["created_at"] - timedelta(minutes=capture.CRISIS_EPISODE_MIN)]
            plan, keyed = capture.plan_capture(w, done_before[-capture.CONTEXT_BEFORE:], mem.list_memories(), lookback=back,
                user_said=[m["body"] for m in done_before if m["role"] == "user"])
        except Exception as exc:  # noqa: BLE001
            usage["failed"] += 1
            print("call failed:", type(exc).__name__, file=sys.stderr)
            done_before += w
            continue
        if plan.usage:
            usage["calls"] += 1
            usage["prompt_tokens"] += int(plan.usage.get("prompt_tokens") or 0)
            usage["completion_tokens"] += int(plan.usage.get("completion_tokens") or 0)
        capture.apply_plan(mem, plan, keyed, session_id="dry", observed_at=w[-1]["created_at"].isoformat())
        log.append({"window": [w[0]["at"], w[-1]["at"]], "ops": [o.__dict__ for o in plan.ops], "rejected": plan.rejected, "excluded": sum(1 for m in capture.mark_crisis(back + w)[len(back):] if m["safety_hit"])})
        done_before += w
    out = {"memories": mem.items, "usage": usage, "windows": len(windows), "messages": len(msgs), "log": log}
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1, default=list))
    for i, it in enumerate(mem.items, 1):
        print(f"{i}. [{str(it.get('created_at'))[:10]}] {it['text']}")
    print(json.dumps({k: out[k] for k in ("usage", "windows", "messages")}))


if __name__ == "__main__":
    main()
