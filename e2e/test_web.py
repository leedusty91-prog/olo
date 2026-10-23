"""浏览器端到端：故事引导 → 起名/选样子/选性子 → 流式聊天 → 花园 → 日记。

需要一个以 LLM_PROVIDER=mock、OLO_WEB_EMBED_TOKEN=1 启动的后端（docker compose 默认即是）。
"""

import base64
import json
import os
import re
import time
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect


def test_story_onboarding_then_streaming_chat(page: Page, base: str, shot) -> None:
    started = time.time()
    page.goto(f"{base}/")
    expect(page.get_by_test_id("start")).to_be_visible()
    shot(page, "01-title")
    page.get_by_test_id("start").click()

    for i in range(4):
        beat = page.locator(f'[data-beat="{i}"]')
        expect(beat).to_be_visible()
        expect(beat.get_by_test_id("scene").locator("canvas, video")).to_be_visible()
        expect(beat.locator(".story")).not_to_be_empty()
        page.wait_for_timeout(3200)
        shot(page, f"0{i + 2}-story-{i + 1}")
        beat.get_by_test_id("next").click()

    expect(page.get_by_test_id("hello")).to_be_visible()
    page.wait_for_timeout(2400)
    shot(page, "06-hatch")
    page.get_by_test_id("hello").click()

    page.get_by_test_id("name").fill("小灯")
    shot(page, "07-name")
    page.get_by_test_id("name-ok").click()
    # 昵称一步：可跳过，填了就存到服务端
    expect(page.get_by_test_id("nickname-step")).to_be_visible()
    page.get_by_test_id("nickname-input").fill("阿星")
    page.get_by_test_id("nickname-ok").click()
    # 性别一步：三个选项，只用于日记称呼
    expect(page.get_by_test_id("gender-step")).to_be_visible()
    expect(page.locator("[data-gender]")).to_have_count(3)
    expect(page.get_by_test_id("gender-unspecified")).to_have_class(re.compile("on"))
    page.get_by_test_id("gender-female").click()
    expect(page.get_by_test_id("gender-female")).to_have_class(re.compile("on"))
    shot(page, "05-gender")
    page.get_by_test_id("gender-ok").click()

    # 形态自带固定配色，不再有颜色选择
    expect(page.locator("button[data-color], .swatch")).to_have_count(0)
    page.get_by_test_id("form-cloud").click()
    expect(page.locator('canvas[data-olo-form="cloud"][data-color="sky"]').first).to_be_visible()  # 云朵默认配色
    shot(page, "08-form")
    page.get_by_test_id("form-ok").click()

    # 不再有选性格这一步：选完样子直接进入聊天
    expect(page.locator("[data-tone]")).to_have_count(0)

    expect(page.get_by_test_id("app")).to_be_visible(timeout=10_000)
    expect(page.get_by_test_id("olo-name")).to_have_text("小灯")
    shot(page, "10-chat-empty")

    page.get_by_test_id("chat-input").fill("你是谁呀？")
    page.get_by_test_id("send").click()
    # 流式回复期间头像进入 talking/thinking 状态
    expect(page.get_by_test_id("hero")).to_have_attribute("data-state", re.compile(r"thinking|talking"))
    expect(page.locator("form[data-busy]")).to_have_count(0, timeout=15_000)
    # 一条回复拆成三个气泡（欢迎语 + 3）
    bubbles = page.locator(".msg.assistant")
    expect(bubbles).to_have_count(4)
    expect(bubbles.nth(1)).to_contain_text("小灯")
    expect(bubbles.nth(1)).to_contain_text("灯籽")
    expect(bubbles.nth(2)).to_contain_text("芦婆婆")
    expect(bubbles.nth(3)).to_contain_text("今天过得怎么样")
    expect(page.locator(".msg.assistant span", has_text="||")).to_have_count(0)
    page.get_by_test_id("chat-input").fill("今天加班好累")
    page.get_by_test_id("send").click()
    expect(page.locator(".msg.assistant").last).to_contain_text("加班", timeout=10_000)
    expect(page.get_by_test_id("hero")).to_have_attribute("data-state", "sad")
    shot(page, "11-chat")

    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("tab-garden").click()
    expect(page.get_by_test_id("garden")).to_be_visible()
    expect(page.get_by_test_id("stage")).not_to_be_empty()
    expect(page.locator(".lore article").first).to_be_visible()
    shot(page, "12-garden")

    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("tab-diary").click()
    expect(page.get_by_test_id("diary")).to_be_visible()
    page.get_by_test_id("write-diary").click()
    activate = page.get_by_test_id("activate")
    page.wait_for_timeout(800)
    if activate.is_visible():
        activate.click()
        page.get_by_test_id("write-diary").click()
    expect(page.locator(".page").first).to_be_visible()
    # 当天用户原话单独成段、用引用样式显示
    quote = page.locator(".page").first.get_by_test_id("diary-quote")
    expect(quote).to_have_count(1)
    expect(quote).to_have_text(re.compile(r"^「[^」]+」$"))
    shot(page, "13-diary")

    # 音效：全部由 WebAudio 合成，事件日志里应出现转场 / 发送 / 收到 / 花园生长 / 翻页
    names = set(page.evaluate("window.__oloAudio.log.map((e) => e.name)"))
    assert {"gesture", "whoosh", "hatch", "send", "receive", "grow", "page"} <= names, names
    assert {"title", "city", "river", "boat", "room", "chat", "garden", "diary"} <= names, names
    video_dir = os.environ.get("OLO_VIDEO_DIR")
    if video_dir:
        # 把本次会话的音频事件离线重放成 WAV，供演示视频配乐
        wav = page.evaluate("window.__oloAudio.renderWav()")
        origin = page.evaluate("performance.timeOrigin") / 1000
        Path(video_dir).mkdir(parents=True, exist_ok=True)
        Path(video_dir, "olo-audio.wav").write_bytes(base64.b64decode(wav))
        Path(video_dir, "olo-audio.json").write_text(json.dumps({"offset": origin - started}))

    # 选的性别存到了服务端，设置里能看到也能改
    assert page.evaluate("fetch('/v1/persona',{headers:{Authorization:'Bearer '+(window.OLO_CONFIG.token||localStorage.getItem('olo.token')||'').replace(/\"/g,'')}}).then(r=>r.json()).then(j=>j.user_gender)") == "female"
    assert page.evaluate("fetch('/v1/persona',{headers:{Authorization:'Bearer '+(window.OLO_CONFIG.token||localStorage.getItem('olo.token')||'').replace(/\"/g,'')}}).then(r=>r.json()).then(j=>j.user_nickname)") == "阿星"

    # 刷新后保持已相遇状态，直接进入主界面；历史也按气泡显示
    page.reload()
    expect(page.get_by_test_id("app")).to_be_visible()
    expect(page.locator(".msg.assistant", has_text=re.compile(r"^\s*你呢，今天过得怎么样？\s*$")).last).to_be_visible()


