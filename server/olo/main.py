import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from olo.asr import register_asr
from olo.canon import register_canon
from olo.chapters import register_chapters
from olo.checkins import register_check_ins
from olo.consolidate import register_consolidate
from olo.db import connect, load_dotenv
from olo.metrics import render as render_metrics
from olo.metrics import set_warmup
from olo.notebook import register_notebook
from olo.persona import register_persona
from olo.proactive import register_proactive
from olo.shop import register_shop
from olo.garden import register_garden
from olo.mood import register_mood
from olo.runtime import testing_disabled_runtime
from olo.sessions import register_sessions
from olo.subscription import register_subscription
from olo.turns import register_turns
from olo.voices import register_voices

# server/olo/main.py lives two levels under the repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CERT_FILE = Path(os.environ.get("OLO_TLS_CERT", str(REPO_ROOT / "data" / "certs" / "cert.pem")))
DEFAULT_KEY_FILE = Path(os.environ.get("OLO_TLS_KEY", str(REPO_ROOT / "data" / "certs" / "key.pem")))
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1"})
METRICS_BODY = (
    "# HELP olo_up olo process is up.\n"
    "# TYPE olo_up gauge\n"
    "olo_up 1\n"
)


def demo_mode() -> bool:
    """Offline mode: deterministic mock LLM, no API key, no VoiceMem."""
    if os.environ.get("OLO_DEMO", "0") == "1":
        return True
    return os.environ.get("LLM_PROVIDER", "").strip().lower() in {"mock", "offline", "demo"}


def tls_required() -> bool:
    """TLS is opt-in (OLO_TLS=1). Behind docker / a reverse proxy, plain HTTP is fine."""
    return os.environ.get("OLO_TLS", "0") == "1"


def require_startup() -> None:
    missing: list[str] = []
    if not demo_mode() and not os.environ.get("OPENAI_API_KEY", "").strip():
        missing.append("OPENAI_API_KEY")
    if not os.environ.get("OLO_API_TOKEN", "").strip():
        missing.append("OLO_API_TOKEN")
    if tls_required() and (not DEFAULT_CERT_FILE.is_file() or not DEFAULT_KEY_FILE.is_file()):
        missing.append("TLS cert pair")
    if missing:
        names = ", ".join(missing)
        raise SystemExit(f"refusing to start, missing {names}")


def postgres_reachable() -> bool:
    try:
        with connect() as conn:
            conn.execute("SELECT 1")
    except Exception:
        return False
    return True


load_dotenv(REPO_ROOT / ".env")


def readyz_payload() -> dict:
    reachable = postgres_reachable()
    runtime = getattr(app.state, "runtime", None)
    status = getattr(runtime, "voicemem_status", "warming")
    failed = list(getattr(runtime, "warmup_failed", []) or [])
    set_warmup(status)
    return {
        "postgres": reachable,
        "voicemem": status,
        "warmup_failed": failed,
        "openai_key_present": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
    }


def _under_test() -> bool:
    return "PYTEST_CURRENT_TEST" in os.environ or os.environ.get("OLO_TESTING") == "1"


def _memory_enabled() -> bool:
    from olo.memory.voicemem_api import memory_backend

    return memory_backend() != "off"


def _check_ins_enabled() -> bool:
    return os.environ.get("OLO_CHECKINS", "1") != "0"


def _start_check_ins(runtime=None) -> object:
    import logging
    import threading
    import time

    from olo import consolidate, notebook, proactive
    from olo.checkins import process_due_once

    stop = threading.Event()
    log = logging.getLogger(__name__)
    # A proactive attempt that reaches the model and gets "nothing to ask"
    # backs off, so the minute tick never turns into a model call per minute.
    retry_s = float(os.environ.get("OLO_CHECKIN_RETRY_MIN") or 60) * 60
    next_proactive = [0.0]

    def loop() -> None:
        while not stop.wait(60):
            try:
                process_due_once()
            except Exception as exc:
                log.warning("check-in tick failed: %s", type(exc).__name__)
            if time.monotonic() >= next_proactive[0]:
                try:
                    result = proactive.tick(runtime)
                    if result.get("sent") or result.get("reason") in {"nothing_to_ask", "llm_error"}:
                        next_proactive[0] = time.monotonic() + retry_s
                except Exception as exc:
                    log.warning("proactive tick failed: %s", type(exc).__name__)
            try:
                notebook.nightly_tick(runtime)
            except Exception as exc:
                log.warning("nightly diary tick failed: %s", type(exc).__name__)
            try:
                consolidate.tick(runtime)
            except Exception as exc:
                log.warning("consolidation tick failed: %s", type(exc).__name__)

    threading.Thread(target=loop, name="olo-checkins", daemon=True).start()
    return stop.set


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Uvicorn runs lifespan before bind. Missing secrets or certs must not listen.
    require_startup()
    if not hasattr(_app.state, "runtime"):
        if demo_mode():
            from olo.demo import make_demo_runtime

            _app.state.runtime = make_demo_runtime()
        else:
            runtime = testing_disabled_runtime()
            if not _memory_enabled():
                runtime.voicemem_status = "failed"
            elif not _under_test():
                runtime.voicemem_status = _start_memory(runtime)
            _app.state.runtime = runtime
    if not _under_test() and _check_ins_enabled():
        _app.state.stop_check_ins = _start_check_ins(_app.state.runtime)
    try:
        yield
    finally:
        runtime = getattr(_app.state, "runtime", None)
        if runtime is not None:
            runtime.ingest.drain(timeout=15)
            stopper = getattr(runtime, "stop_housekeeping", None)
            if stopper is not None:
                stopper()
            checks = getattr(_app.state, "stop_check_ins", None)
            if checks is not None:
                checks()


