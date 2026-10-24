// olo 像素引擎：程序化生成的原创像素角色（32×32），挤压拉伸 / 预备动作 / 嫩芽二级运动 / 待机小动作 / 情绪表情符号。
export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// 暖色调色板：每组 6 阶（描边 → 暗部 → 中间调 → 亮部 → 高光 → 灯芯暖光）
export const PALETTES = {
  sun: ["#5b2a12", "#c8641f", "#f0973a", "#ffc46b", "#fff0c8", "#fff7e0"],
  blush: ["#5a2230", "#c4545e", "#ee8a7e", "#ffbfa3", "#ffe9d6", "#fff4e8"],
  mint: ["#22403a", "#3f8a78", "#6cbfa0", "#a8e0bd", "#eefbe0", "#fff8dc"],
  sky: ["#2a3450", "#4f7fa0", "#7fb4c7", "#bfe0dc", "#f3fbf2", "#fff6e2"],
  lavender: ["#45203f", "#9a4f7c", "#cf82a0", "#f2b9c2", "#ffe8e6", "#fff3ea"],
};
const INK = "#2a140c", WHITE = "#fffaf0", CHEEK = "#ff7d7d", MOUTH = "#a8323e";
const STEM = "#4f7a2c", LEAF_D = "#5f9a33", LEAF_L = "#a6d65a", LEAF_H = "#e3f59a", BUD = "#ffd36b";
const SPARK = "#fff1b8", TEAR = "#9fe0f0", RIM = "#ffe2a8";

// ---------- 全局时钟：慢钟 10fps（场景），快钟 20fps（角色） ----------
const slow = new Set(), fast = new Set();
let tick = 0;
export const ticker = {
  add(fn) { slow.add(fn); fn(tick >> 1); return () => slow.delete(fn); },
  addFast(fn) { fast.add(fn); fn(tick / 2); return () => fast.delete(fn); },
  get t() { return tick >> 1; },
  get ft() { return tick / 2; },
};
const run = (set, v) => set.forEach((fn) => { try { fn(v); } catch (e) { console.error(e); } });
if (!REDUCED) setInterval(() => { tick++; run(fast, tick / 2); if (tick % 2 === 0) run(slow, tick >> 1); }, 50);

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export function canvas(w, h, cls = "") {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.className = "px-canvas " + cls;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}
export const P = (ctx, x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

// ---------- 缓动 ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };


// ---------- 高清插画灯籽（与手机端同一套 assets/hd/olo 图） ----------
// 10 种灯籽都有 idle/happy/sad/sleep/talking/thinking；held 只有麻薯/云朵/微光（其余用 happy）。
// 旧的像素饰品/眼型/腮红已移除：存档里的旧装扮一律按默认高清造型画（蝴蝶结以后作为商店道具回来）。
export const HD_FORMS = ["buddy", "cloud", "glow", "bud", "dew", "star", "peach", "acorn", "moon", "amber"];
const HD_FULL = new Set(["buddy", "cloud", "glow"]);
const HD_STATES = ["idle", "happy", "sad", "sleep", "talking", "thinking", "held"];
const HD_IMG = new Map();
export function hdKey(form, state) {
  const f = HD_FORMS.includes(form) ? form : "buddy";
  let st = HD_STATES.includes(state) ? state : "idle";
  if (!HD_FULL.has(f) && st === "held") st = "happy";
  return `${f}-${st}`;
}
export function hdImage(form, state) {
  const k = hdKey(form, state);
  let im = HD_IMG.get(k);
  if (!im) { im = new Image(); im.decoding = "async"; im.src = new URL(`./assets/olo/${k}.png`, import.meta.url).href; HD_IMG.set(k, im); }
  return im;
}
export function preloadOlo(forms = HD_FORMS) { for (const f of forms) for (const st of HD_STATES) hdImage(f, st); }

// 在 32×32 的格子里画一只高清灯籽（ox/oy 为格子左上角，脚底约 y=29）。
// 果冻感：轻微呼吸 / 开心蹦 / 说话点头；减少动态时静止。
export function drawOlo(ctx, { form = "buddy", state = "idle", t = 0, ox = 0, oy = 0 }) {
  const im = hdImage(form, state);
  if (!im.complete || !im.naturalWidth) return; // 图还在加载：这一帧先不画
  const s = REDUCED ? 0 : t / 10;
  let sx = 1, sy = 1, y = 0, rot = 0;
  if (state === "happy" || state === "held") { const b = Math.abs(Math.sin(s * 3.2)); y = -b * 2.2; sy = 1 + 0.05 * b; sx = 1 - 0.035 * b; }
  else if (state === "talking") { sy = 1 + 0.03 * Math.sin(s * 9); sx = 1 - 0.02 * Math.sin(s * 9); }
  else if (state === "thinking") rot = 0.05 * Math.sin(s * 1.2);
  else if (state === "sleep") { sy = 1 + 0.025 * Math.sin(s * 0.9); sx = 1 - 0.015 * Math.sin(s * 0.9); }
  else if (state === "sad") { sy = 0.97 + 0.01 * Math.sin(s * 1.1); sx = 1.02; }
  else { sy = 1 + 0.03 * Math.sin(s * 1.6); sx = 1 - 0.02 * Math.sin(s * 1.6); }
  const S = 34, foot = 30.5;
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  // 软影子
  ctx.globalAlpha = 0.18 * (1 + y / 6);
  ctx.fillStyle = "#5a3424"; ctx.beginPath(); ctx.ellipse(ox + 16, oy + foot, 9 * (1 + y / 10), 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.translate(ox + 16, oy + foot + y); ctx.rotate(rot); ctx.scale(sx, sy);
  ctx.drawImage(im, -S / 2, -S * 0.97, S, S);
  ctx.restore();
}

// ---------- 可挂载的 olo 精灵 ----------
export function oloSprite({ form = "buddy", color = "sun", state = "idle", scale = 4, cls = "", hair = "none", eyes = "circle", cheeks = "blush" } = {}) {
  const R = 8;                                       // 高清：内部 256×256，CSS 再缩放
  const [c, ctx] = canvas(32 * R, 32 * R, "olo-sprite olo-hd " + cls);
  ctx.imageSmoothingEnabled = true;
  c.style.width = c.style.height = 32 * scale + "px";
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", "olo");
  const s = { form, color, state, hair, eyes, cheeks };
  const phase = Math.random() * 50;
  const sync = () => { c.dataset.oloForm = s.form; c.dataset.state = s.state; c.dataset.color = s.color; c.dataset.hair = "none"; c.dataset.eyes = "circle"; c.dataset.cheeks = "blush"; };
  const draw = (t) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 32 * R, 32 * R); ctx.setTransform(R, 0, 0, R, 0, 0); drawOlo(ctx, { ...s, t: t + phase }); };
  sync();
  const off = ticker.addFast(draw);
  const obs = new MutationObserver(() => { if (!c.isConnected) { off(); obs.disconnect(); } });
  requestAnimationFrame(() => obs.observe(document.body, { childList: true, subtree: true }));
  c.olo = {
    set(next) { Object.assign(s, next); sync(); draw(ticker.ft); },
    get: () => ({ ...s }),
    draw: (target, x, y, t) => drawOlo(target, { ...s, t, ox: x, oy: y }),
  };
  return c;
}