def test_skip_story_on_mobile_viewport(browser, base: str) -> None:
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(f"{base}/app/")
    page.get_by_test_id("skip-story").click()
    page.get_by_test_id("hello").click()
    page.get_by_test_id("name-ok").click()  # 默认名 olo
    page.get_by_test_id("nickname-skip").click()
    page.get_by_test_id("gender-ok").click()
    page.get_by_test_id("form-ok").click()
    expect(page.get_by_test_id("olo-name")).to_have_text("olo", timeout=10_000)
    page.get_by_test_id("chat-input").fill("嗨")
    page.get_by_test_id("send").click()
    expect(page.locator(".msg.assistant").last).to_contain_text("我在", timeout=10_000)
    # 没有横向滚动条
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    # 静音开关：在菜单里，点一下静音，刷新后仍保持
    page.get_by_test_id("menu-btn").click()
    mute = page.get_by_test_id("mute")
    expect(page.locator("[data-testid=menu] [data-testid=mute]")).to_be_visible()
    expect(mute).to_have_attribute("aria-pressed", "false")
    mute.click()
    expect(mute).to_have_attribute("aria-pressed", "true")
    assert page.evaluate("localStorage.getItem('olo.muted')") == "1"
    page.reload()
    page.get_by_test_id("menu-btn").click()
    expect(page.get_by_test_id("mute")).to_have_attribute("aria-pressed", "true")
    page.get_by_test_id("mute").click()
    expect(page.get_by_test_id("mute")).to_have_attribute("aria-pressed", "false")
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("menu")).to_be_hidden()
    # 纯聊天布局：没有顶栏、没有快捷提示
    assert page.locator(".topbar").count() == 0 and page.locator(".chip").count() == 0
    # olo眼里的你 + 主动关心开关
    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("profile-btn").click()
    expect(page.get_by_test_id("profile-text")).to_contain_text("认识你", timeout=10_000)
    page.keyboard.press("Escape")
    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("settings").click()
    expect(page.get_by_test_id("settings-checkins")).to_be_checked(timeout=10_000)
    page.keyboard.press("Escape")
    ctx.close()


