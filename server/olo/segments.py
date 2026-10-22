"""Split one reply into chat bubbles.

The model separates bubbles with a line containing only ``||`` (see
``SPEAKING_RULES``). Older/unruly output falls back to blank-line paragraphs.
"""

from __future__ import annotations

import re

SEPARATOR = "||"
MAX_SEGMENTS = 4
_SEP = re.compile(r"\s*\|\|\s*")
_PARA = re.compile(r"\n\s*\n")


def split_segments(text: str, max_segments: int = MAX_SEGMENTS) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    parts = [p.strip() for p in _SEP.split(text)] if SEPARATOR in text else [text]
    parts = [p for p in parts if p]
    if len(parts) == 1:
        parts = [p.strip() for p in _PARA.split(parts[0]) if p.strip()] or parts
    if len(parts) > max_segments:
        parts = parts[: max_segments - 1] + ["\n".join(parts[max_segments - 1 :])]
    return parts


def join_segments(segments: list[str]) -> str:
    """Stored body: bubbles separated by a blank line (readable, splittable)."""
    return "\n\n".join(segments)
