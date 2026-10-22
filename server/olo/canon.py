"""olo's own story, invented per user and kept consistent.

olo may make up small experiences inside the world rules (docs/world.md). After
each reply a cheap background LLM call pulls out any *new facts about olo
itself*; before each reply the relevant ones are injected as "things you have
already said about yourself". This is never mixed with user memories.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

from fastapi import APIRouter, Depends, FastAPI

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, require_bearer

logger = logging.getLogger(__name__)

CATEGORIES = ("past", "life", "friends", "garden", "likes")
CORE_COUNT = 3
RELEVANT_COUNT = 5
MAX_FACT_LEN = 80

WORLD_RULES = (
    "世界规则：olo 是一粒灯籽，从雾里集（落雾滩、灯籽湾、芦苇渡、回声井、晾话廊、萤火坡、旧灯林）"
    "的雾里凝成，由摆渡人芦婆婆撑船送到用户身边；熟人有井婶、阿蒲（井婶的外甥）、小栗（同批灯籽，已去了别人身边）、"
    "豆灯（总迷路的萤火虫信使）、老灯树。雾不能被偷看；一粒灯籽只认一个人；灯籽不撒谎。"
    "olo 现在住在用户的小花园里，不吃饭不睡觉，靠被听见的话长大。"
)

EXTRACT_PROMPT = """你在帮一个陪伴角色「olo」记住它自己讲过的设定，保证以后不说前后矛盾的话。

{rules}

olo 已经说过的关于自己的事（已存档）：
{existing}

用户刚说：{user}
olo 刚回复：{reply}

