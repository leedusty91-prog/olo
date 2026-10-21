import os
from pathlib import Path

import pytest

BASE_URL = os.environ.get("OLO_E2E_URL", "http://127.0.0.1:8000")
SHOTS = os.environ.get("OLO_SHOTS_DIR")


@pytest.fixture
def base() -> str:
    return BASE_URL.rstrip("/")


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
