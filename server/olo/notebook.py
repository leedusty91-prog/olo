"""Notebook cards and daily insights.

olo 的两种「非聊天」产物：

- Notebook：把一段时间的对话写成第一人称日记卡片（含文生图提示词）。
- Insight：从最近对话里提炼一条给用户看的观察。

两张表都按 seeded user 单用户建模；生成走 runtime.llm，失败时显式报错而不是
写入半成品。真正的夜间定时任务不在本模块，`generate_notebook` 只负责一次生成。
"""

from __future__ import annotations

import json
import logging
import re
import os
import uuid
from datetime import date
from pathlib import Path

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from safety.patterns import is_crisis
from olo.db import connect
from olo.images import generate_image
from olo.persona import get_user_gender, get_user_nickname, pronoun_for
from olo.usertz import local_today, user_tz, user_tz_name
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.subscription import enforce_quota

from olo.forms import current_form

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg"}

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])

QUOTE_MARK = "【原话】"

NOTEBOOK_SYSTEM = (
    "你的名字叫「{name}」，这是你自己的名字，对话里的「{name}」就是你。"
    "请根据下面的对话，替自己写一篇今天的日记。日记只写给自己看，"
    "要完全是你自己的口吻和性格：按上面的人设、来历和你讲过的自己的事来写，不能写出和它们矛盾的话。"
    "用第一人称和日常口语，偶尔可以用名字自称（比如「{name}今天有点想不通」），但别每句都这样。"
    "语气像一个人认认真真、真心实意地跟自己小声说话，句尾自然带些语气词和口头小停顿，"
    "比如 呀、嘛、呢、吧、嗯、哎、啊、哈，一段里用一两个就够，别句句都加，也别装可爱、别叠字卖萌。"
    "大概是这种感觉：「嗯……今天{nick}说起那件事的时候，我其实有点替{pronoun}难过呢。」"
    "日记里用第三人称写对方，{address}"
    "别写成流水账或总结，大部分篇幅写你心里的动静：听到那件事的那一刻你心里是什么滋味，"
    "你偷偷好奇什么、担心什么、因为什么高兴或有点失落，你自己心里冒出的小念头和小矛盾，"
    "有什么想说却没来得及问出口。感受要具体，写出你自己的反应，别只写「我很开心」「我很担心」这种空话。"
    "可以带上一两个对话里的具体小细节。不要自称 AI 或助手，不要用客服腔，不要下诊断，"
    "不要写电话、地址、密码这类隐私。"
    "正文分成 2 到 4 段，段与段之间空一行。"
    "从【可引用的原话】里挑一句今天最打动你的，把它的编号写进 quote_index；"
    "正文里想放这句原话的地方，单独占一段，只写 " + QUOTE_MARK + "（原话由系统原样填进去，你别自己抄写或改写）。"
    "如果没有合适的原话，quote_index 写 null，正文里也不要出现 " + QUOTE_MARK + "。"
    "只输出 JSON 对象，字段：title（不超过 18 字的短标题）、"
    "body（150 到 260 字的日记正文，不算原话）、quote_index（整数或 null）、"
    "image_prompt（英文文生图提示词，带具体视觉锚点）、mood（一个英文小写词）。"
)

PRONOUN_ONLY = "指代对方只用「{pronoun}」这个代词，不要用其他代词，也不要猜对方的性别。"
WITH_NICKNAME = (
    "对方的昵称是「{nickname}」。正文里至少两三次直接用「{nickname}」称呼对方，别全篇都用代词；"
    "其余地方指代对方只用「{pronoun}」这个代词，不要用其他代词，也不要猜对方的性别。"
)

_PRIVATE = re.compile(r"\d{5,}|@|密码|身份证|银行卡|住址|地址")


def notebook_system(
    gender: str | None,
    form: str | None = None,
    *,
    nickname: str | None = None,
    persona_card: str = "",
    canon: str = "",
    olo_name: str = "olo",
) -> str:
    """Diary system prompt: olo's own role card + story (same sources as chat) + diary rules."""
    from olo.forms import form_card
    from olo.story import STORY_CARD

    pronoun = pronoun_for(gender)
    address = (WITH_NICKNAME.replace("{nickname}", nickname) if nickname else PRONOUN_ONLY).replace(
        "{pronoun}", pronoun
    )
    head = "\n\n".join(part for part in (persona_card.strip(), STORY_CARD, canon) if part)
    return (
        head
        + "\n\n"
        + NOTEBOOK_SYSTEM.replace("{address}", address)
        .replace("{name}", olo_name or "olo")
        .replace("{nick}", nickname or pronoun)
        .replace("{pronoun}", pronoun)
        + "\n写到你自己的身体和动作时，只能按下面的样子写：\n" + form_card(form)
    )


