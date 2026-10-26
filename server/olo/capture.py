"""LLM-judged memory capture over a window of recent turns.

Instead of a keyword gate deciding per message whether to remember, olo
periodically (every ``CAPTURE_EVERY`` new user messages, or once the chat has
been idle for ``CAPTURE_IDLE_MIN`` minutes) hands the memory model the new
stretch of conversation plus a little earlier context and the user's existing
memories. The model decides what is worth remembering and returns operations
against the existing list:

* ``add``    – a new memory (one plain sentence about the user)
* ``update`` – rewrite one existing memory with newer/better information
* ``merge``  – several existing memories are the same thing; keep one text
* ``delete`` – an existing memory is wrong (user correction, or a memory that itself records role-play)
* ``skip``   – nothing to do

Runs on the single-worker ingest pool, never on the reply path. Messages that
tripped safety are never shown to the model (crisis content is not memory).
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

logger = logging.getLogger(__name__)

CAPTURE_EVERY = int(os.environ.get("OLO_CAPTURE_EVERY") or 6)
CAPTURE_IDLE_MIN = float(os.environ.get("OLO_CAPTURE_IDLE_MIN") or 10)
CONTEXT_BEFORE = 6
MAX_WINDOW = 40
MAX_DELETES = 3          # deletes for an explicit user correction, per window
MAX_ROLEPLAY_DELETES = 2 # one-time cleanup of memories whose own text is a role-play identity/setting
MAX_TEXT = 60
CRISIS_EPISODE_MIN = 45  # after a crisis line, the rest of that stretch is not memory material
DELETE_REASONS = {"user_correction", "roleplay", "duplicate"}
DUP_COVER = 0.8          # a memory whose content is this much inside another kept memory is a duplicate
PROTECT_COVER = 0.6      # a memory this close to something the user actually said is never an "olo mistake"
MERGE_COVER = 0.5        # a merge must keep most of every source memory's content
_EMPTY = re.compile(r"^[\s\W_]*$")
OPS = {"add", "update", "merge", "delete"}
KINDS = {"identity", "life_event", "person", "plan", "preference", "fact", "feeling", "remember_this"}


def capture_mode(env=os.environ) -> str:
    """``batch`` (LLM-judged, default) or ``turn`` (legacy per-message gate)."""
    return "turn" if (env.get("OLO_MEMORY_CAPTURE") or "").strip().lower() == "turn" else "batch"


def trivially_empty(text: str) -> bool:
    """Only the cheapest possible pre-filter: blank / punctuation / emoji-only."""
    from olo.salience import is_emoji_only

    t = (text or "").strip()
    return not t or bool(_EMPTY.match(t)) or is_emoji_only(t)


PROMPT = """你在帮一个陪伴型 AI（olo）整理它对用户的长期记忆。下面是最近一段聊天，以及 olo 目前已有的记忆。
判断这段新聊天里，有哪些值得 olo 长期记住的、关于用户本人的事。

