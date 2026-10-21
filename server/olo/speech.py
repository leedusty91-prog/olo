"""语音回复：把 assistant 文本合成为 mp3，文件落在 data/tts/。

与配图一样是 best-effort：失败返回 None，客户端安静地退回文字。
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 8 * 1024 * 1024
TIMEOUT_SECONDS = 30
DEFAULT_MODEL = "gpt-4o-mini-tts"
DEFAULT_VOICE = "alloy"
CJK = re.compile(r"[\u3400-\u9fff]")

# 性格 → 声音与语速。只影响表达，不影响人设。
TONE_VOICE = {
    "curious": ("alloy", 1.0),
    "calm": ("shimmer", 0.92),
    "playful": ("nova", 1.06),
}
TONE_SAY_RATE = {"calm": 150, "curious": 180, "playful": 205}
VOICE_SAY = {"voice1": "Meijia", "voice2": "Tingting"}
# say 的 -r 实际按几档生效（实测约 90/130/170/220 四档）。
RATE_STEPS = [90, 130, 170, 220]
FORM_DOWNGRADE = {"buddy": 0, "cloud": 1, "glow": 2}


def speech_url() -> str:
    base = (
        os.environ.get("OPENAI_BASE_URL", "").strip()
        or os.environ.get("OPENAI_API_BASE", "").strip()
        or "https://api.openai.com/v1"
    )
    return base.rstrip("/") + "/audio/speech"


def enabled() -> bool:
    if os.environ.get("OLO_TTS", "1") == "0":
        return False
    return "PYTEST_CURRENT_TEST" not in os.environ


def _detect_media(raw: bytes, content_type: str) -> str | None:
    if raw.startswith(b"ID3") or raw.startswith(b"\xff\xfb") or raw.startswith(b"\xff\xf3"):
        return "audio/mpeg"
    if raw.startswith(b"RIFF"):
        return "audio/wav"
    if content_type.startswith("audio/"):
        return content_type.split(";")[0]
    return None


def synthesize(
    text: str, tone: str | None = None, voice: str | None = None, form: str | None = None
) -> tuple[bytes, str] | None:
    """先试远端 TTS，失败后回落到本机 `say`（仅 macOS）。

    tone 决定语速与远端音色；voice（外观里的声音 1/2）决定本机音色；
    form（形态）在本机 TTS 上再轻微调整语速。
    """
    result = _synthesize_api(text, tone)
    if result is None:
        result = synthesize_local(text, tone, voice, form)
    return result


def _synthesize_api(text: str, tone: str | None = None) -> tuple[bytes, str] | None:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key or not enabled() or not text.strip():
        return None

    tone_voice, tone_speed = TONE_VOICE.get(tone or "", (DEFAULT_VOICE, 1.0))
    model = os.environ.get("OPENAI_TTS_MODEL", DEFAULT_MODEL)
    payload = {
        "model": model,
        "voice": os.environ.get("OPENAI_TTS_VOICE", tone_voice),
        "input": text[:2000],
        "response_format": "mp3",
    }
    # speed 只对 tts-1 系列和显式配置安全；其它模型忽略，避免 400。
    if model.startswith("tts-") or os.environ.get("OPENAI_TTS_SPEED", "").strip():
        payload["speed"] = float(os.environ.get("OPENAI_TTS_SPEED", tone_speed))
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            response = client.post(
                speech_url(),
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
            response.raise_for_status()
            raw = response.content
            content_type = response.headers.get("content-type", "")
    except Exception as exc:
        logger.warning("tts failed: %s", type(exc).__name__)
        return None

    if not raw or len(raw) > MAX_AUDIO_BYTES:
        return None
    media_type = _detect_media(raw, content_type)
    if media_type is None:
        logger.warning("tts returned unsupported bytes")
        return None
    return raw, media_type


def local_enabled() -> bool:
    return (
        os.environ.get("OLO_TTS_LOCAL", "1") != "0"
        and sys.platform == "darwin"
        and shutil.which("say") is not None
        and shutil.which("afconvert") is not None
    )


def synthesize_local(
    text: str, tone: str | None = None, voice: str | None = None, form: str | None = None
) -> tuple[bytes, str] | None:
    """macOS 自带 TTS 兜底：say → aiff → afconvert → 22050Hz wav。"""
    if not text.strip() or not local_enabled():
        return None
    voice = (
        os.environ.get("OLO_SAY_VOICE", "").strip()
        or VOICE_SAY.get(voice or "", "")
    )
    if not voice and CJK.search(text):
        voice = "Meijia"
    rate = os.environ.get("OLO_SAY_RATE", "").strip()
    if not rate:
        base = TONE_SAY_RATE.get(tone or "", 180)
        step = 0 if base <= 100 else 1 if base <= 150 else 2 if base <= 180 else 3
        step = max(0, step - FORM_DOWNGRADE.get(form or "buddy", 0))
        rate = str(RATE_STEPS[step])
    with tempfile.TemporaryDirectory(prefix="olo-tts-") as tmp:
        aiff = Path(tmp) / "speech.aiff"
        wav = Path(tmp) / "speech.wav"
        command = ["say", "-o", str(aiff)]
        if rate:
            command.extend(["-r", str(rate)])
        if voice:
            command.extend(["-v", voice])
        command.append(text[:2000])
        try:
            subprocess.run(command, check=True, timeout=TIMEOUT_SECONDS, capture_output=True)
            subprocess.run(
                ["afconvert", "-f", "WAVE", "-d", "LEI16@22050", str(aiff), str(wav)],
                check=True,
                timeout=TIMEOUT_SECONDS,
                capture_output=True,
            )
            data = wav.read_bytes()
        except (subprocess.SubprocessError, OSError) as exc:
            logger.warning("local tts failed: %s", type(exc).__name__)
            return None
    if not data.startswith(b"RIFF") or len(data) > MAX_AUDIO_BYTES:
        return None
    return data, "audio/wav"


def audio_id() -> str:
    return uuid.uuid4().hex
