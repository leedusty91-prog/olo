"""浏览器端到端：故事引导 → 起名/选样子/选性子 → 流式聊天 → 倒影小镇 → 日记。

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
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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
    expect(bubbles.nth(1)).to_contain_text("涟漪兽")
    expect(bubbles.nth(2)).to_contain_text("倒影国")
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


def test_skip_story_on_mobile_viewport(browser, base: str, fresh_account) -> None:
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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
    page.goto(f"{base}/app/?embed=1&nofilm=1&bg_hour=22")
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
    page.goto(f"{base}/app/?embed=1&bg_hour=12")
    expect(page.locator("body")).to_have_attribute("data-daypart", "day", timeout=10_000)
    expect(page.get_by_test_id("hero")).to_have_attribute("data-celestial", "sun")
    expect(page.get_by_test_id("hero")).to_have_attribute("data-daypart", "day")
    page.goto(f"{base}/app/?embed=1&bg_hour=6.2")
    expect(page.get_by_test_id("hero")).to_have_attribute("data-celestial", "sun", timeout=10_000)
    ctx.close()


def test_history_survives_reload_and_profile_sheet_is_centered(browser, base: str) -> None:
    for vp in ({"width": 1280, "height": 800}, {"width": 390, "height": 844}):
        ctx = browser.new_context(viewport=vp, locale="zh-CN")
        page = ctx.new_page()
        page.goto(f"{base}/app/?embed=1&nofilm=1")
        page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy"}))')
        page.reload()
        page.get_by_test_id("chat-input").fill("记得这句：橘子汽水")
        page.get_by_test_id("send").click()
        expect(page.locator("form[data-busy]")).to_have_count(0, timeout=15_000)
        for url in (f"{base}/app/?embed=1&nofilm=1", f"{base}/app/?embed=1&nofilm=1&bg_hour=22"):
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
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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


def test_shop_claim_buy_equip(page: Page, base: str, shot, grant_tokens) -> None:
    """商店：每日领取 → （测试 fixture 写库）加代币 → 买云朵 → 换上，角色立刻变；代币不够时提示。"""
    grant_tokens(120)
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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
        msg = sheet.get_by_test_id("shop-msg")
        expect(msg).to_contain_text("领到")
        got = int(re.search(r"领到 (\d+)", msg.inner_text()).group(1))  # 免费 5，olo+（前面的用例可能开通过）更多
        assert got >= 5
        expect(tokens).to_have_text(f"◆ {before + got}")
    expect(claim).to_have_text("今天已经领过了")
    expect(claim).to_be_disabled()

    # 没开 OLO_DEBUG：调试加币按钮不出现
    expect(sheet.get_by_test_id("shop-debug-grant")).to_have_count(0)
    # 装扮里只剩形态和声音：旧的像素发型/眼睛/腮红已下架

    buy = sheet.get_by_test_id("buy-form:cloud")
    if buy.is_enabled():
        # 云朵还没买：装扮里是锁着的，点了只提示
        sheet.get_by_test_id("equip-form-cloud").click(force=True)  # aria-disabled：Playwright 视为不可点
        expect(sheet.get_by_test_id("shop-msg")).to_contain_text("先在下面买下")
        assert int(tokens.inner_text().split()[-1]) >= 50
        buy.click()
        expect(sheet.get_by_test_id("shop-msg")).to_contain_text("解锁了")
    expect(buy).to_contain_text("已拥有")
    sheet.get_by_test_id("equip-form-cloud").click()
    expect(sheet.get_by_test_id("equip-form-cloud")).to_have_class(re.compile(r"\bon\b"))
    expect(sheet.locator("canvas[data-olo-form=cloud]")).to_have_count(1)
    assert page.evaluate('JSON.parse(localStorage.getItem("olo.profile")).form') == "cloud"
    shot(page, "web-shop")

    # 一直买，直到代币不够：提示要友好
    if True:
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


def test_accessories_render_on_every_form(page: Page, base: str) -> None:
    """每种发型/眼睛/脸颊在三个形态上都要画出来（和默认外观的像素不一样），各个状态都不报错。"""
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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


_COUNT_RGB = """([sel, rgb]) => { const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2]) n++; return n; }"""


def test_shop_equip_hair_changes_sprite(page: Page, base: str, shot) -> None:
    """买下蝴蝶结并换上：预览和主角画布上都出现蝴蝶结的像素。"""
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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
    page.goto(f"{base}/app/?embed=1&nofilm=1")
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


def _ready(page: Page, base: str, q: str = "") -> None:
    q = q.lstrip("?")
    page.goto(f"{base}/app/?embed=1&nofilm=1" + (f"&{q}" if q else ""))
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
        expect(hero).to_have_attribute("data-drag", "home", timeout=10_000)  # 4 倍大的角色跳得更远，CI 上慢机器要多等一会儿
        page.wait_for_timeout(150)
        assert not page.evaluate(_OVERLAP), "olo 挡住了气泡文字"
        hb = page.get_by_test_id("hero-hit").bounding_box()
        assert hb["y"] > 40
    # 主页角色放大到 4 倍后，短对话里不挡字的落脚点变少：至少要在两处以上换着待（最新气泡顶 + 输入框边）
    assert len(keys) >= 2, keys
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
    """收起聊天 → 2.5D 倒影小镇小广场：点一下有反应，甩出去会弹回，按钮回到聊天。"""
    _ready(page, base)
    page.get_by_test_id("room-toggle").click()
    room = page.get_by_test_id("room")
    expect(room).to_be_visible()
    expect(page.get_by_test_id("chat-input")).to_be_hidden()
    expect(page.get_by_test_id("hero")).to_be_hidden()
    order = room.get_attribute("data-order").split(",")
    assert "olo" in order and "well" in order
    assert room.get_attribute("data-daypart") in ("dawn", "day", "dusk", "night")
    page.wait_for_timeout(900)  # 等聊天→倒影小镇的镜头推拉（0.8s）落定
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
    _ready(page, base, q)
    page.get_by_test_id("room-toggle").click()
    w = page.get_by_test_id("room")
    expect(w).to_have_attribute("data-chat", "0")
    page.wait_for_function("() => !!window.__oloWorld")
    return w


def test_world_fullscreen_travel_weather(page: Page, base: str, shot) -> None:
    """倒影小镇铺满整个视口（没有外框）；地图能去四个地方；天气可切换。"""
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


@pytest.mark.parametrize("width", [1280, 420])
def test_multi_bubble_reply_stays_grouped(page: Page, base: str, width: int, shot) -> None:
    """同一轮 olo 连发的多条气泡紧挨成一组、按顺序排列；olo 的站位空间只留在整组最上方，不把最后一条单独隔开。"""
    _ready(page, base)
    msgs = [
        {"role": "user", "body": "考试的事我还在想"},
        {"role": "assistant", "body": "嗯嗯，我在听。"},
        {"role": "user", "body": "没有呀"},
        {"role": "assistant", "body": "哦……那现在心里是不是还挂着它。\n\n老师那边有说什么吗？\n\n不想说也没关系呀。"},
    ]
    page.route(re.compile(r".*/v1/sessions/[^/]+/messages.*"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"messages": msgs})))
    page.evaluate("localStorage.setItem('olo.session', JSON.stringify(localStorage.getItem('olo.session') ? JSON.parse(localStorage.getItem('olo.session')) : 'e2e-session'))")
    page.set_viewport_size({"width": width, "height": 820})
    page.reload()
    expect(page.locator(".msg").last).to_have_text("不想说也没关系呀。", timeout=10_000)
    page.wait_for_timeout(600)
    boxes = page.evaluate("[...document.querySelectorAll('.msg > span')].map(s => { const r = s.getBoundingClientRect(); return {t: s.textContent, top: r.top, bottom: r.bottom, left: r.left} })")
    group = boxes[-3:]
    assert [b["t"] for b in group] == ["哦……那现在心里是不是还挂着它。", "老师那边有说什么吗？", "不想说也没关系呀。"]
    for a, b in zip(group, group[1:]):
        gap = b["top"] - a["bottom"]
        assert 0 <= gap <= 24, f"组内气泡间距异常 {gap}px"
        assert abs(a["left"] - b["left"]) <= 1, "组内气泡没有左对齐"
    # 新发的一句和 olo 的回复之间是普通间距，不再额外留 olo 的站位空白
    user = boxes[-4]
    assert user["t"] == "没有呀"
    assert 0 <= group[0]["top"] - user["bottom"] <= 30, f"用户气泡和回复间距过大 {group[0]['top'] - user['bottom']}px"
    assert page.locator(".msg.perch-top").count() == 1
    assert page.locator(".msg.perch-top > span").inner_text() == group[0]["t"]
    shot(page, f"bubbles-grouped-{width}")


def test_world_flight_touch_peek_water_vista(page: Page, base: str) -> None:
    """换场景是镜头飞过去；点东西会弹、出信息卡；能"看里面"；水面有涟漪；走到地图边看到远景。"""
    w = _world(page, base)
    page.get_by_test_id("world-map-btn").click()
    page.get_by_test_id("travel-lake").click()
    expect(w).to_have_attribute("data-flight", re.compile(r"\S+"), timeout=2_000)
    expect(w).to_have_attribute("data-scene", "lake", timeout=4_000)
    expect(w).to_have_attribute("data-flight", "", timeout=4_000)
    # 水面点一下 → 涟漪
    n0 = int(w.get_attribute("data-ripples") or 0)
    page.evaluate("() => window.__oloWorld.ripple(9, 6)")
    assert int(w.get_attribute("data-ripples") or 0) > n0
    # 去家里：摸一摸坛子 → 信息卡；看里面
    page.evaluate("() => window.__oloWorld.travel('house')")
    expect(w).to_have_attribute("data-scene", "house")
    page.evaluate("() => window.__oloWorld.touch('jar')")
    info = page.get_by_test_id("world-info")
    expect(info).to_be_visible()
    page.get_by_test_id("info-peek").click()
    expect(w).to_have_attribute("data-peek", "jar")
    page.wait_for_timeout(500)
    page.locator(".world canvas").click(position={"x": 30, "y": 300})
    expect(w).to_have_attribute("data-peek", "")
    # 回广场，走到地图边 → 远景展开
    page.evaluate("() => window.__oloWorld.travel('plaza')")
    page.evaluate("() => { const W = window.__oloWorld; W.D.x = 1.2; W.D.y = 1.2; }")
    expect(w).to_have_attribute("data-vista", "1", timeout=4_000)
    assert float(w.get_attribute("data-ms")) < 12


def test_world_hidden_treasures_go_into_diary(page: Page, base: str, shot) -> None:
    """倒影小镇藏了 6 枚彩色倒影：点到一件，olo 走过去捡起来，HUD 计数 +1，日记里多一篇；刷新后不再出现。"""
    w = _world(page, base)
    expect(page.get_by_test_id("world-treasures")).to_have_text("✦ 0/6")
    ids = page.evaluate("() => window.__oloWorld.treasures().map(t => t.id)")
    assert sorted(ids) == ["brass-key", "lantern-seed", "paper-crane"]
    page.evaluate("() => { const W = window.__oloWorld; W.D.x = 3; W.D.y = 5; }")
    # 等镜头跟完（treasure 的屏幕坐标两次读数一致）再点
    page.wait_for_function("""() => { const a = JSON.stringify(window.__oloWorld.treasures().find(t => t.id === 'brass-key'));
      const s = (window.__trS = window.__trS || { a: null, n: 0 }); if (s.a === a) s.n++; else { s.a = a; s.n = 0; } return s.n > 5; }""", polling=100, timeout=10_000)
    t = page.evaluate("() => window.__oloWorld.treasures().find(t => t.id === 'brass-key')")
    box = w.locator("canvas").bounding_box()
    page.mouse.click(box["x"] + t["X"] * t["k"], box["y"] + (t["Y"] - 2) * t["k"])
    expect(w).to_have_attribute("data-treasures", "1", timeout=10_000)
    expect(page.get_by_test_id("world-treasures")).to_have_text("✦ 1/6")
    expect(page.get_by_test_id("world-info")).to_contain_text("钥匙的倒影")
    expect(page.get_by_test_id("info-go")).to_be_hidden()
    shot(page, "web-world-treasure")
    page.wait_for_timeout(500)
    diary = page.evaluate("fetch('/v1/notebook',{headers:{Authorization:'Bearer '+(window.OLO_CONFIG.token||localStorage.getItem('olo.token')||'').replace(/\"/g,'')}}).then(r=>r.json()).then(j=>j.entries)")
    assert any(e["kind"] == "treasure-brass-key" and "1/6" in e["title"] for e in diary)
    page.reload()
    w = _world(page, base)
    expect(page.get_by_test_id("world-treasures")).to_have_text("✦ 1/6", timeout=6_000)
    assert "brass-key" not in page.evaluate("() => window.__oloWorld.treasures().map(t => t.id)")


def test_diary_clip_plays_and_saves(page: Page, base: str) -> None:
    """日记每一篇都能变成几秒的像素小短片，并能存成视频。"""
    _ready(page, base)
    page.get_by_test_id("chat-input").fill("今天下雨了，去湖边看了看")
    page.get_by_test_id("send").click()
    expect(page.locator("form[data-busy]")).to_have_count(0, timeout=15_000)
    page.get_by_test_id("menu-btn").click()
    page.get_by_test_id("tab-diary").click()
    page.get_by_test_id("write-diary").click()
    activate = page.get_by_test_id("activate")
    page.wait_for_timeout(800)
    if activate.is_visible():
        activate.click()
        page.get_by_test_id("write-diary").click()
    page.get_by_test_id("diary-clip-btn").first.click()
    clip = page.get_by_test_id("diary-clip")
    expect(clip).to_be_visible()
    cv = page.get_by_test_id("clip-canvas")
    expect(cv).to_have_attribute("data-done", "1", timeout=20_000)
    page.get_by_test_id("clip-save").click()
    expect(clip).to_have_attribute("data-bytes", re.compile(r"^[1-9]\d*$"), timeout=30_000)
    page.get_by_test_id("clip-close").click()
    expect(clip).to_be_hidden()


def test_desktop_shows_phone_frame(browser, base: str) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 820})
    page = ctx.new_page()
    page.goto(f"{base}/app/")
    frame = page.locator("#olo-phone")
    frame.wait_for(timeout=10000)
    assert "embed=phone" in frame.get_attribute("src")
    assert "token" not in frame.get_attribute("src")
    inner = page.frame_locator("#olo-phone")
    assert inner.locator("#root").count() == 1
    assert page.frames[1].evaluate("innerWidth") == 390
    ctx.close()


def test_narrow_and_shell_not_framed(browser, base: str) -> None:
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    page.goto(f"{base}/app/")
    page.wait_for_selector("#root", state="attached")
    assert page.locator("#olo-phone").count() == 0
    ctx.close()
    ctx = browser.new_context(viewport={"width": 1280, "height": 820})
    ctx.add_init_script("window.OLO_NATIVE_SHELL = true")
    page = ctx.new_page()
    page.goto(f"{base}/app/")
    page.wait_for_selector("#root", state="attached")
    assert page.locator("#olo-phone").count() == 0
    ctx.close()


_WARMTH = """() => { const c = document.querySelector('[data-testid=room] canvas'); const x = c.getContext('2d');
  const d = x.getImageData(0, Math.floor(c.height * 0.45), c.width, Math.floor(c.height * 0.5)).data; let r = 0, b = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; b += d[i + 2]; } return (r - b) / (d.length / 16); }"""


def test_world_golden_hour(page: Page, base: str, shot) -> None:
    """按本地时间：傍晚（18 点）画面整体往琥珀色推、影子拉长；中午没有。"""
    w = _world(page, base, "?bg_hour=12")
    page.evaluate("() => window.__oloWorld.weather('clear')")
    expect(w).to_have_attribute("data-golden", "0")
    page.wait_for_timeout(400)
    noon = page.evaluate(_WARMTH)
    w = _world(page, base, "?bg_hour=18")
    page.evaluate("() => window.__oloWorld.weather('clear')")
    expect(w).to_have_attribute("data-golden", "1")
    page.wait_for_timeout(400)
    dusk = page.evaluate(_WARMTH)
    assert dusk > noon + 8, (noon, dusk)
    shot(page, "web-world-golden-hour")
    w = _world(page, base, "?bg_hour=17")
    expect(w).to_have_attribute("data-golden", "0.67")


def test_world_perf_cull_lod_batch(page: Page, base: str) -> None:
    """最重的组合（湖边 + 黄金时刻长影子 + 下雪 + 一把粒子）下每帧仍 < 12ms；屏幕外剔除、远处 LOD、小方块合批都在工作。"""
    page.set_viewport_size({"width": 390, "height": 760})
    w = _world(page, base, "?bg_hour=18")
    page.evaluate("() => { const W = window.__oloWorld; W.travel('lake'); W.weather('snow'); }")
    expect(w).to_have_attribute("data-scene", "lake")
    for _ in range(4):
        page.evaluate("() => window.__oloWorld.ripple(4, 4)")
        page.wait_for_timeout(250)
    page.wait_for_timeout(1500)
    culled, lod, rects = (int(v) for v in w.get_attribute("data-perf").split(","))
    assert lod > 0 and rects > 0, (culled, lod, rects)
    assert float(w.get_attribute("data-ms")) < 12, w.get_attribute("data-ms")
    page.evaluate("() => window.__oloWorld.travel('plaza')")
    page.wait_for_timeout(1200)
    page.set_viewport_size({"width": 360, "height": 640})
    page.evaluate("() => { const W = window.__oloWorld; W.D.x = 1; W.D.y = 9; }")  # 镜头跟到广场左下角，右边的物件在屏幕外
    page.wait_for_timeout(1500)
    culled, lod, rects = (int(v) for v in w.get_attribute("data-perf").split(","))
    assert culled > 0, (culled, lod, rects)
    assert float(w.get_attribute("data-ms")) < 12, w.get_attribute("data-ms")


def _png(w: int, h: int, rows) -> bytes:
    import struct
    import zlib

    raw = b"".join(b"\x00" + bytes(rows(y)) * w for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def test_world_photo_corner_walkable(page: Page, base: str, shot) -> None:
    """上传一张照片 → olo 生成一个像素小角落并走进去；道具可以点（走过去说话、弹信息卡）；从下边出口回广场；刷新后地图里还在。"""
    w = _world(page, base, "?bg_hour=12")
    page.evaluate("() => window.__oloWorld.weather('clear')")
    page.get_by_test_id("world-map-btn").click()
    expect(page.get_by_test_id("photo-corner-btn")).to_be_visible()
    expect(page.get_by_test_id("travel-corner")).to_be_hidden()
    beach = _png(160, 120, lambda y: (120, 190, 235) if y < 50 else (60, 130, 200) if y < 75 else (232, 212, 154))
    with page.expect_response("**/v1/world/corner") as resp:
        page.get_by_test_id("photo-corner-input").set_input_files({"name": "beach.png", "mimeType": "image/png", "buffer": beach})
    body = resp.value.request.post_data_json
    assert set(body) == {"palette", "thumb", "stats"} and len(body["thumb"]) == 108  # 只发摘要，不发原图
    assert body["stats"]["blue"] > 0.3
    expect(w).to_have_attribute("data-scene", "corner", timeout=10_000)
    c = page.evaluate("() => window.__oloWorld.corner()")
    assert c["name"] and len(c["props"]) >= 5 and any(p["id"] == "easel" for p in c["props"])
    page.wait_for_timeout(900)
    shot(page, "web-world-photo-corner")
    page.wait_for_timeout(1500)  # 进场那句话（900ms 后出现）
    expect(page.get_by_test_id("room-bubble")).to_be_hidden(timeout=10_000)
    ea = next(p for p in c["props"] if p["id"] == "easel")
    box = w.locator("canvas").bounding_box()
    page.mouse.click(box["x"] + ea["X"] * ea["k"], box["y"] + (ea["Y"] - ea["h"] / 2) * ea["k"])
    expect(page.get_by_test_id("world-info")).to_contain_text("你的照片", timeout=5_000)
    expect(page.get_by_test_id("room-doing")).to_contain_text("照片角落", timeout=10_000)
    expect(page.get_by_test_id("room-bubble")).to_contain_text("像素", timeout=10_000)
    expect(page.get_by_test_id("room-bubble")).to_be_hidden(timeout=10_000)
    page.get_by_test_id("spot-c0").dispatch_event("click")
    expect(w).to_have_attribute("data-spot", "c0", timeout=10_000)
    expect(page.get_by_test_id("room-bubble")).to_contain_text("照片里的颜色", timeout=10_000)
    assert float(w.get_attribute("data-ms")) < 12
    page.evaluate("() => { const W = window.__oloWorld; W.D.task = null; W.D.goal = null; W.D.mode = 'idle'; W.D.x = 4; W.D.y = 7.9; }")
    expect(w).to_have_attribute("data-scene", "plaza", timeout=10_000)
    page.reload()
    page.get_by_test_id("room-toggle").click()
    page.get_by_test_id("world-map-btn").click()
    expect(page.get_by_test_id("travel-corner")).to_be_visible()
    page.get_by_test_id("travel-corner").click()
    expect(page.get_by_test_id("room")).to_have_attribute("data-scene", "corner", timeout=10_000)


def test_onboarding_film_in_phone_frame(browser, base: str, fresh_account) -> None:
    """首次相遇：手机框里先放像素开场片（代码实时画的 canvas，不是视频；时间在走、字幕跟着换，可跳过），放完自己进像素标题。"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(f"{base}/app/")
    page.locator("#olo-phone").wait_for(timeout=10000)
    inner = page.frame_locator("#olo-phone")
    film = inner.get_by_test_id("film")
    expect(film).to_be_visible(timeout=10000)
    expect(inner.locator("video")).to_have_count(0)
    expect(inner.get_by_test_id("film-canvas")).to_be_visible()
    expect(inner.get_by_test_id("film-cap")).to_contain_text("倒影国", timeout=5000)
    t1 = float(film.get_attribute("data-t"))
    page.wait_for_timeout(1500)
    assert float(film.get_attribute("data-t")) > t1          # 画面在动
    # 画出来的不是一片纯色
    colors = inner.get_by_test_id("film-canvas").evaluate(
        "c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4 * 97) s.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return s.size; }")
    assert colors > 12
    shots = os.environ.get("OLO_SHOTS_DIR")
    if shots:
        Path(shots).mkdir(parents=True, exist_ok=True)
        for i, at in enumerate((7.5, 13.2, 17.8, 21.4, 22.9)):
            page.wait_for_function("at => { const f = document.querySelector('#olo-phone').contentDocument.querySelector('[data-testid=film]'); return !f || +f.dataset.t >= at; }", arg=at, timeout=30_000)
            page.screenshot(path=str(Path(shots) / f"film-{i + 1}.png"))
    # 放完（或跳过）就到像素标题
    expect(film).to_have_count(0, timeout=30_000)
    expect(inner.get_by_test_id("start")).to_be_visible()
    ctx.close()


