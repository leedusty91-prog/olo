from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class ClassificationView:
    slots: list[str]
    entities: list[str]


@dataclass
class Hit:
    text: str
    observed_at: str = ""


@dataclass
class RbHit:
    content: str


@dataclass
class SearchView:
    """Stand-in that satisfies build_memory_context and the trace fields."""

    hits: list = field(default_factory=list)
    rb_hits: list = field(default_factory=list)
    rb_directive: str = ""
    result_leftbrain: list = field(default_factory=list)
    result_rightbrain: list = field(default_factory=list)
    timing: dict = field(default_factory=dict)
    scene_directive: str = ""


@dataclass
class IngestResult:
    memory_ids: list = field(default_factory=list)
    speaker_id: str | None = None
    facts_count: int | None = None


@dataclass
class PerceptionView:
    emotion: str | None = None


class MemoryPort(Protocol):
    mode: str

    def classify(self, query: str) -> ClassificationView: ...

    def search(
        self,
        query: str,
        *,
        slots: list[str],
        entities: list[str],
        top_k: int = 5,
        emotion: str | None = None,
    ) -> SearchView: ...

    def remember_reply(self, user_text: str, assistant_text: str) -> None: ...

    def ingest_user(
        self,
        *,
        text: str,
        agent_reply: str,
        session_id: str,
        observed_at: str,
        audio_path: str | None = None,
    ) -> IngestResult:
        """No audio_path: ingest with speaker='user' and no audio.
        With audio_path: ingest with audio=path and no speaker keyword."""
        ...

    def transcribe(self, audio_path: str) -> str: ...

    def perceive(self, text: str, audio_path: str) -> PerceptionView: ...

    def flush(self) -> None: ...
