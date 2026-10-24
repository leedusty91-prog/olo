"""灯籽 C 款高清立绘（软胶果冻、一撮卷毛、无手脚、无配饰），程序化渲染到 apps/mobile/assets/hd/olo/。
python scripts/gen_hd_dengzi.py"""
import math, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops
S = 1024; OUT = 512
HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, "..", "apps", "mobile", "assets", "hd", "olo")
FORMS = {  # base, light, deep
    "buddy": ((247, 146, 58), (255, 196, 120), (214, 102, 30)),
    "cloud": ((246, 239, 228), (255, 253, 248), (214, 200, 186)),
    "glow": ((214, 186, 240), (240, 224, 255), (170, 132, 214)),
}
INK = (60, 36, 30)
def body_poly(cx, top, bot, w):
    pts = []
    for i in range(361):
        t = math.radians(i)
        # 下宽上尖的果冻水滴
        y = -math.cos(t); x = math.sin(t)
        k = 0.62 + 0.38 * ((1 + -y) / 2) ** 0.7  # 越往下越宽
        yy = (top + bot) / 2 + y * (bot - top) / 2 * -1
        pts.append((cx + x * w * k, yy))
    return pts
def tuft(d, form, cx, top, col):
    if form == "buddy":   # 卷
        d.ellipse((cx - 70, top - 90, cx + 60, top + 40), fill=col)
        d.ellipse((cx - 20, top - 150, cx + 70, top - 60), fill=col)
        d.ellipse((cx + 5, top - 128, cx + 45, top - 88), fill=None)
    elif form == "cloud":  # 云旋
        for dx, dy, r in ((-60, -10, 70), (40, -30, 62), (0, -95, 58), (30, -150, 38)):
            d.ellipse((cx + dx - r, top + dy - r, cx + dx + r, top + dy + r), fill=col)
    else:                  # 焰尖
        d.polygon([(cx - 90, top + 40), (cx + 80, top + 40), (cx + 40, top - 70), (cx + 10, top - 175), (cx - 30, top - 80)], fill=col)
def render(form, state):
    base, light, deep = FORMS[form]
    cx, top, bot, w = S / 2, 300, 930, 330
    if state == "held": top, bot, w = 250, 940, 300
    if state == "happy": top, w = 330, 345
    m = Image.new("L", (S, S), 0); md = ImageDraw.Draw(m)
    md.polygon(body_poly(cx, top, bot, w), fill=255); tuft(md, form, cx, top + 20, 255)
    m = m.filter(ImageFilter.GaussianBlur(3))
    # 渐变：上浅下深 + 中心透亮
    col = Image.new("RGB", (S, S)); px = col.load()
    for y in range(S):
        f = min(1, max(0, (y - 150) / 820))
        for x in range(0, S):
            r = math.hypot((x - cx * 0.92) / 330, (y - 560) / 360)
            g = max(0, 1 - r) ** 1.4
            c = [base[i] * (1 - f * 0.5) + deep[i] * f * 0.5 for i in range(3)]
            c = [c[i] * (1 - g * 0.55) + light[i] * g * 0.55 for i in range(3)]
            px[x, y] = tuple(int(v) for v in c)
    # 边缘暗、内部亮（果冻感）
    inner = m.filter(ImageFilter.GaussianBlur(40))
    edge = ImageChops.subtract(m, inner).point(lambda v: min(255, v * 2))
    col = Image.composite(Image.new("RGB", (S, S), deep), col, edge.point(lambda v: v // 2))
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); img.paste(col, (0, 0), m)
    # 软投影
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse((cx - 260, bot - 30, cx + 260, bot + 40), fill=(120, 70, 60, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(22)); img = Image.alpha_composite(sh, img)
    d = ImageDraw.Draw(img)
    # 高光
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    hd.ellipse((cx - 200, top + 170, cx - 110, top + 300), fill=(255, 255, 255, 105))
    hd.ellipse((cx - 150, top + 320, cx - 120, top + 350), fill=(255, 255, 255, 120))
    img = Image.alpha_composite(img, hl.filter(ImageFilter.GaussianBlur(10))); d = ImageDraw.Draw(img)
    ey = top + (bot - top) * 0.55 + (-30 if state == "thinking" else 0); ex = 92
    blush = Image.new("RGBA", (S, S), (0, 0, 0, 0)); bd = ImageDraw.Draw(blush)
    a = 200 if state == "held" else 140
    for s in (-1, 1): bd.ellipse((cx + s * 165 - 48, ey + 40, cx + s * 165 + 48, ey + 82), fill=(255, 120, 120, a))
    img = Image.alpha_composite(img, blush.filter(ImageFilter.GaussianBlur(9))); d = ImageDraw.Draw(img)
    for s in (-1, 1):
        x = cx + s * ex
        if state in ("sleep",):
            d.arc((x - 34, ey - 20, x + 34, ey + 24), 20, 160, fill=INK, width=12)
        elif state == "happy":
            d.arc((x - 34, ey - 10, x + 34, ey + 50), 200, 340, fill=INK, width=13)
        else:
            rr = 46 if state == "held" else 42; lift = -12 if state == "thinking" else 0
            d.ellipse((x - rr, ey - rr * 1.15, x + rr, ey + rr * 1.15), fill=INK)
            d.ellipse((x - 18 + (6 if state == "thinking" else 0), ey - 30 + lift, x + 4, ey - 8 + lift), fill=(255, 255, 255))
            d.ellipse((x + 10, ey + 10, x + 20, ey + 20), fill=(255, 255, 255, 200))
    my = ey + 70
    if state in ("talking", "happy"):
        d.chord((cx - 34, my - 24, cx + 34, my + 34), 0, 180, fill=(150, 60, 60)); d.ellipse((cx - 16, my + 8, cx + 16, my + 28), fill=(240, 120, 120))
    elif state == "held":
        d.ellipse((cx - 20, my - 12, cx + 20, my + 32), fill=(150, 60, 60))
    elif state == "sad":
        d.arc((cx - 30, my, cx + 30, my + 40), 200, 340, fill=INK, width=9)
        d.ellipse((cx + ex + 10, ey + 40, cx + ex + 44, ey + 90), fill=(140, 200, 255, 230))
    elif state == "thinking":
        d.line((cx - 18, my + 10, cx + 22, my + 4), fill=INK, width=9)
    elif state != "sleep":
        d.arc((cx - 30, my - 30, cx + 30, my + 14), 30, 150, fill=INK, width=9)
    else:
        d.ellipse((cx - 10, my - 2, cx + 10, my + 14), fill=(150, 60, 60))
    return img.resize((OUT, OUT), Image.LANCZOS)
os.makedirs(DST, exist_ok=True)
for f in FORMS:
    for s in ("idle", "happy", "talking", "sad", "thinking", "held", "sleep"):
        render(f, s).save(os.path.join(DST, f"{f}-{s}.png"), optimize=True)
