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
live = {m["id"]: m["text"] for m in mem.list_memories()}
full = {t: [i for i in live if i.startswith(t)] for t in TARGETS}
if any(len(v) != 1 for v in full.values()):
    sys.exit(f"abort: target ids not uniquely found: {full}")
rows = {full[t][0]: live[full[t][0]] for t in TARGETS}
for mid, text in rows.items():
    print(mid, text)
    if not any(k in text for k in MARKERS):
        sys.exit(f"abort: {mid} is not clearly roleplay")
done = {mid: mem.delete_memory(mid) for mid in rows}
remaining = mem.list_memories()
print(json.dumps({"deleted": done, "remaining": remaining}, ensure_ascii=False, indent=1))
sys.exit(0 if all(done.values()) and not set(rows) & {m["id"] for m in remaining} else 1)
