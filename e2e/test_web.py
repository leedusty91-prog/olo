"""浏览器端到端：故事引导 → 起名/选样子/选性子 → 流式聊天 → 花园 → 日记。

需要一个以 LLM_PROVIDER=mock、OLO_WEB_EMBED_TOKEN=1 启动的后端（docker compose 默认即是）。
"""

import re

from playwright.sync_api import Page, expect


def test_story_onboarding_then_streaming_chat(page: Page, base: str, shot) -> None:
    page.goto(f"{base}/")
    expect(page.get_by_test_id("start")).to_be_visible()
    shot(page, "01-title")
    page.get_by_test_id("start").click()

    for i in range(4):
        beat = page.locator(f'[data-beat="{i}"]')
        expect(beat).to_be_visible()
        expect(beat.locator(".story")).not_to_be_empty()
        page.wait_for_timeout(2600)
        shot(page, f"0{i + 2}-story-{i + 1}")
        beat.get_by_test_id("next").click()

    expect(page.get_by_test_id("hello")).to_be_visible()
    page.wait_for_timeout(2400)
    shot(page, "06-hatch")
    page.get_by_test_id("hello").click()

    page.get_by_test_id("name").fill("小灯")
    shot(page, "07-name")
    page.get_by_test_id("name-ok").click()

    page.get_by_test_id("form-cloud").click()
    page.locator('[data-color="sky"]').click()
    expect(page.locator("svg.olo-cloud").first).to_be_visible()
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
    expect(page.locator(".chat-hero svg.olo")).to_have_class(re.compile(r"is-(thinking|talking)"))
    reply = page.locator(".msg.assistant").last
    expect(reply).to_contain_text("灯籽", timeout=10_000)
    expect(reply).to_contain_text("小灯")
    expect(page.locator("form[data-busy]")).to_have_count(0, timeout=10_000)
    page.get_by_test_id("chat-input").fill("今天加班好累")
    page.get_by_test_id("send").click()
    expect(page.locator(".msg.assistant").last).to_contain_text("加班", timeout=10_000)
    expect(page.locator(".chat-hero svg.olo")).to_have_class(re.compile(r"is-sad"))
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
    shot(page, "13-diary")

    # 刷新后保持已相遇状态，直接进入主界面
    page.reload()
    expect(page.get_by_test_id("app")).to_be_visible()


def test_skip_story_on_mobile_viewport(browser, base: str) -> None:
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(f"{base}/app/")
    page.get_by_test_id("skip-story").click()
    page.get_by_test_id("hello").click()
    page.get_by_test_id("name-ok").click()  # 默认名 olo
    page.get_by_test_id("form-ok").click()
    page.get_by_test_id("tone-calm").click()
    page.get_by_test_id("tone-ok").click()
    expect(page.get_by_test_id("olo-name")).to_have_text("olo", timeout=10_000)
    page.get_by_test_id("chat-input").fill("嗨")
    page.get_by_test_id("send").click()
    expect(page.locator(".msg.assistant").last).to_contain_text("我在", timeout=10_000)
    # 没有横向滚动条
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
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
    page.get_by_test_id("form-ok").click()
    page.on("dialog", lambda d: d.dismiss())
    page.get_by_test_id("tone-ok").click()
    expect(page.locator(".error")).to_contain_text("密钥", timeout=10_000)
    ctx.close()
