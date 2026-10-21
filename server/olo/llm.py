import json
import os
import queue
import threading
from collections.abc import Iterator


def chat_completions_url() -> str:
    """Official OpenAI unless OPENAI_BASE_URL or OPENAI_API_BASE is set."""
    base = (
        os.environ.get("OPENAI_BASE_URL", "").strip()
        or os.environ.get("OPENAI_API_BASE", "").strip()
        or "https://api.openai.com/v1"
    )
    return base.rstrip("/") + "/chat/completions"


class OpenAIChat:
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key = api_key if api_key is not None else os.environ.get("OPENAI_API_KEY", "")
        self.model = (
            model
            or os.environ.get("OPENAI_MODEL", "").strip()
            or os.environ.get("OLO_MODEL", "").strip()
            or "gpt-4o-mini"
        )

    def stream(self, messages: list[dict]) -> Iterator[str]:
        import httpx

        with httpx.Client(timeout=30) as client:
            with client.stream(
                "POST",
                chat_completions_url(),
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "messages": messages, "stream": True},
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
