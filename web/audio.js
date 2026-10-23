// olo 音效与环境音：全部用 WebAudio 实时合成（无任何音频文件 / 第三方素材）。
// - 首次用户手势后才启动 AudioContext；静音状态存在 localStorage("olo.muted")。
// - 所有声音都是纯函数 (ac, out, when) => void，因此同一套代码也能在 OfflineAudioContext 里
//   重放事件日志，渲染出演示视频的配乐（见 renderWav）。
const KEY = "olo.muted";
let muted = localStorage.getItem(KEY) === "1";
let ac = null, master = null, sfxBus = null, ambBus = null;
let amb = null;            // { name, start, gain, next }
let unlockedAt = null;
export const log = [];
const now = () => performance.now() / 1000;
const rec = (kind, name) => { log.push({ t: now(), kind, name }); if (log.length > 4000) log.shift(); };

// ---------- 合成基元 ----------
const hash = (n) => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const noiseBufs = new WeakMap();
function noiseBuf(ac) {
  let b = noiseBufs.get(ac);
  if (!b) { b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = b.getChannelData(0); let s = 7; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } noiseBufs.set(ac, b); }
  return b;
}
function env(ac, out, when, { attack = 0.005, dur = 0.2, vol = 0.1, curve = "exp" }) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vol, when + attack);
  if (curve === "exp") g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  else { g.gain.setValueAtTime(vol, when + dur * 0.6); g.gain.linearRampToValueAtTime(0.0001, when + dur); }
  g.connect(out);
  return g;
}
function tone(ac, out, when, { f = 440, f2 = null, type = "sine", dur = 0.2, vol = 0.1, attack = 0.005, detune = 0, curve, lp = null }) {
  const o = ac.createOscillator(); o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f, when);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, when + dur * 0.8);
  let node = env(ac, out, when, { attack, dur, vol, curve });
  if (lp) { const fl = ac.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp; fl.connect(node); node = fl; }
  o.connect(node); o.start(when); o.stop(when + dur + 0.05);
}
function bell(ac, out, when, f, vol = 0.06, dur = 1.2) {
  tone(ac, out, when, { f, dur, vol, attack: 0.004 });
  tone(ac, out, when, { f: f * 2.01, dur: dur * 0.5, vol: vol * 0.3, attack: 0.003 });
  tone(ac, out, when, { f: f * 3.98, dur: dur * 0.25, vol: vol * 0.12, attack: 0.002 });
}
function noise(ac, out, when, { dur = 0.2, vol = 0.1, f = 1200, f2 = null, q = 1, type = "bandpass", attack = 0.005, curve }) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf(ac); s.loop = true;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, when);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, when + dur);
  s.connect(fl); fl.connect(env(ac, out, when, { attack, dur, vol, curve }));
  s.start(when, hash(when * 1000) * 1.5); s.stop(when + dur + 0.05);
}
const midi = (m) => 440 * 2 ** ((m - 69) / 12);

