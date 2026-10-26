"""Keep olo's own replies (mem0 rows with role=assistant) out of VoiceMem's fact extraction.

VoiceMem stores olo's replies in the same mem0 collection as user facts. Its extractor reads the
"existing memories" via ``existing_for_extractor`` without a role filter, so it saw replies as
memories and UPDATEd them into user facts that kept ``role=assistant`` (hidden from olo's lists,
out of step with the cognitive sqlite). Two guards, installed once per vector store:

* ``existing_for_extractor`` drops reply rows, so the extractor never gets a reply id; an UPDATE or
  DELETE on an id it was not given is downgraded by VoiceMem itself (ADD / NONE).
* ``update_memory`` refuses to rewrite a reply row (the role-tag guard): a reply can never become
  a fact that is still tagged as olo's.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _role_of(vs, memory_id: str) -> str | None:
    try:
        got = vs._mem0.get(memory_id)  # noqa: SLF001
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(got, dict):
        return None
    md = got.get("metadata") or {}
    return str(md.get("role") or got.get("role") or "user")


def _reply_ids(vs, user_id) -> set[str]:
    return {str(e["id"]) for e in vs.list_entries(user_id=user_id) if (e.get("role") or "user") == "assistant"}


def install(repo) -> bool:
    """Wrap ``repo.existing_for_extractor`` (VoiceMem's JSON mirror: it holds reply rows, found
    0329774e there) and ``vector_store.existing_for_extractor`` to drop reply rows, and
    ``vector_store.update_memory`` to refuse reply rows."""
    vs = getattr(repo, "vector_store", None) or getattr(repo, "_vector_store", None)
    if repo is None or vs is None or getattr(repo, "_olo_reply_guard", False):
        return False

    def filtered(orig):
        def existing_for_extractor(*args, **kwargs):
            rows = orig(*args, **kwargs)
            uid = kwargs.get("user_id") or (args[0] if args else None)
            try:
                bad = _reply_ids(vs, uid) if uid and hasattr(vs, "list_entries") else set()
            except Exception:  # noqa: BLE001
                return rows
            return [r for r in rows if str(r.get("id")) not in bad and (r.get("role") or "user") != "assistant"]
        return existing_for_extractor

    for obj in (repo, vs):
        orig = getattr(obj, "existing_for_extractor", None)
        if orig is not None:
            obj.existing_for_extractor = filtered(orig)
    orig_update = getattr(vs, "update_memory", None)
    if orig_update is not None:
        def update_memory(memory_id, new_text, *args, **kwargs):
            if _role_of(vs, memory_id) == "assistant":
                logger.warning("refused to rewrite an olo reply row into a memory")
                return False
            return orig_update(memory_id, new_text, *args, **kwargs)
        vs.update_memory = update_memory
    repo._olo_reply_guard = True  # noqa: SLF001
    return True
