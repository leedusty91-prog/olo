"""夜间整理记忆：合并重复、解决矛盾（以新的为准），再写一份「olo眼里的你」。

两份记忆分开整理，互不混用：
* 用户记忆（VoiceMem）：通过 adapter 的 list/update/delete_memory。
* olo 自己的设定（olo_canon 表）。

模型用记忆模型（OPENAI_* / OLO_MEMORY_MODEL，即通义），只让它输出「操作计划」，
真正的删改由这里按白名单执行：只认计划里出现过的编号，一次删得太多就整批放弃。
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Callable

from fastapi import APIRouter, Depends, FastAPI, Request

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, require_bearer

logger = logging.getLogger(__name__)

MAX_ITEMS = 150
MAX_DELETE_RATIO = 0.5
PROFILE_MAX = 400

PLAN_PROMPT = """你在帮一个陪伴应用整理一份{what}清单。每条前面是编号和记录日期。

{items}

请找出：
1. 重复或几乎同义的条目 → 合成一条（groups）。
2. 互相矛盾的条目（比如以前说喜欢、后来说不喜欢了；以前在 A 公司、后来换到 B）→ 以日期更新的为准，
   也放进同一个 group，合成后的文字只保留新的说法（必要时可写「以前…，现在…」）。
3. 被某条更新的条目完全取代、已经没有意义的旧条目 → drop，并用 by 写出是被哪一条取代的。
规则：
- 一个 group 只放说的是「同一件事、同一个属性」的条目；不同的事哪怕都和同一个人/宠物有关，也绝不合并。
- 不确定就不动。没有问题的条目不要出现在输出里；group 至少 2 条。
- 合成后的文字用中文，一句话，不超过 40 字，不添加原文没有的信息。
- 只能使用上面出现过的编号。
只输出 JSON：{{"groups": [{{"ids": ["m1", "m4"], "text": "..."}}], "drop": [{{"id": "m7", "by": "m9"}}]}}"""

PROFILE_PROMPT = """你是 olo，一只住在镜面背后倒影国的涟漪兽。根据下面你记得的关于用户的事，写一小段「olo眼里的你」。

{items}