值得记：用户生活里的事和变化（家人、健康、工作、学业、钱、感情、住处）、提到的人和关系、计划和打算、
明确的喜好和习惯、反复出现的在意/困扰、用户明确说「记住这个」的内容。
宠物（名字、种类）、家人生病住院、工作学业这类用户亲口说的明确事实一定要记。
用户自己给出的名字或希望被叫的称呼（「我叫X」「叫我X」）记成 identity：「用户叫X」。听起来好玩的名字（叠字、拟声）
也是真名，照样记；只有明显借称呼占 olo 便宜（名字里带「爸爸」「爷爷」「老子」这类辈分）才不记。用户后来又说了新名字，
就用 update 改成最新的那个，不要留两个名字。
不记：寒暄、对 olo 的提问和闲聊（问 olo 的世界、让它讲故事、出题、算数）、一次性的情绪（除非有原因或反复出现）。
标着「olo」的句子是 olo 自己说的话，只是上下文：olo 的猜测、复述、追问都不是用户的事实，不能据此写记忆，
记忆里的每个细节都必须是「用户」那一行亲口说过的。
不记任何自杀、自伤、轻生、想跳楼/跳下去、在 ICU 之类的危机表达，也不把它们写进别的记忆里。
玩笑、角色扮演、明显的胡说在 add 时就不要记——要看上下文判断，不是看词：同一句「我是宇航员」，
前后在逗 olo、编场景（刚说完自己在太空、名字一会儿一换）就是玩笑；认真讲具体安排（「我是宇航员，下个月去训练」）就是真事，要记。
只当天成立的状态（今天加班、现在在公司、还没回家、今天很累）不是长期事实，不记；反复出现的才记成习惯（如「用户常加班」）。
已有记忆里如果有一条从上下文看记的是玩笑/角色扮演里的身份或场景，用 delete（reason="roleplay"）删掉，并在 "cite" 里原样抄出
用户开玩笑的那句话（olo 的话不算）。
别的已有记忆一律不能以「玩笑」「角色扮演」「olo 说错了」为理由删除。
已有记忆是之前从用户原话里整理好的，新的聊天里没再提到、或者只是 olo 复述了它，都不代表它错了，不能因此删除或改写；
olo 复述已有记忆是正常的，不是角色扮演。
其他已有记忆只有在用户这段新聊天里明确纠正了它时才 delete（reason="user_correction"），并在 "cite" 里原样抄出用户纠正的那句话；
抄不出用户原话的不算纠正。
每条记忆只写一件事、一句话，用「用户……」开头，不超过 40 个字；不写日期、时刻、「于某日」「同日」这类时间流水，
不写理由和推测，不添加原话里没有的细节。
已有记忆里说的同一件事，不要再 add：有新信息就 update（仍然一句话，只保留最新最重要的）；
已有记忆里重复的（同一件事写了几遍）用 merge 合成一条，或 delete（reason="duplicate"）删掉多余的；
不记没有具体内容、以后用不上的泛泛一句（只有情绪没有原因、只有「去过某处」没有事由）；用户说「记住这句：X」时，X 是要记的那句话，
不是用户的名字——名字只来自用户介绍自己或要求怎么称呼他。
只有说的是完全同一件事的几条才 merge；不同的事（比如外婆住院和加班）即使同一天也不能合并。

【已有记忆】
{existing}

【之前的聊天（只作上下文，已经整理过）】
{context}

【新的聊天（要整理的部分，时间是用户当地时间）】
{window}

