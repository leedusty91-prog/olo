"""聊天背景画法：网页 web/chat-bg.js 与手机端 apps/mobile/src/chatBg.js 必须是同一份；四个时段的字和气泡对比度要够。"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_chat_bg_shared_with_mobile():
    assert (ROOT / "web/chat-bg.js").read_bytes() == (ROOT / "apps/mobile/src/chatBg.js").read_bytes()


@pytest.mark.skipif(not shutil.which("node"), reason="需要 node")
def test_chat_bg_contrast_all_dayparts(tmp_path):
    (tmp_path / "loc.mjs").write_text('globalThis.location = { search: "" };')
    (tmp_path / "c.mjs").write_text(f"""
import {{ skyAt }} from "{(ROOT / 'web/skytime.js').as_uri()}";
import {{ paintChatBg, contrast, chatInk }} from "{(ROOT / 'web/chat-bg.js').as_uri()}";
const out = {{}};
for (const h of [6.4, 11, 18.4, 22, 3]) {{
  const r = paintChatBg(skyAt(h), {{ W: 90, H: 160 }});
  out[h] = {{ dark: r.dark, ink: contrast(chatInk(r.dark), r.base), border: contrast([42, 20, 12], r.base), bubble: contrast([255, 243, 220], r.base) }};
}}
console.log(JSON.stringify(out));
""")
    res = json.loads(subprocess.run(["node", "--import", (tmp_path / "loc.mjs").as_uri(), str(tmp_path / "c.mjs")], capture_output=True, text=True, check=True).stdout)
    for h, r in res.items():
        assert r["ink"] >= 4.5, (h, r)  # 时间戳/空状态小字
        assert max(r["border"], r["bubble"]) >= 3, (h, r)  # 气泡（深色描边或浅色底）要跳出来
    assert res["22"]["dark"] and not res["11"]["dark"]
