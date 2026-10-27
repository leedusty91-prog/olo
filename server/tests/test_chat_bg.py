"""聊天背景画法：网页 web/chat-bg.js 与手机端 apps/mobile/src/chatBg.js 必须是同一份；四个时段字和气泡对比度要够，配色保持粉彩提亮（不发黑、不走秋黄昏橘褐）。"""
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
import {{ paintScene }} from "{(ROOT / 'web/sky-scene.js').as_uri()}";
import {{ paintChatScene, contrast, chatInk, landPalette }} from "{(ROOT / 'web/chat-bg.js').as_uri()}";
const out = {{}};
for (const h of [6.4, 11, 18.4, 22, 3]) {{
  for (const [W, H, col] of [[130, 270, null], [320, 200, [90, 230]]]) {{
  const r = paintChatScene(skyAt(h), {{ W, H, paintScene, date: new Date(2026, 9, 24), col }});
  out[h + "@" + W] = {{ dark: r.dark, ink: contrast(chatInk(r.dark), r.base), border: contrast([42, 20, 12], r.base), bubble: contrast([255, 243, 220], r.base) }};
}}}}
// 粉彩：白天/清晨/黄昏草坡与水面都提亮（平均亮度够），夜里也不发黑（near 通道均值 > 100）
for (const h of [6.4, 11, 18.4]) {{
  const p = landPalette(h);
  const bright = (c) => (c[0] + c[1] + c[2]) / 3;
  out['pastel' + h] = bright(p.grass) > 160 && bright(p.water) > 150 && bright(p.leaf) > 160;
}}
{{ const p = landPalette(22); out['nightLift'] = (p.near[0] + p.near[1] + p.near[2]) / 3 > 100; }}
console.log(JSON.stringify(out));
""")
    res = json.loads(subprocess.run(["node", "--import", (tmp_path / "loc.mjs").as_uri(), str(tmp_path / "c.mjs")], capture_output=True, text=True, check=True).stdout)
    for h in ("pastel6.4", "pastel11", "pastel18.4", "nightLift"):
        assert res.pop(h), h
    for h, r in res.items():
        assert r["ink"] >= 4.5, (h, r)  # 时间戳/空状态小字
        assert max(r["border"], r["bubble"]) >= 3, (h, r)  # 气泡（深色描边或浅色底）要跳出来
    assert res["22@130"]["dark"] and not res["11@320"]["dark"]
