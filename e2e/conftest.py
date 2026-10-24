"""e2e fixtures.

默认自己起一套干净的环境：新建一个一次性的 Postgres 库 → alembic 迁移 → seed_demo → 起 uvicorn（随机端口），
跑完关服务器并删库。不需要 OLO_DEBUG=1：页面内部状态（window.__oloStage / __oloWorld）只通过
测试专用的 init script 打开，代币用测试专用 fixture 直接写库。

已经有服务器在跑时，设 OLO_E2E_URL=http://127.0.0.1:8000 走老路（不建库、不起服务器）。
OLO_E2E_ADMIN_DB：用来建/删临时库的连接串（默认 postgresql://olo@127.0.0.1:5432/olo）。
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXTERNAL_URL = os.environ.get("OLO_E2E_URL")
ADMIN_DB = os.environ.get("OLO_E2E_ADMIN_DB", "postgresql://olo@127.0.0.1:5432/olo")
SHOTS = os.environ.get("OLO_SHOTS_DIR")
E2E_TOKEN = "e2e-dev-token"  # 只给本地临时服务器用的假令牌
SEEDED_USER_ID = "00000000-0000-4000-8000-000000000001"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _db_url(name: str) -> str:
    return ADMIN_DB.rsplit("/", 1)[0] + "/" + name


@pytest.fixture(scope="session")
def e2e_server():
    if EXTERNAL_URL:
        yield {"url": EXTERNAL_URL.rstrip("/"), "db": os.environ.get("OLO_E2E_DB")}
        return
    import psycopg

    name = f"olo_e2e_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(ADMIN_DB, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    db = _db_url(name)
    port = _free_port()
    env = {
        **os.environ,
        "DATABASE_URL": db,
        "OLO_API_TOKEN": E2E_TOKEN,
        "LLM_PROVIDER": "mock",
        "OLO_MEMORY": "fake",
        "OLO_WEB_EMBED_TOKEN": "1",
        "OLO_DEV_SUBSCRIPTIONS": "1",
        "OLO_DEBUG": "0",
    }
    server_dir = ROOT / "server"
    log = open(Path(os.environ.get("TMPDIR", "/tmp")) / f"{name}.log", "w")
    proc = None
    try:
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=server_dir, env=env, check=True, stdout=log, stderr=log)
        subprocess.run([sys.executable, str(ROOT / "scripts" / "seed_demo.py")], cwd=server_dir, env=env, check=True, stdout=log, stderr=log)
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "olo.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=server_dir, env=env, stdout=log, stderr=log)
        url = f"http://127.0.0.1:{port}"
        for _ in range(150):
            if proc.poll() is not None:
                raise RuntimeError(f"e2e server exited, see {log.name}")
            try:
                urllib.request.urlopen(url + "/healthz", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        else:
            raise RuntimeError(f"e2e server did not start, see {log.name}")
        yield {"url": url, "db": db}
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.close()
        with psycopg.connect(ADMIN_DB, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
def base(e2e_server) -> str:
    return e2e_server["url"]


@pytest.fixture
def grant_tokens(e2e_server):
    """测试专用：直接给演示用户的钱包加代币（不走任何调试接口）。"""

    def _grant(n: int) -> None:
        db = e2e_server["db"]
        if not db:
            pytest.skip("grant_tokens needs OLO_E2E_DB when OLO_E2E_URL is used")
        import psycopg

        with psycopg.connect(db) as conn:
            conn.execute(
                "INSERT INTO wallets (user_id, tokens) VALUES (%s, %s) ON CONFLICT (user_id) DO UPDATE SET tokens = wallets.tokens + EXCLUDED.tokens",
                (SEEDED_USER_ID, n),
            )
            conn.commit()

    return _grant


@pytest.fixture(autouse=True)
def _test_hooks(request):
    """测试专用 init script：让页面挂出 window.__oloStage / __oloWorld（生产页面不会有这个标记）。"""
    if "page" in request.fixturenames:
        request.getfixturevalue("page").add_init_script("window.__OLO_TEST_HOOKS__ = true;")


@pytest.fixture
def shot():
    """shot(page, name): 设置 OLO_SHOTS_DIR 时保存截图（用于 README）。"""

    def _shot(page, name: str) -> None:
        if SHOTS:
            Path(SHOTS).mkdir(parents=True, exist_ok=True)
            page.wait_for_timeout(700)
            page.screenshot(path=str(Path(SHOTS) / f"{name}.png"))

    return _shot


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    args = {**browser_context_args, "viewport": {"width": 1280, "height": 820}, "locale": "zh-CN"}
    video = os.environ.get("OLO_VIDEO_DIR")
    if video:
        args["record_video_dir"] = video
        args["record_video_size"] = {"width": 1280, "height": 820}
    return args