def test_rejects_wrong_token(browser, base: str) -> None:
    ctx = browser.new_context()
    page = ctx.new_page()
    page.route("**/app/config.js", lambda r: r.fulfill(
        body='window.OLO_CONFIG={"apiBase":"","token":"wrong"};', content_type="application/javascript"))
    page.goto(f"{base}/app/")
    page.get_by_test_id("skip-story").click()
    page.get_by_test_id("hello").click()
    page.get_by_test_id("name-ok").click()
    page.get_by_test_id("nickname-ok").click()  # 空着也能过
    page.get_by_test_id("gender-ok").click()
    page.on("dialog", lambda d: d.dismiss())
    page.get_by_test_id("form-ok").click()
    expect(page.locator(".error")).to_contain_text("密钥", timeout=10_000)
    ctx.close()


def test_story_book_and_mood_chart(page: Page, base: str, shot) -> None:
    page.goto(f"{base}/app/")
    page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy",color:"sun",tone:"curious"}))')
    page.reload()
    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("tab-book").click()
    expect(page.get_by_test_id("book")).to_be_visible()
    expect(page.get_by_test_id("chapter-locked").first).to_be_visible()
    # 章节比屏幕高时，故事书自己能往下滚（body 是 overflow:hidden）
    page.set_viewport_size({"width": 390, "height": 600})
    book = page.get_by_test_id("book")
    assert book.evaluate("b => b.scrollHeight > b.clientHeight")
    book.hover()
    page.mouse.wheel(0, 600)
    page.wait_for_function("document.querySelector('[data-testid=book]').scrollTop > 0")
    page.set_viewport_size({"width": 1280, "height": 820})
    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("tab-diary").click()
    expect(page.locator("[data-testid=mood] canvas")).to_have_attribute("data-points", re.compile(r"^\d+$"))
    shot(page, "14-book-mood")


def test_timezone_synced_and_sky_follows_local_time(browser, base: str) -> None:
    ctx = browser.new_context(timezone_id="America/Los_Angeles", viewport={"width": 1280, "height": 820}, locale="zh-CN")
    page = ctx.new_page()
    page.goto(f"{base}/app/?bg_hour=22")
    page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy",tone:"curious"}))')
    page.reload()
    expect(page.locator("body")).to_have_attribute("data-daypart", "night", timeout=10_000)
    tz = "fetch('/v1/persona',{headers:{Authorization:'Bearer '+(window.OLO_CONFIG.token||localStorage.getItem('olo.token')||'').replace(/\"/g,'')}}).then(r=>r.json()).then(j=>j.timezone)"
    for _ in range(20):
        if page.evaluate(tz) == "America/Los_Angeles":
            break
        page.wait_for_timeout(250)
    assert page.evaluate(tz) == "America/Los_Angeles"
    expect(page.get_by_test_id("hero")).to_have_attribute("data-celestial", "moon")
    page.goto(f"{base}/app/?bg_hour=12")
    expect(page.locator("body")).to_have_attribute("data-daypart", "day", timeout=10_000)
    expect(page.get_by_test_id("hero")).to_have_attribute("data-celestial", "sun")
    expect(page.get_by_test_id("hero")).to_have_attribute("data-daypart", "day")
    page.goto(f"{base}/app/?bg_hour=6.2")
    expect(page.get_by_test_id("hero")).to_have_attribute("data-celestial", "sun", timeout=10_000)
    ctx.close()


