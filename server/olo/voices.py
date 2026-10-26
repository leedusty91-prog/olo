"""TTS 端点：POST 合成、GET 播放。文件按 id 落盘，客户端带 Bearer 取音频。"""

from __future__ import annotations

from olo.userctx import current_user_id
from olo.forms import FORMS
import os
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from olo.db import connect
from olo.sessions import SEEDED_USER_ID, ApiError, require_bearer
from olo.speech import audio_id, synthesize

router = APIRouter(prefix="/v1", dependencies=[Depends(require_bearer)])

REPO_ROOT = Path(__file__).resolve().parents[2]
SUFFIX_BY_MEDIA = {"audio/mpeg": ".mp3", "audio/wav": ".wav"}
MEDIA_BY_SUFFIX = {value: key for key, value in SUFFIX_BY_MEDIA.items()}
AUDIO_ID = re.compile(r"^[0-9a-f]{32}$")


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def tts_dir() -> Path:
    override = os.environ.get("OLO_TTS_DIR", "").strip()
    return Path(override) if override else REPO_ROOT / "data" / "tts"


def _runtime(request: Request):
    runtime = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "runtime is not ready")
    return runtime


def persona_audio_profile() -> tuple[str, str, str]:
    """读当前人设的（性格, 外观声音, 形态）；读不到就按默认值，绝不让语音因此失败。"""
    tone, voice, form = "curious", "voice1", "buddy"
    try:
        with connect() as conn:
            row = conn.execute(
                """
                SELECT tone, appearance FROM companion_personas
                WHERE user_id = %s
                ORDER BY version DESC
                LIMIT 1
                """,
                (current_user_id(),),
            ).fetchone()
    except Exception:
        return tone, voice, form
    if row is None:
        return tone, voice, form
    if row[0]:
        tone = row[0]
    appearance = row[1] if isinstance(row[1], dict) else {}
    if appearance.get("voice") in {"voice1", "voice2"}:
        voice = appearance["voice"]
    if appearance.get("form") in FORMS:
        form = appearance["form"]
    return tone, voice, form


def _synthesize(
    runtime, text: str, tone: str, voice: str, form: str
) -> tuple[bytes, str] | None:
    generator = getattr(runtime, "tts_generator", None) or synthesize
    try:
        return generator(text, tone, voice, form)
    except Exception as exc:
        import logging

        logging.getLogger(__name__).warning("tts generator failed: %s", type(exc).__name__)
        return None


@router.post("/speech")
def post_speech(request: Request, payload: SpeakRequest) -> JSONResponse:
    runtime = _runtime(request)
    tone, voice, form = persona_audio_profile()
    result = _synthesize(runtime, payload.text.strip(), tone, voice, form)
    if result is None:
        # 没配置 / 暂时合成不了：安静退回文字（200 + available:false），不让客户端控制台报 503
        return JSONResponse(status_code=200, content={"id": None, "url": None, "media_type": None, "available": False})
    data, media_type = result
    suffix = SUFFIX_BY_MEDIA.get(media_type)
    if suffix is None:
        raise ApiError(503, "TTS_UNAVAILABLE", "语音格式不支持")

    identifier = audio_id()
    path = tts_dir() / f"{identifier}{suffix}"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError as exc:
        raise ApiError(503, "TTS_UNAVAILABLE", "语音写入失败") from exc

    return JSONResponse(
        status_code=201,
        content={
            "id": identifier,
            "url": f"/v1/speech/{identifier}",
            "media_type": media_type,
            "available": True,
        },
    )


@router.get("/speech/{identifier}")
def get_speech(identifier: str, request: Request) -> FileResponse:
    if AUDIO_ID.fullmatch(identifier) is None:
        raise ApiError(404, "NOT_FOUND", "没有这段语音")
    directory = tts_dir()
    matches = [directory / f"{identifier}{suffix}" for suffix in SUFFIX_BY_MEDIA.values()]
    path = next((item for item in matches if item.is_file()), None)
    if path is None:
        raise ApiError(404, "NOT_FOUND", "没有这段语音")
    return FileResponse(path, media_type=MEDIA_BY_SUFFIX[path.suffix])


@router.get("/messages/{message_id}/audio")
def get_message_audio(message_id: uuid.UUID, request: Request) -> FileResponse:
    with connect() as conn:
        row = conn.execute(
            "SELECT audio_relpath FROM messages WHERE id = %s",
            (message_id,),
        ).fetchone()
    if row is None or not row[0]:
        raise ApiError(404, "NOT_FOUND", "这条消息没有语音")
    stored = Path(row[0])
    path = stored if stored.is_absolute() else REPO_ROOT / stored
    if not path.is_file():
        raise ApiError(404, "NOT_FOUND", "语音文件不存在")
    media_type = MEDIA_BY_SUFFIX.get(path.suffix.lower())
    if media_type is None:
        raise ApiError(404, "NOT_FOUND", "语音格式不支持")
    return FileResponse(path, media_type=media_type)


def register_voices(app: FastAPI) -> None:
    app.include_router(router)
