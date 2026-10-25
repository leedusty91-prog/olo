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
* ``delete`` – an existing memory is wrong (e.g. a joke/role-play stored as fact)
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
MAX_DELETES = 3
MAX_TEXT = 120
_EMPTY = re.compile(r"^[\s\W_]*$")
OPS = {"add", "update", "merge", "delete"}
KINDS = {"life_event", "person", "plan", "preference", "fact", "feeling", "remember_this"}


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
不记：寒暄、对 olo 的提问和闲聊（问 olo 的世界、让它讲故事、出题、算数）、olo 自己说的事、一次性的情绪
（除非有原因或反复出现）、olo 说过但用户没说的内容。
玩笑、角色扮演、明显的胡说（比如自称宇航员、在太空、改名逗 olo）不要当真：不记成事实；如果已有记忆把这类
玩笑当成了事实，用 delete 删掉。拿不准是不是玩笑就不记。
用户说「我叫X」要结合上下文判断是真名、昵称还是逗你。
不写日期之外的猜测，不添加原话里没有的细节。每条记忆一句话，用「用户……」开头，简洁具体。
已有记忆里说的同一件事，不要再 add：有新信息就 update，重复的几条用 merge 合成一条。

【已有记忆】
{existing}

【之前的聊天（只作上下文，已经整理过）】
{context}

【新的聊天（要整理的部分，时间是用户当地时间）】
{window}

只输出 JSON：{{"ops": [{{"op": "add|update|merge|delete", "ids": ["m1", ...], "text": "...", "kind": "life_event|person|plan|preference|fact|feeling|remember_this", "why": "一句话理由"}}]}}
add 不需要 ids；update 一个 id；merge 两个以上 id；delete 一个或多个 id（text 可空）。没有要做的就输出 {{"ops": []}}。"""


@dataclass(frozen=True)
class Op:
    op: str
    text: str = ""
    ids: tuple[str, ...] = ()
    kind: str = "fact"
    why: str = ""


@dataclass
class Plan:
    ops: list[Op] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    usage: dict = field(default_factory=dict)


def _line(m: dict, limit: int = 200) -> str:
    who = "用户" if m.get("role") == "user" else "olo"
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


def parse_ops(content: str, keyed: dict[str, dict]) -> Plan:
    plan = Plan()
    start, end = (content or "").find("{"), (content or "").rfind("}")
    try:
        data = json.loads(content[start : end + 1]) if start >= 0 else {}
    except json.JSONDecodeError:
        return plan
    raw_ops = data.get("ops") if isinstance(data, dict) else None
    deletes = 0
    for raw in raw_ops if isinstance(raw_ops, list) else []:
        if not isinstance(raw, dict):
            continue
        op = str(raw.get("op") or "").strip().lower()
        text = " ".join(str(raw.get("text") or "").split())[:MAX_TEXT]
        ids = tuple(str(i) for i in (raw.get("ids") or []) if str(i) in keyed)
        kind = str(raw.get("kind") or "fact")
        kind = kind if kind in KINDS else "fact"
        why = str(raw.get("why") or "")[:80]
        ok = (
            (op == "add" and text and not ids)
            or (op == "update" and text and len(ids) == 1)
            or (op == "merge" and text and len(set(ids)) >= 2)
            or (op == "delete" and ids and deletes + len(ids) <= MAX_DELETES)
        )
        if op not in OPS or not ok:
            plan.rejected.append(raw)
            continue
        if op == "delete":
            deletes += len(ids)
        if op == "add" and any(text == it["text"] for it in keyed.values()):
            plan.rejected.append(raw)
            continue
        plan.ops.append(Op(op, text, tuple(dict.fromkeys(ids)), kind, why))
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


def plan_capture(window: list[dict], context: list[dict], existing: list[dict], planner=None) -> tuple[Plan, dict[str, dict]]:
    window = [m for m in window if not m.get("safety_hit") and not (m.get("role") == "user" and trivially_empty(m.get("body", "")))]
    context = [m for m in context if not m.get("safety_hit")]
    if not any(m.get("role") == "user" for m in window):
        return Plan(), {}
    prompt, keyed = build_prompt(window, context, existing)
    content, usage = (planner or PLANNER)(prompt)
    plan = parse_ops(content, keyed)
    plan.usage = usage
    return plan, keyed


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
    plan, keyed = plan_capture(window, context, existing, planner=planner)
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
