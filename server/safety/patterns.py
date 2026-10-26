"""Crisis detection: fixed substrings plus a few first-person Chinese patterns.

Hand-written and reviewed; never learned from chat. Patterns (not bare substrings)
cover the forms the substring list missed in real use (「我跳下去了」「现在在icu」),
with game / sport / shopping contexts excluded so 「跳楼价」「跳下去拿装备」 stay normal.
"""

import re

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


# Self-harm acts said about oneself. Matched on the casefolded, whitespace-free text.
CRISIS_PATTERNS = tuple(re.compile(p) for p in (
    r"(我|想|要|就|准备|已经|干脆|打算|直接)[^，。,.!?！？]{0,6}跳(下去|下来了|楼|河|江|海|桥|轨)",
    r"(我|自己)[^，。,.!?！？]{0,8}(在|进了?|住进?了?|躺在|被送进?了?|被送到)(icu|重症监护|抢救室)",
    r"(差点|差一点|快要?)(摔死|死掉|死了)",
    r"(我|自己)[^，。,.!?！？]{0,4}(想|要|准备)(去死|死掉|死了算了|消失)",
    r"(割|划|剌)(了|开)?(自己|手腕|腕)",
    r"(吃|吞)了?[^，。,.!?！？]{0,4}(安眠药|一整瓶|整瓶药|很多药)",
    r"(烧炭|上吊|卧轨)",
))
# Contexts where those words are about a game, sport or a price, not the user.
_NOT_SELF = re.compile(
    r"跳楼价|跳楼甩卖|游戏|副本|角色|英雄|技能|装备|地图|队友|对面|残血|复活|回合|无畏契约|瓦罗兰特|王者|吃鸡|和平精英|原神|我的世界|"
    r"跳伞|蹦极|跳水|泳池|游泳|电影|小说|剧里|剧情|主角|新闻|上班|值班|实习|护士|医生|陪护|探望|看望"
)


def _pattern_crisis(folded: str) -> bool:
    return not _NOT_SELF.search(folded) and any(p.search(folded) for p in CRISIS_PATTERNS)


def is_crisis(text: str) -> bool:
    folded = re.sub(r"跳楼(价|甩卖|大甩卖|清仓)", "", normalize_for_match(text))
    if not folded:
        return False
    return any(normalize_for_match(mark) in folded for mark in CRISIS_MARKERS) or _pattern_crisis(folded)