// ---------- 音效 ----------
export const SFX = {
  type: (ac, o, w) => tone(ac, o, w, { f: 1250 + hash(w * 997) * 500, type: "square", dur: 0.03, vol: 0.018, lp: 3200 }),
  tick: (ac, o, w) => tone(ac, o, w, { f: 1700 + hash(w * 733) * 400, type: "triangle", dur: 0.025, vol: 0.02 }),
  hover: (ac, o, w) => tone(ac, o, w, { f: 990, f2: 1320, type: "triangle", dur: 0.05, vol: 0.025 }),
  press: (ac, o, w) => { tone(ac, o, w, { f: 620, f2: 300, type: "square", dur: 0.08, vol: 0.04, lp: 2400 }); tone(ac, o, w + 0.02, { f: 1240, type: "triangle", dur: 0.06, vol: 0.03 }); },
  select: (ac, o, w) => { tone(ac, o, w, { f: midi(76), type: "triangle", dur: 0.09, vol: 0.05 }); tone(ac, o, w + 0.06, { f: midi(83), type: "triangle", dur: 0.14, vol: 0.05 }); },
  whoosh: (ac, o, w) => { noise(ac, o, w, { dur: 0.5, vol: 0.07, f: 300, f2: 2600, q: 0.8, attack: 0.15 }); bell(ac, o, w + 0.28, midi(86), 0.025, 0.8); },
  hatch: (ac, o, w) => {
    [0, 0.3, 0.55, 0.75].forEach((d, i) => { noise(ac, o, w + d, { dur: 0.06, vol: 0.09 + i * 0.02, f: 2600, type: "highpass", q: 0.5 }); tone(ac, o, w + d, { f: 180 - i * 15, type: "square", dur: 0.05, vol: 0.03, lp: 900 }); });
    [72, 76, 79, 84, 88].forEach((m, i) => bell(ac, o, w + 1.0 + i * 0.09, midi(m), 0.05, 1.4));
    noise(ac, o, w + 0.95, { dur: 0.9, vol: 0.05, f: 6000, type: "highpass", q: 0.3, attack: 0.01 });
  },
  happy: (ac, o, w) => { tone(ac, o, w, { f: midi(72), f2: midi(79), type: "square", dur: 0.12, vol: 0.035, lp: 2600 }); tone(ac, o, w + 0.11, { f: midi(84), type: "triangle", dur: 0.25, vol: 0.05 }); },
  sad: (ac, o, w) => { tone(ac, o, w, { f: midi(69), f2: midi(62), type: "triangle", dur: 0.5, vol: 0.05, attack: 0.03 }); tone(ac, o, w + 0.05, { f: midi(57), type: "sine", dur: 0.6, vol: 0.03, attack: 0.05 }); },
  think: (ac, o, w) => { [0, 0.12, 0.24].forEach((d, i) => tone(ac, o, w + d, { f: 620 + i * 140, f2: 760 + i * 140, type: "sine", dur: 0.06, vol: 0.035 })); },
  send: (ac, o, w) => { noise(ac, o, w, { dur: 0.22, vol: 0.05, f: 800, f2: 4000, q: 1.2, attack: 0.04 }); tone(ac, o, w, { f: midi(79), f2: midi(91), type: "triangle", dur: 0.14, vol: 0.04 }); },
  receive: (ac, o, w) => { bell(ac, o, w, midi(83), 0.05, 0.9); bell(ac, o, w + 0.1, midi(88), 0.045, 1.1); },
  grow: (ac, o, w) => { [67, 69, 71, 74, 76, 79, 83].forEach((m, i) => tone(ac, o, w + i * 0.07, { f: midi(m), type: "triangle", dur: 0.3, vol: 0.04 })); bell(ac, o, w + 0.55, midi(86), 0.04, 1.4); },
  rain: (ac, o, w) => { for (let i = 0; i < 10; i++) tone(ac, o, w + i * 0.11 + hash(i + w) * 0.06, { f: 1800 + hash(i * 7 + w) * 1600, f2: 900, type: "sine", dur: 0.06, vol: 0.02 }); },
  page: (ac, o, w) => { noise(ac, o, w, { dur: 0.14, vol: 0.08, f: 1400, f2: 3800, q: 0.7, attack: 0.02 }); noise(ac, o, w + 0.12, { dur: 0.1, vol: 0.05, f: 2400, f2: 900, q: 0.9, attack: 0.01 }); },
  error: (ac, o, w) => { tone(ac, o, w, { f: 220, f2: 170, type: "square", dur: 0.18, vol: 0.04, lp: 1200 }); tone(ac, o, w + 0.16, { f: 170, f2: 140, type: "square", dur: 0.2, vol: 0.04, lp: 1200 }); },
  // 拖拽落地：软软的"啵嘤"（下滑音 + 轻颤）
  boing: (ac, o, w) => { tone(ac, o, w, { f: 340, f2: 150, type: "sine", dur: 0.22, vol: 0.05, attack: 0.004 }); tone(ac, o, w + 0.03, { f: 520, f2: 260, type: "triangle", dur: 0.16, vol: 0.02, detune: 12 }); },
  sparkle: (ac, o, w) => { [88, 91, 95].forEach((m, i) => bell(ac, o, w + i * 0.05, midi(m), 0.025, 0.6)); },
};

