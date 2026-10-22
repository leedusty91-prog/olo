"""浏览器端到端：故事引导 → 起名/选样子/选性子 → 流式聊天 → 花园 → 日记。

需要一个以 LLM_PROVIDER=mock、OLO_WEB_EMBED_TOKEN=1 启动的后端（docker compose 默认即是）。
"""

import base64
import json
import os
import re
import time
from pathlib import Path

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

    page.get_by_test_id("tone-playful").click()
    shot(page, "09-tone")
    page.get_by_test_id("tone-ok").click()

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

    page.get_by_test_id("tab-garden").click()
    expect(page.get_by_test_id("garden")).to_be_visible()
    expect(page.get_by_test_id("stage")).not_to_be_empty()
    expect(page.locator(".lore article").first).to_be_visible()
    shot(page, "12-garden")

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
    page.get_by_test_id("gender-ok").click()
    page.get_by_test_id("form-ok").click()
    page.get_by_test_id("tone-calm").click()
    page.get_by_test_id("tone-ok").click()
    expect(page.get_by_test_id("olo-name")).to_have_text("olo", timeout=10_000)
    page.get_by_test_id("chat-input").fill("嗨")
    page.get_by_test_id("send").click()
    expect(page.locator(".msg.assistant").last).to_contain_text("我在", timeout=10_000)
    # 没有横向滚动条
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    # 静音开关：在顶栏里，点一下静音，刷新后仍保持
    mute = page.get_by_test_id("mute")
    expect(page.locator(".topbar [data-testid=mute]")).to_be_visible()
    expect(mute).to_have_attribute("aria-pressed", "false")
    mute.click()
    expect(mute).to_have_attribute("aria-pressed", "true")
    assert page.evaluate("localStorage.getItem('olo.muted')") == "1"
    page.reload()
    expect(page.get_by_test_id("mute")).to_have_attribute("aria-pressed", "true")
    page.get_by_test_id("mute").click()
    expect(page.get_by_test_id("mute")).to_have_attribute("aria-pressed", "false")
    # olo眼里的你 + 主动关心开关
    page.get_by_test_id("profile-btn").click()
    expect(page.get_by_test_id("profile-text")).to_contain_text("认识你", timeout=10_000)
    page.keyboard.press("Escape")
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
    page.get_by_test_id("gender-ok").click()
    page.get_by_test_id("form-ok").click()
    page.on("dialog", lambda d: d.dismiss())
    page.get_by_test_id("tone-ok").click()
    expect(page.locator(".error")).to_contain_text("密钥", timeout=10_000)
    ctx.close()


def test_story_book_and_mood_chart(page: Page, base: str, shot) -> None:
    page.goto(f"{base}/app/")
    page.evaluate('localStorage.setItem("olo.profile", JSON.stringify({name:"olo",form:"buddy",color:"sun",tone:"curious"}))')
    page.reload()
    page.get_by_test_id("tab-book").click()
    expect(page.get_by_test_id("book")).to_be_visible()
    expect(page.get_by_test_id("chapter-locked").first).to_be_visible()
    page.get_by_test_id("tab-diary").click()
    expect(page.locator("[data-testid=mood] canvas")).to_have_attribute("data-points", re.compile(r"^\d+$"))
    shot(page, "14-book-mood")
