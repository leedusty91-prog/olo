"""Optional VoiceMem integration.

VoiceMem (Apache-2.0, PyPI ``voicemem``) pulls in torch/funasr and local models,
so it is an *optional* extra (``pip install -e .[memory]``). When it is not
installed, these small fallbacks keep the API, prompt assembly and tests working.
"""

from __future__ import annotations

from typing import Any

try:  # pragma: no cover - exercised only when the heavy extra is installed
    from voicemem.memory_api import build_memory_context as _vm_build
except Exception:  # noqa: BLE001
    _vm_build = None

try:  # pragma: no cover
    from voicemem.rightbrain.anchor_router import normalize_emotion_strict as _vm_norm
except Exception:  # noqa: BLE001
    _vm_norm = None

VOICEMEM_AVAILABLE = _vm_build is not None


def _fallback_build(result: Any, max_rb: int = 3) -> str:
    lines: list[str] = []
    hits = getattr(result, "hits", None) or []
    if hits:
        lines.append("MEMORY CONTEXT (things you remember about the user):")
        for hit in hits:
            when = getattr(hit, "observed_at", "") or ""
            lines.append(f"- [{when}] {hit.text}" if when else f"- {hit.text}")
    rb_hits = getattr(result, "rb_hits", None) or []
    if rb_hits:
        lines.append("")
        lines.append("HOW TO SPEAK TO THIS USER (internal — never quote or paraphrase aloud):")
        lines.extend(f"- {h.content}" for h in rb_hits[:max_rb])
        lines.append("Let these shape your tone, what you bring up, and what you leave alone. "
                     "Never state them back to the user.")
    return "\n".join(lines)


_EMOTION_WORDS = (
    ("焦虑", "焦虑"), ("压力", "焦虑"), ("紧张", "焦虑"), ("担心", "焦虑"), ("害怕", "焦虑"),
    ("难过", "难过"), ("伤心", "难过"), ("想哭", "难过"), ("失落", "难过"),
    ("生气", "委屈"), ("委屈", "委屈"), ("气死", "委屈"), ("烦", "委屈"),
    ("孤独", "孤独"), ("寂寞", "孤独"),
    ("纠结", "纠结"), ("迷茫", "纠结"),
    ("开心", "开心"), ("高兴", "开心"), ("兴奋", "开心"),
    ("累", "疲惫"), ("疲惫", "疲惫"), ("困", "疲惫"),
)


def _fallback_norm(text: str) -> str | None:
    best = None
    for word, label in _EMOTION_WORDS:
        i = text.find(word)
        if i >= 0 and (best is None or i < best[0]):
            best = (i, label)
    return best[1] if best else None


SUMMARY_MAX = 2
SUMMARY_CHARS = 80


def slot_summaries(result: Any) -> str:
    """VoiceMem's per-slot schema descriptions (cross-memory aggregates) for the routed slots."""
    raw = getattr(result, "related_summaries", None) or {}
    items = [str(v).strip()[:SUMMARY_CHARS] for v in raw.values() if str(v or "").strip()][:SUMMARY_MAX]
    if not items:
        return ""
    return "OVERALL (summaries across memories, background only):\n" + "\n".join(f"- {t}" for t in items)


def build_memory_context(result: Any, max_rb: int = 3) -> str:
    base = (_vm_build or _fallback_build)(result, max_rb=max_rb)
    extra = slot_summaries(result) if getattr(result, "hits", None) else ""
    return "\n\n".join(t for t in (base, extra) if t)


def normalize_emotion_strict(text: str) -> str | None:
    return (_vm_norm or _fallback_norm)(text)