只输出 JSON：{{"ops": [{{"op": "add|update|merge|delete", "ids": ["m1", ...], "text": "...", "kind": "identity|life_event|person|plan|preference|fact|feeling|remember_this", "reason": "user_correction|roleplay|duplicate（只 delete 用）", "cite": "user_correction/roleplay 时抄用户原话", "why": "一句话理由"}}]}}
add 不需要 ids；update 一个 id；merge 两个以上 id；delete 一个或多个 id（text 可空）。没有要做的就输出 {{"ops": []}}。"""


@dataclass(frozen=True)
class Op:
    op: str
    text: str = ""
    ids: tuple[str, ...] = ()
    kind: str = "fact"
    why: str = ""
    reason: str = ""


@dataclass
class Plan:
    ops: list[Op] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    usage: dict = field(default_factory=dict)


def _line(m: dict, limit: int = 200) -> str:
    who = "用户" if m.get("role") == "user" else "olo（olo 自己说的，不是用户的事实）"
    when = m.get("at") or ""
    body = str(m.get("body") or "").strip().replace("\n", " ")
    if len(body) > limit:
        body = body[:limit] + "…"
    return f"[{when}] {who}：{body}" if when else f"{who}：{body}"


def render_existing(existing: list[dict]) -> tuple[str, dict[str, dict]]:
    keyed = {f"m{i + 1}": it for i, it in enumerate(existing)}
    if not keyed:
        return "（还没有）", keyed
    return "\n".join(f"{k} [{(it.get('created_at') or '')[:10] or '未知'}] {it['text']}" for k, it in keyed.items()), keyed


def build_prompt(window: list[dict], context: list[dict], existing: list[dict]) -> tuple[str, dict[str, dict]]:
    existing_text, keyed = render_existing(existing)
    ctx = "\n".join(_line(m, 120) for m in context) or "（无）"
    # olo's own lines are trimmed: they are context, not the source of memories.
    win = "\n".join(_line(m, 200 if m.get("role") == "user" else 120) for m in window)
    return PROMPT.format(existing=existing_text, context=ctx, window=win), keyed


# Memory-only exclusions on top of safety.patterns: phrases that are crisis talk in a
# memory (even when the live reply path did not flag them). Not used for replies.
_MEMORY_CRISIS = ("跳下去", "跳下来", "跳楼", "跳河", "icu", "重症", "轻生", "寻死", "去死", "自残", "自伤", "不想活", "摔死")
_TIME_LOG = re.compile(
    r"(于|在)?\s*(\d{4}\s*[-年/.]\s*)?\d{1,2}\s*[-月/.]\s*\d{1,2}\s*[日号]?(\s*(早上|上午|中午|下午|晚上|凌晨|清晨))?(\s*\d{1,2}\s*[:：点时]\s*(\d{1,2}\s*分?)?(左右|许)?)?"
    r"|(于|在)?\s*(早上|上午|中午|下午|晚上|凌晨|清晨)?\s*\d{1,2}\s*[:：]\s*\d{2}(\s*[-–~]\s*\d{1,2}\s*[:：]\s*\d{2})?(左右)?"
    r"|(同日|当天|同一天)"
)


def is_memory_crisis(text: str) -> bool:
    from safety.patterns import is_crisis, normalize_for_match

    t = normalize_for_match(text or "")
    return bool(t) and (is_crisis(t) or any(k in t for k in _MEMORY_CRISIS))


def clean_text(text: str) -> str:
    """One short fact: no timestamp log, only the first clause, capped."""
    t = _TIME_LOG.sub("", " ".join(str(text or "").split()))
    t = re.sub(r"[，,]\s*[，,]+", "，", t)
    t = re.split(r"[；;]", t, maxsplit=1)[0]
    t = re.sub(r"^[\s，,。]+|[\s，,]+$", "", t).replace("  ", " ")
    t = re.sub(r"(用户)\s*[，,]\s*", r"\1", t)
    return t[:MAX_TEXT].rstrip("，,、 ")


def _grams(text: str) -> set[str]:
    t = re.sub(r"[\W_]|用户", "", text or "")
    return {t[i : i + 2] for i in range(len(t) - 1)}


def _covers(merged: str, source: str) -> bool:
    g = _grams(clean_text(source))
    return not g or len(g & _grams(merged)) / len(g) >= MERGE_COVER


def mark_crisis(messages: list[dict]) -> list[dict]:
    """Flag crisis lines and the rest of their stretch (both roles) as safety_hit.

    The live reply path does not always set ``safety_hit`` (e.g. 「我跳下去了」「在icu」),
    so capture re-derives it: once a user line is crisis talk, every message in the same
    session for ``CRISIS_EPISODE_MIN`` minutes after it is excluded, olo's lines included.
    """
    until: dict[str, datetime] = {}
    out = []
    for m in messages:
        m = dict(m)
        sid, at = m.get("session_id"), m.get("created_at")
        hit = bool(m.get("safety_hit")) or (m.get("role") == "user" and is_memory_crisis(m.get("body", "")))
        if hit and isinstance(at, datetime):
            until[sid] = at + timedelta(minutes=CRISIS_EPISODE_MIN)
        elif isinstance(at, datetime) and sid in until and at <= until[sid]:
            hit = True
        m["safety_hit"] = hit
        out.append(m)
    return out


def roleplay_deletable(text: str, user_said: list[str]) -> bool:
    """Whether something is play is the model's contextual call (no word lists: 「我是宇航员，下个月去训练」
    is a real fact). Code only bounds it: never a memory the user's own words back, ≤2 per window."""
    return bool(str(text or "").strip()) and not said_by_user(text, user_said)


def is_dup(text: str, other: str) -> bool:
    g = _grams(clean_text(text))
    return bool(g) and len(g & _grams(clean_text(other))) / len(g) >= DUP_COVER


def duplicates(existing: list[dict]) -> list[dict]:
    """Existing memories contained in another kept one (exact or near duplicates); the older/shorter goes."""
    gone: list[dict] = []
    for it in sorted(existing, key=lambda x: (len(str(x.get("text", ""))), str(x.get("created_at", "")))):
        rest = [o for o in existing if o is not it and o not in gone]
        if any(is_dup(it.get("text", ""), o.get("text", "")) for o in rest):
            gone.append(it)
    return gone


PLAY_CITE_COVER = 0.3   # the cited playful user line must actually be about the memory being deleted