def test_history_survives_reload_and_profile_sheet_is_centered(browser, base: str) -> None:
    for vp in ({"width": 1280, "height": 800}, {"width": 390, "height": 844}):
        ctx = browser.new_context(viewport=vp, locale="zh-CN")
        page = ctx.new_page()
        page.goto(f"{base}/app/")
        page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy"}))')
        page.reload()
        page.get_by_test_id("chat-input").fill("记得这句：橘子汽水")
        page.get_by_test_id("send").click()
        expect(page.locator("form[data-busy]")).to_have_count(0, timeout=15_000)
        for url in (f"{base}/app/", f"{base}/app/?bg_hour=22"):
            page.goto(url)
            expect(page.locator(".msg.user", has_text="橘子汽水").last).to_be_visible(timeout=5_000)
        # olo眼里的你：弹层居中
        page.get_by_test_id("menu-btn").click()
        page.get_by_test_id("profile-btn").click()
        box = page.get_by_test_id("profile-sheet").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        assert abs(cx - vp["width"] / 2) < 4, (cx, vp)
        assert abs(cy - vp["height"] / 2) < 4, (cy, vp)
        ctx.close()


def test_form_colors_ignore_stored_color(page: Page, base: str) -> None:
    """小团子永远暖橘色；云朵/微光也不随存储的 color 变。"""
    page.goto(f"{base}/app/")
    same = page.evaluate(
        """async () => {
          const { drawOlo } = await import('./pixel.js');
          const draw = (form, color) => { const c = document.createElement('canvas'); c.width = c.height = 32;
            drawOlo(c.getContext('2d'), { form, color, state: 'happy', t: 7 }); return c.toDataURL(); };
          const out = {};
          for (const f of ['buddy', 'cloud', 'glow']) out[f] = ['blush', 'mint', 'sky', 'lavender', 'nope'].every((k) => draw(f, k) === draw(f, 'sun'));
          return out;
        }"""
    )
    assert same == {"buddy": True, "cloud": True, "glow": True}


def test_shop_claim_buy_equip(page: Page, base: str, shot) -> None:
    """商店：每日领取 → （调试）加代币 → 买云朵 → 换上，角色立刻变；代币不够时提示。"""
    page.goto(f"{base}/app/")
    page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy"}))')
    page.reload()
    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("shop-btn").click()
    sheet = page.get_by_test_id("shop-sheet")
    expect(sheet).to_be_visible()
    tokens = sheet.get_by_test_id("shop-tokens")
    expect(tokens).not_to_have_text("◆ …")
    claim = sheet.get_by_test_id("shop-claim")
    if claim.is_enabled():
        before = int(tokens.inner_text().split()[-1])
        claim.click()
        expect(sheet.get_by_test_id("shop-msg")).to_contain_text("领到")
        expect(tokens).to_have_text(f"◆ {before + 5}")
    expect(claim).to_have_text("今天已经领过了")
    expect(claim).to_be_disabled()

    grant = sheet.get_by_test_id("shop-debug-grant")
    debug = page.evaluate("!!(window.OLO_CONFIG||{}).debug")
    assert grant.count() == (1 if debug else 0)
    if debug:
        before = int(tokens.inner_text().split()[-1])
        grant.click()
        expect(tokens).to_have_text(f"◆ {before + 100}")

    buy = sheet.get_by_test_id("buy-form:cloud")
    if buy.is_enabled():
        # 云朵还没买：装扮里是锁着的，点了只提示
        sheet.get_by_test_id("equip-form-cloud").click(force=True)  # aria-disabled：Playwright 视为不可点
        expect(sheet.get_by_test_id("shop-msg")).to_contain_text("先在下面买下")
        if int(tokens.inner_text().split()[-1]) < 50:
            pytest.skip("not enough tokens without OLO_DEBUG=1")
        buy.click()
        expect(sheet.get_by_test_id("shop-msg")).to_contain_text("解锁了")
    expect(buy).to_contain_text("已拥有")
    sheet.get_by_test_id("equip-form-cloud").click()
    expect(sheet.get_by_test_id("equip-form-cloud")).to_have_class(re.compile(r"\bon\b"))
    expect(sheet.locator("canvas[data-olo-form=cloud]")).to_have_count(1)
    assert page.evaluate('JSON.parse(localStorage.getItem("olo.profile")).form') == "cloud"
    shot(page, "web-shop")

    # 一直买，直到代币不够：提示要友好
    if debug:
        for _ in range(20):
            left = sheet.locator("[data-buy]:not([disabled])")
            if left.count() == 0:
                break
            left.first.click()
            page.wait_for_timeout(250)
            if "代币不够" in sheet.get_by_test_id("shop-msg").inner_text():
                break
        if sheet.locator("[data-buy]:not([disabled])").count():
            expect(sheet.get_by_test_id("shop-msg")).to_contain_text("代币不够")

    # 换回小团子，刷新后保持
    sheet.get_by_test_id("equip-form-buddy").click()
    expect(sheet.get_by_test_id("equip-form-buddy")).to_have_class(re.compile(r"\bon\b"))
    page.reload()
    assert page.evaluate('JSON.parse(localStorage.getItem("olo.profile")).form') == "buddy"


