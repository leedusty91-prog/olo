"""把像素场景里写死的十六进制颜色批量换成倒影国粉彩（明亮、低对比、无暗部）。

用法：python scripts/pastelize.py web/scenes.js ...   （原地改写，幂等性不保证，只跑一次）
规则：提亮到 0.62~0.98、压低饱和；原本很暗的酒红 / 紫褐（夜色）转成薰衣草，绿色转薄荷，橙色保留成蜜桃。
"""
import colorsys
import re
import sys

HEX = re.compile(r"#([0-9a-fA-F]{6})\b")


def pastel(m: re.Match) -> str:
    r, g, b = (int(m.group(1)[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    deg = h * 360
    if l < 0.4 and (deg >= 290 or deg < 25):
        deg = 262  # 夜色 → 薰衣草
    elif 70 <= deg < 170:
        deg = 160 + (deg - 70) * 0.1  # 绿色 → 薄荷
    elif 25 <= deg < 45 and l < 0.35:
        deg = 15  # 深棕 → 玫瑰灰
    l2 = 0.62 + 0.36 * l
    s2 = min(s, 0.8) * 0.65 + 0.12
    r2, g2, b2 = colorsys.hls_to_rgb(deg / 360, l2, s2)
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in (r2, g2, b2))


for path in sys.argv[1:]:
    src = open(path, encoding="utf-8").read()
    open(path, "w", encoding="utf-8").write(HEX.sub(pastel, src))
    print(path)