def _warm_search(memory) -> None:
    """The first mem0 search pays client startup. Do that before ready."""
    try:
        found = memory.classify("你好")
        memory.search(
            "你好",
            slots=found.slots,
            entities=found.entities,
            top_k=5,
        )
    except Exception as exc:
        __import__("logging").getLogger(__name__).warning(
            "search warmup failed: %s", type(exc).__name__
        )


def _start_memory(runtime) -> str:
    """Start API-backed VoiceMem in the background. Returns the initial status.

    No API key or VoiceMem not installed -> keep FakeMemory with status "failed"
    (turns still work, just without long-term memory).
    """
    import logging
    import threading

    from olo.memory.voicemem_api import VoiceMemSettings, memory_backend, voicemem_installed

    log = logging.getLogger(__name__)
    settings = VoiceMemSettings.from_env()
    missing = settings.missing()
    if missing or not voicemem_installed():
        why = f"missing {', '.join(missing)}" if missing else "voicemem not installed"
        level = log.warning if memory_backend() == "voicemem" else log.info
        level("VoiceMem memory off (%s); using FakeMemory fallback", why)
        set_warmup("failed")
        return "failed"

    # Remote embedding + slot-classifier calls need far more than the 0.4s that
    # in-process VoiceMem had; a retrieval timeout also blocks the memory write.
    runtime.search_wait_s = float(os.environ.get("OLO_SEARCH_WAIT_S") or 3.0)

    def work() -> None:
        try:
            from olo.memory.probe import probe_warmup
            from olo.memory.voicemem_api import ApiVoiceMemAdapter, make_voicemem

            vm = make_voicemem(settings)
            adapter = ApiVoiceMemAdapter(vm, settings)
            failed = probe_warmup(vm)
            if not failed:
                _warm_search(adapter)
            runtime.memory = adapter
            runtime.warmup_failed = failed
            runtime.voicemem_status = "failed" if failed else "ready"
        except Exception as exc:
            log.warning("VoiceMem start failed: %s: %s", type(exc).__name__, exc)
            runtime.voicemem_status = "failed"
            runtime.warmup_failed = [type(exc).__name__]
        set_warmup(runtime.voicemem_status)

    threading.Thread(target=work, name="olo-probe", daemon=True).start()
    stop = threading.Event()
    runtime.stop_housekeeping = stop.set

    def housekeeping() -> None:
        from olo.flush import flush_idle, sweep_uploads
        from olo.db import connect as db_connect
        from olo.turns import REPO_ROOT

        while not stop.wait(60):
            try:
                if runtime.voicemem_status == "ready":
                    flush_idle(db_connect, runtime.memory, runtime.io_lock)
                sweep_uploads(REPO_ROOT / "data" / "uploads")
            except Exception as exc:
                logger = __import__("logging").getLogger(__name__)
                logger.warning("housekeeping failed: %s", type(exc).__name__)

    threading.Thread(target=housekeeping, name="olo-housekeeping", daemon=True).start()
    return "warming"


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get(
            "OLO_CORS_ORIGINS",
            "http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006,http://127.0.0.1:19006",
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_sessions(app)
register_turns(app)
register_asr(app)
register_notebook(app)
register_garden(app)
register_canon(app)
register_chapters(app)
register_mood(app)
register_persona(app)
register_shop(app)
register_voices(app)
register_subscription(app)
register_check_ins(app)
register_proactive(app)
register_consolidate(app)


WEB_DIR = Path(os.environ.get("OLO_WEB_DIR", str(REPO_ROOT / "web")))


def web_embed_token() -> bool:
    """Demo convenience: hand the API token to the same-origin web page.

    Only for local demos (docker compose sets it). Leave off on any shared host.
    """
    return os.environ.get("OLO_WEB_EMBED_TOKEN", "0") == "1"


@app.get("/", include_in_schema=False)
def root() -> Response:
    if (WEB_DIR / "index.html").is_file():
        return RedirectResponse("/app/")
    return JSONResponse({"ok": True, "docs": "/docs"})


@app.get("/app/config.js", include_in_schema=False)
def web_config() -> Response:
    import json as _json

    token = os.environ.get("OLO_API_TOKEN", "") if web_embed_token() else ""
    from olo.shop import debug_enabled

    cfg = {"apiBase": "", "token": token}
    if debug_enabled():
        cfg["debug"] = True
    body = "window.OLO_CONFIG = " + _json.dumps(cfg) + ";\n"
    return Response(body, media_type="application/javascript", headers={"Cache-Control": "no-store"})


class _RevalidatedStatic(StaticFiles):
    """Web assets must always revalidate, so a restart never leaves browsers on stale JS."""

    async def get_response(self, path, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


if WEB_DIR.is_dir():
    app.mount("/app", _RevalidatedStatic(directory=str(WEB_DIR), html=True), name="web")


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.get("/readyz")
def readyz() -> JSONResponse:
    payload = readyz_payload()
    return JSONResponse(
        status_code=200 if payload["postgres"] else 503,
        content=payload,
    )


@app.get("/metrics")
def metrics(request: Request) -> Response:
    host = request.client.host if request.client is not None else None
    if host not in LOOPBACK_HOSTS:
        raise HTTPException(status_code=403, detail="metrics are loopback only")
    return Response(
        content=render_metrics(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