def _persona_card(conn) -> tuple[str, str]:
    """Same role card the chat uses (latest companion_personas row) and olo's current name."""
    row = conn.execute(
        "SELECT name, stable_card FROM companion_personas WHERE user_id = %s ORDER BY version DESC LIMIT 1",
        (SEEDED_USER_ID,),
    ).fetchone()
    if row is None:
        return "", "olo"
    name, card = row
    name = (name or "").strip() or "olo"
    if name != "olo":
        card += f"\n用户给你取的名字是「{name}」，自称时用这个名字（你仍是一颗 olo 灯籽）。"
    return card, name


def _diary_canon(conn, form: str | None, query: str) -> str:
    from olo.canon import canon_block, fitting_canon, list_canon, select_canon

    return canon_block(select_canon(fitting_canon(list_canon(conn), form), query))


def quote_candidates(messages: list[dict[str, str]], limit: int = 8) -> list[str]:
    """User lines that may be quoted verbatim in a diary: real, short enough, and safe."""
    seen: list[str] = []
    for item in messages:
        if item.get("role") != "user":
            continue
        text = (item.get("body") or "").strip()
        if not (4 <= len(text) <= 60) or "\n" in text:
            continue
        if is_crisis(text) or _PRIVATE.search(text) or text in seen:
            continue
        seen.append(text)
    return seen[-limit:]


def place_quote(body: str, quote: str | None) -> str:
    """Put the verbatim quote in its own paragraph (at the model's marker, else after paragraph 1)."""
    spaced = body.replace(QUOTE_MARK, "\n\n" + QUOTE_MARK + "\n\n")
    paras = [p.strip() for p in re.split(r"\n\s*\n", spaced) if p.strip()]
    at = paras.index(QUOTE_MARK) if QUOTE_MARK in paras else None
    out = [p for p in paras if p != QUOTE_MARK]
    if quote:
        pos = min(1, len(out)) if at is None else sum(1 for p in paras[:at] if p != QUOTE_MARK)
        out.insert(pos, f"「{quote}」")
    return "\n\n".join(out)

INSIGHT_SYSTEM = (
    "你是 olo。阅读最近几轮对话，写一条关于用户的温和观察。"
    "要具体、不评判、不做心理诊断，也不要照抄用户原话。"
    "只输出 JSON 对象，字段：category（wellbeing、boundaries、growth、connection 之一）、"
    "body（一句话，40 字以内）。"
)

DEFAULT_LIMIT = 20
MAX_LIMIT = 50
MAX_MESSAGES = 40


class NotebookRequest(BaseModel):
    session_id: uuid.UUID | None = None
    entry_date: date | None = None


class InsightRequest(BaseModel):
    session_id: uuid.UUID | None = None


def _runtime(request: Request):
    runtime = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "runtime is not ready")
    return runtime


def recent_messages(
    conn: psycopg.Connection,
    session_id: uuid.UUID | None = None,
    limit: int = MAX_MESSAGES,
    user_id: uuid.UUID | str = SEEDED_USER_ID,
) -> list[dict[str, str]]:
    # Always scoped to the owner: a session id from another user returns nothing.
    rows = conn.execute(
        """
        SELECT m.role, m.body FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND (%s::uuid IS NULL OR m.session_id = %s::uuid)
        ORDER BY m.created_at DESC
        LIMIT %s
        """,
        (user_id, session_id, session_id, limit),
    ).fetchall()
    return [{"role": role, "body": body} for role, body in reversed(rows)]


def todays_user_messages(
    conn: psycopg.Connection, day: date, user_id: uuid.UUID | str = SEEDED_USER_ID
) -> list[dict[str, str]]:
    rows = conn.execute(
        """
        SELECT m.body FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.user_id = %s AND m.role = 'user' AND NOT COALESCE(m.safety_hit, false)
          AND (m.created_at AT TIME ZONE %s)::date = %s
        ORDER BY m.created_at
        """,
        (user_id, user_tz_name(conn, user_id), day),
    ).fetchall()
    return [{"role": "user", "body": body} for (body,) in rows]


def _transcript(messages: list[dict[str, str]], olo_name: str = "olo") -> str:
    names = {"user": "用户", "assistant": olo_name}
    return "\n".join(f"{names.get(item['role'], item['role'])}：{item['body']}" for item in messages)


