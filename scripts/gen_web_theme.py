"""从 apps/mobile/theme/illustration.ts 生成 web/theme.css（网页与手机同一套插画主题 token）。

用法：python scripts/gen_web_theme.py            # 写文件
      python scripts/gen_web_theme.py --check    # 只比较（pytest 用）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps/mobile/theme/illustration.ts"
OUT = ROOT / "web/theme.css"


def kebab(s: str) -> str:
    return re.sub(r"([A-Z])", lambda m: "-" + m.group(1).lower(), s)


def block(src: str, name: str) -> str:
    m = re.search(r"export const %s = \{([^\n]*?)\} as const" % name, src) or re.search(r"export const %s = \{(.*?)\n\}" % name, src, re.S)
    return m.group(1) if m else ""


def render() -> str:
    src = SRC.read_text(encoding="utf-8")
    out = ["/* 自动生成：python scripts/gen_web_theme.py（来源 apps/mobile/theme/illustration.ts），不要手改 */", ":root {"]
    colors = block(src, "colors")
    dz = re.search(r"dengzi:\s*\{(.*?)\}", colors, re.S)
    flat = colors.replace(dz.group(0), "") if dz else colors
    for k, v in re.findall(r"(\w+):\s*\"([^\"]+)\"", flat):
        out.append(f"  --c-{kebab(k)}: {v};")
    if dz:
        for k, v in re.findall(r"(\w+):\s*\"([^\"]+)\"", dz.group(1)):
            out.append(f"  --dz-{k}: {v};")
    for name, pre in (("spacing", "sp"), ("radii", "r")):
        for k, v in re.findall(r"(\w+):\s*(\d+)", block(src, name)):
            out.append(f"  --{pre}-{k}: {v}px;")
    out.append(f"  --touch: {re.search(r'export const TOUCH = (\d+)', src).group(1)}px;")
    b = re.search(r"export const border = \{ width: ([\d.]+), color: \"([^\"]+)\", colorInk: \"([^\"]+)\"", src)
    out += [f"  --bd-w: {b.group(1)}px;", f"  --bd-c: {b.group(2)};", f"  --bd-ink: {b.group(3)};"]
    ts = re.search(r"textShadowColor: \"([^\"]+)\".*?height: (\d+).*?textShadowRadius: (\d+)", src, re.S)
    out.append(f"  --text-shadow: 0 {ts.group(2)}px {ts.group(3)}px {ts.group(1)};")
    out.append("  --shadow-soft: 0 6px 16px rgba(122,74,58,0.16);")
    out.append("  --shadow-glow: 0 0 18px rgba(255,184,107,0.55);")
    sizes = re.search(r"size: \{(.*?)\}", block(src, "fonts"), re.S).group(1)
    for k, v in re.findall(r"(\w+):\s*(\d+)", sizes):
        out.append(f"  --fs-{k}: {v}px;")
    out.append('  --font-body: "LXGW WenKai Lite", "LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif;')
    out.append("}")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    css = render()
    if "--check" in sys.argv:
        sys.exit(0 if OUT.read_text(encoding="utf-8") == css else 1)
    OUT.write_text(css, encoding="utf-8")
    print(OUT)
