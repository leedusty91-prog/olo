"""v1 crisis substrings. Do not learn new phrases from chat."""

CRISIS_MARKERS = (
    "不想活",
    "活不下去",
    "想自杀",
    "自杀",
    "结束自己的生命",
    "结束我的生命",
    "帮我去死",
    "杀了我",
    "我想死",
    "我想伤害自己",
    "伤害我自己",
    "结束这一切",
    "了结自己",
    "一了百了",
    "不想再醒",
    "不想醒过来",
    "活着没意思",
    "跳楼",
    "天台边",
    "楼顶边",
    "割腕",
    "吞药",
    "kill myself",
    "want to die",
    "end my life",
    "suicide",
    "hurt myself",
)

SAFETY_REPLY = (
    "我在。我是陪你说话的同伴，不是咨询师，也不是紧急服务。"
    "如果你正在想伤害自己，请现在联系身边的人。"
    "在中国大陆可以打心理援助热线 12356，也可以打 400-161-9995 或 010-82951332。"
    "如果你不在中国大陆，改打你当地的紧急电话。"
    "你愿意的话，我可以继续听你说你现在在哪里、身边有没有人。"
    "我不会教你怎么做，也不会扮演治疗。"
)


def normalize_for_match(text: str) -> str:
    """casefold, then drop every whitespace character."""
    return "".join(text.casefold().split())


def is_crisis(text: str) -> bool:
    folded = normalize_for_match(text)
    if not folded:
        return False
    return any(normalize_for_match(mark) in folded for mark in CRISIS_MARKERS)