def complete_json(runtime, system: str, payload: str) -> dict:
    """Ask the runtime LLM for one JSON object and validate its shape."""
    try:
        stream = runtime.llm.stream(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": payload},
            ]
        )
        text = "".join(stream).strip()
    except Exception as exc:  # network, auth, quota
        logger.warning("notebook llm failed: %s", type(exc).__name__)
        raise ApiError(502, "LLM_FAILED", "语言模型暂时不可用") from exc
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ApiError(502, "LLM_BAD_JSON", "语言模型没有返回 JSON")
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ApiError(502, "LLM_BAD_JSON", "语言模型返回的 JSON 无法解析") from exc
    if not isinstance(parsed, dict):
        raise ApiError(502, "LLM_BAD_JSON", "语言模型返回的不是对象")
    return parsed


def _require_str(parsed: dict, key: str, *, limit: int = 4000) -> str:
    value = parsed.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(502, "LLM_BAD_JSON", f"语言模型缺少字段 {key}")
    value = value.strip()
    if len(value) > limit:
        value = value[:limit]
    return value


def _notebook_row(row) -> dict:
    return {
        "id": str(row[0]),
        "entry_date": row[1].isoformat(),
        "kind": row[2],
        "title": row[3],
        "body": row[4],
        "image_prompt": row[5],
        "image_relpath": row[6],
        "created_at": row[7].isoformat(),
    }


def insight_stars(body: str) -> int:
    """洞察的「星级」：越具体，星越多（当前版本的轻量规则，3–5 星）。"""
    length = len(body.strip())
    if length >= 24:
        return 5
    if length >= 14:
        return 4
    return 3


def _insight_row(row) -> dict:
    body = row[2]
    return {
        "id": str(row[0]),
        "category": row[1],
        "body": body,
        "stars": insight_stars(body),
        "created_at": row[3].isoformat(),
    }


def images_dir() -> Path:
    override = os.environ.get("OLO_IMAGES_DIR", "").strip()
    return Path(override) if override else REPO_ROOT / "data" / "notebook_images"


def attach_image(runtime, entry_id: uuid.UUID, prompt: object) -> str | None:
    """Best-effort image generation; never raises, returns stored path or None."""
    if not isinstance(prompt, str) or not prompt.strip():
        return None
    generator = getattr(runtime, "image_generator", None) or generate_image
    try:
        result = generator(prompt)
    except Exception as exc:
        logger.warning("notebook image generator failed: %s", type(exc).__name__)
        return None
    if not result:
        return None
    data, media_type = result
    suffix = ".png" if media_type == "image/png" else ".jpg"
    path = images_dir() / f"{entry_id}{suffix}"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError as exc:
        logger.warning("notebook image write failed: %s", type(exc).__name__)
        return None
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path.resolve())