_COUNT_RGB = """([sel, rgb]) => { const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) n++; return n; }"""


def test_accessories_render_on_every_form(page: Page, base: str) -> None:
    """每种发型/眼睛/脸颊在三个形态上都要画出来（和默认外观的像素不一样），各个状态都不报错。"""
    page.goto(f"{base}/app/")
    bad = page.evaluate("""async () => {
      const { drawOlo } = await import('./pixel.js');
      const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
      const img = (o) => { x.clearRect(0, 0, 32, 32); drawOlo(x, { t: 7, state: 'idle', ...o }); return c.toDataURL(); };
      const looks = [...['bow','leaf','spikes','curl','crest','bun','sun','halo','straw'].map((v) => ({ hair: v })), { eyes: 'almond' },
        ...['dots','triangle','warpaint','none'].map((v) => ({ cheeks: v }))];
      const bad = [];
      for (const form of ['buddy', 'cloud', 'glow']) {
        const base = img({ form });
        for (const lk of looks) if (!(form === 'glow' && lk.cheeks === 'none') && img({ form, ...lk }) === base) bad.push(form + ':' + JSON.stringify(lk));
        for (const state of ['idle','happy','sad','thinking','sleepy','talking']) img({ form, state, hair: 'halo', eyes: 'almond', cheeks: 'warpaint' });
      }
      return bad;
    }""")
    assert bad == []


def test_shop_equip_hair_changes_sprite(page: Page, base: str, shot) -> None:
    """买下蝴蝶结并换上：预览和主角画布上都出现蝴蝶结的像素。"""
    page.goto(f"{base}/app/")
    if not page.evaluate("!!(window.OLO_CONFIG||{}).debug"):
        pytest.skip("needs OLO_DEBUG=1 for tokens")
    page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy"}))')
    page.reload()
    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("shop-btn").click()
    sheet = page.get_by_test_id("shop-sheet")
    expect(sheet.get_by_test_id("shop-tokens")).not_to_have_text("◆ …")
    sheet.get_by_test_id("equip-hair-none").click()
    expect(sheet.locator("canvas[data-hair=none]")).to_have_count(1)
    pink = [0xFF, 0x6F, 0x96]
    sel = ".shop-preview canvas"
    assert page.evaluate(_COUNT_RGB, [sel, pink]) == 0
    buy = sheet.get_by_test_id("buy-hair:bow")
    if buy.is_enabled():
        sheet.get_by_test_id("shop-debug-grant").click()
        expect(sheet.get_by_test_id("shop-msg")).to_contain_text("+100")
        buy.click()
        expect(buy).to_contain_text("已拥有")
    sheet.get_by_test_id("equip-hair-bow").click()
    expect(sheet.locator("canvas[data-hair=bow]")).to_have_count(1)
    page.wait_for_timeout(300)
    assert page.evaluate(_COUNT_RGB, [sel, pink]) > 0
    assert page.evaluate('JSON.parse(localStorage.getItem("olo.profile")).hair') == "bow"
    shot(page, "web-shop-equipped")
    sheet.locator("button[value=close]").click()
    page.wait_for_timeout(300)
    assert page.evaluate(_COUNT_RGB, ["[data-testid=hero] canvas", pink]) > 0


def _force_form(page: Page, form: str) -> None:
    """服务器人设里的形态优先于本地缓存：拦截 GET /v1/persona，只改返回的 appearance.form。"""

    def handle(route):
        if route.request.method != "GET":
            return route.continue_()
        r = route.fetch()
        body = r.json()
        body.setdefault("appearance", {})["form"] = form
        route.fulfill(response=r, json=body)

    page.route("**/v1/persona", handle)


def _hero_point(page: Page, sx: float, sy: float):
    """角色身体（全屏覆盖层里唯一可点的区域）的中心。"""
    b = page.get_by_test_id("hero-hit").bounding_box()
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