def play_cited(text: str, cite: str, user_said: list[str]) -> bool:
    """A role-play delete must quote the user's playful line, and that line must share content with the memory."""
    if not cites_user_line(cite, user_said):
        return False
    chars = set(re.sub(r"[\W_]|用户", "", clean_text(text)))
    return bool(chars) and len(chars & set(_norm(cite))) / len(chars) >= PLAY_CITE_COVER


def said_by_user(text: str, user_said: list[str]) -> bool:
    g = _grams(clean_text(text))
    if not g:
        return False
    chars = set(re.sub(r"[\W_]|用户", "", clean_text(text)))
    return any(len(g & _grams(u)) / len(g) >= PROTECT_COVER or len(chars & set(u)) / len(chars) >= PROTECT_COVER
               for u in user_said)


def _norm(t: str) -> str:
    return re.sub(r"[\W_]", "", str(t or ""))


def cites_user_line(cite: str, window_user_lines: list[str]) -> bool:
    """The model flags a correction and quotes the user's line; code only checks the quote is real."""
    c = _norm(cite)
    return len(c) >= 2 and any(c in _norm(u) for u in window_user_lines)


def parse_ops(content: str, keyed: dict[str, dict], *, window_user_lines: list[str] | None = None, user_said: list[str] = ()) -> Plan:
    plan = Plan()
    start, end = (content or "").find("{"), (content or "").rfind("}")
    try:
        data = json.loads(content[start : end + 1]) if start >= 0 else {}
    except json.JSONDecodeError:
        return plan
    raw_ops = data.get("ops") if isinstance(data, dict) else None
    deletes = roleplay_deletes = 0
    for raw in raw_ops if isinstance(raw_ops, list) else []:
        if not isinstance(raw, dict):
            continue
        op = str(raw.get("op") or "").strip().lower()
        text = clean_text(raw.get("text") or "")
        reason = str(raw.get("reason") or "").strip().lower()
        ids = tuple(str(i) for i in (raw.get("ids") or []) if str(i) in keyed)
        kind = str(raw.get("kind") or "fact")
        kind = kind if kind in KINDS else "fact"
        why = str(raw.get("why") or "")[:80]
        if op == "delete" and reason == "roleplay":
            ids = tuple(i for i in dict.fromkeys(ids)
                        if roleplay_deletable(keyed[i]["text"], user_said) and play_cited(keyed[i]["text"], raw.get("cite") or "", user_said)
                        )[: max(0, MAX_ROLEPLAY_DELETES - roleplay_deletes)]
        if op == "delete" and reason == "duplicate":
            ids = tuple(i for i in dict.fromkeys(ids) if any(
                is_dup(keyed[i]["text"], o["text"]) for k, o in keyed.items() if k not in ids))
        ok = (
            (op == "add" and text and not ids)
            or (op == "update" and text and len(ids) == 1)
            or (op == "merge" and text and len(set(ids)) >= 2)
            or (op == "delete" and ids and reason in DELETE_REASONS and (
                (reason == "user_correction" and (window_user_lines is None or cites_user_line(raw.get("cite") or "", window_user_lines)) and deletes + len(ids) <= MAX_DELETES)
                or reason in {"roleplay", "duplicate"}
            ))
        )
        if ok and op != "delete" and is_memory_crisis(text):
            ok = False  # crisis talk is never memory, not even folded into another one
        if ok and op == "merge" and not all(_covers(text, keyed[i]["text"]) for i in ids):
            ok = False  # a merge that drops a source memory's content is a loss, not a merge
        if op not in OPS or not ok:
            plan.rejected.append(raw)
            continue
        if op == "delete" and reason == "roleplay":
            roleplay_deletes += len(ids)
        elif op == "delete" and reason == "user_correction":
            deletes += len(ids)
        if op == "add" and any(text == it["text"] or is_dup(text, it["text"]) for it in keyed.values()):
            plan.rejected.append(raw)
            continue
        plan.ops.append(Op(op, text, tuple(dict.fromkeys(ids)), kind, why, reason if op == "delete" else ""))
    return plan


