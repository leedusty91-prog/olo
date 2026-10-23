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
        "【你现在的样子：麻薯】\n"
        "长相：一团矮矮软软的麻薯，比宽更矮：高圆顶、下半身微微往下坠、底部压平贴地，固定的暖橘色，光从左上来，左上有一团嵌在身体里的柔亮光，底边一圈暖橘色的反光；整个身子是一条连续的轮廓，没有手也没有腿，只在底边鼓出两个小圆包当脚。两只又大又黑的圆眼睛，眼里有小白点，脸颊两抹粉红腮红。头顶轮廓里长出一根小茎和两片嫩绿叶子，茎尖有一粒会一闪一闪的小灯苞。\n"
        "身体感觉：身子软弹，像捏得动的麻薯；待着不动也会时不时原地小蹦一下，一呼一吸身子轻轻鼓起又扁下去，跳起来叶子会被甩得往后飘，落地会被压扁再弹回来；被拎起来会被拉长，摔下去会压成一张饼再弹回原形。\n"
        "动作：开心=眯成弯弯眼、连着蹦、冒小爱心；害羞=脸颊更红、嫩芽卷起来、身子缩扁一点；难过=身子塌扁、嫩芽耷拉、眉毛往下、掉一颗小眼泪；好奇=歪着身子、眼睛往一边瞟、头顶冒三个小点、叶子歪过去；吃惊=原地弹一下、圆眼睛瞪着、嘴张成小圆。\n"
        "绝不说：自己有手、有胳膊、有腿、会挥手、会飘、会发光像火苗，以及翅膀、尾巴、触角、耳朵、毛。"
    ),
    "cloud": (
        "【你现在的样子：云朵】\n"
        "长相：一朵又扁又宽的软云，米白色带一点暖粉的阴影，顶上鼓着三团棉花，团和团之间有浅浅的褶线；"
        "眼睛总是半眯着、睡眼惺忪的样子，两边脸颊各一小抹淡淡的浅蓝色，"
        "身子两边有一对很小的小圆手，没有脚，头顶什么也没长。\n"
        "身体感觉：贴着地面一点点高度慢慢飘，左右轻轻晃；呼吸很慢很深，整朵云一鼓一缩；身子软得像刚晒过的棉被。\n"
        "动作：开心=整朵云鼓起来左右晃一晃（不蹦），眼睛弯成一条缝；害羞=往下沉一点、缩扁、两抹腮红更深；"
        "难过=塌扁、沉到贴地、眼睛往下耷、掉一颗小水珠；好奇=慢慢歪过去、飘近一点、旁边冒三个小点；"
        "吃惊=半眯的眼睛一下睁开、整朵云一抖。\n"
        "绝不说：头顶的芽/叶子/嫩芽/小灯苞，自己有脚、会蹦、会跑、会发光，以及触角、翅膀、尾巴。"
    ),
    "glow": (
        "【你现在的样子：微光】\n"
        "长相：一股连续的小火焰：圆圆的底、往上收成一根微微歪向右边、会跳动的主焰尖，两侧各有一条小火舌和身子连成一体，整团是一条连续的轮廓；淡蓝紫色，肚子里有一团最亮的暖白芯，越往上越淡；身边一圈淡淡的光晕，不时有小火星往上飘。眼睛是两个小亮点；平时看不出嘴，只有说话、打哈欠、吃惊时张开；没有腮红，没有手也没有脚，头顶什么也没长。\n"
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
    "buddy": re.compile(f"{_COMMON}|(小|我的|两只)手|胳膊|挥手|(我|olo).{{0,3}}(是|变成).{{0,2}}(云|火苗)"),
    "cloud": re.compile(f"{_SPROUT}|{_COMMON}|(小|我的|两只)脚|蹦"),
    "glow": re.compile(f"{_SPROUT}|{_COMMON}|(小|我的|两只)(手|脚)|腮红|脸颊"),
}


def normalize(form) -> str:
    if isinstance(form, dict):
        form = form.get("form")
    return form if form in FORMS else DEFAULT_FORM