@pytest.mark.parametrize("form", ["buddy", "cloud", "glow"])
def test_hero_drag_fling_bounce_settle(page: Page, base: str, form: str, shot) -> None:
    """抓起角色：惊讶表情 + 跟手；甩出去后撞边/落地挤压回弹，最后蹦回原位、恢复表情。"""
    page.goto(f"{base}/app/")
    _force_form(page, form)
    page.evaluate(f'localStorage.setItem("olo.profile", JSON.stringify({{name:"olo",form:"{form}"}}))')
    page.reload()
    hero = page.get_by_test_id("hero")
    expect(hero).to_have_attribute("data-drag", "home")
    page.wait_for_timeout(500)
    assert page.evaluate('JSON.parse(localStorage.getItem("olo.profile")).form') == form
    x, y = _hero_point(page, 48, 22)
    page.mouse.move(x, y)
    page.mouse.down()
    expect(hero).to_have_attribute("data-drag", "held")
    for i in range(1, 9):
        page.mouse.move(x - i * 6, y - i * 8)
        page.wait_for_timeout(16)
    if form == "buddy":
        shot(page, "web-drag-held")
    for i in range(1, 6):  # 往右上方甩出去
        page.mouse.move(x - 48 + i * 24, y + 16 - i * 30)
        page.wait_for_timeout(12)
    expect(hero).to_have_attribute("data-squash", re.compile("held"))  # 甩动时沿速度方向拉伸
    page.mouse.up()
    expect(hero).to_have_attribute("data-drag", re.compile("fling|return"))
    expect(hero).to_have_attribute("data-squash", re.compile("fling"), timeout=5_000)  # 撞边/落地时挤压
    expect(hero).to_have_attribute("data-drag", "home", timeout=10_000)
    # 聊天布局不受影响
    expect(page.get_by_test_id("chat-input")).to_be_visible()


def _ready(page: Page, base: str) -> None:
    page.goto(f"{base}/app/")
    page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy"}))')
    page.reload()
    expect(page.get_by_test_id("hero")).to_have_attribute("data-drag", "home")


_OVERLAP = """() => { const h = window.__oloStage.rect(), lr = document.querySelector('.msgs').getBoundingClientRect();
  return [...document.querySelectorAll('.msg > span')].map(e => e.getBoundingClientRect())
    .filter(r => r.bottom > lr.top && r.top < lr.bottom)
    .some(r => h.l < r.right && h.r > r.left && h.t < r.bottom && h.b > r.top); }"""


def test_olo_perch_varies_and_never_covers_text(page: Page, base: str) -> None:
    """olo 不再总站在最新一句回复末端：换着待在不同气泡顶、输入框边；身体从不压住气泡文字；覆盖层不挡点击。"""
    _ready(page, base)
    hero = page.get_by_test_id("hero")
    expect(page.locator(".chat-hero")).to_have_count(0)
    for t in ["嗨", "今天好累", "想吃火锅"]:
        page.get_by_test_id("chat-input").fill(t)
        page.get_by_test_id("send").click()
        expect(page.get_by_test_id("send")).to_be_enabled(timeout=15_000)
    expect(hero).to_have_attribute("data-drag", "home", timeout=5_000)
    assert not page.evaluate(_OVERLAP)
    keys = set()
    for _ in range(10):
        keys.add(page.evaluate("() => window.__oloStage.repick().key"))
        expect(hero).to_have_attribute("data-drag", "home", timeout=5_000)
        page.wait_for_timeout(150)
        assert not page.evaluate(_OVERLAP), "olo 挡住了气泡文字"
        hb = page.get_by_test_id("hero-hit").bounding_box()
        assert hb["y"] > 40
    assert len(keys) >= 3, keys
    n = page.locator(".msg").count()
    assert keys != {f"bubble-{n - 1}"}
    # 覆盖层不拦截：输入框还能点
    stage = page.locator(".olo-stage")
    assert stage.evaluate("e => getComputedStyle(e).pointerEvents") == "none"
    page.get_by_test_id("chat-input").click()
    page.keyboard.type("x")
    expect(page.get_by_test_id("chat-input")).to_have_value("x")
    # 窗口变窄（重排）后仍不压文字
    page.set_viewport_size({"width": 420, "height": 820})
    page.wait_for_timeout(1500)
    expect(hero).to_have_attribute("data-drag", "home", timeout=5_000)
    assert not page.evaluate(_OVERLAP)


