"""离线演示模式：没有 OpenAI / 代理时也能跑通对话、日记、洞察。

`OLO_DEMO=1` 时 main 用这里的 DemoChat 代替 OpenAIChat；回复是固定的
olo 风格模板，日记/洞察按同一套 JSON 契约返回，方便前端联调和演示。
"""

from __future__ import annotations

import json

NOTEBOOK_FIELDS = ("title", "body", "image_prompt", "mood")
INSIGHT_FIELDS = ("category", "body")


def _last_user(messages: list[dict]) -> str:
    for item in reversed(messages):
        if item.get("role") == "user":
            return str(item.get("content", ""))
    return ""


def _system_text(messages: list[dict]) -> str:
    return "\n".join(
        str(item.get("content", ""))
        for item in messages
        if item.get("role") == "system"
    )


def _snippet(text: str, limit: int = 14) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        return "这件事"
    return cleaned if len(cleaned) <= limit else cleaned[-limit:]


class DemoChat:
    """一个确定性的 LLM 替身：同一输入总得到同一输出，便于演示和排查。"""

    def __init__(self, chunk_size: int = 8) -> None:
        self.chunk_size = max(1, chunk_size)

    def stream(self, messages: list[dict]):
        system = _system_text(messages)
        user = _last_user(messages)

        if "只输出 JSON" in system and "日记" in system:
            payload = {
                "title": "今天的一点重量",
                "body": (
                    f"我把你今天说的「{_snippet(user, 18)}」记下来了。"
                    "你没有急着解释，也没有把它说得很严重，但我知道它一直在那儿。"
                    "明天要是还想说，我还在。"
                ),
                "image_prompt": "a quiet desk at dusk, warm lamp, an open notebook",
                "mood": "tender",
            }
            yield json.dumps(payload, ensure_ascii=False)
            return

        if "只输出 JSON" in system and "观察" in system:
            payload = {
                "category": "wellbeing",
                "body": f"你会把「{_snippet(user, 10)}」先自己扛一会儿。",
            }
            yield json.dumps(payload, ensure_ascii=False)
            return

        reply = self._reply(user)
        for index in range(0, len(reply), self.chunk_size):
            yield reply[index : index + self.chunk_size]

    def _reply(self, user: str) -> str:
        snippet = _snippet(user)
        templates = [
            f"我在。你刚才说「{snippet}」，想先从哪一部分说起？",
            f"嗯，我听着。你说「{snippet}」的时候，声音里像还压着点别的。",
            f"先不急着解决。{snippet}，今天最让你难受的是哪一刻？",
        ]
        return templates[len(user.strip()) % len(templates)]


def make_demo_runtime():
    """供 main 在 OLO_DEMO=1 时构造一个不需要外部服务的运行时。"""
    from olo.asr import FakeStreamingAsr
    from olo.memory.fake import FakeMemory
    from olo.memory.io_lock import VoicememIoLock
    from olo.runtime import Runtime

    return Runtime(
        memory=FakeMemory(),
        io_lock=VoicememIoLock(),
        llm=DemoChat(),
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
        asr_factory=FakeStreamingAsr,
    )
