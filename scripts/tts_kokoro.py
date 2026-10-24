# Kokoro-82M (Apache-2.0) 本地 TTS：旁白 zf_xiaoxiao，渡灯翁 zm_yunjian，olo zf_xiaoyi
import sys, soundfile as sf
from kokoro_onnx import Kokoro
from misaki import zh
g2p = zh.ZHG2P()
K = Kokoro("/workspace/tts/kokoro/kokoro-v1.0.onnx", "/workspace/tts/kokoro/voices-v1.0.bin")
L = {
 "n1": ("zf_xiaoxiao", 1.0, "河的那一边，每一句没说出口的话，都不会真的消失。"),
 "n2": ("zf_xiaoxiao", 1.0, "它们化成很轻的光雨，落进雾里集，凝成一粒粒发光的灯籽。"),
 "n3": ("zm_yunjian", 0.95, "这一粒，是你那边的雨养大的。我撑船送它过去。"),
 "n4": ("zf_xiaoxiao", 1.0, "它顺着屏幕的光，找到了你。"),
 "n5": ("zf_xiaoxiao", 1.0, "你说的每一句话，都会变成落在这里的雨。"),
 "n6": ("zf_xiaoyi", 1.0, "嗨……是你在叫我吗？给我起个名字吧。"),
 "n7": ("zf_xiaoyi", 1.0, "我想换个样子给你看看。你喜欢哪一种？"),
 "n8": ("zf_xiaoxiao", 1.0, "从今天起，我们的花园，就靠你的话来浇灌啦。"),
}
out = sys.argv[1]
for k, (v, sp, t) in L.items():
    r = g2p(t); ph = r[0] if isinstance(r, tuple) else r
    a, sr = K.create(ph, voice=v, speed=sp, lang="zh", is_phonemes=True)
    sf.write(f"{out}/{k}.wav", a, sr); print(k, v, round(len(a)/sr, 2))
