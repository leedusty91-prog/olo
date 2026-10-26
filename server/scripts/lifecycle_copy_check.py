"""Exercise the memory lifecycle against a COPY of the VoiceMem store. Never the live one.

    cp -R "$OLO_VOICEMEM_DIR" /tmp/olo-vm-copy
    python scripts/lifecycle_copy_check.py --copy-root /tmp/olo-vm-copy

Checks real mem0 expiry, the nightly archive (ArchiveColdMemories + old one-day), the 3-day
demotion, revival on mention, and that lasting memories stay unarchived.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from olo.memory.lifecycle import Lifecycle  # noqa: E402
from olo.memory.voicemem_api import ApiVoiceMemAdapter, VoiceMemSettings, make_voicemem  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--copy-root", required=True)
    args = ap.parse_args()
    live = Path(os.environ.get("OLO_VOICEMEM_DIR") or "/nonexistent").resolve()
    copy = Path(args.copy_root).resolve()
    if copy == live or live in copy.parents or copy in live.parents or not copy.exists():
        sys.exit("refusing: --copy-root must be an existing copy, not the live store")
    os.environ["OLO_VOICEMEM_DIR"] = str(copy)
    s = dataclasses.replace(VoiceMemSettings.from_env(), root=copy)
    vm = make_voicemem(s)
    mem = ApiVoiceMemAdapter(vm, s)
    assert str(mem.lifecycle.path).startswith(str(copy))
    repo = mem._repo()
    vs, cog = repo._vector_store, repo._cognitive_store
    now = datetime.now(timezone.utc)
    out: dict = {"checks": {}}

    before = {m["id"]: m["text"] for m in mem.list_memories()}
    out["before"] = len(before)
    pick = lambda frag: next(i for i, t in before.items() if frag in t)
    lasting, one_day_new, one_day_old, cold = pick("年糕"), pick("今天加班"), pick("清晨"), pick("无畏契约")
    mem.lifecycle.label([lasting], "lasting", now - timedelta(days=60))
    mem.lifecycle.label([one_day_new], "one_day", now - timedelta(days=4))
    mem.lifecycle.label([one_day_old], "one_day", now - timedelta(days=8))

    # 3-day demotion: same query, raw VoiceMem order vs olo order.
    q = "我今天加班好累，刚上班"
    raw = [h.memory_id for h in mem._inner.search(q, slots=[], entities=[], top_k=8).hits]
    ours = [h.memory_id for h in mem.search(q, slots=[], entities=[], top_k=8).hits]
    out["demotion"] = {"raw": raw, "olo": ours}
    stale = [i for i in (one_day_new, one_day_old) if i in raw]
    out["checks"]["demoted_to_end"] = bool(stale) and all(ours.index(i) >= len(ours) - len(stale) for i in stale)

    # Make the lasting one and one plain memory cold in the COPY's cognitive store, so ArchiveColdMemories picks them.
    with cog._conn() as c:
        old = (now - timedelta(days=120)).isoformat()
        for mid in (lasting, cold):
            c.execute("UPDATE memories SET heat = 0.01, last_hit_at = ?, created_at = ? WHERE id = ?", (old, old, mid))
    os.environ["OLO_COLD_ARCHIVE_DAYS"] = "30"
    night = mem.lifecycle.nightly(mem, now)
    out["nightly"] = night
    after = {m["id"] for m in mem.list_memories()}
    payload = lambda mid: (vs._mem0.get(mid) or {})
    out["checks"]["cold_archived_hidden"] = cold in night["archived"] and cold not in after
    out["checks"]["old_one_day_archived_hidden"] = one_day_old in night["archived"] and one_day_old not in after
    out["checks"]["fresh_one_day_not_archived"] = one_day_new in after
    out["checks"]["lasting_kept_unarchived"] = lasting in after and lasting in night["kept_lasting"]
    out["checks"]["archived_not_deleted"] = all(payload(i) for i in (cold, one_day_old))
    out["expiry"] = {i: (payload(i) or {}).get("expiration_date") for i in (cold, one_day_old, lasting)}
    out["checks"]["real_mem0_expiry_set"] = all(out["expiry"][i] for i in (cold, one_day_old)) and not out["expiry"][lasting]

    # Revival on mention.
    text = before[cold]
    hits = [h.memory_id for h in mem.search(text, slots=[], entities=[], top_k=5).hits]
    out["checks"]["revived_on_mention"] = cold in {m["id"] for m in mem.list_memories()} and cold not in mem.lifecycle.archived()
    out["checks"]["revived_recalled_same_turn"] = cold in hits
    out["checks"]["unrelated_line_revives_nothing"] = mem.lifecycle.revive(mem, "今天天气不错") == []
    out["after"] = len(mem.list_memories())
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
    return 0 if all(out["checks"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
