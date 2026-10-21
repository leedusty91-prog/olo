"""人设、性格与外观：首次匹配时选，之后可以在「我的」里改。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel
from psycopg.types.json import Jsonb

from olo.context import TONE_ARCHETYPES
from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.shop import owns_value

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])

DEFAULT_APPEARANCE = {
    "color": "mint",
    "eyes": "circle",
    "cheeks": "blush",
    "hair": "none",
    "voice": "voice1",
    "form": "buddy",
}

APPEARANCE_OPTIONS = {
    "color": [
        {"id": "mint", "label": "薄荷"},
        {"id": "sky", "label": "天蓝"},
        {"id": "sun", "label": "暖黄"},
        {"id": "blush", "label": "樱粉"},
        {"id": "lavender", "label": "薰衣草"},
    ],
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
        {"id": "buddy", "label": "小团子"},
        {"id": "cloud", "label": "云朵形态"},
        {"id": "glow", "label": "微光形态"},
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
    ],
}


class PersonaRequest(BaseModel):
    name: str | None = None
    tone: str | None = None
    appearance: dict[str, str] | None = None


def _normalize_appearance(raw: object) -> dict[str, str]:
    merged = dict(DEFAULT_APPEARANCE)
    if isinstance(raw, dict):
        for key, value in raw.items():
            if key in DEFAULT_APPEARANCE and isinstance(value, str):
                merged[key] = value
    return merged


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


def _payload(current: tuple[str, str, dict[str, str]]) -> dict:
    name, tone, appearance = current
    return {
        "name": name,
        "tone": tone,
        "options": _options(),
        "appearance": appearance,
        "appearance_options": APPEARANCE_OPTIONS,
    }


@router.get("/persona")
def get_persona(request: Request) -> dict:
    with connect() as conn:
        current = _current(conn)
    if current is None:
        raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
    return _payload(current)


@router.put("/persona")
def put_persona(payload: PersonaRequest, request: Request) -> dict:
    if payload.tone is not None and payload.tone not in TONE_ARCHETYPES:
        raise ApiError(422, "VALIDATION_FAILED", "不认识的性格")
    if payload.appearance is not None:
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
        conn.commit()
        updated = _current(conn)
    if updated is None:
        raise ApiError(503, "PERSONA_UNAVAILABLE", "persona unavailable")
    return _payload(updated)


def register_persona(app: FastAPI) -> None:
    app.include_router(router)


class OnboardingRequest(BaseModel):
    name: str
    tone: str
    form: str = "buddy"
    color: str | None = None


@router.post("/onboarding")
def complete_onboarding(payload: OnboardingRequest, request: Request) -> dict:
    """相遇仪式：起名、选性子、选样子。首次选择的形态作为见面礼免费解锁。"""
    name = " ".join(payload.name.split())
    if not 1 <= len(name) <= 12:
        raise ApiError(422, "VALIDATION_FAILED", "名字要 1 到 12 个字")
    if payload.tone not in TONE_ARCHETYPES:
        raise ApiError(422, "VALIDATION_FAILED", "不认识的性格")
    appearance_patch = {"form": payload.form}
    if payload.color is not None:
        appearance_patch["color"] = payload.color
    _validate_appearance(appearance_patch)
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
            (name, payload.tone, Jsonb(appearance), SEEDED_USER_ID, SEEDED_USER_ID),
        )
        conn.commit()
        updated = _current(conn)
    return _payload(updated)
