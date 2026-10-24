"""网页插画主题 token 必须由手机端 illustration.ts 生成，二者一致。"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_web_theme_css_matches_mobile_illustration_theme():
    r = subprocess.run([sys.executable, str(ROOT / "scripts/gen_web_theme.py"), "--check"])
    assert r.returncode == 0, "web/theme.css 过期：运行 python scripts/gen_web_theme.py"


def test_web_has_all_ten_dengzi_sprites():
    forms = ["buddy", "cloud", "glow", "bud", "dew", "star", "peach", "acorn", "moon", "amber"]
    for f in forms:
        for st in ("idle", "happy", "sad", "sleep"):
            assert (ROOT / f"web/assets/olo/{f}-{st}.png").exists(), (f, st)
    fx = (ROOT / "web/onboard-fx.js").read_text(encoding="utf-8")
    for f in forms:
        assert f'["{f}",' in fx


def test_web_wenkai_webfont_has_ofl():
    assert (ROOT / "web/fonts/LXGWWenKaiLite-Regular.subset.woff2").exists()
    assert "Open Font License" in (ROOT / "web/fonts/OFL-LXGWWenKai.txt").read_text(encoding="utf-8")