// ---------- 环境音：每个场景一段可无限延续的生成式小曲 ----------
// 和弦循环 + 五声音阶铃音 + 可选环境噪声（水声 / 风 / 虫鸣），按拍号确定性生成。
const AMB = {
  title: { bpm: 66, root: 62, chords: [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 0, 4, 7], [7, 11, 14, 17]], scale: [0, 2, 4, 7, 9], bell: 0.45, pad: 0.022 },
  city: { bpm: 60, root: 57, chords: [[0, 3, 7, 10], [5, 8, 12, 15], [-2, 2, 5, 9], [3, 7, 10, 14]], scale: [0, 3, 5, 7, 10], bell: 0.35, pad: 0.024, air: "wind" },
  river: { bpm: 58, root: 65, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [2, 5, 9, 12]], scale: [0, 2, 4, 7, 9], bell: 0.4, pad: 0.02, air: "water" },
  boat: { bpm: 54, root: 50, chords: [[0, 7, 10, 14], [5, 9, 12, 17], [3, 7, 10, 14], [-2, 5, 9, 12]], scale: [0, 2, 3, 7, 9], bell: 0.3, pad: 0.026, air: "water", pluck: true },
  room: { bpm: 72, root: 60, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], scale: [0, 2, 4, 7, 9], bell: 0.55, pad: 0.018, box: true },
  chat: { bpm: 70, root: 67, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 14], [7, 11, 14, 17]], scale: [0, 2, 4, 7, 9], bell: 0.28, pad: 0.016, box: true },
  garden: { bpm: 64, root: 64, chords: [[0, 4, 7, 9], [5, 9, 12, 16], [-5, -1, 2, 7], [0, 4, 7, 11]], scale: [0, 2, 4, 7, 9], bell: 0.35, pad: 0.018, air: "crickets" },
  diary: { bpm: 60, root: 60, chords: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]], scale: [0, 2, 4, 7, 9], bell: 0.25, pad: 0.018 },
};
function ambBeats(ac, out, name, b0, b1, start, skipBefore = -1) {
  const c = AMB[name]; if (!c) return;
  const beat = 60 / c.bpm, seed = name.length * 131;
  for (let b = b0; b < b1; b++) {
    const w = start + b * beat;
    if (w < skipBefore) continue;
    const bar = Math.floor(b / 8), chord = c.chords[bar % c.chords.length];
    if (b % 8 === 0) {
      chord.forEach((n, i) => { tone(ac, out, w, { f: midi(c.root - 12 + n), type: "triangle", dur: beat * 8.4, vol: c.pad, attack: beat * 2, curve: "lin", detune: (i - 1.5) * 6, lp: 1100 }); });
      tone(ac, out, w, { f: midi(c.root - 24 + chord[0]), type: "sine", dur: beat * 8.4, vol: c.pad * 1.4, attack: beat, curve: "lin" });
      if (c.air === "water") noise(ac, out, w, { dur: beat * 8.6, vol: 0.022, f: 500, q: 0.4, type: "lowpass", attack: beat * 3, curve: "lin" });
      if (c.air === "wind") noise(ac, out, w, { dur: beat * 8.6, vol: 0.016, f: 380, f2: 700, q: 2, attack: beat * 3, curve: "lin" });
    }
    if (c.air === "crickets" && hash(b * 3 + seed) > 0.4) for (let k = 0; k < 4; k++) tone(ac, out, w + k * 0.05 + hash(b) * 0.3, { f: 4200 + hash(b * 5) * 600, type: "sine", dur: 0.03, vol: 0.008 });
    if (c.air === "water" && hash(b * 17 + seed) > 0.6) tone(ac, out, w + hash(b * 9) * beat, { f: 900 + hash(b * 13) * 900, f2: 500, type: "sine", dur: 0.08, vol: 0.012 });
    // 铃音旋律：两个八分音符位置
    for (const half of [0, 0.5]) {
      const r = hash(b * 2 + half * 2 + seed);
      if (r < c.bell) {
        const deg = Math.floor(hash(b * 7 + half * 3 + seed) * c.scale.length), oct = hash(b * 11 + seed) > 0.7 ? 12 : 0;
        const f = midi(c.root + 12 + c.scale[deg] + oct);
        if (c.box) tone(ac, out, w + half * beat, { f, type: "triangle", dur: 0.7, vol: 0.03 });
        else bell(ac, out, w + half * beat, f, 0.028, 1.8);
      }
    }
    if (c.pluck && b % 2 === 0) tone(ac, out, w, { f: midi(c.root + chord[(b >> 1) % 4]), type: "triangle", dur: 0.5, vol: 0.03, lp: 1800 });
  }
}

