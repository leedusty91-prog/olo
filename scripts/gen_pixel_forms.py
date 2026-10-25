"""把 10 只灯籽的设定稿（commit 5c5e22c 的 apps/mobile/assets/forms/*.png）重画成像素剪影 + 色板，写 web/forms-px.js。
用法：python3 scripts/gen_pixel_forms.py   （需要 Pillow；从 git 历史读原图，不往仓库里放高清图）"""
import io, json, subprocess, colorsys
from PIL import Image

REV = "5c5e22c"
IDS = ["buddy", "cloud", "glow", "bud", "dew", "star", "peach", "acorn", "moon", "amber"]
HEIGHT = {"acorn": 22, "star": 21, "moon": 24, "dew": 24}  # 其余 21

# 星星：五个圆角的软星（缩小后的剪影糊成一团，手画）
STAR = [
    "..........##.........",
    ".........###.........",
    "........####.........",
    "........#####........",
    ".......#######.......",
    ".......#######.......",
    "......#########......",
    ".####################.",
    "######################",
    "######################",
    ".####################.",
    "..##################..",
    "...################...",
    "....##############....",
    "....##############....",
    "...################...",
    "...#######..#######...",
    "..#######....#######..",
    "..######......######..",
    "...####........####...",
]

# 每只的身子底色（取自设定稿 / forms.py 外形卡）
BASE = {"buddy": (243, 154, 74), "cloud": (238, 226, 214), "glow": (196, 168, 222), "bud": (164, 204, 132), "dew": (160, 206, 232),
        "star": (255, 200, 78), "peach": (246, 146, 136), "acorn": (196, 122, 70), "moon": (200, 206, 216), "amber": (232, 164, 88)}

def ramp(rgb):
    h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in rgb])
    def c(L, S=s, dh=0.0):
        r, g, b = colorsys.hls_to_rgb((h + dh) % 1, max(0, min(1, L)), max(0, min(1, S)))
        return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
    return [c(l * 0.32, min(1, s * 0.9), -0.02), c(l * 0.78, min(1, s * 1.05), -0.01), c(l), c(l + (1 - l) * 0.35), c(l + (1 - l) * 0.7, s * 0.8), c(0.95, 0.9, 0.0)]

out = {}
for f in IDS:
    im = Image.open(io.BytesIO(subprocess.check_output(["git", "show", f"{REV}:apps/mobile/assets/forms/{f}.png"]))).convert("RGBA")
    im = im.crop(im.getchannel("A").point(lambda a: 255 if a > 200 else 0).getbbox())
    H = HEIGHT.get(f, 23); W = max(8, round(im.width * H / im.height))
    if W > 24: W = 24; H = round(im.height * W / im.width)
    sm = im.resize((W, H), Image.LANCZOS)
    rows, body = [], []
    for y in range(H):
        r = ""
        for x in range(W):
            R, G, B, A = sm.getpixel((x, y))
            if A < 200: r += "."; continue
            cap = f == "acorn" and y < H * 0.44
            r += "c" if cap else "#"
            if not cap and 0.45 < y / H < 0.95 and (x < W * 0.3 or x > W * 0.7): body.append((R, G, B))
        rows.append(r)
    body.sort(key=sum); mid = body[len(body) // 2]
    # 只留最大的连通块（去掉设定稿里飘着的小光点）
    cells = {(x, y) for y, r in enumerate(rows) for x, ch in enumerate(r) if ch != "."}
    best = set()
    while cells:
        st = [cells.pop()]; comp = set(st)
        while st:
            x, y = st.pop()
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in cells: cells.remove(n); comp.add(n); st.append(n)
        if len(comp) > len(best): best = comp
    rows = ["".join(ch if (x, y) in best else "." for x, ch in enumerate(r)) for y, r in enumerate(rows)]
    rows = [r for r in rows if r.strip(".")]
    # 底部别比上面宽（设定稿脚下连着一片影子）
    for y in range(len(rows) * 2 // 3, len(rows)):
        prev = rows[y - 1]; lo = prev.index("#") - 1 if "#" in prev else 0; hi = prev.rindex("#") + 1 if "#" in prev else 0
        rows[y] = "".join(ch if lo <= x <= hi else "." for x, ch in enumerate(rows[y]))
    if f == "star": rows = STAR
    keep = [x for x in range(len(rows[0])) if any(r[x] != "." for r in rows)]
    rows = [r[keep[0]:keep[-1] + 1] for r in rows]
    out[f] = {"g": rows, "pal": ramp(BASE[f])}
js = "// 由 scripts/gen_pixel_forms.py 生成：10 只灯籽设定稿（C 款软果冻 + 头顶一撮卷毛）重画成像素剪影。别手改。\n"
js += "// g：从上到下每行一串，'#' 身子，'c' 橡果壳帽；pal：描边→暗部→中间调→亮部→高光→灯芯\n"
js += "export const PX_FORMS = " + json.dumps(out, ensure_ascii=False, indent=0) + ";\n"
open("web/forms-px.js", "w").write(js)
for f in IDS: print(f, len(out[f]["g"][0]), len(out[f]["g"]), out[f]["pal"][2]); print("\n".join(out[f]["g"]))
