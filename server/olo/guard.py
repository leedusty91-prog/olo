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
    "narrate_feeling": "替对方描述、点评、总结对方的感受或处境（「这种难受最磨人了」「坐着站着都不对劲」「累得不冤」「挺心酸的」「这滋味不好受」「听着就不是随口说说的那种累」「听着是真累了」——对方说的话越重，越不能替对方定性；替对方感叹也算，比如「这谁受得了啊」「换谁都烦」；点评对方的处境或对方说的话也算，比如「开会最怕这种，事儿还在原地打转」「「习惯了」这三个字听着可不像好事」「光一句忙，确实让人接不下去」「这么闲啊」。标的时候宁可多标这一类：删掉后剩下的问题照样能发）",
    "guess_cause": "替对方猜原因或动机（「是坐太久了吧」「是没睡好吧」「你是在硬撑」「怕的是……」），而不是直接问",
    "stock_line": "陪伴/共情套话，真朋友不会这么说（「我在这儿」「我陪着你」「抱抱」「听起来好难」「辛苦了」「你已经很棒了」「照顾好自己」「随时找我」「慢慢来」）",
    "offer_choices": "给对方列选项让对方挑：怎么聊（「是想聊聊，还是就待着」「想说就说，不想说也行」），或者问句里摆出两三个猜测让对方选（「是身上不舒服，还是遇上什么事了？」「是班上累的，还是没睡好？」）。任何「A还是B」式的二选一问句都算，哪怕问的是事实（「是天天这样还是就今天？」「突然一下还是慢慢觉出来的？」「你是喜欢还是嫌烦？」）——应该只问一个开放的问题（「多久了？」「咋发现的？」）。英文同样算：「Was it work or just no sleep?」「Do you want to talk or just chill?」「Is it every day or only today?」「Chords or strumming?」「Did you go or not?」",
    "filler": "没有任何新内容的凑数句、客套收尾、重复前面意思的句子（「嗯嗯」「好的呀」「还想聊什么吗」「有啥随时说」、对方没在说新鲜事时的口头禅「镜面这边收到啦」）",
    "echo": "把对方刚说的话、原词或描述的事实换个说法复述回去（包括开头那句「哎，交啦！」「还是答应了啊」「上海待了四年呢」这种把对方的话重说一遍的；句子里一个短短的复述开头也算，比如「五斤诶，怎么掉的？」里的「五斤诶」、「没请你，那你…」里的「没请你」、「爬山诶，爬的哪座？」里的「爬山诶」——这种句子整句标 echo，改稿时只保留问题本身）",
    "ignore_user": "没先接对方刚说的话（没有反应、没回答、没追问），直接岔开去问别的事——比如对方说了件事，回复却只有一个跟这件事无关的小问题，或者先问无关的问题、再回应对方",
    "generic_advice": "泛泛的建议或命令（「早点休息」「多喝水」「出去走走」「别给自己太大压力」「先别……」「别撑着」）",
}