任务：从 olo 这次的回复里，找出 olo **新讲出来的、关于它自己**的具体事实（经历、日常、朋友、花园、喜好）。
规则：
- 只要关于 olo 自己的事；关于用户的事一律不要（那是另一套记忆）。
- 不要 olo 和用户「一起经历过」的事。
- 不要已存档里已经有的、或意思一样的。
- 和世界规则或已存档矛盾的，不要。
- 只是提问、安慰、泛泛的话，不要。
- 每条写成一句完整的中文陈述，以「olo」开头，不超过 40 字。
没有就返回空数组。只输出 JSON：{{"facts": [{{"fact": "...", "category": "past|life|friends|garden|likes", "entities": ["..."]}}]}}"""

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="olo-canon")
_futures: list[Future] = []


# ---------------------------------------------------------------- storage

def list_canon(conn, user_id=SEEDED_USER_ID, limit: int = 200) -> list[dict]:
    rows = conn.execute(
        """
        SELECT fact, category, entities, created_at FROM olo_canon
        WHERE user_id = %s ORDER BY created_at, fact LIMIT %s
        """,
        (user_id, limit),
    ).fetchall()
    return [
        {"fact": r[0], "category": r[1], "entities": list(r[2] or []), "created_at": r[3].isoformat()}
        for r in rows
    ]


def add_canon(conn, facts: list[dict], *, user_id=SEEDED_USER_ID, source_message_id=None) -> int:
    added = 0
    for item in facts:
        fact = str(item.get("fact", "")).strip()[:MAX_FACT_LEN]
        if not fact:
            continue
        category = item.get("category") if item.get("category") in CATEGORIES else "life"
        entities = [str(e)[:20] for e in (item.get("entities") or [])][:6]
        cur = conn.execute(
            """
            INSERT INTO olo_canon (id, user_id, fact, category, entities, source_message_id)
            VALUES (%s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (user_id, fact) DO NOTHING
            """,
            (uuid.uuid4(), user_id, fact, category, json.dumps(entities, ensure_ascii=False), source_message_id),
        )
        added += cur.rowcount or 0
    return added


# ---------------------------------------------------------------- retrieval

def _grams(text: str) -> set[str]:
    t = re.sub(r"\s+", "", text or "")
    return {t[i : i + 2] for i in range(len(t) - 1)} | set(t)


def select_canon(canon: list[dict], query: str, core: int = CORE_COUNT, k: int = RELEVANT_COUNT) -> list[str]:
    """A few oldest (core) facts + the ones that overlap the query most."""
    if not canon:
        return []
    picked = [c["fact"] for c in canon[:core]]
    q = _grams(query)
    scored = []
    for c in canon[core:]:
        text = c["fact"] + " " + " ".join(c.get("entities") or [])
        overlap = len(q & _grams(text))
        if overlap >= 2:
            scored.append((overlap, c["fact"]))
    scored.sort(key=lambda x: -x[0])
    picked += [f for _, f in scored[:k]]
    return picked


def canon_block(facts: list[str]) -> str:
    if not facts:
        return ""
    lines = "\n".join(f"- {f}" for f in facts)
    return (
        "【你之前讲过的关于你自己的事】（这是你自己的设定，不是用户的事；可以接着讲，绝不能说出矛盾的话）\n"
        + lines
    )


def prompt_canon(query: str, user_id=SEEDED_USER_ID) -> str:
    try:
        with connect() as conn:
            return canon_block(select_canon(list_canon(conn, user_id), query))
    except Exception as exc:  # noqa: BLE001
        logger.warning("canon load failed: %s", type(exc).__name__)
        return ""


# ---------------------------------------------------------------- extraction

def _llm_extract(user_text: str, reply: str, existing: list[str]) -> list[dict]:
    """One small chat call on the memory model (OPENAI_* / OLO_MEMORY_MODEL)."""
    import httpx

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key or os.environ.get("LLM_PROVIDER", "").strip() == "mock":
        return []
    base = (os.environ.get("OPENAI_BASE_URL") or os.environ.get("OPENAI_API_BASE") or "https://api.openai.com/v1").rstrip("/")
    model = (os.environ.get("OLO_MEMORY_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini").strip()
    prompt = EXTRACT_PROMPT.format(
        rules=WORLD_RULES,
        existing="\n".join(f"- {e}" for e in existing[-40:]) or "（还没有）",
        user=user_text[:400],
        reply=reply[:1200],
    )
    r = httpx.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}],
              "response_format": {"type": "json_object"}, "temperature": 0},
        timeout=30,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    data = json.loads(content[content.find("{") : content.rfind("}") + 1] or "{}")
    return [f for f in data.get("facts", []) if isinstance(f, dict)]


EXTRACTOR: Callable[[str, str, list[str]], list[dict]] = _llm_extract


def _mentions_self(reply: str) -> bool:
    """Cheap pre-filter: skip the LLM call when olo said nothing about itself."""
    keys = ("我", "芦婆婆", "井婶", "阿蒲", "小栗", "豆灯", "雾里集", "花园", "灯籽", "石子", "嫩芽")
    return any(k in reply for k in keys)


_CHAT_META = re.compile(r"用户|对方|你|提过|聊过|说过|讲过")


def _about_chat(fact) -> bool:
    """Facts about the user or about this conversation are not olo's canon."""
    text = fact.get("fact", "") if isinstance(fact, dict) else str(fact)
    return bool(_CHAT_META.search(text))


def extract_and_store(user_text: str, reply: str, source_message_id=None, user_id=SEEDED_USER_ID) -> int:
    if not _mentions_self(reply):
        return 0
    try:
        with connect() as conn:
            existing = [c["fact"] for c in list_canon(conn, user_id)]
        facts = [f for f in (EXTRACTOR(user_text, reply, existing) or []) if not _about_chat(f)]
        if not facts:
            return 0
        with connect() as conn:
            n = add_canon(conn, facts, user_id=user_id, source_message_id=source_message_id)
        if n:
            logger.info("canon +%d", n)
            from olo.chapters import check_unlocks

            check_unlocks(user_id)
        return n
    except Exception as exc:  # noqa: BLE001
        logger.warning("canon extract failed: %s", type(exc).__name__)
        return 0


def submit_extract(user_text: str, reply: str, source_message_id=None) -> None:
    if os.environ.get("OLO_CANON", "1") == "0":
        return
    if EXTRACTOR is _llm_extract and os.environ.get("PYTEST_CURRENT_TEST"):
        return  # never call a real API from the test suite
    _futures.append(_pool.submit(extract_and_store, user_text, reply, source_message_id))
    del _futures[:-50]


def drain(timeout: float = 10) -> None:
    for f in list(_futures):
        try:
            f.result(timeout=timeout)
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------- API

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


@router.get("/olo/story")
def get_story() -> dict:
    with connect() as conn:
        return {"facts": list_canon(conn)}


def register_canon(app: FastAPI) -> None:
    app.include_router(router)