// ---------- 实时引擎 ----------
function ensure() {
  if (ac) return true;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  try {
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.85;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    ambBus = ac.createGain(); ambBus.gain.value = 0.55; ambBus.connect(master);
    setInterval(pump, 250);
    return true;
  } catch { ac = null; return false; }
}
function startAmb(name) {
  if (!ac) return;
  if (amb) { const g = amb.gain; g.gain.setTargetAtTime(0, ac.currentTime, 0.4); setTimeout(() => g.disconnect(), 3000); }
  const g = ac.createGain(); g.gain.setValueAtTime(0, ac.currentTime); g.gain.linearRampToValueAtTime(1, ac.currentTime + 1.2); g.connect(ambBus);
  amb = { name, start: ac.currentTime + 0.05, gain: g, next: 0 };
}
function pump() {
  if (!ac || !amb || ac.state !== "running") return;
  const beat = 60 / AMB[amb.name].bpm, until = Math.floor((ac.currentTime + 0.8 - amb.start) / beat) + 1;
  if (until > amb.next) { ambBeats(ac, amb.gain, amb.name, amb.next, until, amb.start, ac.currentTime - 0.01); amb.next = until; }
}
let wanted = null;
export function ambient(name) {
  if (wanted === name) return;
  wanted = name; rec("amb", name);
  if (ac) startAmb(name);
}
export function sfx(name) {
  rec("sfx", name);
  if (!ac || muted || ac.state !== "running") return;
  SFX[name]?.(ac, sfxBus, ac.currentTime + 0.01);
}
export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m; localStorage.setItem(KEY, muted ? "1" : "0"); rec("mute", muted ? "on" : "off");
  if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.85, ac.currentTime, 0.05);
  document.querySelectorAll("[data-testid=mute]").forEach((b) => { b.setAttribute("aria-pressed", String(muted)); b.classList.toggle("off", muted); b.title = muted ? "打开声音" : "静音"; });
}
function unlock() {
  if (!ensure()) return;
  if (ac.state === "suspended") ac.resume();
  if (unlockedAt == null) { unlockedAt = now(); rec("unlock", "gesture"); if (wanted) startAmb(wanted); }
}
["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, unlock, { capture: true, passive: true }));

// 按钮的悬停 / 按下音效（事件委托）
let lastHover = null;
addEventListener("pointerover", (e) => {
  const b = e.target.closest?.("button, [role=button], .chip, .swatch");
  if (b && b !== lastHover && !b.disabled) { lastHover = b; if (e.pointerType === "mouse") sfx("hover"); }
  if (!b) lastHover = null;
});
addEventListener("pointerdown", (e) => { const b = e.target.closest?.("button, [role=button]"); if (b && !b.disabled && b.dataset.testid !== "mute") sfx(b.matches(".choice, .swatch") ? "select" : "press"); }, true);

// ---------- 离线渲染：把事件日志重放成 WAV（用于演示视频配乐） ----------
export async function renderWav({ from = 0, to = now(), rate = 22050 } = {}) {
  const dur = Math.max(1, to - from);
  const oac = new OfflineAudioContext(1, Math.ceil(dur * rate), rate);
  const m = oac.createGain(); m.gain.value = 0.6; const comp = oac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; m.connect(comp); comp.connect(oac.destination);
  const sb = oac.createGain(); sb.gain.value = 0.9; sb.connect(m);
  const ab = oac.createGain(); ab.gain.value = 0.55; ab.connect(m);
  const ul = log.find((e) => e.kind === "unlock")?.t; if (ul == null) return null;
  let isM = false, cur = null, curStart = 0;
  const flushAmb = (until) => {
    if (!cur) return;
    const s = Math.max(curStart, ul) - from, e = until - from, beat = 60 / AMB[cur].bpm;
    if (e <= s) return;
    const g = oac.createGain(); g.gain.setValueAtTime(0, Math.max(0, s)); g.gain.linearRampToValueAtTime(1, Math.max(0, s) + 1.2); g.gain.setTargetAtTime(0, e, 0.4); g.connect(ab);
    ambBeats(oac, g, cur, 0, Math.ceil((e - s) / beat) + 1, s);
  };
  for (const ev of log) {
    if (ev.t < from || ev.t > to) { if (ev.kind === "amb" && ev.t < from) { cur = ev.name; curStart = ev.t; } continue; }
    if (ev.kind === "mute") { isM = ev.name === "on"; continue; }
    if (ev.kind === "amb") { flushAmb(ev.t); cur = ev.name; curStart = ev.t; continue; }
    if (ev.kind === "sfx" && !isM && ev.t >= ul) SFX[ev.name]?.(oac, sb, ev.t - from);
  }
  flushAmb(to);
  const buf = await oac.startRendering();
  const pcm = buf.getChannelData(0), bytes = new Uint8Array(44 + pcm.length * 2), dv = new DataView(bytes.buffer);
  const wr = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  wr(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); wr(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

window.__oloAudio = { log, renderWav, isMuted, sfx, ambient };
