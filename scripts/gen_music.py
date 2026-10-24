"""olo 开场配乐：纯代码合成（numpy），无采样、无第三方素材。输出以 CC0 发布，见 apps/mobile/assets/onboard/LICENSE-audio.md。

用法：python scripts/gen_music.py out.wav 45
温暖、治愈：F–C–Dm–B♭ 进行，72bpm，柔和钢琴音色 + 弦乐 pad + 稀疏的五声旋律 + 八音盒点缀。
"""
import sys, wave
import numpy as np

SR = 44100
BPM = 72
BEAT = 60 / BPM


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def piano(f, dur, vel=0.5):
    t = np.arange(int(SR * dur)) / SR
    env = np.exp(-t * 2.2) * (1 - np.exp(-t * 300))
    s = sum((0.6 / k ** 1.6) * np.sin(2 * np.pi * f * k * t * (1 + 0.0004 * k)) for k in range(1, 7))
    return vel * env * s


def pad(f, dur):
    t = np.arange(int(SR * dur)) / SR
    att = np.clip(t / 1.8, 0, 1) * np.clip((dur - t) / 1.8, 0, 1)
    s = np.zeros_like(t)
    for d in (-0.12, 0.0, 0.13):
        ff = f * 2 ** (d / 12)
        s += sum(np.sin(2 * np.pi * ff * k * t + k) / k ** 2 for k in range(1, 5))
    return 0.05 * att * s


def bell(f, dur=2.5, vel=0.18):
    t = np.arange(int(SR * dur)) / SR
    return vel * np.exp(-t * 3) * (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t))


def add(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i : i + len(sig)] += sig


def render(seconds, seed=7):
    rng = np.random.default_rng(seed)
    n = int(SR * seconds)
    L, R = np.zeros(n + SR * 4), np.zeros(n + SR * 4)
    chords = [(53, [65, 69, 72]), (48, [64, 67, 72]), (50, [65, 69, 74]), (46, [62, 65, 70])]
    scale = [72, 74, 77, 79, 81, 84]
    bar = BEAT * 4
    t, ci = 0.0, 0
    while t < seconds:
        root, tri = chords[ci % 4]
        dur = bar * 2
        for f in [root - 12, root] + tri:
            p = pad(midi(f), dur + 1.5)
            add(L, p, t); add(R, p, t)
        for b in range(8):  # 分解和弦
            note = ([root] + tri + [tri[1] + 12])[[0, 2, 1, 3, 4, 3, 2, 1][b]]
            s = piano(midi(note), 3.0, 0.16 + 0.04 * (b == 0))
            pan = 0.5 + 0.3 * np.sin(b)
            add(L, s * (1 - pan), t + b * BEAT); add(R, s * pan, t + b * BEAT)
        if t > bar * 2:  # 第二轮起加旋律
            for b in (0, 3, 4, 6):
                if rng.random() < 0.75:
                    s = piano(midi(rng.choice(scale)), 3.5, 0.2)
                    add(L, s * 0.55, t + b * BEAT + bar * (b > 3)); add(R, s * 0.45, t + b * BEAT + bar * (b > 3))
        if rng.random() < 0.6:
            s = bell(midi(rng.choice(scale) + 12))
            add(L, s * 0.3, t + bar * 1.5); add(R, s * 0.7, t + bar * 1.5)
        t += dur; ci += 1
    st = np.stack([L[:n], R[:n]], 1)
    # 简单混响：几条衰减延迟
    out = st.copy()
    for d, g in ((0.031, 0.35), (0.047, 0.3), (0.089, 0.22), (0.137, 0.16)):
        k = int(d * SR)
        out[k:] += g * st[:-k][:, ::-1]
    fade = np.ones(n); fi, fo = int(SR * 2), int(SR * 4)
    fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
    out *= fade[:, None]
    out /= np.max(np.abs(out)) + 1e-9
    return (out * 0.8 * 32767).astype(np.int16)


if __name__ == "__main__":
    path, secs = sys.argv[1], float(sys.argv[2])
    data = render(secs)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