要求：
- 用第二人称「你」，像写给对方的小纸条，温柔、具体、不肉麻。
- 3～5 句，不超过 150 字。
- 只用上面出现过的事实。不要描写场景和画面，不添加任何没出现过的细节（时间、物品、动作、心理活动都不行）。
- 不猜性别，不下诊断式结论。
- 最后一句可以是一句你想对 TA 说的话。
只输出这段文字。"""


# ---------------------------------------------------------------- LLM (memory model)

def _memory_llm(prompt: str, *, json_mode: bool) -> str:
    import httpx

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key or os.environ.get("LLM_PROVIDER", "").strip().lower() in {"mock", "offline", "demo"}:
        raise RuntimeError("memory model not configured")
    base = (os.environ.get("OPENAI_BASE_URL") or os.environ.get("OPENAI_API_BASE") or "https://api.openai.com/v1").rstrip("/")
    from olo.models import memory_model

    model = memory_model("consolidate")
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    r = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=60)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _plan_llm(what: str, items: str) -> dict:
    content = _memory_llm(PLAN_PROMPT.format(what=what, items=items), json_mode=True)
    start, end = content.find("{"), content.rfind("}")
    return json.loads(content[start : end + 1]) if start >= 0 else {}


def _profile_llm(items: str) -> str:
    return _memory_llm(PROFILE_PROMPT.format(items=items), json_mode=False)


PLANNER: Callable[[str, str], dict] = _plan_llm
PROFILER: Callable[[str], str] = _profile_llm


# ---------------------------------------------------------------- planning

def _render(items: list[dict]) -> tuple[str, dict[str, dict]]:
    keyed = {f"m{i + 1}": it for i, it in enumerate(items)}
    lines = "\n".join(f"{k} [{(it.get('created_at') or '')[:10] or '未知'}] {it['text']}" for k, it in keyed.items())
    return lines, keyed


def validate_plan(plan: dict, keyed: dict[str, dict]) -> tuple[list[tuple[dict, str, list[dict]]], list[dict]]:
    """Plan -> [(keep_item, new_text, drop_items)], [drop_items]. Unknown/duplicate ids ignored."""
    used: set[str] = set()
    merges = []
    for g in plan.get("groups") or []:
        if not isinstance(g, dict):
            continue
        ids = [i for i in dict.fromkeys(str(x) for x in (g.get("ids") or [])) if i in keyed and i not in used]
        text = str(g.get("text") or "").strip()[:80]
        if len(ids) < 2 or not text:  # a lone "group" would be a silent rewrite
            continue
        members = sorted((keyed[i] for i in ids), key=lambda it: it.get("created_at") or "")
        keep = members[-1]  # newest wins
        merges.append((keep, text, members[:-1]))
        used.update(ids)
    drops = []
    for d in plan.get("drop") or []:
        # a drop must name the newer entry that supersedes it
        i, by = (str(d.get("id")), str(d.get("by"))) if isinstance(d, dict) else (str(d), "")
        if i not in keyed or i in used or by not in keyed or by == i:
            continue
        if (keyed[by].get("created_at") or "") < (keyed[i].get("created_at") or ""):
            continue
        drops.append(keyed[i])
        used.add(i)
    return merges, drops


def _too_destructive(n_items: int, merges, drops) -> bool:
    deleted = len(drops) + sum(len(d) for _, _, d in merges)
    return n_items >= 4 and deleted > n_items * MAX_DELETE_RATIO


# ---------------------------------------------------------------- user memories

def consolidate_user_memories(memory) -> dict:
    stats = {"before": 0, "merged": 0, "updated": 0, "deleted": 0, "skipped": None}
    lister = getattr(memory, "list_memories", None)
    if lister is None:
        stats["skipped"] = "memory backend has no list api"
        return stats
    items = sorted(lister(), key=lambda m: m.get("created_at") or "")[-MAX_ITEMS:]
    stats["before"] = len(items)
    if len(items) < 2:
        return stats
    lines, keyed = _render(items)
    merges, drops = validate_plan(PLANNER("关于用户的记忆", lines), keyed)
    if _too_destructive(len(items), merges, drops):
        stats["skipped"] = "plan deletes too much"
        return stats
    for keep, text, others in merges:
        if text != keep["text"] and memory.update_memory(keep["id"], text):
            stats["updated"] += 1
        for o in others:
            if memory.delete_memory(o["id"]):
                stats["deleted"] += 1
        stats["merged"] += 1
    for d in drops:
        if memory.delete_memory(d["id"]):
            stats["deleted"] += 1
    return stats


# ---------------------------------------------------------------- olo canon

def consolidate_canon(conn, user_id=SEEDED_USER_ID) -> dict:
    stats = {"before": 0, "merged": 0, "updated": 0, "deleted": 0, "skipped": None}
    rows = conn.execute(
        "SELECT id, fact, created_at FROM olo_canon WHERE user_id = %s ORDER BY created_at, fact LIMIT %s",
        (user_id, MAX_ITEMS),
    ).fetchall()
    items = [{"id": r[0], "text": r[1], "created_at": r[2].isoformat()} for r in rows]
    stats["before"] = len(items)
    if len(items) < 2:
        return stats
    lines, keyed = _render(items)
    merges, drops = validate_plan(PLANNER("关于陪伴角色 olo 自己的设定", lines), keyed)
    if _too_destructive(len(items), merges, drops):
        stats["skipped"] = "plan deletes too much"
        return stats
    for keep, text, others in merges:
        for o in others:
            conn.execute("DELETE FROM olo_canon WHERE id = %s", (o["id"],))
            stats["deleted"] += 1
        if text != keep["text"]:
            clash = conn.execute(
                "SELECT id FROM olo_canon WHERE user_id = %s AND fact = %s AND id <> %s",
                (user_id, text, keep["id"]),
            ).fetchone()
            if clash:
                conn.execute("DELETE FROM olo_canon WHERE id = %s", (keep["id"],))
                stats["deleted"] += 1
            else:
                conn.execute("UPDATE olo_canon SET fact = %s WHERE id = %s", (text, keep["id"]))
                stats["updated"] += 1
        stats["merged"] += 1
    for d in drops:
        conn.execute("DELETE FROM olo_canon WHERE id = %s", (d["id"],))
        stats["deleted"] += 1
    conn.commit()
    return stats


# ---------------------------------------------------------------- profile

def get_profile(conn, user_id=SEEDED_USER_ID) -> dict | None:
    row = conn.execute("SELECT profile, updated_at FROM user_profiles WHERE user_id = %s", (user_id,)).fetchone()
    return {"profile": row[0], "updated_at": row[1].isoformat()} if row else None


def rebuild_profile(conn, memory, user_id=SEEDED_USER_ID) -> str | None:
    lister = getattr(memory, "list_memories", None)
    items = sorted(lister(), key=lambda m: m.get("created_at") or "")[-60:] if lister else []
    if not items:
        return None
    text = (PROFILER("\n".join(f"- {m['text']}" for m in items)) or "").strip()[:PROFILE_MAX]
    if not text:
        return None
    conn.execute(
        """
        INSERT INTO user_profiles (user_id, profile, updated_at) VALUES (%s, %s, now())
        ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
        """,
        (user_id, text),
    )
    conn.commit()
    return text


# ---------------------------------------------------------------- forgetting

def archive_forgotten(memory) -> dict:
    """Nightly forgetting: VoiceMem ArchiveColdMemories + old one-day memories, archived not deleted."""
    lifecycle = getattr(memory, "lifecycle", None)
    if lifecycle is None or not hasattr(memory, "archive_cold"):
        return {"skipped": "no_lifecycle"}
    return lifecycle.nightly(memory)


# ---------------------------------------------------------------- run

_run_lock = threading.Lock()


def run(conn, memory, *, trigger: str = "manual", user_id=SEEDED_USER_ID) -> dict:
    if not _run_lock.acquire(blocking=False):
        return {"ok": False, "reason": "already_running"}
    try:
        stats: dict = {"trigger": trigger}
        for name, fn in (
            ("memories", lambda: consolidate_user_memories(memory)),
            ("canon", lambda: consolidate_canon(conn, user_id)),
            ("lifecycle", lambda: archive_forgotten(memory)),
        ):
            try:
                stats[name] = fn()
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                logger.warning("consolidate %s failed: %s", name, type(exc).__name__)
                stats[name] = {"error": type(exc).__name__}
        try:
            stats["profile_updated"] = rebuild_profile(conn, memory, user_id) is not None
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            logger.warning("profile rebuild failed: %s", type(exc).__name__)
            stats["profile_updated"] = False
        conn.execute(
            "INSERT INTO consolidation_runs (id, user_id, trigger, stats) VALUES (%s, %s, %s, %s::jsonb)",
            (uuid.uuid4(), user_id, trigger, json.dumps(stats, ensure_ascii=False, default=str)),
        )
        conn.commit()
        return {"ok": True, **stats}
    finally:
        _run_lock.release()


def nightly_due(conn, now: datetime, user_id=SEEDED_USER_ID) -> bool:
    """Once per local night, at or after OLO_CONSOLIDATE_HOUR (default 3) and before 6."""
    from olo.proactive import _local_day_start, local_tz

    tz = local_tz(conn, user_id)
    hour = int(os.environ.get("OLO_CONSOLIDATE_HOUR") or 3)
    local = now.astimezone(tz)
    if not (hour <= local.hour < max(hour + 3, 6)):
        return False
    row = conn.execute(
        "SELECT 1 FROM consolidation_runs WHERE user_id = %s AND trigger = 'nightly' AND created_at >= %s",
        (user_id, _local_day_start(now, tz)),
    ).fetchone()
    return row is None


def tick(runtime=None, now: datetime | None = None) -> dict | None:
    now = now or datetime.now(timezone.utc)
    if runtime is None or getattr(runtime, "voicemem_status", "") != "ready":
        return None
    with connect() as conn:
        if not nightly_due(conn, now):
            return None
        return run(conn, runtime.memory, trigger="nightly")


# ---------------------------------------------------------------- API

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


@router.post("/memory/consolidate")
def consolidate_now(request: Request) -> dict:
    runtime = getattr(request.app.state, "runtime", None)
    with connect() as conn:
        return run(conn, getattr(runtime, "memory", None), trigger="manual")


@router.get("/profile")
def read_profile(request: Request) -> dict:
    with connect() as conn:
        p = get_profile(conn)
        last = conn.execute(
            "SELECT trigger, stats, created_at FROM consolidation_runs WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
            (SEEDED_USER_ID,),
        ).fetchone()
    return {
        "profile": p["profile"] if p else None,
        "updated_at": p["updated_at"] if p else None,
        "last_run": {"trigger": last[0], "stats": last[1], "at": last[2].isoformat()} if last else None,
    }


def register_consolidate(app: FastAPI) -> None:
    app.include_router(router)
