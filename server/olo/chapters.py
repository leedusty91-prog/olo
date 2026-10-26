"""雾里集 chapters: olo's invented canon, grouped into story chapters that unlock as you talk.

Each chapter has a fixed place/theme and an unlock rule (canon facts told so far + garden
stage). The first time a chapter unlocks, the memory model writes a title and a short
narration from the canon facts that belong to it; that text is stored and never rewritten,
so the book stays consistent with what olo has already said.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Callable

from fastapi import APIRouter, Depends, FastAPI

from olo.userctx import current_user_id
from olo.canon import list_canon
from olo.db import connect
from olo.sessions import SEEDED_USER_ID, require_bearer

logger = logging.getLogger(__name__)

# (place, theme, min canon facts, min garden stage, canon categories it draws on)
CHAPTERS = [
    ("落雾滩", "olo 还是一缕雾的时候", 1, 1, ("past",)),
    ("灯籽湾", "凝成灯籽、等船的日子", 3, 1, ("past", "friends")),
    ("芦苇渡", "渡灯翁撑船，过河来找你", 5, 2, ("past", "friends")),
    ("回声井", "井婶、阿蒲和雾里集的熟人们", 8, 2, ("friends", "likes")),
    ("晾话廊", "olo 的小喜好和小日子", 12, 3, ("likes", "life")),
    ("萤火坡", "在你的花园里扎根", 16, 4, ("garden", "life")),
    ("旧灯林", "慢慢长成一盏灯", 22, 5, ("garden", "past", "life")),
]

NARRATE_PROMPT = """你在为陪伴角色「olo」写一本小故事书里的一章。olo 是一粒灯籽，这本书只讲 olo 自己的经历。

{rules}

这一章的地点：{place}；主题：{theme}。
前面已经写好的章节（不能和它们矛盾，也不要重复）：
{previous}

olo 亲口讲过的关于自己的事（这是唯一的事实来源，必须以它们为准，不许编出和它们矛盾的情节）：
{facts}

要求：
- 用 olo 的第一人称「我」，温柔、口语、像睡前小故事，120~220 字，2~3 段，段与段之间空一行。
- 可以补一点景色、声音、温度这类氛围，但情节只能来自上面的事实。
- 只能出现上面事实里提到过的人物（渡灯翁、井婶、阿蒲、小栗、豆灯等），事实里没出现的人物一个都不要写进来，也不要发明他们做过的事。
- 不要提到「用户」「聊天」「设定」这类词，结尾留一点余味。
- 标题 4~10 个字，有画面感。
只输出 JSON：{{"title": "...", "narration": "..."}}"""


def _form_card_now() -> str:
    from olo.forms import current_look, form_card

    try:
        with connect() as conn:
            return form_card(current_look(conn))
    except Exception:  # noqa: BLE001
        return form_card(None)


def _llm_narrate(place: str, theme: str, facts: list[str], previous: list[str]) -> dict:
    import httpx

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key or os.environ.get("LLM_PROVIDER", "").strip() == "mock":
        return _fallback(place, theme, facts)
    base = (os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    from olo.models import memory_model

    model = memory_model("chapters")
    prompt = NARRATE_PROMPT.format(
        rules=PLACE_RULES + "\n写到 olo 的身体时只按它现在的样子写，不要写卡片里没有的部位：\n" + _form_card_now(), place=place, theme=theme,
        previous="\n".join(previous) or "（这是第一章）",
        facts="\n".join(f"- {f}" for f in facts) or "（还很少，就写这个地方的样子和 olo 隐约记得的感觉）",
    )
    r = httpx.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}],
              "response_format": {"type": "json_object"}, "temperature": 0.7},
        timeout=45,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    data = json.loads(content[content.find("{") : content.rfind("}") + 1] or "{}")
    if not data.get("title") or not data.get("narration"):
        return _fallback(place, theme, facts)
    return {"title": str(data["title"])[:20], "narration": str(data["narration"])[:600]}


def _fallback(place: str, theme: str, facts: list[str]) -> dict:
    body = "\n\n".join(f.replace("olo ", "我").replace("olo", "我") for f in facts[:3]) or f"{place}的雾很轻，我只记得一点点。"
    return {"title": f"{place}的事", "narration": body}


NAMES = ("渡灯翁", "井婶", "阿蒲", "小栗", "豆灯", "老灯树")
PLACE_RULES = (
    "世界：olo 是一粒灯籽，从雾里集的雾里凝成（雾是城里人没说出口的话）；地点有落雾滩、灯籽湾、芦苇渡、回声井、晾话廊、萤火坡、旧灯林。"
    "雾不能被偷看；一粒灯籽只认一个人；灯籽不撒谎。"
)


def stray_names(text: str, facts: list[str]) -> list[str]:
    """Named characters in the narration that none of the chapter's facts mention."""
    joined = "".join(facts)
    return [n for n in NAMES if n in text and n not in joined]