GUARD_PROMPT = (
    "你在审一个陪伴角色（olo，一个住在对方手机里的小生灵，是对方的朋友）准备发出去的微信回复。只挑出属于下面这些类别的句子：\n"
    + "\n".join(f"- {k}：{v}" for k, v in CLASSES.items() if k != "ignore_user")
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


IGNORE_NOTE = (
    "\n这一轮先回应对方刚说的「{user}」（你的真实反应、回答或一个直接的追问），"
    "不要再问上一稿里那个跟这句话无关的小问题。"
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


# Either-or questions are caught by rule as well as by the judge, in both languages, so the
# class can't slip through when the model misses one. "还是" also means "still"
# (「你还是没睡吗？」), so those readings are excluded.
_ZH_OR = re.compile(r"(?<=[\u4e00-\u9fffA-Za-z0-9\s\x22\x27”’）)，,、])(?<![你我他她它们咱])还是(?!没|不|别|会|要|得|在|有|很|挺|那么|这么|一样|老样子|算了|去了|来了|觉得)[^，,。！!]{1,}")
_ZH_OR_ALT = re.compile(r"(?:要么|或者).{1,12}(?:要么|或者|还是)")
_EN_OR = re.compile(r"\b(?:or|either)\b(?!\s+(?:so|something|anything|whatever|two|less|more|else|later)\b)", re.I)


def is_either_or(sentence: str) -> bool:
    """A question that hands the user two or more options to pick from (zh or en)."""
    q = sentence.strip()
    if not re.search(r"[？?]", q):
        return False
    return bool(_ZH_OR.search(q) or _ZH_OR_ALT.search(q) or _EN_OR.search(q))


def cut_choice(sentence: str) -> str:
    """Last resort for an either-or question: keep only the first option as a plain question."""
    for rx, mark in ((_ZH_OR, "？"), (_ZH_OR_ALT, "？"), (_EN_OR, "?")):
        m = rx.search(sentence)
        if m and m.start() > 0:
            head = sentence[: m.start()].rstrip(" ，,、")
            if len(re.sub(r"\W", "", head)) >= 2:
                return head + mark
    return sentence


def rule_hits(sents: list[list[str]]) -> list[dict]:
    return [{"seg": i, "sent": j, "cls": "offer_choices", "text": t, "rule": True}
            for i, ss in enumerate(sents) for j, t in enumerate(ss) if is_either_or(t)]


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


def judge(llm, user_text: str, recent: list[dict], segments: list[str], timeout_s: float = 6.0, note: str = "",
          check=None) -> tuple[list[list[str]], list[dict]]:
    """Model labels plus rule labels. `check(sents)` adds turn-specific rule hits (e.g. 陪你学)."""
    sents, hits = _judge_model(llm, user_text, recent, segments, timeout_s, note)
    extra = rule_hits(sents) + (check(sents) if check else [])
    seen = {(h["seg"], h["sent"]) for h in hits}
    for h in extra:
        if (h["seg"], h["sent"]) not in seen:
            hits.append(h)
            seen.add((h["seg"], h["sent"]))
    return sents, hits


def _judge_model(llm, user_text, recent, segments, timeout_s, note):
    sents, numbered = _numbered(segments)
    convo = "\n".join(
        f"{'对方' if m.get('role') == 'user' else 'olo'}：{re.sub(r'[|]{2}', ' ', str(m.get('content') or ''))[:120]}"
        for m in recent[-4:]
    )
    payload = f"之前的对话：\n{convo or '（无）'}\n对方刚说：{user_text}\n\nolo 准备发的回复（按句编号）：\n{numbered}"
    raw = _ask(llm, [{"role": "system", "content": GUARD_PROMPT + note}, {"role": "user", "content": payload}], timeout_s)
    m = re.search(r"\{.*\}", raw, re.S)
    bad = json.loads(m.group(0)).get("bad", []) if m else []
    hits = []
    for b in bad if isinstance(bad, list) else []:
        try:
            i, j = (int(x) - 1 for x in str(b.get("id", "")).split("."))
        except (ValueError, AttributeError):
            continue
        # ignore_user is rule-only (olo.learning.react_first_check): the model over-labels it.
        if 0 <= i < len(sents) and 0 <= j < len(sents[i]) and b.get("cls") in CLASSES and b.get("cls") != "ignore_user":
            hits.append({"seg": i, "sent": j, "cls": b["cls"], "text": sents[i][j]})
    return sents, hits


def _trim(sents: list[list[str]], hits: list[dict]) -> list[str]:
    drop = {(h["seg"], h["sent"]) for h in hits}
    segs = ["".join(s for j, s in enumerate(ss) if (i, j) not in drop).strip() for i, ss in enumerate(sents)]
    return [s for s in segs if s]


def _stands_alone(segs: list[str]) -> bool:
    text = "".join(segs)
    return len(re.sub(r"[\s，。！？、,.!?…~～哈嗯哎诶啊呀吧呢啦]", "", text)) >= 2


def _with_note(messages: list[dict], note: str) -> list[dict]:
    """Append a private note to the last user message (so it reads as this turn's instruction)."""
    out = [dict(m) for m in messages]
    for m in reversed(out):
        if m.get("role") == "user":
            m["content"] = f"{m.get('content') or ''}\n\n（{note.strip()}这条要求对方看不见，直接输出要发的话。）"
            break
    return out


def guard_reply(runtime, messages: list[dict], user_text: str, recent: list[dict], text: str, note: str = "",
                check=None) -> GuardResult:
    """Check one finished reply; trim or regenerate it. Never raises."""
    llm = getattr(runtime.llm, "guard", None) or runtime.llm.aux
    segments = polish_segments(split_segments(text)) or [text]
    res = GuardResult(text=text)
    t = time.perf_counter()
    try:
        sents, hits = judge(llm, user_text, recent, segments, note=note, check=check)
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
        # The judge often labels only the worst line; check what is left once more.
        try:
            sents_k, hits_k = judge(llm, user_text, recent, kept, note=note, check=check)
            res.calls += 1
        except Exception:
            hits_k = []
        if hits_k:
            res.hits = hits + hits_k
            kept = _trim(sents_k, hits_k)
        if kept and _stands_alone(kept):
            res.text, res.action = join_segments(kept), "trim"
            res.guard_ms = (time.perf_counter() - t) * 1000
            return res
        hits = res.hits
    # Nothing worth keeping: regenerate (at most twice) with the problems named, then trim that.
    t = time.perf_counter()
    res.action = "regen"
    all_hits = list(hits)
    draft = text
    try:
        for _ in range(2):
            regen_note = REGEN_NOTE.format(items="\n".join(
                f"- {h['text']}（{CLASSES[h['cls']].split('（')[0]}）" for h in all_hits))
            base = messages
            if any(h["cls"] == "ignore_user" for h in all_hits):
                # Reacting comes first; the casual review question is optional, so drop it this
                # turn: say so, and take the hint that asked for it out of the prompt.
                regen_note += IGNORE_NOTE.format(user=user_text[:80])
                strip = getattr(check, "without_hint", None)
                base = strip(messages) if strip else messages
            if base is not messages:
                # No earlier draft in context: it only pulls the rewrite back to the review.
                regen = "".join(runtime.llm.aux.stream(_with_note(base, IGNORE_NOTE.format(user=user_text[:80])))).strip()
            else:
                regen = "".join(runtime.llm.aux.stream([*base, {"role": "assistant", "content": draft},
                                            {"role": "user", "content": regen_note}])).strip()
            res.calls += 1
            segs2 = polish_segments(split_segments(regen)) or [regen]
            sents2, hits2 = judge(llm, user_text, recent, segs2, note=note, check=check)
            res.calls += 1
            all_hits += [{**h, "regen": True} for h in hits2]
            kept2 = _trim(sents2, hits2)
            if kept2 and _stands_alone(kept2):
                res.text = join_segments(kept2)
                break
            res.text = regen  # best effort if the second try also fails
            draft = regen
        res.hits = all_hits
        if check is not None:
            # A reply that skips what the user said must never ship: drop the review line, and
            # if nothing is left, answer once more as if there were no review this turn at all.
            sents4, _ = _numbered(polish_segments(split_segments(res.text)) or [res.text])
            bad4 = [h for h in check(sents4) if h["cls"] == "ignore_user"]
            if bad4:
                kept4 = _trim(sents4, bad4)
                if kept4 and _stands_alone(kept4):
                    res.text = join_segments(kept4)
                else:
                    strip = getattr(check, "without_hint", None)
                    plain = strip(messages) if strip else messages
                    res.text = "".join(runtime.llm.aux.stream(plain)).strip() or res.text
                    res.calls += 1
        # The rule classes must never ship: cut any either-or that survived both rewrites.
        segs3 = polish_segments(split_segments(res.text)) or [res.text]
        sents3, _ = _numbered(segs3)
        if rule_hits(sents3):
            res.text = join_segments(["".join(cut_choice(t) if is_either_or(t) else t for t in ss) for ss in sents3])
    except Exception as exc:
        logger.warning("reply guard regen failed: %s", type(exc).__name__)
        res.action = "error"
    res.regen_ms = (time.perf_counter() - t) * 1000
    return res


def guard_stream(runtime, messages: list[dict], user_text: str, recent: list[dict], pieces, note: str = "", check=None):
    """Stream-friendly guard over a token iterator.

    Yields ("delta", text) chunks and finally ("result", GuardResult). The first bubble is
    checked on its own as soon as the model finishes it (while the rest keeps generating)
    and shown right away if clean; later bubbles are checked with the whole reply and can
    only be trimmed. If the first bubble has a problem, falls back to guard_reply.
    """
    from concurrent.futures import ThreadPoolExecutor

    llm = getattr(runtime.llm, "guard", None) or runtime.llm.aux
    buf = ""
    fut = None
    first = None
    pool = ThreadPoolExecutor(1)
    sent_first = False
    early_failed = False
    t0 = time.perf_counter()
    try:
        for piece in pieces:
            buf += piece
            if fut is None:
                head = re.split(r"\|\||\n\s*\n", buf, maxsplit=1)
                if len(head) == 2 and head[0].strip():
                    first = head[0].strip()
                    fut = pool.submit(judge, llm, user_text, recent, [first], note=note, check=check)
            if fut is not None and not sent_first and not early_failed and fut.done():
                sent_first, early_failed = _release(fut)
                if sent_first:
                    yield ("delta", first + "||")
        text = buf.strip()
        if fut is not None and not sent_first and not early_failed:
            sent_first, early_failed = _release(fut)
            if sent_first:
                yield ("delta", first + "||")
        if not sent_first:
            res = guard_reply(runtime, messages, user_text, recent, text, note=note, check=check)
            yield ("delta", res.text)
            yield ("result", res)
            return
        res = GuardResult(text=text, calls=1)
        segs = polish_segments(split_segments(text)) or [text]
        rest = segs[1:]
        if rest:
            t = time.perf_counter()
            try:
                sents, hits = judge(llm, user_text, recent, [first, *rest], note=note, check=check)
                res.calls += 1
                hits = [h for h in hits if h["seg"] > 0]
                if hits:
                    res.hits, res.action = hits, "trim"
                    drop = {(h["seg"], h["sent"]) for h in hits}
                    rest = ["".join(s for j, s in enumerate(ss) if (i, j) not in drop).strip()
                            for i, ss in enumerate(sents) if i > 0]
                    rest = [r for r in rest if r and _stands_alone([r])]
            except Exception as exc:
                logger.warning("reply guard failed: %s", type(exc).__name__)
                res.action = "error"
            res.guard_ms = (time.perf_counter() - t) * 1000
        if rest:
            yield ("delta", join_segments(rest))
        res.text = join_segments([first, *rest])
        yield ("result", res)
    finally:
        pool.shutdown(wait=False)
        logger.debug("guard_stream %.0f ms", (time.perf_counter() - t0) * 1000)


def _release(fut) -> tuple[bool, bool]:
    """(clean, failed) for the first-bubble check; errors count as not-clean (full path decides)."""
    try:
        _, hits = fut.result(timeout=6.0)
    except Exception:
        return False, True
    return (not hits), bool(hits)
