"""Wrap one mode=normal VoiceMem. Do not construct VoiceMem in tests."""
import os

from olo.models import memory_model

from olo.memory.fake import ingest_call_kwargs
from olo.memory.port import ClassificationView, IngestResult, PerceptionView

SEEDED_USER_ID = "00000000-0000-4000-8000-000000000001"


def build_config(
    api_key: str,
    user_id: str = SEEDED_USER_ID,
    base_url: str | None = None,
) -> dict:
    config = {
        "mode": "normal",
        "api_key": api_key,
        "top_k": 5,
        "space": "demo",
        "user_id": user_id,
        "memory_language": "zh",
        "embedding": {"provider": "local"},
        "slots": {"provider": "local"},
        "llm": {"provider": "openai", "config": {"model": os.environ.get("VOICEMEM_LLM_MODEL") or memory_model()}},
    }
    cleaned = (base_url or "").strip()
    if cleaned:
        config["base_url"] = cleaned
        config["llm"]["config"]["base_url"] = cleaned
    return config


class VoiceMemAdapter:
    def __init__(self, vm: object) -> None:
        self._vm = vm

    @property
    def mode(self) -> str:
        raw = getattr(self._vm, "mode", "multi_modal")
        if raw in {"normal", "multi_modal"}:
            return "multi_modal"
        return str(raw)

    def classify(self, query: str) -> ClassificationView:
        found = self._vm.Classify(query)  # type: ignore[attr-defined]
        return ClassificationView(
            slots=list(getattr(found, "slots", []) or []),
            entities=list(getattr(found, "entities", []) or []),
        )

    def search(
        self,
        query: str,
        *,
        slots: list[str],
        entities: list[str],
        top_k: int = 5,
        emotion: str | None = None,
    ):
        kwargs: dict = {"slots": slots, "entities": entities, "top_k": top_k}
        if emotion is not None:
            kwargs["emotion"] = emotion
        return self._vm.search(query, **kwargs)  # type: ignore[attr-defined]

    def remember_reply(self, user_text: str, assistant_text: str) -> None:
        self._vm.remember_reply(user_text, assistant_text)  # type: ignore[attr-defined]

    def ingest_user(
        self,
        *,
        text: str,
        agent_reply: str,
        session_id: str,
        observed_at: str,
        audio_path: str | None = None,
    ) -> IngestResult:
        recorded = ingest_call_kwargs(
            text=text,
            agent_reply=agent_reply,
            session_id=session_id,
            observed_at=observed_at,
            audio_path=audio_path,
        )
        raw = self._vm.ingest(**recorded)  # type: ignore[attr-defined]
        return _ingest_result(raw)

    def transcribe(self, audio_path: str) -> str:
        return self._vm.transcribe(audio_path)  # type: ignore[attr-defined]

    def perceive(self, text: str, audio_path: str) -> PerceptionView:
        raw = self._vm.preprocess(text, audio=audio_path)  # type: ignore[attr-defined]
        emotion = getattr(raw, "emotion", None) or getattr(raw, "emotion_label", None)
        if emotion is not None:
            emotion = str(emotion)
        return PerceptionView(emotion=emotion)

    def flush(self) -> None:
        self._vm.flush()  # type: ignore[attr-defined]


def _ingest_result(raw: object) -> IngestResult:
    if raw is None:
        return IngestResult()
    if isinstance(raw, dict):
        return IngestResult(
            memory_ids=list(raw.get("memory_ids") or []),
            speaker_id=raw.get("speaker_id"),
            facts_count=raw.get("facts_count"),
        )
    return IngestResult(
        memory_ids=list(getattr(raw, "memory_ids", []) or []),
        speaker_id=getattr(raw, "speaker_id", None),
        facts_count=getattr(raw, "facts_count", None),
    )
