"""离线演示模式：没有 OpenAI / 代理时也能跑通对话、日记、洞察。

`OLO_DEMO=1` 时 main 用这里的 DemoChat 代替 OpenAIChat；回复是固定的
olo 风格模板，日记/洞察按同一套 JSON 契约返回，方便前端联调和演示。
"""

from __future__ import annotations

import json
import re

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


def _last_user_line(text: str) -> str:
    """日记 prompt 里是整段对话记录，取最后一句用户说的话。"""
    lines = [line[3:] for line in text.splitlines() if line.startswith("用户：")]
    return lines[-1] if lines else text


class DemoChat:
    """一个确定性的 LLM 替身：同一输入总得到同一输出，便于演示和排查。"""

    def __init__(self, chunk_size: int = 8) -> None:
        self.chunk_size = max(1, chunk_size)

    def stream(self, messages: list[dict]):
        system = _system_text(messages)
        user = _last_user(messages)

        if "只输出 JSON" in system and "明信片" in system:
            place = user.replace("这次去的是：", "").strip("。 ") or "外面"
            payload = {
                "title": f"{place[:8]} · 傍晚",
                "story": f"我在{place[:8]}看见一片被风吹得打转的叶子，追了它好久。最后它停在我脚边，好像在说你该回家啦。",
            }
            yield json.dumps(payload, ensure_ascii=False)
            return

        if "只输出 JSON" in system and "日记" in system:
            payload = {
                "title": "花园里又下雨了",
                "body": (
                    "今天花园里又落了好几滴雨。有一句话我一直记着：\n\n【原话】\n\n"
                    "听到的时候我心里紧了一下，好想问问后来怎么样了，又怕问得太急。"
                    "我一直在旁边认真听着。明天要是还想说，我还在这儿亮着。"
                ),
                "quote_index": 0 if "\n0. " in user else None,
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

        reply = self._reply(user, system)
        for index in range(0, len(reply), self.chunk_size):
            yield reply[index : index + self.chunk_size]

    def _reply(self, user: str, system: str = "") -> str:
        snippet = _snippet(user)
        name = "olo"
        match = re.search(r"用户给你取的名字是「([^」]+)」", system)
        if match:
            name = match.group(1)
        text = user.strip()
        if any(w in text for w in ("你是谁", "你叫什么", "你从哪", "哪里来")):
            return (
                f"我是{name}，一颗灯籽。||渡灯翁撑着小船从雾里集把我送来的，"
                "船底下全是雾，摇起来像在划棉花糖。||你呢，今天过得怎么样？"
            )
        if any(w in text for w in ("你好", "嗨", "hi", "hello", "在吗")):
            return f"我在呢！今天想从哪件小事说起？"
        templates = [
            f"我在。你刚才说「{snippet}」，花园里像落了好大一滴雨。想先从哪一部分说起？",
            f"嗯，我听着。说「{snippet}」的时候，心里是不是还压着点别的？",
            f"先不急着解决。{snippet}……今天最让你难受的是哪一刻？",
        ]
        if "安静" in system and "句子短" in system:
            templates = [f"嗯。我在。{snippet}，慢慢说。", f"我听见了。{snippet}。", "我陪着你，不急。"]
        elif "轻轻损" in system:
            templates = [
                f"哟，「{snippet}」？这雨下得有点大啊。好啦，认真听你说，怎么回事？",
                f"我听得一愣一愣的。{snippet}，然后呢？",
            ]
        return templates[len(text) % len(templates)]


def make_demo_runtime():
    """供 main 在 OLO_DEMO=1 时构造一个不需要外部服务的运行时。"""
    from olo.asr import FakeStreamingAsr
    from olo.memory.fake import FakeMemory
    from olo.memory.per_user import PerUserMemory
    from olo.memory.io_lock import VoicememIoLock
    from olo.runtime import Runtime

    return Runtime(
        memory=PerUserMemory(FakeMemory(), lambda _uid: FakeMemory()),
        io_lock=VoicememIoLock(),
        llm=DemoChat(),
        voicemem_status="ready",
        rate_limit_per_minute=10_000,
        asr_factory=FakeStreamingAsr,
    )
