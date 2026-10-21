"""Notebook 配图：调用 OpenAI 兼容的 Images API，失败时安静降级为纯文本卡片。

设计约束：
- 只在真实运行时启用；pytest 进程默认关闭，测试通过注入假生成器覆盖。
- 输出必须是 PNG/JPEG 且不超过 8 MB，否则丢弃。
- 任何失败都只记日志，不阻塞日记写入。
"""

from __future__ import annotations

import base64
import logging
import os

import httpx

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 8 * 1024 * 1024
TIMEOUT_SECONDS = 60
DEFAULT_MODEL = "gpt-image-1"


def images_url() -> str:
    base = (
        os.environ.get("OPENAI_BASE_URL", "").strip()
        or os.environ.get("OPENAI_API_BASE", "").strip()
        or "https://api.openai.com/v1"
    )
    return base.rstrip("/") + "/images/generations"


def enabled() -> bool:
    if os.environ.get("OLO_NOTEBOOK_IMAGES", "1") == "0":
        return False
    # 测试里不发起真实网络请求；需要图片时注入 runtime.image_generator。
    return "PYTEST_CURRENT_TEST" not in os.environ


def _detect_media(raw: bytes) -> str | None:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def generate_image(prompt: str) -> tuple[bytes, str] | None:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key or not enabled():
        return None

    model = os.environ.get("OPENAI_IMAGE_MODEL", DEFAULT_MODEL)
    size = os.environ.get("OPENAI_IMAGE_SIZE", "1024x1024")
    payload = {
        "model": model,
        "prompt": prompt[:1000],
        "n": 1,
        "size": size,
    }
    raw = b""
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
            response = client.post(
                images_url(),
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json().get("data") or []
            if not data:
                return None
            item = data[0]
            if isinstance(item.get("b64_json"), str):
                raw = base64.b64decode(item["b64_json"])
            elif isinstance(item.get("url"), str):
                image = client.get(item["url"], timeout=TIMEOUT_SECONDS)
                image.raise_for_status()
                raw = image.content
            else:
                return None
    except Exception as exc:  # 网络、鉴权、配额、格式都可能
        logger.warning("notebook image failed: %s", type(exc).__name__)
        return None

    if not raw or len(raw) > MAX_IMAGE_BYTES:
        return None
    media_type = _detect_media(raw)
    if media_type is None:
        logger.warning("notebook image rejected: unsupported bytes")
        return None
    return raw, media_type
