"""流式 ASR 的可注入骨架（WebSocket 版）。

真正的流式 ASR（VoiceMem/Whisper）还没接；这里先固化协议：
- 客户端连 `ws(s)://host/v1/asr/stream`，带 `Authorization: Bearer <token>`；
- 每个音频 chunk 用二进制帧发送，服务端回 `{"type":"partial","text":...}`；
- 客户端发文本帧 `end`（或关闭）后，服务端回 `final` 并关闭。

`OLO_DEMO=1` 时用 FakeStreamingAsr 把 chunk 当 UTF-8 文本拼起来，移动端后续
可以按住说话实时出字。
"""

from __future__ import annotations

import asyncio
import hmac
import os

from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect

from olo.sessions import ApiError

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_CHUNKS = 4096

router = APIRouter(prefix="/v1")


class StreamingAsr:
    def feed(self, chunk: bytes) -> str | None:  # pragma: no cover - 接口定义
        raise NotImplementedError

    def finish(self) -> str:  # pragma: no cover - 接口定义
        raise NotImplementedError


class FakeStreamingAsr(StreamingAsr):
    """把 chunk 按 UTF-8 文本拼接，用于演示和测试。"""

    def __init__(self) -> None:
        self.parts: list[str] = []

    def feed(self, chunk: bytes) -> str | None:
        text = chunk.decode("utf-8", "ignore")
        if not text:
            return None
        self.parts.append(text)
        return "".join(self.parts)

    def finish(self) -> str:
        return "".join(self.parts)


def _token_ok(presented: str) -> bool:
    expected = os.environ.get("OLO_API_TOKEN", "").strip()
    if not expected or not presented:
        return False
    try:
        return hmac.compare_digest(
            presented.encode("utf-8"), expected.encode("utf-8")
        )
    except UnicodeEncodeError:
        return False


def _bearer(value: str | None) -> str:
    if not value:
        return ""
    scheme, separator, rest = value.partition(" ")
    if separator != " " or scheme.lower() != "bearer":
        return ""
    token = rest.strip()
    return token if token and " " not in token else ""


def _runtime(websocket: WebSocket):
    runtime = getattr(websocket.app.state, "runtime", None)
    if runtime is None:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "runtime is not ready")
    return runtime


@router.websocket("/asr/stream")
async def ws_asr(websocket: WebSocket) -> None:
    await websocket.accept()
    if not _token_ok(_bearer(websocket.headers.get("authorization"))):
        await websocket.send_json({"type": "error", "code": "UNAUTHORIZED"})
        await websocket.close(code=4401)
        return

    try:
        runtime = _runtime(websocket)
    except ApiError:
        await websocket.send_json({"type": "error", "code": "RUNTIME_UNAVAILABLE"})
        await websocket.close(code=1011)
        return

    factory = getattr(runtime, "asr_factory", None)
    if factory is None:
        await websocket.send_json({"type": "error", "code": "ASR_UNAVAILABLE"})
        await websocket.close(code=1011)
        return

    provider = factory()
    total = 0
    count = 0
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                return
            text = message.get("text")
            if text is not None:
                if text.strip() == "end":
                    break
                continue
            chunk = message.get("bytes") or b""
            if not chunk:
                continue
            total += len(chunk)
            count += 1
            if total > MAX_AUDIO_BYTES or count > MAX_CHUNKS:
                await websocket.send_json(
                    {"type": "error", "code": "AUDIO_TOO_LARGE", "message": "语音太长了"}
                )
                await websocket.close(code=1009)
                return
            partial = await asyncio.to_thread(provider.feed, chunk)
            if partial:
                await websocket.send_json({"type": "partial", "text": partial})
        final = await asyncio.to_thread(provider.finish)
        await websocket.send_json({"type": "final", "text": final})
        await websocket.close()
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await websocket.send_json(
                {"type": "error", "code": "ASR_FAILED", "message": "转写失败"}
            )
            await websocket.close(code=1011)
        except Exception:
            pass


def register_asr(app: FastAPI) -> None:
    app.include_router(router)
