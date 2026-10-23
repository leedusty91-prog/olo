import json
import os
import queue
import threading
from collections.abc import Iterator


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def chat_completions_url() -> str:
    """Chat endpoint: CHAT_BASE_URL, else OPENAI_BASE_URL/OPENAI_API_BASE, else OpenAI.

    CHAT_* lets the reply model live on a different provider (e.g. DeepSeek)
    while VoiceMem memory keeps using OPENAI_* (e.g. Qwen on DashScope).
    """
    base = (
        _env("CHAT_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL", "").strip()
        or os.environ.get("OPENAI_API_BASE", "").strip()
        or "https://api.openai.com/v1"
    )
    return base.rstrip("/") + "/chat/completions"


class OpenAIChat:
    def __init__(self, api_key: str | None = None, model: str | None = None, purpose: str = "chat") -> None:
        self.purpose = purpose
        self.api_key = api_key if api_key is not None else (_env("CHAT_API_KEY") or _env("OPENAI_API_KEY"))
        self.model = (
            model
            or _env("CHAT_MODEL")
            or os.environ.get("OPENAI_MODEL", "").strip()
            or os.environ.get("OLO_MODEL", "").strip()
            or "gpt-4o-mini"
        )

    @property
    def aux(self) -> "OpenAIChat":
        """Same model/key for background jobs (diary, insights, proactive)."""
        return OpenAIChat(api_key=self.api_key, model=self.model, purpose="aux")

    def body(self, messages: list[dict]) -> dict:
        body = {"model": self.model, "messages": messages, "stream": True}
        # DeepSeek thinking: on for chat replies (better follow-ups), off for
        # background jobs (cheaper). OLO_CHAT_THINKING / OLO_AUX_THINKING override.
        if "deepseek" in chat_completions_url() or self.model.startswith("deepseek"):
            if self.purpose == "chat":
                mode = _env("OLO_CHAT_THINKING") or "enabled"
            else:
                mode = _env("OLO_AUX_THINKING") or "disabled"
            body["thinking"] = {"type": mode}
        return body

    def stream(self, messages: list[dict]) -> Iterator[str]:
        import httpx

        with httpx.Client(timeout=30) as client:
            with client.stream(
                "POST",
                chat_completions_url(),
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=self.body(messages),
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    payload = json.loads(data)
                    delta = payload["choices"][0].get("delta", {}).get("content") or ""
                    if delta:
                        yield delta


def iter_first_token(stream: Iterator[str], timeout_s: float) -> Iterator[str] | None:
    """Yield tokens, or return None if the first token misses the deadline."""
    sentinel = object()
    box: queue.Queue = queue.Queue()

    def pump() -> None:
        try:
            for piece in stream:
                box.put(piece)
            box.put(sentinel)
        except Exception as exc:
            box.put(exc)

    threading.Thread(target=pump, name="olo-llm", daemon=True).start()
    try:
        first = box.get(timeout=timeout_s)
    except queue.Empty:
        return None
    if isinstance(first, BaseException):
        raise first

    def generate() -> Iterator[str]:
        if first is not sentinel:
            yield first
        while True:
            item = box.get()
            if item is sentinel:
                return
            if isinstance(item, BaseException):
                raise item
            yield item

    return generate()
