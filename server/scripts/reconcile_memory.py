"""Dry-run reconcile of VoiceMem's two stores (mem0 vectors vs cognitive sqlite). Read-only: it
prints a plan and writes nothing; there is no apply mode yet.

Run it on a snapshot of the live store (embedded Qdrant is locked by the running server):
    OLO_VOICEMEM_DIR=/tmp/snap MEM0_DIR=/tmp/snap/mem0 python scripts/reconcile_memory.py [--plan-delete id8 ...]

Plan items:
  sync_text   sqlite content differs from mem0 (mem0 is what recall reads) -> set sqlite to mem0 text
  orphan      sqlite row with no mem0 row (cannot be recalled) -> delete it and its memory_id rows
  retag_user  mem0 row tagged role=assistant that is also a sqlite memory (a user fact) -> role=user
  mirror      JSON mirror rows that are olo replies or unknown to mem0 (fed VoiceMem's extractor)
  planned_delete  ids passed with --plan-delete (needs the owner's approval; not executed)
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from olo.memory.voicemem_api import VoiceMemSettings, make_voicemem  # noqa: E402

LIVE = (Path.home() / "Developer/olo/data/voicemem").resolve()

args = sys.argv[1:]
plan_delete = args[args.index("--plan-delete") + 1 :] if "--plan-delete" in args else []
s = VoiceMemSettings.from_env()
root = Path(s.memory_root).resolve()
if root == LIVE:
    sys.exit("refusing the live store path: run on a snapshot")
repo = make_voicemem(s)._o._get_repo()  # noqa: SLF001
uid = s.user_id
m0 = {str(e["id"]): e for e in repo.vector_store.list_entries(user_id=uid)}
db = sqlite3.connect(f"file:{root / 'olo' / 'olo.sqlite'}?mode=ro", uri=True)
sq = {r[0]: r[1] for r in db.execute("SELECT id, content FROM memories WHERE user_id=? ORDER BY created_at", (uid,))}
link_tables = [t for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
               if t != "memories" and "memory_id" in [c[1] for c in db.execute(f'PRAGMA table_info("{t}")')]]


def links(mid):
    return {t: n for t in link_tables if (n := db.execute(f'SELECT count(*) FROM "{t}" WHERE memory_id=?', (mid,)).fetchone()[0])}


plan = {"sync_text": [], "orphan": [], "retag_user": [], "mirror": [], "planned_delete": []}
for mid, text in sq.items():
    e = m0.get(mid)
    if e is None:
        plan["orphan"].append({"id": mid, "sqlite": text, "linked_rows": links(mid)})
        continue
    if e.get("role") == "assistant":
        plan["retag_user"].append({"id": mid, "mem0": e.get("text")})
    if (e.get("text") or "").strip() != (text or "").strip():
        plan["sync_text"].append({"id": mid, "sqlite": text, "mem0": e.get("text")})
for obj in repo.load_json_store().get("results", []):
    mid = str((obj or {}).get("id", ""))
    e = m0.get(mid)
    if e is None or e.get("role") == "assistant":
        plan["mirror"].append({"id": mid, "why": "not in mem0" if e is None else "olo reply", "text": str(obj.get("memory", ""))[:60]})
for short in plan_delete:
    ids = sorted({i for i in list(m0) + list(sq) if i.startswith(short)})
    for mid in ids:
        plan["planned_delete"].append({"id": mid, "mem0": (m0.get(mid) or {}).get("text"), "sqlite": sq.get(mid),
                                       "linked_rows": links(mid), "approved": False})
    if not ids:
        plan["planned_delete"].append({"id": short, "missing": True})
plan["counts"] = {"mem0_user": sum(e.get("role") != "assistant" for e in m0.values()),
                  "mem0_reply": sum(e.get("role") == "assistant" for e in m0.values()), "sqlite": len(sq)}
print(json.dumps(plan, ensure_ascii=False, indent=1))
