import threading

_lock = threading.Lock()
_turns: dict[tuple[str, str], int] = {}
_timeouts: dict[str, int] = {}
_ingests: dict[tuple[str, str], int] = {}
_ttft: list[float] = []
_rb_ms: list[float] = []
_warmup = 0

_TTFT_BUCKETS = (100, 500, 1500, 8000)
_RB_BUCKETS = (50, 134, 400, 1000)


def set_warmup(status: str) -> None:
    global _warmup
    mapping = {"warming": 0, "ready": 1, "failed": -1}
    with _lock:
        _warmup = mapping.get(status, 0)


def record_turn(modality: str, degraded: str | None) -> None:
    key = (modality, degraded or "none")
    with _lock:
        _turns[key] = _turns.get(key, 0) + 1


def record_timeout(lock_held: bool) -> None:
    key = "true" if lock_held else "false"
    with _lock:
        _timeouts[key] = _timeouts.get(key, 0) + 1


def record_ingest(decision: str, reason: str) -> None:
    key = (decision, reason)
    with _lock:
        _ingests[key] = _ingests.get(key, 0) + 1


def record_ttft(ms: float) -> None:
    with _lock:
        _ttft.append(ms)


def record_rb_ms(ms: float) -> None:
    with _lock:
        _rb_ms.append(ms)


def _histogram(name: str, values: list[float], buckets: tuple[int, ...]) -> list[str]:
    lines = [
        f"# HELP {name} milliseconds",
        f"# TYPE {name} histogram",
    ]
    for bound in buckets:
        count = sum(1 for value in values if value <= bound)
        lines.append(f'{name}_bucket{{le="{bound}"}} {count}')
    lines.append(f'{name}_bucket{{le="+Inf"}} {len(values)}')
    total = sum(values)
    lines.append(f"{name}_sum {total}")
    lines.append(f"{name}_count {len(values)}")
    return lines


def render() -> str:
    with _lock:
        lines = [
            "# HELP olo_up olo process is up.",
            "# TYPE olo_up gauge",
            "olo_up 1",
            "# HELP olo_voicemem_warmup warming=0 ready=1 failed=-1",
            "# TYPE olo_voicemem_warmup gauge",
            f"olo_voicemem_warmup {_warmup}",
        ]
        lines.append("# TYPE olo_turns_total counter")
        for (modality, degraded), count in sorted(_turns.items()):
            lines.append(
                f'olo_turns_total{{modality="{modality}",degraded="{degraded}"}} {count}'
            )
        lines.append("# TYPE olo_retrieval_timeout_total counter")
        for held, count in sorted(_timeouts.items()):
            lines.append(f'olo_retrieval_timeout_total{{lock_held="{held}"}} {count}')
        lines.append("# TYPE olo_ingest_total counter")
        for (decision, reason), count in sorted(_ingests.items()):
            lines.append(
                f'olo_ingest_total{{decision="{decision}",reason="{reason}"}} {count}'
            )
        lines.extend(_histogram("olo_llm_ttft_ms", list(_ttft), _TTFT_BUCKETS))
        lines.extend(_histogram("olo_search_rb_ms", list(_rb_ms), _RB_BUCKETS))
    return "\n".join(lines) + "\n"