def test_onboarding_picker_has_10_pixel_dengzi(page: Page, base: str, shot, fresh_account) -> None:
    """选样子：设定稿里那 10 种颜色的涟漪兽像素版，都能选，预览跟着换。"""
    page.goto(f"{base}/app/?embed=1&nofilm=1")
    page.get_by_test_id("skip-story").click()
    page.get_by_test_id("hello").click()
    page.get_by_test_id("name-ok").click()
    page.get_by_test_id("nickname-skip").click()
    page.get_by_test_id("gender-ok").click()
    picker = page.get_by_test_id("form-picker")
    expect(picker).to_be_visible()
    ids = ["buddy", "cloud", "glow", "bud", "dew", "star", "peach", "acorn", "moon", "amber"]
    expect(picker.locator("[data-form]")).to_have_count(10)
    for f in ids:
        expect(picker.get_by_test_id(f"form-{f}").locator("canvas.olo-sprite")).to_have_attribute("data-olo-form", f)
    page.get_by_test_id("form-moon").click()
    expect(page.locator(".preview canvas.olo-sprite").first).to_have_attribute("data-olo-form", "moon")
    shot(page, "web-onboarding-picker-10")
    page.get_by_test_id("form-ok").click()
    expect(page.get_by_test_id("olo-name")).to_be_visible(timeout=10_000)
    assert page.evaluate("JSON.parse(localStorage.getItem('olo.profile') || '{}').form") == "moon"


