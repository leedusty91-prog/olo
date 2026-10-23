"""网页和手机端的天色关键帧必须是同一张表（web/sky-keys.js 为准）。"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _keys(p: Path):
    m = re.search(r"/\*json\*/(.*?)/\*end\*/", p.read_text(encoding="utf-8"), re.S)
    assert m, p
    return json.loads(m.group(1))


def test_sky_keys_shared_between_web_and_mobile():
    web = _keys(ROOT / "web" / "sky-keys.js")
    mobile = _keys(ROOT / "apps" / "mobile" / "src" / "skyKeys.ts")
    assert web == mobile
    assert web[0][0] == 0 and web[-1][0] == 24
    assert all(len(k[1]["sky"]) == 4 for k in web)


def test_sky_scene_shared_with_mobile():
    """网页 sky-scene.js 和手机端 skyScene.js 必须逐字一致（唯一来源）。"""
    root = Path(__file__).resolve().parents[2]
    web = (root / "web" / "sky-scene.js").read_text(encoding="utf-8")
    mobile = (root / "apps" / "mobile" / "src" / "skyScene.js").read_text(encoding="utf-8")
    assert web == mobile


def test_nook_scene_shared_with_mobile():
    """小窝 nook-scene.js 同样只有一份：手机端是逐字拷贝。"""
    root = Path(__file__).resolve().parents[2]
    web = (root / "web" / "nook-scene.js").read_text(encoding="utf-8")
    mobile = (root / "apps" / "mobile" / "src" / "nookScene.js").read_text(encoding="utf-8")
    assert web == mobile
