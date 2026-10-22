import unicodedata
from dataclasses import dataclass

from olo.memory.compat import normalize_emotion_strict

TRIVIAL_EXACT = frozenset(
    {"嗯", "嗯嗯", "哈哈", "哈哈哈", "好", "好的", "在吗", "ok", "okay", "lol"}
)
FACT_MARKERS = (
    "我是",
    "我叫",
    "我住在",
    "我喜欢",
    "我不喜欢",
    "我不吃",
    "过敏",
    "我的工作是",
    "我养",
    "我家",
    "我有一",
    "我今年",
    "我在",
    "生日",
    "叫做",
    "名字叫",
)
RELATIONSHIP_MARKERS = (
    "我妈",
    "我爸",
    "我母亲",
    "我父亲",
    "我对象",
    "我男朋友",
    "我女朋友",
    "分手",
    "和好了",
    "我朋友",
)
USER_PROMISE_MARKERS = ("帮我记住", "记得提醒我", "你要记得")
ASSISTANT_PROMISE_MARKERS = ("我会记得", "我会提醒", "我提醒你", "我答应你", "下次我帮你记")
DONE_MARKERS = ("不用提醒", "不用记得了", "这个承诺完成了")
NEUTRAL_EMOTIONS = frozenset({None, "", "neutral", "unknown"})


@dataclass(frozen=True)
class Gate:
    decision: str
    reason: str


def normalize_text(text: str) -> str:
    return "".join(text.casefold().split())


def _is_emoji_char(ch: str) -> bool:
    if ch in {"\ufe0f", "\u200d", "\u20e3"}:
        return True
    code = ord(ch)
    if 0x1F000 <= code <= 0x1FAFF or 0x2600 <= code <= 0x27BF or 0xFE00 <= code <= 0xFE0F:
        return True
    return unicodedata.category(ch) == "So"


def is_emoji_only(text: str) -> bool:
    stripped = "".join(ch for ch in text if not ch.isspace())
    return bool(stripped) and all(_is_emoji_char(ch) for ch in stripped)


def commitment_body(assistant_text: str) -> str | None:
    text = assistant_text.strip()
    if any(mark in text for mark in ASSISTANT_PROMISE_MARKERS):
        return text[:200]
    return None


def closes_commitment(user_text: str) -> bool:
    normalized = "".join(user_text.split())
    return any(mark in normalized for mark in DONE_MARKERS)


def decide(user_text: str, *, safety_hit: bool, emotion_label: str | None) -> Gate:
    if safety_hit:
        return Gate("skip", "safety_withhold")
    normalized = normalize_text(user_text)
    if normalized in TRIVIAL_EXACT or normalized == "" or is_emoji_only(user_text):
        return Gate("skip", "trivial")
    if any(mark in normalized for mark in FACT_MARKERS):
        return Gate("write", "fact")
    if any(mark in normalized for mark in RELATIONSHIP_MARKERS):
        return Gate("write", "relationship")
    if any(mark in normalized for mark in USER_PROMISE_MARKERS):
        return Gate("write", "promise")
    acoustic = emotion_label if emotion_label not in NEUTRAL_EMOTIONS else None
    if acoustic is not None or normalize_emotion_strict(user_text) is not None:
        return Gate("write", "emotion_peak")
    return Gate("skip", "trivial")