def test_world_photo_corner_daily_cap_toast(page: Page, base: str, shot) -> None:
    """当天造够了（服务端 429）：不报技术错误，弹一个像素小提示，场景不变。"""
    w = _world(page, base, "?bg_hour=12")
    page.route("**/v1/world/corner", lambda r: r.fulfill(status=429, content_type="application/json",
               body='{"error": {"code": "CORNER_DAILY_CAP", "message": "今天的照片角落已经造够啦"}}'))
    page.get_by_test_id("world-map-btn").click()
    page.get_by_test_id("photo-corner-input").set_input_files({"name": "a.png", "mimeType": "image/png", "buffer": _png(40, 30, lambda y: (60, 120, 60))})
    t = page.get_by_test_id("world-toast")
    expect(t).to_be_visible(timeout=10_000)
    expect(t).to_contain_text("明天再拍一张")
    assert "429" not in t.inner_text()
    expect(w).to_have_attribute("data-scene", "plaza")
    shot(page, "web-world-corner-cap-toast")
    expect(t).to_be_hidden(timeout=8_000)


def test_remeet_replays_film_then_title(browser, base: str, fresh_account) -> None:
    """设置里点「重新相遇」：账号已相遇过，也要从头再放开场片，然后回到像素标题（桌面手机框 iframe 内）。"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(f"{base}/app/?nofilm=1")
    page.locator("#olo-phone").wait_for(timeout=10000)
    f = page.frame_locator("#olo-phone")
    f.get_by_test_id("skip-story").click()
    f.get_by_test_id("hello").click()
    f.get_by_test_id("name-ok").click()
    f.get_by_test_id("nickname-skip").click()
    f.get_by_test_id("gender-ok").click()
    f.get_by_test_id("form-ok").click()
    expect(f.get_by_test_id("olo-name")).to_have_text("olo", timeout=10_000)
    # 账号上已记“相遇过”：普通刷新不会再进引导
    f.get_by_test_id("menu-btn").click()
    f.get_by_test_id("settings").click()
    f.get_by_test_id("reset").click()
    film = f.get_by_test_id("film")
    expect(film).to_be_visible(timeout=10_000)  # 即便 URL 带 nofilm，重新相遇也要放片
    f.get_by_test_id("film-skip").click()
    expect(film).to_have_count(0)
    expect(f.get_by_test_id("start")).to_be_visible()
    # 一次性：再刷新就回到主界面
    page.reload()
    expect(page.frame_locator("#olo-phone").get_by_test_id("olo-name")).to_be_visible(timeout=10_000)
    ctx.close()


def test_home_rain_window_background(page: Page, base: str) -> None:
    """主页背景是雨窗（WebGL2）：水滴在动，聊天输入照常可用，角色放大到 4 倍。"""
    _ready(page, base)
    scene = page.get_by_test_id("chat-scene")
    expect(scene).to_have_attribute("data-rain", "1")
    page.wait_for_function("() => window.__oloRain && window.__oloRain.drops.length > 0")
    expect(page.get_by_test_id("chat-input")).to_be_visible()
    w = page.get_by_test_id("hero").bounding_box()["width"]
    assert w >= 48 * 4 - 1, w  # 角色放大到 4 倍
