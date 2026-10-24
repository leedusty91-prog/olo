"""聊天背景：网页 web/chat-bg.js 与手机端 apps/mobile/src/chatBg.js 必须是同一份；两端都用这份数据选四幅高清插画、铺压字薄纱。
这里核对：选图边界与手机端 ChatBackdrop / 网页 onboarding 一致；声明的平均色与两端实际 jpg 相符；
叠纱后正文小字对比度 ≥ 4.5、气泡 ≥ 3；两端插画文件都在，而且网页/手机两端都真的引用了这份模块。"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
KEYS = ["dawn", "day", "dusk", "night"]


def test_chat_bg_shared_with_mobile():
    assert (ROOT / "web/chat-bg.js").read_bytes() == (ROOT / "apps/mobile/src/chatBg.js").read_bytes()


def test_both_sides_use_shared_module():
    app = (ROOT / "web/app.js").read_text()
    assert 'from "./chat-bg.js' in app and "bgFor(" in app and "scrimCss(" in app
    assert "paintChatScene" not in app
    tsx = (ROOT / "apps/mobile/src/ChatBackdrop.tsx").read_text()
    assert 'from "./chatBg"' in tsx and "scrimCss(" in tsx
    for k in KEYS:
        assert (ROOT / f"web/assets/bg/bg-{k}.jpg").is_file()
        assert (ROOT / f"apps/mobile/assets/hd/bg-{k}.jpg").is_file()


def _run(js, tmp_path):
    (tmp_path / "c.mjs").write_text(f'import * as C from "{(ROOT / "web/chat-bg.js").as_uri()}";\n' + js)
    return json.loads(subprocess.run(["node", str(tmp_path / "c.mjs")], capture_output=True, text=True, check=True).stdout)


@pytest.mark.skipif(not shutil.which("node"), reason="需要 node")
def test_bg_choice_and_contrast(tmp_path):
    r = _run("""
const hours = [0, 4.99, 5, 7.99, 8, 16.49, 16.5, 19.49, 19.5, 23.9, 27];
const out = { pick: hours.map(C.bgFor), keys: C.CHAT_BG_KEYS, bg: {} };
for (const k of C.CHAT_BG_KEYS) { const s = C.chatSurface(k), d = C.chatDark(k);
  out.bg[k] = { base: C.CHAT_BG[k].base, dark: d, ink: C.contrast(C.chatInk(d), s), border: C.contrast([42, 20, 12], s), bubble: C.contrast([255, 243, 220], s) }; }
console.log(JSON.stringify(out));""", tmp_path)
    assert r["keys"] == KEYS
    assert r["pick"] == ["night", "night", "dawn", "dawn", "day", "day", "dusk", "dusk", "night", "night", "night"]
    for k, v in r["bg"].items():
        assert v["ink"] >= 4.5, (k, v)
        assert max(v["border"], v["bubble"]) >= 3, (k, v)
    assert r["bg"]["night"]["dark"] and not r["bg"]["day"]["dark"]
    # 平均色与两端真实图片相符（换图忘了改数据会在这里报）
    pytest.importorskip("PIL")
    from PIL import Image, ImageStat
    for k in KEYS:
        for p in (ROOT / f"web/assets/bg/bg-{k}.jpg", ROOT / f"apps/mobile/assets/hd/bg-{k}.jpg"):
            mean = ImageStat.Stat(Image.open(p).convert("RGB")).mean
            assert max(abs(a - b) for a, b in zip(mean, r["bg"][k]["base"])) <= 12, (p, mean)


def test_web_onboarding_uses_same_boundaries():
    app = (ROOT / "web/app.js").read_text()
    assert 'hour >= 19.5 || hour < 5 ? "bg-night" : hour < 8 ? "bg-dawn" : hour < 16.5 ? "bg-day" : "bg-dusk"' in app
