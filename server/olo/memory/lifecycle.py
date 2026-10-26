"""Memory lifecycle on top of VoiceMem: durability labels, recall demotion, archive and revival.

* Capture's judge pass labels each written memory ``lasting`` or ``one_day`` (model judgement).
* Recall: a ``one_day`` memory older than ``ONE_DAY_DEMOTE_DAYS`` sinks below the others.
* Nightly: VoiceMem's ``ArchiveColdMemories`` (heat-decayed, old) plus one-day memories older
  than ``ONE_DAY_ARCHIVE_DAYS`` are archived (mem0 expiration_date; hidden, not deleted).
  ``lasting`` memories are never left archived.
* Revival: when the user's line matches an archived memory, it is unarchived and recalled.

Labels and the archive index live in a JSON sidecar next to the VoiceMem store; VoiceMem's own
search hides archived rows, so olo keeps their text to know when the user brings one back up.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

ONE_DAY_DEMOTE_DAYS = 3.0
ONE_DAY_ARCHIVE_DAYS = 7.0
COLD_ARCHIVE_DAYS = 30.0
REVIVE_COVER = 0.6
DURABILITY = {"lasting", "one_day"}


def _days(env: str, default: float) -> float:
    try:
        return float(os.environ.get(env) or default)
    except ValueError:
        return default


def _bigrams(text: str) -> set[str]:
    t = "".join(ch for ch in (text or "").lower() if ch.isalnum()).replace("用户", "")
    return {t[i : i + 2] for i in range(len(t) - 1)}


def _parse(at: str) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


class Lifecycle:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            data = {}
        data.setdefault("durability", {})
        data.setdefault("archived", {})
        return data

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        tmp.replace(self.path)

    def label(self, memory_ids, durability: str, at: datetime | None = None) -> None:
        if durability not in DURABILITY or not memory_ids:
            return
        stamp = (at or datetime.now(timezone.utc)).isoformat()
        with self._lock:
            data = self._load()
            for mid in memory_ids:
                data["durability"][str(mid)] = {"d": durability, "at": stamp}
            self._save(data)

    def forget(self, memory_id: str) -> None:
        with self._lock:
            data = self._load()
            data["durability"].pop(str(memory_id), None)
            data["archived"].pop(str(memory_id), None)
            self._save(data)

    def durability(self, memory_id: str) -> dict | None:
        return self._load()["durability"].get(str(memory_id))

    def archived(self) -> dict:
        return dict(self._load()["archived"])

    # ---------------------------------------------------------------- recall

    def stale_one_day(self, memory_id: str, now: datetime, days: float) -> bool:
        info = self._load()["durability"].get(str(memory_id))
        if not info or info.get("d") != "one_day":
            return False
        at = _parse(info.get("at"))
        return at is not None and now - at >= timedelta(days=days)

    def rerank(self, hits: list, now: datetime | None = None) -> list:
        """Stable: fresh and lasting hits keep their order; stale one-day hits move to the end."""
        now = now or datetime.now(timezone.utc)
        days = _days("OLO_ONE_DAY_DEMOTE_DAYS", ONE_DAY_DEMOTE_DAYS)
        stale = [self.stale_one_day(getattr(h, "memory_id", ""), now, days) for h in hits]
        return [h for h, s in zip(hits, stale) if not s] + [h for h, s in zip(hits, stale) if s]

    def revive(self, memory, query: str) -> list[str]:
        """Unarchive archived memories the user's line brings back up. Returns revived ids."""
        q = _bigrams(query)
        if not q:
            return []
        revived = []
        for mid, info in self.archived().items():
            b = _bigrams(info.get("text", ""))
            if b and len(b & q) / len(b) >= REVIVE_COVER and memory.unarchive_memory(mid):
                revived.append(mid)
        if revived:
            with self._lock:
                data = self._load()
                for mid in revived:
                    data["archived"].pop(mid, None)
                    info = data["durability"].get(mid)
                    if info:  # brought back up: its clock restarts
                        info["at"] = datetime.now(timezone.utc).isoformat()
                self._save(data)
        return revived

    # ---------------------------------------------------------------- nightly

    def nightly(self, memory, now: datetime | None = None) -> dict:
        """Archive cold (VoiceMem ArchiveColdMemories) and old one-day memories; keep lasting ones."""
        now = now or datetime.now(timezone.utc)
        texts = {m["id"]: m.get("text", "") for m in memory.list_memories()}
        data = self._load()
        lasting = {mid for mid, i in data["durability"].items() if i.get("d") == "lasting"}
        cold = []
        try:
            res = memory.archive_cold(min_age_days=_days("OLO_COLD_ARCHIVE_DAYS", COLD_ARCHIVE_DAYS)) or {}
            cold = [str(m) for m in res.get("archived") or []]
        except Exception as exc:  # noqa: BLE001
            logger.warning("archive cold failed: %s", type(exc).__name__)
        kept = [mid for mid in cold if mid in lasting and memory.unarchive_memory(mid)]
        archived = [mid for mid in cold if mid not in kept]
        old_days = _days("OLO_ONE_DAY_ARCHIVE_DAYS", ONE_DAY_ARCHIVE_DAYS)
        for mid in texts:
            if mid not in archived and mid not in data["archived"] and self.stale_one_day(mid, now, old_days):
                if memory.archive_memory(mid):
                    archived.append(mid)
        if archived:
            with self._lock:
                data = self._load()
                for mid in archived:
                    data["archived"][mid] = {"text": texts.get(mid, ""), "at": now.isoformat()}
                self._save(data)
        return {"archived": archived, "kept_lasting": kept}