def test_room_scene_tap_throw_and_back_to_chat(page: Page, base: str, shot) -> None:
    """收起聊天 → 2.5D 雾里集小广场：点一下有反应，甩出去会弹回，按钮回到聊天。"""
    _ready(page, base)
    page.get_by_test_id("room-toggle").click()
    room = page.get_by_test_id("room")
    expect(room).to_be_visible()
    expect(page.get_by_test_id("chat-input")).to_be_hidden()
    expect(page.get_by_test_id("hero")).to_be_hidden()
    order = room.get_attribute("data-order").split(",")
    assert "olo" in order and "well" in order
    assert room.get_attribute("data-daypart") in ("dawn", "day", "dusk", "night")
    page.wait_for_timeout(300)
    page.evaluate("1")
    def pt():
        b = room.locator("canvas").bounding_box()
        return b["x"] + float(room.get_attribute("data-x")), b["y"] + float(room.get_attribute("data-y")) - 20
    x, y = pt()
    page.mouse.click(x, y)
    expect(room).to_have_attribute("data-taps", "1", timeout=3_000)
    page.wait_for_timeout(1200)
    x, y = pt()
    page.mouse.move(x, y)
    page.mouse.down()
    expect(room).to_have_attribute("data-drag", "held")
    for i in range(1, 7):
        page.mouse.move(x + i * 20, y - i * 18)
        page.wait_for_timeout(14)
    page.mouse.up()
    expect(room).to_have_attribute("data-squash", re.compile("fling"), timeout=5_000)
    expect(room).to_have_attribute("data-drag", "home", timeout=10_000)
    # 顶部状态栏 + 去处互动：点「水井」→ olo 走过去看井并冒气泡说话；点「叫它过来」→ 跑回跟前
    expect(page.get_by_test_id("room-hud")).to_be_visible()
    expect(page.get_by_test_id("room-clock")).to_contain_text(":")
    # 去处按钮可能正好被 olo / 球挡在下面（位置随甩出的落点而变）：按无障碍点击触发，避免抖动
    page.get_by_test_id("spot-well").dispatch_event("click")
    expect(room).to_have_attribute("data-spot", "well")
    expect(room).to_have_attribute("data-act", "well", timeout=6_000)
    expect(page.get_by_test_id("room-bubble")).to_be_visible()
    expect(page.get_by_test_id("room-doing")).to_contain_text("井")
    shot(page, "web-room")
    page.get_by_test_id("room-call").click()
    expect(room).to_have_attribute("data-spot", "come")
    page.get_by_test_id("room-open-chat").click()
    expect(page.get_by_test_id("chat-input")).to_be_visible()
    expect(page.get_by_test_id("hero")).to_be_visible()


def test_stage_reduced_motion(browser, base: str) -> None:
    ctx = browser.new_context(reduced_motion="reduce")
    page = ctx.new_page()
    _ready(page, base)
    page.get_by_test_id("room-toggle").click()
    room = page.get_by_test_id("room")
    x0 = room.get_attribute("data-x")
    page.wait_for_timeout(1500)
    assert room.get_attribute("data-x") == x0  # 不闲逛
    page.get_by_test_id("spot-bench").click()
    expect(room).to_have_attribute("data-act", "bench")
    expect(page.get_by_test_id("room-bubble")).to_be_visible()
    ctx.close()


def _world(page: Page, base: str, q: str = ""):
    _ready(page, base)
    page.get_by_test_id("room-toggle").click()
    w = page.get_by_test_id("room")
    expect(w).to_have_attribute("data-chat", "0")
    page.wait_for_function("() => !!window.__oloWorld")
    return w


