"""Reply guard: a cheap model-judged check run before a reply is shown.

The chat model sometimes slips into lines a real friend wouldn't say. The
prompt rules lower the rate; this guard catches the rest. One small JSON call
(no thinking, temperature 0) labels individual sentences by class; flagged
sentences are deleted when the rest still stands on its own, otherwise the
reply is regenerated once with the problems named. Length is never a problem
by itself: a real story, opinion or answer must survive.

Fails open: any error or timeout ships the original reply.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import re
import threading
import time
from dataclasses import dataclass, field

from olo.segments import _sentences, join_segments, polish_segments, split_segments

logger = logging.getLogger(__name__)

CLASSES = {
    "narrate_feeling": "替对方描述、点评、总结对方的感受或处境（「这种难受最磨人了」「坐着站着都不对劲」「累得不冤」「挺心酸的」「这滋味不好受」）",
    "guess_cause": "替对方猜原因或动机（「是坐太久了吧」「是没睡好吧」「你是在硬撑」「怕的是……」），而不是直接问",
    "stock_line": "陪伴/共情套话，真朋友不会这么说（「我在这儿」「我陪着你」「抱抱」「听起来好难」「辛苦了」「你已经很棒了」「照顾好自己」「随时找我」「慢慢来」）",
    "offer_choices": "给对方列选项让对方挑：怎么聊（「是想聊聊，还是就待着」「想说就说，不想说也行」），或者问句里摆出两三个猜测让对方选（「是身上不舒服，还是遇上什么事了？」「是班上累的，还是没睡好？」）。任何「A还是B」式的二选一问句都算，哪怕问的是事实（「是天天这样还是就今天？」「突然一下还是慢慢觉出来的？」「你是喜欢还是嫌烦？」）——应该只问一个开放的问题（「多久了？」「咋发现的？」）",
    "filler": "没有任何新内容的凑数句、客套收尾、重复前面意思的句子（「嗯嗯」「好的呀」「还想聊什么吗」「有啥随时说」）",
    "echo": "把对方刚说的话、原词或描述的事实换个说法复述回去（包括开头那句「哎，交啦！」「还是答应了啊」「上海待了四年呢」这种把对方的话重说一遍的）",
    "generic_advice": "泛泛的建议或命令（「早点休息」「多喝水」「出去走走」「别给自己太大压力」「先别……」「别撑着」）",
}

GUARD_PROMPT = (
    "你在审一个陪伴角色（olo，一个住在对方手机里的小生灵，是对方的朋友）准备发出去的微信回复。只挑出属于下面这些类别的句子：\n"
    + "\n".join(f"- {k}：{v}" for k, v in CLASSES.items())
    + "\n不算问题的：长度本身（多说几句没关系）；olo 讲自己的小故事、说自己的真实看法或反应、认真回答对方的问题；一个直接、具体的问题（「咋弄的？」「后来呢？」）；"
    "轻松的玩笑；自然地接上对方提到的人和事。\n"
    "只输出 JSON：{\"bad\":[{\"id\":\"句子编号\",\"cls\":\"类别\"}]}，没有问题就 {\"bad\":[]}。"
)

REGEN_NOTE = (
    "【改稿】你上一稿里这些句子不像真朋友会说的：\n{items}\n"
    "重新回一次：不要这些句子，也不要换个说法再说一遍。只说有新东西的话：你真实的反应、一个直接的问题、你自己的事或看法。"
    "长短跟着内容走，没东西就一句。"
    "这条改稿要求对方看不见：直接输出要发给对方的话，别提「改稿」「换个说法」「重新说」，也别为上一稿道歉。"
)


@dataclass
class GuardResult:
    text: str
    action: str = "pass"  # pass | trim | regen | error | off
    hits: list[dict] = field(default_factory=list)
    guard_ms: float = 0.0
    regen_ms: float = 0.0
    calls: int = 0


def enabled(runtime) -> bool:
    if (os.environ.get("OLO_REPLY_GUARD") or "on").lower() in {"off", "0", "false"}:
        return False
    return hasattr(getattr(runtime, "llm", None), "aux")


def _numbered(segments: list[str]) -> tuple[list[list[str]], str]:
    sents = [[s.strip() for s in _sentences(seg) if s.strip()] or [seg] for seg in segments]
    lines = [f"{i + 1}.{j + 1} {s}" for i, ss in enumerate(sents) for j, s in enumerate(ss)]
    return sents, "\n".join(lines)


def _ask(llm, messages: list[dict], timeout_s: float) -> str:
    box: queue.Queue = queue.Queue()

    def run() -> None:
        try:
            box.put("".join(llm.stream(messages)))
        except Exception as exc:  # network, auth, quota
            box.put(exc)

    threading.Thread(target=run, name="olo-guard", daemon=True).start()
    out = box.get(timeout=timeout_s)
    if isinstance(out, BaseException):
        raise out
    return out


def judge(llm, user_text: str, recent: list[dict], segments: list[str], timeout_s: float = 6.0) -> tuple[list[list[str]], list[dict]]:
    sents, numbered = _numbered(segments)
    convo = "\n".join(
        f"{'对方' if m.get('role') == 'user' else 'olo'}：{re.sub(r'[|]{2}', ' ', str(m.get('content') or ''))[:120]}"
        for m in recent[-4:]
    )
    payload = f"之前的对话：\n{convo or '（无）'}\n对方刚说：{user_text}\n\nolo 准备发的回复（按句编号）：\n{numbered}"
    raw = _ask(llm, [{"role": "system", "content": GUARD_PROMPT}, {"role": "user", "content": payload}], timeout_s)
    m = re.search(r"\{.*\}", raw, re.S)
    bad = json.loads(m.group(0)).get("bad", []) if m else []
    hits = []
    for b in bad if isinstance(bad, list) else []:
        try:
            i, j = (int(x) - 1 for x in str(b.get("id", "")).split("."))
        except (ValueError, AttributeError):
            continue
        if 0 <= i < len(sents) and 0 <= j < len(sents[i]) and b.get("cls") in CLASSES:
            hits.append({"seg": i, "sent": j, "cls": b["cls"], "text": sents[i][j]})
    return sents, hits


def _trim(sents: list[list[str]], hits: list[dict]) -> list[str]:
    drop = {(h["seg"], h["sent"]) for h in hits}
    segs = ["".join(s for j, s in enumerate(ss) if (i, j) not in drop).strip() for i, ss in enumerate(sents)]
    return [s for s in segs if s]


def _stands_alone(segs: list[str]) -> bool:
    text = "".join(segs)
    return len(re.sub(r"[\s，。！？、,.!?…~～哈嗯哎诶啊呀吧呢啦]", "", text)) >= 2


def guard_reply(runtime, messages: list[dict], user_text: str, recent: list[dict], text: str) -> GuardResult:
    """Check one finished reply; trim or regenerate it. Never raises."""
    llm = runtime.llm.aux
    segments = polish_segments(split_segments(text)) or [text]
    res = GuardResult(text=text)
    t = time.perf_counter()
    try:
        sents, hits = judge(llm, user_text, recent, segments)
        res.calls += 1
    except Exception as exc:
        logger.warning("reply guard failed: %s", type(exc).__name__)
        res.action, res.guard_ms = "error", (time.perf_counter() - t) * 1000
        return res
    res.guard_ms = (time.perf_counter() - t) * 1000
    res.hits = hits
    if not hits:
        return res
    kept = _trim(sents, hits)
    if kept and _stands_alone(kept):
        res.text, res.action = join_segments(kept), "trim"
        return res
    # Nothing worth keeping: regenerate once with the problems named, then trim that.
    t = time.perf_counter()
    try:
        note = REGEN_NOTE.format(items="\n".join(f"- {h['text']}（{CLASSES[h['cls']].split('（')[0]}）" for h in hits))
        regen = "".join(runtime.llm.aux.stream([*messages, {"role": "assistant", "content": text}, {"role": "user", "content": note}])).strip()
        res.calls += 1
        segs2 = polish_segments(split_segments(regen)) or [regen]
        sents2, hits2 = judge(llm, user_text, recent, segs2)
        res.calls += 1
        kept2 = _trim(sents2, hits2)
        res.text = join_segments(kept2) if kept2 and _stands_alone(kept2) else regen
        res.hits = hits + [{**h, "regen": True} for h in hits2]
        res.action = "regen"
    except Exception as exc:
        logger.warning("reply guard regen failed: %s", type(exc).__name__)
        res.action = "error"
    res.regen_ms = (time.perf_counter() - t) * 1000
    return res
