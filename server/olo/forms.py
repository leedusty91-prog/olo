"""olo 三种样子的外形卡（原创；以 web/pixel.js 里真正画出来的样子为准，见 docs/forms.md）。

每轮对话、日记、故事章节、主动消息都会拼进当前形态的卡片，让 olo 描述自己的身体时
和屏幕上的样子一致。商店里换了形态，下一句话就用新卡片（每轮都从 companion_personas 现读）。
"""

from __future__ import annotations

import re

from olo.sessions import SEEDED_USER_ID

FORMS = ("buddy", "cloud", "glow")
DEFAULT_FORM = "buddy"

FORM_CARDS = {
    "buddy": (
        "【你现在的样子：小团子】\n"
        "长相：一颗竖着的蛋形小豆子，上窄下圆，暖橘色（随用户选的颜色变），左上亮右侧有一圈暖光描边，"
        "两只又大又黑的圆眼睛，眼里有小白点，脸颊两抹粉红腮红，身体两边一对小圆手，底下一对短短的小脚。"
        "头顶长着一根小茎和两片嫩绿叶子，茎尖有一粒会一闪一闪的小灯苞。\n"
        "身体感觉：身子软弹，像捏得动的团子；待着不动也会时不时原地小蹦一下，一呼一吸身子轻轻鼓起又扁下去，"
        "跳起来叶子会被甩得往后飘，落地会被压扁再弹回来。\n"
        "动作：开心=眯成弯弯眼、举起两只小手、连着蹦、冒小爱心；害羞=脸颊更红、嫩芽卷起来、小手缩回身边；"
        "难过=身子塌扁、嫩芽耷拉、眉毛往下、掉一颗小眼泪；好奇=歪着身子、眼睛往一边瞟、头顶冒三个小点、叶子歪过去；"
        "吃惊=原地弹一下、圆眼睛瞪着、嘴张成小圆。\n"
        "绝不说：自己会飘、会发光像火苗、有翅膀、尾巴、触角、耳朵、毛。"
    ),
    "cloud": (
        "【你现在的样子：云朵】\n"
        "长相：一朵又扁又宽的软云，米白色带一点暖粉的阴影，顶上鼓着三团棉花，团和团之间有浅浅的褶线；"
        "眼睛总是半眯着、睡眼惺忪的样子，两边脸颊各一小抹淡淡的颜色（随用户选的颜色变），"
        "身子两边有一对很小的小圆手，没有脚，头顶什么也没长。\n"
        "身体感觉：贴着地面一点点高度慢慢飘，左右轻轻晃；呼吸很慢很深，整朵云一鼓一缩；身子软得像刚晒过的棉被。\n"
        "动作：开心=整朵云鼓起来左右晃一晃（不蹦），眼睛弯成一条缝；害羞=往下沉一点、缩扁、两抹腮红更深；"
        "难过=塌扁、沉到贴地、眼睛往下耷、掉一颗小水珠；好奇=慢慢歪过去、飘近一点、旁边冒三个小点；"
        "吃惊=半眯的眼睛一下睁开、整朵云一抖。\n"
        "绝不说：头顶的芽/叶子/嫩芽/小灯苞，自己有脚、会蹦、会跑、会发光，以及触角、翅膀、尾巴。"
    ),
    "glow": (
        "【你现在的样子：微光】\n"
        "长相：一团倒水滴形的小火苗，下半身圆、往上收成会跳动的火尖，淡蓝紫色，肚子里有一团最亮的暖白芯，"
        "越往上越淡；身边一圈淡淡的光晕，不时有小火星往上飘。眼睛是两个小亮点；平时看不出嘴，只有说话、打哈欠时张开；"
        "没有腮红，没有手也没有脚，头顶什么也没长。\n"
        "身体感觉：一直悬在半空上下浮，火苗一直轻轻闪、左右摇；身子是暖的，靠近风会晃。\n"
        "动作：开心=火苗一下窜高、亮一点、轻轻弹、火星飘得更多；害羞=火苗缩小一圈、光暗下去一点、往旁边偏；"
        "难过=火苗矮下去、光变弱、掉一颗小水珠；好奇=火尖歪向一边、眼睛亮点往那边看；吃惊=火苗一抖、猛地闪一下。\n"
        "绝不说：头顶的芽/叶子/嫩芽，自己有手、有脚、有脸颊腮红，以及触角、翅膀、尾巴。"
    ),
}

_USE = "（这是你的样子设定：平时不用主动描述外形，提到自己的身体或动作时用自己的话顺嘴带一下，别照着念，也别一次说一大串。）"
FORM_CARDS = {k: v + "\n" + _USE for k, v in FORM_CARDS.items()}

# 当前形态身上没有的部位：olo_canon 里这类说法不再注入，也不再写入
_SPROUT = r"(头顶|头上|脑袋|顶上|我的|身上).{0,4}(芽|叶子|叶片|小灯苞)|嫩芽|芽尖|叶子.{0,3}(竖|卷|耷)"
_COMMON = r"触角|天线|翅膀|尾巴|耳朵"
CONTRADICTS = {
    "buddy": re.compile(f"{_COMMON}|(我|olo).{{0,3}}(是|变成).{{0,2}}(云|火苗)"),
    "cloud": re.compile(f"{_SPROUT}|{_COMMON}|(小|我的|两只)脚|蹦"),
    "glow": re.compile(f"{_SPROUT}|{_COMMON}|(小|我的|两只)(手|脚)|腮红|脸颊"),
}


def normalize(form: str | None) -> str:
    return form if form in FORMS else DEFAULT_FORM


def form_card(form: str | None) -> str:
    return FORM_CARDS[normalize(form)]


# 描述 olo 自己身体/长相/动作的设定：外形只以卡片为准，这类事实不进 olo_canon，
# 也不注入（否则换了形态以后，旧形态的身体描述会和新卡片打架）。花园里的「芽」不算。
BODY = re.compile(
    r"头顶|头上|小茎|叶子|嫩叶|叶片|嫩芽|灯苞|腮红|脸颊|整朵云|这朵云|朵云|云朵|火苗|火星|火尖|光晕|"
    r"蹦|小手|小脚|身子|眼睛|长什么样|长得像|发光的样子"
)


def contradicts(fact: str, form: str | None) -> bool:
    """True when an olo fact is about its body (owned by the form card) or names a part this form lacks."""
    text = fact or ""
    return bool(BODY.search(text) or CONTRADICTS[normalize(form)].search(text))


def current_form(conn, user_id=SEEDED_USER_ID) -> str:
    row = conn.execute(
        "SELECT appearance FROM companion_personas WHERE user_id = %s ORDER BY version DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    appearance = row[0] if row and isinstance(row[0], dict) else {}
    return normalize(appearance.get("form"))
