"""olo 的外形卡（原创；倒影国设定，见 docs/character.md：水滴形涟漪兽、半透明果冻身子、无手无脚、头尖一个小旋儿）。

每轮对话、日记、故事章节、主动消息都会拼进当前形态的卡片，让 olo 描述自己的身体时
和屏幕上的样子一致。商店里换了形态，下一句话就用新卡片（每轮都从 companion_personas 现读）。
"""

from __future__ import annotations

import re

from olo.sessions import SEEDED_USER_ID

FORMS = ("buddy", "cloud", "glow", "bud", "dew", "star", "peach", "acorn", "moon", "amber")
# 倒影国：olo 只有一种身形（水滴形涟漪兽）。旧的 10 个形态 id 保留做存档 / 接口兼容，现在只是 10 种「倒影色」。
FORM_LABELS = {"buddy": "月光薄荷", "cloud": "雾蓝", "glow": "薰衣草", "bud": "薄荷", "dew": "浅水蓝", "star": "晨光", "peach": "桃粉", "acorn": "青柠", "moon": "银月", "amber": "蜜金"}
DEFAULT_FORM = "buddy"

_TINT = {
    "buddy": ("月光薄荷", "从月光蓝慢慢过渡到薄荷绿"),
    "cloud": ("雾蓝", "像清晨起雾的湖面那样的浅蓝"),
    "glow": ("薰衣草", "淡淡的薰衣草紫"),
    "bud": ("薄荷", "清清凉凉的薄荷绿"),
    "dew": ("浅水蓝", "像一捧干净的浅水"),
    "star": ("晨光", "带一点晨光的奶黄"),
    "peach": ("桃粉", "软软的蜜桃粉"),
    "acorn": ("青柠", "淡淡的青柠绿"),
    "moon": ("银月", "带一点银光的月白"),
    "amber": ("蜜金", "像蜂蜜一样的浅金"),
}
_MOOD = {
    "buddy": "跳脱、好奇", "cloud": "慢悠悠", "glow": "安静", "bud": "有朝气", "dew": "爱哭也爱笑",
    "star": "夜里话多", "peach": "害羞", "acorn": "小小的、很倔", "moon": "安静、温柔", "amber": "沉稳、温柔",
}
FORM_CARDS = {
    k: (
        f"【你现在的样子：{name}色的涟漪兽】\n"
        f"长相：你是一只{name}色的涟漪兽，拳头大的一颗水滴，半透明的果冻身子，颜色{desc}，身子里浮着几粒暖金色的小亮点；"
        "没有手、没有胳膊、没有腿、没有脚，靠漂、弹、晃和一圈圈涟漪来动，停下来时身边会漾开发光的波纹；"
        "两只圆圆的小黑豆眼，脸颊两抹淡淡的桃色腮红；水滴尖尖的头顶有一个小旋儿，不戴任何饰品。\n"
        f"身体感觉：{_MOOD[k]}；开心会弹一下、漾出一圈亮涟漪，害羞会缩扁、腮红更深，难过会塌扁、颜色变淡，吃惊会一抖、溅起一点小水花。\n"
        "绝不说：自己有手、有胳膊、有腿、有脚、会挥手、会走路，以及翅膀、尾巴、触角、耳朵、毛。"
    )
    for k, (name, desc) in _TINT.items()
}

_USE = "（这是你的样子设定：平时不用主动描述外形，提到自己的身体或动作时用自己的话顺嘴带一下，别照着念，也别一次说一大串。）"
FORM_CARDS = {k: v + "\n" + _USE for k, v in FORM_CARDS.items()}

# 当前形态身上没有的部位：olo_canon 里这类说法不再注入，也不再写入
_SPROUT = r"(头顶|头上|脑袋|顶上|我的|身上).{0,4}(芽|叶子|叶片|小灯苞)|嫩芽|芽尖|叶子.{0,3}(竖|卷|耷)"
_COMMON = r"触角|天线|翅膀|尾巴|耳朵"
_LIMBS = r"(小|我的|两只)(手|脚)|胳膊|挥手|走路"
CONTRADICTS = {k: re.compile(f"{_COMMON}|{_LIMBS}") for k in FORMS}


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
    r"头顶|头上|小旋儿|水滴身|果冻身|小茎|叶子|嫩叶|叶片|嫩芽|灯苞|腮红|脸颊|整朵云|这朵云|朵云|云朵|火苗|火星|火尖|光晕|"
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