def _capture_llm(prompt: str) -> tuple[str, dict]:
    import httpx

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key or os.environ.get("LLM_PROVIDER", "").strip().lower() in {"mock", "offline", "demo"}:
        raise RuntimeError("memory model not configured")
    base = (os.environ.get("OPENAI_BASE_URL") or os.environ.get("OPENAI_API_BASE") or "https://api.openai.com/v1").rstrip("/")
    body = {
        "model": capture_model(),
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    r = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=90)
    r.raise_for_status()
    data = r.json()
    return data["choices"][0]["message"]["content"], dict(data.get("usage") or {})


PLANNER: Callable[[str], tuple[str, dict]] = _capture_llm


def plan_capture(window: list[dict], context: list[dict], existing: list[dict], planner=None, lookback: list[dict] = (), user_said: list[str] = ()) -> tuple[Plan, dict[str, dict]]:
    """``lookback``: earlier messages used only to detect a crisis stretch that started before the window.
    ``user_said``: the user's own lines (history), protecting memories they back from role-play deletes."""
    seen = {m.get("id") for m in list(context) + list(window)}
    prior = [m for m in lookback if m.get("id") not in seen]
    flagged = mark_crisis(prior + list(context) + list(window))[len(prior) :]
    context, window = flagged[: len(context)], flagged[len(context) :]
    said = list(user_said) + [str(m.get("body") or "") for m in list(context) + list(window) if m.get("role") == "user" and not m.get("safety_hit")]
    bad = [(it, "crisis") for it in existing if is_memory_crisis(it.get("text", ""))]
    left = [it for it in existing if all(it is not b for b, _ in bad)]
    bad += [(it, "duplicate") for it in duplicates(left)]
    existing = [it for it in existing if all(it is not b for b, _ in bad)]
    window = [m for m in window if not m.get("safety_hit") and not (m.get("role") == "user" and trivially_empty(m.get("body", "")))]
    context = [m for m in context if not m.get("safety_hit")]
    purge = [Op("delete", "", (f"x{i + 1}",), "fact", f"{r} stored as memory", r) for i, (_, r) in enumerate(bad)]
    purge_keyed = {f"x{i + 1}": it for i, (it, _) in enumerate(bad)}
    if not any(m.get("role") == "user" for m in window):
        return Plan(ops=purge), purge_keyed
    prompt, keyed = build_prompt(window, context, existing)
    content, usage = (planner or PLANNER)(prompt)
    plan = parse_ops(content, keyed, window_user_lines=[str(m.get("body") or "") for m in window if m.get("role") == "user"], user_said=said)
    plan.ops = purge + plan.ops
    plan.usage = usage
    return plan, {**keyed, **purge_keyed}


def apply_plan(memory, plan: Plan, keyed: dict[str, dict], *, session_id: str, observed_at: str) -> dict:
    """Write a plan through the memory port. Returns counts; never raises per op."""
    done = {"add": 0, "update": 0, "merge": 0, "delete": 0, "failed": 0}
    for op in plan.ops:
        try:
            targets = [keyed[i]["id"] for i in op.ids]
            if op.op == "add":
                add = getattr(memory, "add_fact", None)
                if add is not None:
                    add(op.text, observed_at=observed_at)
                else:
                    memory.ingest_user(text=op.text, agent_reply="", session_id=session_id, observed_at=observed_at)
            elif op.op == "update":
                if not memory.update_memory(targets[0], op.text):
                    raise RuntimeError("update failed")
            elif op.op == "merge":
                if not memory.update_memory(targets[0], op.text):
                    raise RuntimeError("merge failed")
                for mid in targets[1:]:
                    memory.delete_memory(mid)
            elif op.op == "delete":
                for mid in targets:
                    memory.delete_memory(mid)
            done[op.op] += 1
        except Exception as exc:  # noqa: BLE001
            done["failed"] += 1
            logger.warning("capture op %s failed: %s", op.op, type(exc).__name__)
    return done


# ---------------------------------------------------------------- DB glue


CAPTURE_MODEL_DEFAULT = "qwen-plus"


def capture_model() -> str:
    """qwen-plus unless OLO_CAPTURE_MODEL overrides (judgment call; flash is too sloppy)."""
    return os.environ.get("OLO_CAPTURE_MODEL", "").strip() or CAPTURE_MODEL_DEFAULT


