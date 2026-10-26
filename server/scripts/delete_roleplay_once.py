"""One-time, sniper-approved delete of 5 roleplay memories through the normal delete path.

Run ONLY while the olo server is stopped (embedded Qdrant allows one process). Aborts if any
target is missing or its text is not clearly the roleplay (宇航员/天台/尼爸爸).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from olo.memory.voicemem_api import ApiVoiceMemAdapter, VoiceMemSettings, make_voicemem  # noqa: E402

TARGETS = ("0329774e", "3ac8384d", "05f7d424", "b3c1deb1", "8b74223a")
MARKERS = ("宇航员", "天台", "尼爸爸")

s = VoiceMemSettings.from_env()
mem = ApiVoiceMemAdapter(make_voicemem(s), s)
repo = mem._repo()  # noqa: SLF001
uid = s.user_id
# Look in mem0 regardless of role (0329774e is a user fact tagged role=assistant) and in sqlite.
live = {str(e["id"]): str(e.get("text") or "") for e in repo.vector_store.list_entries(user_id=uid)}
with repo.cognitive_store._conn() as c:  # noqa: SLF001
    sql = {str(r[0]): str(r[1]) for r in c.execute("SELECT id, content FROM memories WHERE user_id=?", (uid,))}
for k, v in sql.items():
    live.setdefault(k, v)
full = {t: [i for i in live if i.startswith(t)] for t in TARGETS}
if any(len(v) != 1 for v in full.values()):
    sys.exit(f"abort: target ids not uniquely found: {full}")
rows = {full[t][0]: live[full[t][0]] for t in TARGETS}
for mid, text in rows.items():
    print(mid, text)
    if not any(k in text for k in MARKERS):
        sys.exit(f"abort: {mid} is not clearly roleplay")
done = {mid: mem.delete_memory(mid) for mid in rows}
m0 = [(str(e["id"]), e.get("role"), str(e.get("text") or "")) for e in repo.vector_store.list_entries(user_id=uid)]
with repo.cognitive_store._conn() as c:  # noqa: SLF001
    sq = [(str(r[0]), str(r[1])) for r in c.execute("SELECT id, content FROM memories WHERE user_id=? ORDER BY created_at", (uid,))]
print(json.dumps({"deleted": done, "mem0_user": [(i[:8], t) for i, r, t in m0 if r != "assistant"],
                  "mem0_assistant_count": sum(r == "assistant" for _, r, _ in m0), "sqlite": [(i[:8], t) for i, t in sq]},
                 ensure_ascii=False, indent=1))
left = {i for i, _, _ in m0} | {i for i, _ in sq}
sys.exit(0 if all(done.values()) and not set(rows) & left else 1)
