"""Public privacy policy and terms pages (required by App Store / Google Play listings)."""
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

_STYLE = "body{font-family:monospace;max-width:640px;margin:2em auto;padding:0 1em;line-height:1.6;background:#fdf6e3;color:#333}"

PRIVACY = """<h1>olo 隐私政策</h1><p>最后更新：2026-10-26（草稿，上架前需由开发者确认联系方式）</p>
<h2>我们收集什么</h2><ul><li>你和 olo 的聊天文字，以及你主动录制的语音。</li><li>olo 从聊天中整理出的记忆。</li><li>设置、时区、应用内物品等使用数据。</li></ul>
<h2>怎么用</h2><p>只用于让 olo 回复你、记住你说过的事。聊天内容会发送给第三方大模型服务（如 DeepSeek、阿里云通义）来生成回复与整理记忆。我们不出售你的数据，不用于广告。</p>
<h2>你的权利</h2><p>你可以随时在「设置」里导出全部数据，或删除账号及所有数据（不可恢复）。</p>
<h2>安全与危机</h2><p>olo 不是医生或心理咨询师。检测到危机表达时会提示求助热线；相关内容不会被写入记忆。</p>
<h2>未成年人</h2><p>本应用面向 13 岁以上用户（中国大陆地区 18 岁以上）。</p>
<h2>联系</h2><p>联系邮箱：［待填写］</p>"""

TERMS = """<h1>olo 使用条款</h1><p>最后更新：2026-10-26（草稿）</p>
<ul><li>olo 是 AI 陪伴角色，回复由模型生成，可能出错，不构成医疗、法律或心理建议。</li>
<li>如处于危险中，请立即联系当地急救电话或心理援助热线。</li>
<li>请勿利用 olo 生成违法、伤害他人或侵权内容。</li>
<li>你可以随时删除账号；我们可能因滥用暂停服务。</li></ul>"""


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>{title}</title><style>{_STYLE}</style>{body}")


def register_legal(app: FastAPI) -> None:
    app.add_api_route("/privacy", lambda: _page("olo 隐私政策", PRIVACY), methods=["GET"], include_in_schema=False)
    app.add_api_route("/terms", lambda: _page("olo 使用条款", TERMS), methods=["GET"], include_in_schema=False)
