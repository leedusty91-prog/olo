"""Dry-run VoiceMem's OWN extract -> resolve pipeline over batched windows. READ-ONLY.

Same windows and crisis exclusion as capture_dryrun.py, but each window goes to
VoiceMem's OpenAIAdditiveExtractor.extract() and then ConflictResolver.resolve()
(ADD/UPDATE/DELETE/NONE, Mem0 V1 style), exactly as voice_input.ingest_voice_input
does, with an in-memory store. Candidate memories = the whole in-memory list
(small store; stands in for VoiceMem's per-fact top-15 + attribute search).
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
from openai.resources.chat import completions as _cc  # noqa: E402

from olo import capture  # noqa: E402
from olo.memory import voicemem_api as va  # noqa: E402

USAGE = {"prompt_tokens": 0, "completion_tokens": 0, "calls": 0, "failed": 0}
_orig = _cc.Completions.create


def _counted(self, *a, **k):
    r = _orig(self, *a, **k)
    u = getattr(r, "usage", None)
    USAGE["calls"] += 1
    USAGE["prompt_tokens"] += int(getattr(u, "prompt_tokens", 0) or 0)
    USAGE["completion_tokens"] += int(getattr(u, "completion_tokens", 0) or 0)
    return r


_cc.Completions.create = _counted


def to_messages(window, back):
    keep = capture.mark_crisis(back + window)[len(back):]
    msgs = []
    for m in keep:
        if m.get("safety_hit"):
            continue
        role = "user" if m["role"] == "user" else "assistant"
        if msgs and msgs[-1]["role"] == role:
            msgs[-1]["content"] += "\n" + m["body"]
        else:
            msgs.append({"role": role, "content": m["body"]})
    return msgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", default=os.path.join(os.environ.get("OLO_VOICEMEM_DIR") or "data/voicemem", "olo", "olo.sqlite"))
    ap.add_argument("--from-current", action="store_true")
    ap.add_argument("--model", default=os.environ.get("OLO_CAPTURE_MODEL", "qwen-plus"))
    ap.add_argument("--out", default=os.path.expanduser("~/olo-dry-vm.json"))
    a = ap.parse_args()
    s = va.VoiceMemSettings.from_env()
    va.apply_env(s)
    va.keep_user_language()
    va.trim_extractor_prompt()
    va.use_memory_model(a.model, a.model)
    from voicemem.leftbrain.extract_facts_openai import ConflictResolver, OpenAIMem0V3AdditiveExtractor as OpenAIAdditiveExtractor
    ext, res = OpenAIAdditiveExtractor(), ConflictResolver(single_valued_rule=True)

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.read_only = True
        msgs = capture._rows(conn, """SELECT m.id, m.role, m.body, m.safety_hit, m.created_at, m.session_id
            FROM messages m ORDER BY m.created_at""", ())
    items = []
    if a.from_current:
        db = sqlite3.connect(f"file:{a.sqlite}?mode=ro", uri=True)
        items = [{"id": r[0], "text": r[1], "created_at": r[2]} for r in db.execute("select id, content, created_at from memories order by created_at")]
    windows, cur = [], []
    for m in msgs:
        if cur and m["created_at"] - cur[-1]["created_at"] >= timedelta(minutes=capture.CAPTURE_IDLE_MIN):
            windows.append(cur); cur = []
        cur.append(m)
        if m["role"] == "user" and sum(x["role"] == "user" for x in cur) >= capture.CAPTURE_EVERY:
            windows.append(cur); cur = []
    if cur:
        windows.append(cur)
    log, done, n = [], [], 0
    for w in windows:
        back = [m for m in done if m["created_at"] > w[0]["created_at"] - timedelta(minutes=capture.CRISIS_EPISODE_MIN)]
        done += w
        nm = to_messages(w, back)
        if not any(x["role"] == "user" for x in nm):
            continue
        ts = w[-1]["created_at"].isoformat()
        existing = [{"id": i["id"], "text": i["text"]} for i in items]
        try:
            facts = [f.text for f in ext.extract(new_messages=nm, existing_memories=existing,
                                                  observation_date=ts, current_date=ts) if f.text]
            rs = res.resolve(facts, existing, speaker_name=None) if (facts and existing) else []
        except Exception as exc:  # noqa: BLE001
            USAGE["failed"] += 1
            print("call failed:", type(exc).__name__, exc, file=sys.stderr)
            continue
        if facts and not rs:
            from types import SimpleNamespace as NS
            rs = [NS(event="ADD", memory_id="", text=t, old_memory="") for t in facts]
        ops = []
        for r in rs:
            if r.event == "ADD" and r.text:
                n += 1
                items.append({"id": f"new{n}", "text": r.text, "created_at": ts[:10]})
            elif r.event == "UPDATE" and r.text:
                for i in items:
                    if i["id"] == r.memory_id:
                        ops.append({"op": "UPDATE", "old": i["text"], "text": r.text}); i["text"] = r.text
                continue
            elif r.event == "DELETE":
                old = [i["text"] for i in items if i["id"] == r.memory_id]
                items = [i for i in items if i["id"] != r.memory_id]
                ops.append({"op": "DELETE", "old": old[:1]}); continue
            else:
                continue
            ops.append({"op": "ADD", "text": r.text})
        log.append({"window": [str(w[0]["created_at"]), ts], "facts": facts, "ops": ops})
    out = {"memories": items, "usage": USAGE, "windows": len(windows), "messages": len(msgs), "log": log}
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str))
    for i, it in enumerate(items, 1):
        print(f"{i}. [{str(it.get('created_at'))[:10]}] {it['text']}")
    print(json.dumps({k: out[k] for k in ("usage", "windows", "messages")}))


if __name__ == "__main__":
    main()
