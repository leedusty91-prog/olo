"""小窝 Playwright 检查（跑在 Expo web 导出上）：

  npx expo export -p web --output-dir /tmp/mweb   # 再用任意静态服务 + /v1 反代到服务端
  NOOK_URL=http://127.0.0.1:8170 OLO_API_TOKEN=... python apps/mobile/e2e/nook_e2e.py [截图目录] [--video 目录]

点花浇水 / 翻书 / 闻碗 / 开关灯笼 / 扔球 / 拖 olo / 拉起聊天面板（olo 站到面板上沿）/ 开门出门 → 带回明信片；夜里 olo 打盹。
"""

import os
import sys

from playwright.sync_api import expect, sync_playwright

URL = os.environ.get("NOOK_URL", "http://127.0.0.1:8170")
TOKEN = os.environ["OLO_API_TOKEN"]
OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
VIDEO = sys.argv[sys.argv.index("--video") + 1] if "--video" in sys.argv else None


def shot(pg, name):
    if OUT:
        pg.screenshot(path=f"{OUT}/nook-live-{name}.png")


def open_app(b, hour):
    kw = {"record_video_dir": VIDEO, "record_video_size": {"width": 390, "height": 844}} if VIDEO else {}
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, **kw)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:300]))
    pg.goto(URL + "/")
    pg.evaluate("([t,b])=>{localStorage.setItem('olo.settings',JSON.stringify({baseUrl:b,token:t,allowCleartext:true}));localStorage.setItem('olo.onboarded','1')}", [TOKEN, URL])
    pg.goto(f"{URL}/?bg_hour={hour}&nook_fast=1")
    return ctx, pg, errs


def tid(pg, t):
    return pg.locator(f"[data-testid='{t}']")


def center(loc):
    bb = loc.bounding_box()
    return bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2


def drag(pg, loc, dx, dy, steps=6):
    x, y = center(loc)
    pg.mouse.move(x, y)
    pg.mouse.down()
    for i in range(1, steps + 1):
        pg.mouse.move(x + dx * i / steps, y + dy * i / steps)
        pg.wait_for_timeout(16)
    pg.mouse.up()


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ---- 白天 ----
        ctx, pg, errs = open_app(b, 10.5)
        expect(tid(pg, "nook-day")).to_be_visible(timeout=15000)
        expect(tid(pg, "nook-room")).to_be_visible()
        pg.wait_for_timeout(800)
        shot(pg, "day")
        for hot, tag in [("nook-plant", "nook-tag-plant"), ("nook-book", "nook-tag-book"), ("nook-bowl", "nook-tag-bowl"), ("nook-item", "nook-tag-item"), ("nook-lamp", "nook-tag-lamp")]:
            tid(pg, hot).click()
            expect(tid(pg, tag)).to_be_visible()
            if hot == "nook-plant":
                shot(pg, "plant")
            pg.wait_for_timeout(500)
        tid(pg, "nook-lamp").click()  # 灯笼关回去
        ball = tid(pg, "nook-ball")
        x0, y0 = center(ball)
        drag(pg, ball, -150, -140)
        pg.wait_for_timeout(150)
        x1, y1 = center(ball)
        shot(pg, "ball")
        assert abs(x1 - x0) + abs(y1 - y0) > 30, "ball did not move"
        pg.wait_for_timeout(2500)
        olo = pg.locator("[data-testid^='nook-olo-']")
        drag(pg, olo, 90, -120)
        pg.wait_for_timeout(2500)
        # ---- 聊天面板 ----
        expect(tid(pg, "sheet-min")).to_be_visible()
        expect(tid(pg, "hold")).to_be_visible()
        tid(pg, "sheet-grab").click()
        expect(tid(pg, "sheet-half")).to_be_visible()
        expect(tid(pg, "olo-perch")).to_be_visible()
        expect(pg.locator("[data-testid^='nook-olo-']")).to_have_count(0)
        pg.wait_for_timeout(700)
        shot(pg, "chat-half")
        tid(pg, "chat-input").click()
        expect(tid(pg, "sheet-full")).to_be_visible()
        pg.wait_for_timeout(700)
        shot(pg, "chat-full")
        tid(pg, "sheet-grab").click()
        expect(tid(pg, "sheet-min")).to_be_visible()
        pg.wait_for_timeout(600)
        # ---- 出门 ----
        tid(pg, "nook-door").click()
        expect(tid(pg, "nook-chooser")).to_be_visible()
        shot(pg, "door")
        tid(pg, "go-lake").click()
        card = tid(pg, "postcard")
        expect(card).to_be_visible(timeout=15000)
        pg.wait_for_timeout(1200)
        story = tid(pg, "postcard-story").inner_text()
        assert len(story) >= 8, story
        shot(pg, "postcard")
        tid(pg, "postcard-keep").click()
        expect(card).to_have_count(0)
        assert not errs, errs
        ctx.close()
        # ---- 夜里 ----
        ctx, pg, errs = open_app(b, 22.5)
        expect(tid(pg, "nook-night")).to_be_visible(timeout=15000)
        expect(tid(pg, "nook-olo-sleep")).to_be_visible()
        pg.wait_for_timeout(1500)
        shot(pg, "night")
        tid(pg, "nook-book").click()
        pg.wait_for_timeout(400)
        shot(pg, "night-book")
        assert not errs, errs
        ctx.close()
        b.close()
    print("nook e2e ok")


if __name__ == "__main__":
    main()