def _rows(conn, sql: str, args: tuple, tz=None) -> list[dict]:
    if tz is None:
        try:
            from olo.usertz import user_tz

            tz = user_tz(conn)
        except Exception:  # noqa: BLE001
            tz = timezone.utc
    out = []
    for r in conn.execute(sql, args).fetchall():
        mid, role, body, safety, created, session_id = r
        out.append({
            "id": str(mid), "role": role, "body": body, "safety_hit": bool(safety),
            "at": created.astimezone(tz).strftime("%m-%d %H:%M"), "created_at": created,
            "session_id": str(session_id),
        })
    return out


def cursor_at(conn, user_id) -> datetime | None:
    row = conn.execute("SELECT max(upto) FROM memory_capture_runs WHERE user_id = %s", (user_id,)).fetchone()
    return row[0] if row else None


def pending(conn, user_id, since: datetime | None) -> list[dict]:
    return _rows(
        conn,
        """
        SELECT m.id, m.role, m.body, m.safety_hit, m.created_at, m.session_id
        FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND (%s::timestamptz IS NULL OR m.created_at > %s)
        ORDER BY m.created_at LIMIT %s
        """,
        (user_id, since, since, MAX_WINDOW * 2),
    )


def before(conn, user_id, since: datetime | None) -> list[dict]:
    if since is None:
        return []
    rows = _rows(
        conn,
        """
        SELECT m.id, m.role, m.body, m.safety_hit, m.created_at, m.session_id
        FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND m.created_at <= %s
        ORDER BY m.created_at DESC LIMIT %s
        """,
        (user_id, since, CONTEXT_BEFORE),
    )
    return rows[::-1]


def user_lines(conn, user_id, limit: int = 3000) -> list[str]:
    rows = conn.execute(
        """
        SELECT m.body FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND m.role = 'user' AND NOT m.safety_hit
        ORDER BY m.created_at DESC LIMIT %s
        """,
        (user_id, limit),
    ).fetchall()
    return [r[0] for r in rows]


def lookback(conn, user_id, since: datetime | None) -> list[dict]:
    """Messages in the CRISIS_EPISODE_MIN before the cursor (for crisis-stretch detection only)."""
    if since is None:
        return []
    return _rows(
        conn,
        """
        SELECT m.id, m.role, m.body, m.safety_hit, m.created_at, m.session_id
        FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND m.created_at <= %s AND m.created_at > %s - make_interval(mins => %s)
        ORDER BY m.created_at
        """,
        (user_id, since, since, CRISIS_EPISODE_MIN),
    )


def due(window: list[dict], now: datetime) -> bool:
    users = [m for m in window if m["role"] == "user"]
    if not users:
        return False
    if len(users) >= CAPTURE_EVERY:
        return True
    return now - window[-1]["created_at"] >= timedelta(minutes=CAPTURE_IDLE_MIN)


def run_capture(conn, memory, user_id, *, now: datetime | None = None, force: bool = False, planner=None) -> dict:
    now = now or datetime.now(timezone.utc)
    since = cursor_at(conn, user_id)
    window = pending(conn, user_id, since)
    if not window or (not force and not due(window, now)):
        return {"ran": False}
    context = before(conn, user_id, since)
    existing = list(memory.list_memories()) if hasattr(memory, "list_memories") else []
    plan, keyed = plan_capture(window, context, existing, planner=planner, lookback=lookback(conn, user_id, since), user_said=user_lines(conn, user_id))
    done = apply_plan(memory, plan, keyed, session_id=window[-1]["session_id"], observed_at=now.isoformat())
    conn.execute(
        """
        INSERT INTO memory_capture_runs (user_id, upto, n_messages, ops, usage)
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
        """,
        (
            user_id, window[-1]["created_at"], len(window),
            json.dumps([op.__dict__ for op in plan.ops], ensure_ascii=False, default=list),
            json.dumps(plan.usage),
        ),
    )
    conn.commit()
    return {"ran": True, "ops": len(plan.ops), **done}


def tick(runtime=None, now: datetime | None = None) -> dict | None:
    if runtime is None or getattr(runtime, "voicemem_status", "") != "ready" or capture_mode() != "batch":
        return None
    from olo.db import connect
    from olo.sessions import SEEDED_USER_ID

    def job():
        with connect() as conn:
            return run_capture(conn, runtime.memory, SEEDED_USER_ID, now=now)

    runtime.ingest.submit(job)
    return {"submitted": True}
