"""人设、性格与外观：首次匹配时选，之后可以在「我的」里改。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel
from psycopg.types.json import Jsonb

from olo.context import TONE_ARCHETYPES
from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.shop import owns_value
from olo.usertz import set_user_tz, user_tz_name

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])

DEFAULT_APPEARANCE = {
    "color": "mint",
    "eyes": "circle",
    "cheeks": "blush",
    "hair": "none",
    "voice": "voice1",
    "form": "buddy",
}

# 颜色不再出售/可选（形态决定配色）；老用户存过的颜色仍然认，未知值回落默认
LEGACY_COLORS = {"mint", "sky", "sun", "blush", "lavender"}

APPEARANCE_OPTIONS = {
    "eyes": [
        {"id": "circle", "label": "圆眼"},
        {"id": "almond", "label": "杏眼"},
    ],
    "cheeks": [
        {"id": "blush", "label": "腮红"},
        {"id": "dots", "label": "小点"},
        {"id": "triangle", "label": "三角"},
        {"id": "warpaint", "label": "战纹"},
        {"id": "none", "label": "不画"},
    ],
    "voice": [
        {"id": "voice1", "label": "声音 1"},
        {"id": "voice2", "label": "声音 2"},
    ],
    "form": [
        {"id": "buddy", "label": "月光薄荷"},
        {"id": "cloud", "label": "雾蓝"},
        {"id": "glow", "label": "薰衣草"},
        {"id": "bud", "label": "薄荷"},
        {"id": "dew", "label": "浅水蓝"},
        {"id": "star", "label": "晨光"},
        {"id": "peach", "label": "桃粉"},
        {"id": "acorn", "label": "青柠"},
        {"id": "moon", "label": "银月"},
        {"id": "amber", "label": "蜜金"},
    ],
    "hair": [
        {"id": "none", "label": "不戴"},
        {"id": "bow", "label": "蝴蝶结"},
        {"id": "leaf", "label": "小叶子"},
        {"id": "spikes", "label": "小刺刺"},
        {"id": "curl", "label": "卷卷"},
        {"id": "crest", "label": "鸡冠"},
        {"id": "bun", "label": "丸子头"},
        {"id": "sun", "label": "小太阳"},
        {"id": "halo", "label": "光环"},
        {"id": "straw", "label": "斗笠"},
    ],
}


DEFAULT_TONE = "curious"

GENDERS = ("male", "female", "unspecified")
PRONOUNS = {"male": "他", "female": "她"}


def pronoun_for(gender: str | None) -> str:
    """Third-person pronoun for the user; never guessed: anything but male/female is TA."""
    return PRONOUNS.get(gender or "", "TA")


def get_user_gender(conn) -> str | None:
    row = conn.execute("SELECT gender FROM users WHERE id = %s", (SEEDED_USER_ID,)).fetchone()
    return row[0] if row else None


# users.display_name is seeded as "demo"; that placeholder means "no nickname yet".
NICKNAME_PLACEHOLDER = "demo"


def get_user_nickname(conn) -> str | None:
    row = conn.execute("SELECT display_name FROM users WHERE id = %s", (SEEDED_USER_ID,)).fetchone()
    name = (row[0] or "").strip() if row else ""
    return name if name and name != NICKNAME_PLACEHOLDER else None


def get_onboarded(conn) -> bool:
    row = conn.execute("SELECT onboarded_at FROM users WHERE id = %s", (SEEDED_USER_ID,)).fetchone()
    return bool(row and row[0])


def _set_nickname(conn, nickname: str | None) -> None:
    if nickname is None:
        return
    name = " ".join(nickname.split())
    if len(name) > 12:
        raise ApiError(422, "VALIDATION_FAILED", "昵称最多 12 个字")
    # empty string clears the nickname (diary falls back to pronouns)
    conn.execute("UPDATE users SET display_name = %s WHERE id = %s", (name or NICKNAME_PLACEHOLDER, SEEDED_USER_ID))


def _set_gender(conn, gender: str | None) -> None:
    if gender is None:
        return
    if gender not in GENDERS:
        raise ApiError(422, "VALIDATION_FAILED", "性别只能是 male、female 或 unspecified")
    conn.execute("UPDATE users SET gender = %s WHERE id = %s", (gender, SEEDED_USER_ID))


class PersonaRequest(BaseModel):
    user_gender: str | None = None
    user_nickname: str | None = None
    timezone: str | None = None
    name: str | None = None
    tone: str | None = None
    appearance: dict[str, str] | None = None


def _normalize_appearance(raw: object) -> dict[str, str]:
    merged = dict(DEFAULT_APPEARANCE)
    if isinstance(raw, dict):
        for key, value in raw.items():
            if key in DEFAULT_APPEARANCE and isinstance(value, str):
                merged[key] = value
    if merged["color"] not in LEGACY_COLORS:
        merged["color"] = DEFAULT_APPEARANCE["color"]
    return merged


def _without_color(raw: dict[str, str]) -> dict[str, str]:
    """Colour is no longer a choice: silently drop it instead of rejecting old clients."""
    return {k: v for k, v in raw.items() if k != "color"}


def _validate_appearance(raw: dict[str, str]) -> None:
    for key, value in raw.items():
        if key not in DEFAULT_APPEARANCE:
            raise ApiError(422, "VALIDATION_FAILED", f"不认识的外观项 {key}")
        allowed = {item["id"] for item in APPEARANCE_OPTIONS[key]}
        if value not in allowed:
            raise ApiError(422, "VALIDATION_FAILED", f"{key} 没有 {value} 这个选项")


def _current(conn) -> tuple[str, str, dict[str, str]] | None:
    row = conn.execute(
        """
        SELECT name, tone, appearance FROM companion_personas
        WHERE user_id = %s
        ORDER BY version DESC
        LIMIT 1
        """,
        (SEEDED_USER_ID,),
    ).fetchone()
    if row is None:
        return None
    return row[0], (row[1] or "curious"), _normalize_appearance(row[2])


def _options() -> list[dict]:
    return [
        {"id": key, "label": value["label"], "description": value["description"]}
        for key, value in TONE_ARCHETYPES.items()
    ]


def _payload(
    current: tuple[str, str, dict[str, str]],
    gender: str | None = None,
    tz: str | None = None,
    nickname: str | None = None,
    onboarded: bool | None = None,
) -> dict:
    name, tone, appearance = current
    out = {
        "user_gender": gender,
        "user_nickname": nickname,
        "timezone": tz,
        "name": name,
        "tone": tone,
        "options": _options(),
        "appearance": appearance,
        "appearance_options": APPEARANCE_OPTIONS,
    }
    if onboarded is not None:
        out["onboarded"] = onboarded
    return out


@router.get("/persona")
def get_persona(request: Request) -> dict:
    with connect() as conn:
        current = _current(conn)
        gender = get_user_gender(conn)
        tz = user_tz_name(conn)
        nickname = get_user_nickname(conn)
        onboarded = get_onboarded(conn)
    if current is None:
        raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
    return _payload(current, gender, tz, nickname, onboarded)


@router.put("/persona")
def put_persona(payload: PersonaRequest, request: Request) -> dict:
    if payload.tone is not None and payload.tone not in TONE_ARCHETYPES:
        raise ApiError(422, "VALIDATION_FAILED", "不认识的性格")
    if payload.appearance is not None:
        payload.appearance = _without_color(payload.appearance)
        _validate_appearance(payload.appearance)
    new_name = None
    if payload.name is not None:
        new_name = " ".join(payload.name.split())
        if not 1 <= len(new_name) <= 12:
            raise ApiError(422, "VALIDATION_FAILED", "名字要 1 到 12 个字")

    with connect() as conn:
        current = _current(conn)
        if current is None:
            raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
        tone = payload.tone or current[1]
        appearance = dict(current[2])
        if payload.appearance is not None:
            for key, value in payload.appearance.items():
                if not owns_value(conn, key, value):
                    raise ApiError(402, "LOCKED", f"{value} 还没解锁")
            appearance.update(payload.appearance)
        conn.execute(
            """
            UPDATE companion_personas
            SET tone = %s, appearance = %s, name = COALESCE(%s, name)
            WHERE user_id = %s
              AND id = (
                SELECT id FROM companion_personas
                WHERE user_id = %s
                ORDER BY version DESC
                LIMIT 1
              )
            """,
            (tone, Jsonb(appearance), new_name, SEEDED_USER_ID, SEEDED_USER_ID),
        )
        _set_gender(conn, payload.user_gender)
        _set_nickname(conn, payload.user_nickname)
        set_user_tz(conn, payload.timezone)
        conn.commit()
        updated = _current(conn)
        gender = get_user_gender(conn)
        tz = user_tz_name(conn)
        nickname = get_user_nickname(conn)
    if updated is None:
        raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
    return _payload(updated, gender, tz, nickname)


def register_persona(app: FastAPI) -> None:
    app.include_router(router)


class OnboardingRequest(BaseModel):
    name: str
    tone: str | None = None  # 不再让用户选性格；旧客户端传了也只做兼容
    form: str = "buddy"
    color: str | None = None
    user_gender: str | None = None
    user_nickname: str | None = None
    timezone: str | None = None


@router.post("/onboarding")
def complete_onboarding(payload: OnboardingRequest, request: Request) -> dict:
    """相遇仪式：起名、选性子、选样子。首次选择的形态作为见面礼免费解锁。"""
    name = " ".join(payload.name.split())
    if not 1 <= len(name) <= 12:
        raise ApiError(422, "VALIDATION_FAILED", "名字要 1 到 12 个字")
    tone = payload.tone if payload.tone in TONE_ARCHETYPES else DEFAULT_TONE
    appearance_patch = {"form": payload.form}
    # 网页按形态带上配色；只接受老配色表里的值，其余忽略
    if payload.color in LEGACY_COLORS:
        appearance_patch["color"] = payload.color
    _validate_appearance(_without_color(appearance_patch))
    import uuid as _uuid

    with connect() as conn:
        current = _current(conn)
        if current is None:
            raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
        for key, value in appearance_patch.items():
            if not owns_value(conn, key, value):
                conn.execute(
                    "INSERT INTO purchases (id, user_id, item_id) VALUES (%s, %s, %s)",
                    (_uuid.uuid4(), SEEDED_USER_ID, f"{key}:{value}"),
                )
        appearance = dict(current[2])
        appearance.update(appearance_patch)
        conn.execute(
            """
            UPDATE companion_personas
            SET name = %s, tone = %s, appearance = %s
            WHERE user_id = %s
              AND id = (
                SELECT id FROM companion_personas
                WHERE user_id = %s ORDER BY version DESC LIMIT 1
              )
            """,
            (name, tone, Jsonb(appearance), SEEDED_USER_ID, SEEDED_USER_ID),
        )
        _set_gender(conn, payload.user_gender)
        _set_nickname(conn, payload.user_nickname)
        set_user_tz(conn, payload.timezone)
        conn.execute("UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = %s", (SEEDED_USER_ID,))
        conn.commit()
        updated = _current(conn)
        gender = get_user_gender(conn)
        tz = user_tz_name(conn)
        nickname = get_user_nickname(conn)
    return _payload(updated, gender, tz, nickname, True)
