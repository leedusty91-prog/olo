"""高清插画风各页截图（Expo web 导出 + Playwright，手机尺寸 390x844@2x）。
  npx expo export -p web --output-dir /tmp/mweb && (cd /tmp/mweb && python3 -m http.server 8171)
  APP_URL=http://127.0.0.1:8171 API_URL=http://127.0.0.1:8172 OLO_API_TOKEN=... OLO_SESSION=... python apps/mobile/e2e/style_shots.py 输出目录
"""
import os, sys
from playwright.sync_api import sync_playwright

APP, API = os.environ.get("APP_URL", "http://127.0.0.1:8171"), os.environ.get("API_URL", "http://127.0.0.1:8172")
TOKEN, SESSION, OUT = os.environ["OLO_API_TOKEN"], os.environ["OLO_SESSION"], sys.argv[1]

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        errs = []
        def open_at(hour):
            ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN")
            pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
            pg.goto(APP + "/")
            pg.evaluate("([t,b,s])=>{localStorage.setItem('olo.settings',JSON.stringify({baseUrl:b,token:t,allowCleartext:true}));localStorage.setItem('olo.onboarded','1');localStorage.setItem('olo.session',s)}", [TOKEN, API, SESSION])
            pg.goto(f"{APP}/?bg_hour={hour}")
            pg.get_by_test_id("menu-btn").wait_for(timeout=30000); pg.wait_for_timeout(1500)
            return ctx, pg
        for hour, tag in [(10.5, "day"), (21.5, "night"), (18, "dusk"), (6.5, "dawn")]:
            ctx, pg = open_at(hour)
            pg.screenshot(path=f"{OUT}/home-{tag}.png")
            pg.get_by_test_id("sheet-grab").click(); pg.wait_for_timeout(1500)
            pg.screenshot(path=f"{OUT}/chat-{tag}.png")
            if tag == "day":
                pg.get_by_test_id("sheet-grab").click(); pg.wait_for_timeout(800)
                pg.get_by_test_id("menu-btn").click(); pg.wait_for_timeout(600)
                pg.screenshot(path=f"{OUT}/menu.png")
                for k in ["notebook", "insights", "garden", "profile"]:
                    pg.get_by_test_id(f"menu-{k}").click(); pg.wait_for_timeout(2000)
                    pg.screenshot(path=f"{OUT}/{k}.png")
                    pg.get_by_test_id("back").first.click(); pg.wait_for_timeout(600)
                    pg.get_by_test_id("menu-btn").click(); pg.wait_for_timeout(500)
                pg.get_by_test_id("menu-settings").click(); pg.wait_for_timeout(1200)
                pg.screenshot(path=f"{OUT}/settings.png")
            ctx.close()
        print("page errors:", errs)
        b.close()
main()