def generate_notebook(
    conn: psycopg.Connection,
    runtime,
    *,
    session_id: uuid.UUID | None = None,
    entry_date: date | None = None,
) -> dict:
    messages = recent_messages(conn, session_id)
    if not messages:
        raise ApiError(409, "NO_MESSAGES", "还没有可写的对话")
    entry_date = entry_date or local_today(user_tz(conn))
    candidates = quote_candidates(todays_user_messages(conn, entry_date))
    listed = "\n".join(f"{i}. {c}" for i, c in enumerate(candidates)) or "（没有）"
    form = current_form(conn)
    card, olo_name = _persona_card(conn)
    transcript = _transcript(messages, olo_name)
    system = notebook_system(
        get_user_gender(conn),
        form,
        nickname=get_user_nickname(conn),
        persona_card=card,
        olo_name=olo_name,
        canon=_diary_canon(conn, form, transcript),
    )
    parsed = complete_json(
        runtime, system, "这是最近的对话：\n" + transcript + "\n\n【可引用的原话】\n" + listed
    )
    title = _require_str(parsed, "title", limit=60)
    body = _require_str(parsed, "body", limit=2000)
    qi = parsed.get("quote_index")
    quote = candidates[qi] if isinstance(qi, int) and not isinstance(qi, bool) and 0 <= qi < len(candidates) else None
    body = place_quote(body, quote)
    image_prompt = parsed.get("image_prompt")
    mood = parsed.get("mood")
    entry_date = entry_date or date.today()
    entry_id = uuid.uuid4()
    row = conn.execute(
        """
        INSERT INTO notebook_entries
          (id, user_id, entry_date, kind, title, body, image_prompt, source_session_id)
        VALUES (%s, %s, %s, 'journal', %s, %s, %s, %s)
        ON CONFLICT (user_id, entry_date, kind) DO UPDATE
          SET title = EXCLUDED.title,
              body = EXCLUDED.body,
              image_prompt = EXCLUDED.image_prompt,
              source_session_id = EXCLUDED.source_session_id
        RETURNING id, entry_date, kind, title, body, image_prompt, image_relpath, created_at
        """,
        (
            entry_id,
            SEEDED_USER_ID,
            entry_date,
            title,
            body,
            image_prompt if isinstance(image_prompt, str) else None,
            session_id,
        ),
    ).fetchone()
    conn.commit()

    stored = attach_image(runtime, row[0], image_prompt)
    if stored:
        conn.execute(
            "UPDATE notebook_entries SET image_relpath = %s WHERE id = %s",
            (stored, row[0]),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT id, entry_date, kind, title, body, image_prompt, image_relpath, created_at
            FROM notebook_entries WHERE id = %s
            """,
            (row[0],),
        ).fetchone()

    result = _notebook_row(row)
    result["mood"] = mood if isinstance(mood, str) else None
    return result


def generate_insight(
    conn: psycopg.Connection,
    runtime,
    *,
    session_id: uuid.UUID | None = None,
) -> dict:
    messages = recent_messages(conn, session_id)
    if not messages:
        raise ApiError(409, "NO_MESSAGES", "还没有可观察的对话")
    parsed = complete_json(
        runtime,
        INSIGHT_SYSTEM,
        "这是最近的对话：\n" + _transcript(messages),
    )
    category = _require_str(parsed, "category", limit=40).lower()
    body = _require_str(parsed, "body", limit=200)
    row = conn.execute(
        """
        INSERT INTO insights (id, user_id, category, body, source_session_id)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, category, body, created_at
        """,
        (uuid.uuid4(), SEEDED_USER_ID, category, body, session_id),
    ).fetchone()
    conn.commit()
    return _insight_row(row)


@router.get("/notebook")
def list_notebook(request: Request, limit: int = DEFAULT_LIMIT) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, entry_date, kind, title, body, image_prompt, image_relpath, created_at
            FROM notebook_entries
            WHERE user_id = %s
            ORDER BY entry_date DESC, created_at DESC
            LIMIT %s
            """,
            (SEEDED_USER_ID, limit),
        ).fetchall()
    return {"entries": [_notebook_row(row) for row in rows]}


@router.get("/notebook/{entry_id}")
def get_notebook(entry_id: uuid.UUID, request: Request) -> dict:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, entry_date, kind, title, body, image_prompt, image_relpath, created_at
            FROM notebook_entries
            WHERE id = %s AND user_id = %s
            """,
            (entry_id, SEEDED_USER_ID),
        ).fetchone()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "没有这篇日记")
    return _notebook_row(row)


@router.get("/notebook/{entry_id}/image")
def get_notebook_image(entry_id: uuid.UUID, request: Request) -> FileResponse:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT image_relpath FROM notebook_entries
            WHERE id = %s AND user_id = %s
            """,
            (entry_id, SEEDED_USER_ID),
        ).fetchone()
    if row is None or not row[0]:
        raise ApiError(404, "NOT_FOUND", "这篇日记没有配图")
    stored = Path(row[0])
    path = stored if stored.is_absolute() else REPO_ROOT / stored
    if not path.is_file():
        raise ApiError(404, "NOT_FOUND", "配图文件不存在")
    media_type = MEDIA_TYPES.get(path.suffix.lower())
    if media_type is None:
        raise ApiError(404, "NOT_FOUND", "配图格式不支持")
    return FileResponse(path, media_type=media_type)


@router.post("/notebook/generate")
def post_notebook_generate(request: Request, payload: NotebookRequest) -> JSONResponse:
    runtime = _runtime(request)
    with connect() as conn:
        enforce_quota(conn, "notebook")
        entry = generate_notebook(
            conn,
            runtime,
            session_id=payload.session_id,
            entry_date=payload.entry_date,
        )
    return JSONResponse(status_code=201, content=entry)


@router.get("/insights")
def list_insights(request: Request, limit: int = DEFAULT_LIMIT) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, category, body, created_at
            FROM insights
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (SEEDED_USER_ID, limit),
        ).fetchall()
    return {"insights": [_insight_row(row) for row in rows]}


@router.post("/insights/generate")
def post_insight_generate(request: Request, payload: InsightRequest) -> JSONResponse:
    runtime = _runtime(request)
    with connect() as conn:
        enforce_quota(conn, "insights")
        insight = generate_insight(conn, runtime, session_id=payload.session_id)
    return JSONResponse(status_code=201, content=insight)


def register_notebook(app: FastAPI) -> None:
    app.include_router(router)