def narrate_checked(place: str, theme: str, facts: list[str], previous: list[str]) -> dict:
    """Narrate; if it drags in characters the facts never mention, retry once, then fall back."""
    text = NARRATOR(place, theme, facts, previous)
    if stray_names(text["narration"], facts):
        text = NARRATOR(place, theme, facts, previous + ["（上一稿写进了事实里没有的人物，这次只写事实里出现的人物）"])
        bad = stray_names(text["narration"], facts)
        if bad:
            text = {"title": text["title"], "narration": _drop_sentences(text["narration"], bad)}
            if len(text["narration"]) < 40:
                text = _fallback(place, theme, facts)
    return text


def _drop_sentences(text: str, names: list[str]) -> str:
    paras = []
    for para in text.split("\n\n"):
        parts = re.findall(r"[^。！？…]+[。！？…]*", para)
        kept = "".join(p for p in parts if not any(n in p for n in names)).strip()
        if kept:
            paras.append(kept)
    return "\n\n".join(paras)


NARRATOR: Callable[[str, str, list[str], list[str]], dict] = _llm_narrate


def _facts_for(canon: list[dict], cats: tuple[str, ...], used: set[str], n: int = 6) -> list[str]:
    picked = [c["fact"] for c in canon if c["category"] in cats and c["fact"] not in used][:n]
    if len(picked) < 2:  # thin canon: borrow the next unused facts so the chapter isn't empty
        picked += [c["fact"] for c in canon if c["fact"] not in used and c["fact"] not in picked][: 2 - len(picked)]
    return picked


def _stage(conn) -> int:
    from olo.garden import garden_state

    return int(garden_state(conn)["level"])


def stored(conn, user_id=None) -> dict[int, dict]:
    if user_id is None:
        user_id = current_user_id()
    rows = conn.execute(
        "SELECT idx, title, narration, unlocked_at FROM olo_chapters WHERE user_id = %s ORDER BY idx", (user_id,)
    ).fetchall()
    return {r[0]: {"title": r[1], "narration": r[2], "unlocked_at": r[3].isoformat()} for r in rows}


def check_unlocks(user_id=None) -> list[int]:
    """Unlock (and narrate once) every chapter whose rule is met, in order. Returns new indexes."""
    if user_id is None:
        user_id = current_user_id()
    new: list[int] = []
    with connect() as conn:
        from olo.canon import fitting_canon
        from olo.forms import current_form

        canon = fitting_canon(list_canon(conn, user_id), current_form(conn, user_id))
        stage = _stage(conn)
        have = stored(conn, user_id)
    used: set[str] = set()
    previous = [f"《{c['title']}》{c['narration'][:80]}" for _, c in sorted(have.items())]
    for idx, (place, theme, need_canon, need_stage, cats) in enumerate(CHAPTERS):
        if idx in have:
            continue
        if len(canon) < need_canon or stage < need_stage:
            break  # chapters unlock strictly in order
        facts = _facts_for(canon, cats, used)
        used.update(facts)
        try:
            text = narrate_checked(place, theme, facts, previous)
        except Exception as exc:  # noqa: BLE001
            logger.warning("chapter narrate failed: %s", type(exc).__name__)
            break  # try again next time rather than storing a broken chapter
        with connect() as conn:
            cur = conn.execute(
                "INSERT INTO olo_chapters (user_id, idx, title, narration, canon_count) VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (user_id, idx, text["title"], text["narration"], len(canon)),
            )
        if cur.rowcount:
            new.append(idx)
            previous.append(f"《{text['title']}》{text['narration'][:80]}")
            logger.info("chapter %d unlocked", idx)
    return new


def book(conn, user_id=None) -> dict:
    if user_id is None:
        user_id = current_user_id()
    have = stored(conn, user_id)
    canon_n = len(list_canon(conn, user_id))
    stage = _stage(conn)
    chapters = []
    for idx, (place, theme, need_canon, need_stage, _c) in enumerate(CHAPTERS):
        item = {"index": idx, "place": place, "unlocked": idx in have,
                "requires": {"canon": need_canon, "stage": need_stage}}
        if idx in have:
            item.update(have[idx], theme=theme)
        else:
            need = []
            if canon_n < need_canon:
                need.append(f"再听 olo 讲 {need_canon - canon_n} 件自己的事")
            if stage < need_stage:
                need.append(f"花园长到第 {need_stage} 阶段")
            item["hint"] = "，".join(need) or "前一章展开后就来"
        chapters.append(item)
    return {"canon_count": canon_n, "stage": stage, "unlocked": len(have), "total": len(CHAPTERS), "chapters": chapters}


router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])


@router.get("/olo/chapters")
def get_chapters() -> dict:
    try:
        check_unlocks()
    except Exception as exc:  # noqa: BLE001
        logger.warning("chapter check failed: %s", type(exc).__name__)
    with connect() as conn:
        return book(conn)


def register_chapters(app: FastAPI) -> None:
    app.include_router(router)
