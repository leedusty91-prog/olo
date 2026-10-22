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


# ---------- deterministic post-processing ----------
_CLOSE = "」』”\"）)"
_SENT = re.compile("[^。！？!?…~～\n]*(?:[。！？!?…~～]+[" + _CLOSE + "]*|\n|$)")
_QUESTION = re.compile("[？?][" + _CLOSE + "]*\\s*$")
_ACTION = re.compile(r"[（(][^（）()]{1,16}[）)]")
_STRAY = re.compile(r"\|+|^\s*[-—*#>]+\s*|\s*\|\s*$", re.M)


def _sentences(text: str) -> list[str]:
    return [s for s in _SENT.findall(text) if s.strip()]


def polish_segments(
    segments: list[str], max_segments: int = MAX_SEGMENTS, max_questions: int = 1, keep: str = "last"
) -> list[str]:
    """Enforce the speaking rules the model sometimes breaks.

    - stray ``|`` / markdown bullets are removed;
    - at most one short bracketed action across the whole reply;
    - at most ``max_questions`` questions: the *last* one is kept (it is usually
      the real follow-up); earlier question sentences are dropped, unless that
      would empty a bubble, in which case the question mark becomes a full stop;
    - empty bubbles disappear and the bubble cap is re-applied.
    """
    cleaned: list[str] = []
    actions = 0
    for seg in segments:
        seg = _STRAY.sub("", seg).strip()

        def keep_first_action(m: re.Match) -> str:
            nonlocal actions
            actions += 1
            return m.group(0) if actions == 1 else ""

        seg = _ACTION.sub(keep_first_action, seg).strip()
        if seg:
            cleaned.append(seg)

    sentences = [_sentences(s) for s in cleaned]
    qpos = [(i, j) for i, ss in enumerate(sentences) for j, s in enumerate(ss) if _QUESTION.search(s.strip())]
    extra = qpos[: max(0, len(qpos) - max_questions)] if keep == "last" else qpos[max_questions:]
    for i, j in extra:
        others = [s for k, s in enumerate(sentences[i]) if k != j and s.strip()]
        if others:
            sentences[i][j] = ""
        else:
            s = sentences[i][j].rstrip()
            sentences[i][j] = re.sub("[？?]+([" + _CLOSE + "]*)$", "。\\1", s)
    out = ["".join(ss).strip() for ss in sentences]
    out = [s for s in out if s]
    if len(out) > max_segments:
        out = out[: max_segments - 1] + ["\n".join(out[max_segments - 1 :])]
    return out or [s for s in segments if s.strip()][:1]


def count_questions(segments: list[str]) -> int:
    return sum(1 for seg in segments for s in _sentences(seg) if _QUESTION.search(s.strip()))
