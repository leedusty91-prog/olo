"""Which model each auxiliary (non-chat) LLM call uses.

Chat replies use CHAT_* (see llm.py). Everything else (VoiceMem extraction,
canon extraction, chapters, consolidation) runs on a cheap "memory model":

* ``OLO_<KIND>_MODEL`` overrides one call site (KIND = EXTRACT, CANON,
  CHAPTERS, CONSOLIDATE), e.g. ``OLO_EXTRACT_MODEL=qwen-plus``;
* else ``OLO_MEMORY_MODEL``;
* else ``qwen-flash`` on DashScope, or ``OPENAI_MODEL``/``gpt-4o-mini`` elsewhere.
"""
import os

DASHSCOPE_DEFAULT = "qwen-flash"


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def memory_model(kind: str = "") -> str:
    if kind and _env(f"OLO_{kind.upper()}_MODEL"):
        return _env(f"OLO_{kind.upper()}_MODEL")
    if _env("OLO_MEMORY_MODEL"):
        return _env("OLO_MEMORY_MODEL")
    base = _env("OPENAI_BASE_URL") or _env("OPENAI_API_BASE")
    if "dashscope" in base:
        return DASHSCOPE_DEFAULT
    return _env("OPENAI_MODEL") or "gpt-4o-mini"
