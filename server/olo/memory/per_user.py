"""Route memory calls to the current user's own store (olo.userctx).

The seeded user keeps the original store untouched; every other user gets a store
built by ``factory(user_id)`` (for VoiceMem: its own directory, so Qdrant files never
mix). A small LRU keeps memory use bounded.
"""
import threading
import uuid
from collections import OrderedDict
from collections.abc import Callable

from olo.userctx import SEEDED_USER_ID, current_user_id


class PerUserMemory:
    def __init__(self, default: object, factory: Callable[[uuid.UUID], object], max_open: int = 8,
                 wipe: Callable[[uuid.UUID, object], None] | None = None) -> None:
        self._default = default
        self._factory = factory
        self._wipe = wipe
        self._max = max_open
        self._open: OrderedDict[uuid.UUID, object] = OrderedDict()
        self._lock = threading.Lock()

    def for_user(self, user_id: uuid.UUID) -> object:
        if user_id == SEEDED_USER_ID:
            return self._default
        with self._lock:
            mem = self._open.get(user_id)
            if mem is None:
                mem = self._factory(user_id)
                self._open[user_id] = mem
                while len(self._open) > self._max:
                    self._open.popitem(last=False)
            self._open.move_to_end(user_id)
            return mem

    def wipe_user(self, user_id: uuid.UUID) -> None:
        """Erase every memory of user_id (account deletion)."""
        mem = self.for_user(user_id)
        if self._wipe is not None:
            self._wipe(user_id, mem)
        else:
            for row in list(mem.list_memories()):
                mem.delete_memory(row["id"])
        with self._lock:
            self._open.pop(user_id, None)

    def __getattr__(self, name: str):
        return getattr(self.for_user(current_user_id()), name)