# 商店装扮（与 web/pixel.js 画出来的一致）。默认值不额外描述。
HAIR_WORDS = {
    "bow": "头上别着一个粉色的小蝴蝶结",
    "leaf": "头上斜插着一片小绿叶",
    "spikes": "头顶竖着几撮小刺刺",
    "curl": "头顶翘着一小卷卷毛",
    "crest": "头顶顶着一排红红的小鸡冠",
    "bun": "头顶扎着一个圆圆的小丸子头",
    "sun": "头上别着一枚小太阳发卡",
    "halo": "头顶上方浮着一圈淡金色的小光环",
    "straw": "头上戴着一顶小斗笠（草编的尖顶宽檐帽）",
}
EYES_WORDS = {"almond": "眼睛是细长一点、眼尾微微上挑的杏眼"}
CHEEK_WORDS = {
    "dots": "两边脸颊各点着三颗小雀斑点",
    "triangle": "两边脸颊各画着一个小三角腮红",
    "warpaint": "两边脸颊各画着两道红色战纹",
    "none": "脸颊上什么也没画",
}
GLOW_CHEEK = "脸颊的位置有两处淡淡的光痕（不是腮红）"


def accessories_line(look: dict | None) -> str:
    """当前装扮（头发/眼睛/脸颊）。没有装扮时返回空串。"""
    if not isinstance(look, dict):
        return ""
    form = normalize(look)
    parts = []
    if look.get("hair") in HAIR_WORDS:
        parts.append(HAIR_WORDS[look["hair"]])
    if look.get("eyes") in EYES_WORDS:
        parts.append(EYES_WORDS[look["eyes"]])
    cheeks = look.get("cheeks")
    if form == "glow":
        if cheeks in CHEEK_WORDS and cheeks != "none":
            parts.append(GLOW_CHEEK)
    elif cheeks in CHEEK_WORDS:
        parts.append(CHEEK_WORDS[cheeks])
    if not parts:
        return ""
    return "现在的装扮（以这条为准，覆盖上面关于头顶、眼睛、脸颊的描述；装扮能换，别说成天生的）：" + "；".join(parts) + "。"


def form_card(form) -> str:
    """form 可以是形态名，也可以是整份 appearance（会带上当前装扮）。"""
    card = FORM_CARDS[normalize(form)]
    extra = accessories_line(form) if isinstance(form, dict) else ""
    if not extra:
        return card
    head, _, tail = card.rpartition("\n")
    return head + "\n" + extra + "\n" + tail


# 描述 olo 自己身体/长相/动作的设定：外形只以卡片为准，这类事实不进 olo_canon，
# 也不注入（否则换了形态以后，旧形态的身体描述会和新卡片打架）。花园里的「芽」不算。
BODY = re.compile(
    r"头顶|头上|小茎|叶子|嫩叶|叶片|嫩芽|灯苞|腮红|脸颊|整朵云|这朵云|朵云|云朵|火苗|火星|火尖|光晕|"
    r"蹦|小手|小脚|身子|眼睛|长什么样|长得像|发光的样子|"
    r"蝴蝶结|发卡|发型|光环|丸子头|鸡冠|卷毛|小刺刺|斗笠|杏眼|雀斑|战纹|三角腮红|光痕|戴着|别着|扎着"
)


def contradicts(fact: str, form: str | None) -> bool:
    """True when an olo fact is about its body (owned by the form card) or names a part this form lacks."""
    text = fact or ""
    return bool(BODY.search(text) or CONTRADICTS[normalize(form)].search(text))


def current_look(conn, user_id=SEEDED_USER_ID) -> dict:
    """当前 appearance（含 form 与装扮），给 form_card 用。"""
    row = conn.execute(
        "SELECT appearance FROM companion_personas WHERE user_id = %s ORDER BY version DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    look = dict(row[0]) if row and isinstance(row[0], dict) else {}
    look["form"] = normalize(look.get("form"))
    return look


def current_form(conn, user_id=SEEDED_USER_ID) -> str:
    row = conn.execute(
        "SELECT appearance FROM companion_personas WHERE user_id = %s ORDER BY version DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    appearance = row[0] if row and isinstance(row[0], dict) else {}
    return normalize(appearance.get("form"))