def test_world_fullscreen_travel_weather(page: Page, base: str, shot) -> None:
    """雾里集铺满整个视口（没有外框）；地图能去四个地方；天气可切换。"""
    w = _world(page, base)
    b = w.locator("canvas").bounding_box()
    vp = page.viewport_size
    assert b["x"] <= 0 and b["y"] <= 0 and b["width"] >= vp["width"] and b["height"] >= vp["height"]
    assert w.get_attribute("data-scene") == "plaza"
    for sc in ["house", "lake", "roof", "plaza"]:
        page.get_by_test_id("world-map-btn").click()
        page.get_by_test_id(f"travel-{sc}").click()
        expect(w).to_have_attribute("data-scene", sc, timeout=4_000)
    seen = set()
    for _ in range(4):
        page.get_by_test_id("world-weather").click()
        seen.add(w.get_attribute("data-weather"))
    assert seen == {"clear", "rain", "snow", "fog"}
    # 走到东边出口 → 林间湖
    page.evaluate("() => { const W = window.__oloWorld; W.D.x = 13.4; W.D.y = 5.5; }")
    page.get_by_test_id("spot-sign").dispatch_event("click")
    expect(w).to_have_attribute("data-scene", "lake", timeout=8_000)
    page.wait_for_timeout(600)
    assert float(w.get_attribute("data-ms")) < 12  # 每帧绘制耗时（毫秒）
    shot(page, "web-world-lake")


def test_world_plant_find_fish_feed_ball(page: Page, base: str) -> None:
    """浇花→隔天长高；捡收集物得代币；钓鱼；喂包子；踢球。"""
    w = _world(page, base)
    page.get_by_test_id("spot-pot").dispatch_event("click")
    expect(w).to_have_attribute("data-act", "water", timeout=8_000)
    st = lambda: page.evaluate("() => window.__oloWorld.state().plants['plaza-pot']")
    expect(w).not_to_have_attribute("data-act", "water", timeout=8_000)
    assert st()["stage"] == 0 and st()["watered"]
    page.evaluate("() => window.__oloWorld.nextDay()")
    assert st()["stage"] == 1
    # 包子：蘑菇婶给一个，olo 去吃
    page.get_by_test_id("spot-stall").dispatch_event("click")
    expect(w).to_have_attribute("data-act", "stall", timeout=8_000)
    page.wait_for_function("() => window.__oloWorld.items().some(i => i.kind === 'bun')")
    page.wait_for_timeout(1500)
    x, y = page.evaluate("() => { const b = window.__oloWorld.items().find(i => i.kind === 'bun'); return window.__oloWorld.w2s(b.x, b.y, 3); }")
    page.mouse.click(x, y)
    expect(w).to_have_attribute("data-fed", "1", timeout=10_000)
    # 踢球（先把 olo 挪开，免得点到它身上）
    page.evaluate("() => { const W = window.__oloWorld; W.D.x = 4; W.D.y = 7; }")
    x, y = page.evaluate("() => { const b = window.__oloWorld.items().find(i => i.kind === 'ball'); return window.__oloWorld.w2s(b.x, b.y, 3); }")
    page.mouse.click(x, y)
    expect(w).to_have_attribute("data-kicks", re.compile(r"[1-9]"), timeout=10_000)
    # 去湖边：捡一个收集物 → 代币变多
    t0 = int(w.get_attribute("data-tokens") or 0)
    page.evaluate("() => window.__oloWorld.travel('lake')")
    page.wait_for_function("() => window.__oloWorld.finds().length > 0")
    x, y = page.evaluate("() => { const f = window.__oloWorld.finds()[0]; return window.__oloWorld.w2s(f.x, f.y, 2); }")
    page.mouse.click(x, y)
    page.wait_for_function(f"() => +document.querySelector('[data-testid=room]').dataset.tokens > {t0}", timeout=12_000)
    # 钓鱼：咬钩时点屏幕
    page.get_by_test_id("spot-dock").dispatch_event("click")
    expect(w).to_have_attribute("data-act", "fish", timeout=10_000)
    page.evaluate("() => window.__oloWorld.bite()")
    page.wait_for_timeout(300)
    page.mouse.click(40, 400)
    expect(w).to_have_attribute("data-fish", "1", timeout=3_000)


def test_world_behind_chat(page: Page, base: str) -> None:
    """聊天时世界在后面当背景（压暗、不可点），olo 站在气泡上。"""
    _ready(page, base)
    w = page.get_by_test_id("room")
    expect(w).to_have_attribute("data-chat", "1")
    assert w.locator("canvas").evaluate("e => getComputedStyle(e).pointerEvents") == "none"
    expect(page.get_by_test_id("hero")).to_be_visible()
    expect(page.get_by_test_id("chat-input")).to_be_visible()
