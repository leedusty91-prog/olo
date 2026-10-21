// olo 像素引擎：程序化生成原创像素精灵（32×32），逐帧动画，统一 10fps 时钟。
export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const PALETTES = {
  mint: ["#22402f", "#3f9a68", "#6fcf98", "#b4efcc", "#effff4"],
  sky: ["#1f3352", "#4f84c7", "#80b6ef", "#c9e4ff", "#f4faff"],
  sun: ["#4f3510", "#d99a2b", "#ffc455", "#ffe7a1", "#fffbe6"],
  blush: ["#52253a", "#d96d8e", "#f59ab3", "#ffd6e1", "#fff3f7"],
  lavender: ["#33285c", "#8069cf", "#ab95ef", "#e2d8ff", "#f8f5ff"],
};
const INK = "#1d1830", WHITE = "#ffffff", CHEEK = "#ff86a3", STEM = "#2f7a4b", LEAF1 = "#47b06c", LEAF2 = "#8be3a8";
const GLOW = "#fff1a8", TEAR = "#8fd3ff";

// ---------- 全局时钟 ----------
const subs = new Set();
let tick = 0;
export const ticker = {
  add(fn) { subs.add(fn); fn(tick); return () => subs.delete(fn); },
  get t() { return tick; },
};
if (!REDUCED) setInterval(() => { tick++; subs.forEach((fn) => { try { fn(tick); } catch (e) { console.error(e); } }); }, 100);

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function canvas(w, h, cls = "") {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.className = "px-canvas " + cls;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}
export const P = (ctx, x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w, h); };

// ---------- 形体遮罩 ----------
const masks = {};
function mask(form) {
  if (masks[form]) return masks[form];
  const m = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const X = x + 0.5, Y = y + 0.5;
    let inside;
    if (form === "cloud") {
      const c = (cx, cy, r) => (X - cx) ** 2 + (Y - cy) ** 2 <= r * r;
      inside = (c(8.5, 21, 5.2) || c(13, 16.5, 5.6) || c(19.5, 15.5, 6.2) || c(24, 20.5, 5) || c(16, 22.5, 6.8) || c(10, 24.5, 3.8) || c(22, 24.5, 3.8)) && Y < 28;
    } else if (form === "glow") {
      inside = (X - 16) ** 2 + (Y - 20) ** 2 <= 6.6 ** 2;
    } else {
      inside = ((X - 16) / 11) ** 2 + ((Y - 19.5) / 9.2) ** 2 <= 1 && Y < 28.4;
    }
    m.push(inside);
  }
  let top = 32;
  for (let i = 0; i < m.length; i++) if (m[i]) { top = Math.min(top, (i / 32) | 0); }
  return (masks[form] = { m, top });
}
const at = (m, x, y) => x >= 0 && y >= 0 && x < 32 && y < 32 && m[y * 32 + x];

// ---------- 绘制一帧 ----------
export function drawOlo(ctx, { form = "buddy", color = "mint", state = "idle", t = 0, ox = 0, oy = 0 }) {
  const pal = PALETTES[color] || PALETTES.mint;
  const { m, top } = mask(form);
  const glow = form === "glow";
  // 动作参数
  let bob = 0, squash = 0;
  if (state === "happy") { const ph = t % 6; bob = [0, -1, -3, -3, -1, 0][ph]; squash = ph === 0 ? 1 : 0; }
  else if (state === "talking") bob = t % 4 < 2 ? 0 : -1;
  else if (state === "sad") bob = (t >> 3) % 2 ? 1 : 0;
  else bob = (t >> 2) % 4 === 0 || (t >> 2) % 4 === 3 ? 0 : -1;
  const dy = oy + bob;

  // 影子
  const sw = glow ? 8 : 18 - (bob < -2 ? 4 : bob < 0 ? 2 : 0);
  ctx.globalAlpha = 0.28; P(ctx, ox + 16 - sw / 2, oy + 29, INK, sw, 2); ctx.globalAlpha = 1;

  // 微光形态的光晕（抖动的同心环）
  if (glow) {
    const pulse = (t >> 1) % 4;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 20);
      const r = 8.4 + (pulse > 1 ? 0.7 : 0);
      if (d > 7.1 && d < r) { ctx.globalAlpha = 0.55; P(ctx, ox + x, dy + y, (x + y) % 2 ? pal[2] : pal[3]); }
      else if (d >= r + 1 && d < r + 4 && (x * 7 + y * 13 + (t >> 1) * 5) % 23 === 0) { ctx.globalAlpha = 0.9; P(ctx, ox + x, dy + y, GLOW); }
    }
    ctx.globalAlpha = 1;
  }

  // 身体：描边 + 三段明暗 + 高光
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (!at(m, x, y)) continue;
    const edge = !at(m, x - 1, y) || !at(m, x + 1, y) || !at(m, x, y - 1) || !at(m, x, y + 1);
    let c;
    if (edge) c = pal[0];
    else {
      const s = (x - 16) * 0.8 + (y - 19) * 1.0;
      c = s < -7 ? pal[3] : s < 3 ? pal[2] : s < 7 ? ((x + y) % 2 ? pal[2] : pal[1]) : pal[1];
      if (!at(m, x, y + 2)) c = pal[1];
    }
    P(ctx, ox + x, dy + y + (squash && y > 24 ? 0 : 0), c);
  }
  // 高光
  const hx = glow ? 13 : 9, hy = glow ? 16 : form === "cloud" ? 13 : 14;
  P(ctx, ox + hx, dy + hy, pal[4], 2, 1); P(ctx, ox + hx, dy + hy + 1, pal[4]);
  // 腹部灯芯（灯籽的暖光）
  // 灯籽的暖光：高光随呼吸闪一下
  if ((t >> 2) % 6 === 0) { P(ctx, ox + hx + 2, dy + hy, pal[4]); P(ctx, ox + hx - 1, dy + hy + 1, pal[4]); }

  // 嫩芽
  const sx = 16, sy = top - 1 + dy;
  if (state === "sad") {
    P(ctx, ox + sx, sy, STEM); P(ctx, ox + sx, sy - 1, STEM);
    P(ctx, ox + sx - 3, sy, LEAF1, 3, 1); P(ctx, ox + sx - 4, sy + 1, LEAF1);
    P(ctx, ox + sx + 1, sy, LEAF2, 3, 1); P(ctx, ox + sx + 4, sy + 1, LEAF2);
  } else {
    const sway = state === "happy" ? (t % 2 ? 1 : -1) : ((t >> 3) % 2 ? 1 : 0);
    P(ctx, ox + sx, sy, STEM); P(ctx, ox + sx, sy - 1, STEM); P(ctx, ox + sx + sway, sy - 2, STEM);
    const lx = ox + sx + sway, ly = sy - 3;
    P(ctx, lx - 4, ly - 1, LEAF1, 2, 1); P(ctx, lx - 3, ly, LEAF1, 3, 1); P(ctx, lx - 5, ly - 2, LEAF1, 2, 1); P(ctx, lx - 2, ly + 1, LEAF1);
    P(ctx, lx + 1, ly, LEAF2, 3, 1); P(ctx, lx + 2, ly - 1, LEAF2, 3, 1); P(ctx, lx + 4, ly - 2, LEAF2, 2, 1);
    if (state === "happy") { P(ctx, lx - 6, ly - 3, LEAF1); P(ctx, lx + 6, ly - 3, LEAF2); }
  }

  // 脸
  const ey = dy + (glow ? 18 : form === "cloud" ? 19 : 18);
  const lx = ox + (glow ? 12 : 10), rx = ox + (glow ? 18 : 20);
  const blink = state !== "happy" && state !== "sad" && (t % 37 === 0 || t % 37 === 1 || t % 91 === 5);
  if (state === "happy") {
    for (const ex of [lx, rx]) { P(ctx, ex, ey + 1, INK); P(ctx, ex + 1, ey, INK); P(ctx, ex + 2, ey + 1, INK); }
  } else if (blink) {
    P(ctx, lx, ey + 1, INK, 3, 1); P(ctx, rx, ey + 1, INK, 3, 1);
  } else if (state === "sad") {
    for (const ex of [lx, rx]) { P(ctx, ex, ey + 1, INK, 2, 2); P(ctx, ex, ey + 1, WHITE); }
    P(ctx, lx - 1, ey - 1, INK, 2, 1); P(ctx, lx + 1, ey - 2, INK);
    P(ctx, rx + 1, ey - 1, INK, 2, 1); P(ctx, rx, ey - 2, INK);
  } else {
    const look = state === "thinking" ? 1 : 0;
    for (const ex of [lx, rx]) { P(ctx, ex + look, ey - look, INK, 2, 3); P(ctx, ex + look + 1, ey - look, WHITE); }
  }
  // 腮红
  ctx.globalAlpha = 0.8; P(ctx, lx - 2, ey + 3, CHEEK, 2, 1); P(ctx, rx + 2, ey + 3, CHEEK, 2, 1); ctx.globalAlpha = 1;
  // 嘴
  const mx = ox + 15, my = ey + 4;
  if (state === "talking") {
    const f = t % 3;
    if (f === 0) P(ctx, mx, my, INK, 2, 1);
    else if (f === 1) { P(ctx, mx, my, INK, 2, 2); }
    else { P(ctx, mx - 1, my, INK, 4, 2); P(ctx, mx, my + 2, INK, 2, 1); P(ctx, mx, my + 1, "#ff6f8f", 2, 1); }
  } else if (state === "sad") {
    P(ctx, mx - 1, my + 1, INK); P(ctx, mx, my, INK, 2, 1); P(ctx, mx + 2, my + 1, INK);
  } else if (state === "thinking") {
    P(ctx, mx + 1, my, INK);
  } else if (state === "happy") {
    P(ctx, mx - 1, my, INK, 4, 1); P(ctx, mx, my + 1, INK, 2, 1); P(ctx, mx, my + 1, "#ff6f8f");
  } else {
    P(ctx, mx - 1, my, INK); P(ctx, mx, my + 1, INK, 2, 1); P(ctx, mx + 2, my, INK);
  }

  // 情绪特效
  if (state === "happy") {
    const sp = [[3, 6], [27, 8], [26, 1], [4, 14]];
    sp.forEach(([x, y], i) => {
      if ((t + i) % 4 < 2) { P(ctx, ox + x, dy + y - 1, GLOW); P(ctx, ox + x - 1, dy + y, GLOW, 3, 1); P(ctx, ox + x, dy + y + 1, GLOW); }
      else P(ctx, ox + x, dy + y, WHITE);
    });
  }
  if (state === "sad") {
    const f = t % 10;
    if (f < 7) { ctx.globalAlpha = 1 - f / 8; P(ctx, lx, ey + 3 + f, TEAR, 1, 2); ctx.globalAlpha = 1; }
  }
  if (state === "thinking") {
    const n = (t >> 2) % 4;
    [[24, 9], [27, 6], [30, 3]].forEach(([x, y], i) => { if (i < n) P(ctx, ox + x - (i === 2 ? 1 : 0), dy + y, WHITE, i === 2 ? 2 : 1, i === 2 ? 2 : 1); });
  }
}

// ---------- 可挂载的 olo 精灵 ----------
export function oloSprite({ form = "buddy", color = "mint", state = "idle", scale = 4, cls = "" } = {}) {
  const [c, ctx] = canvas(32, 32, "olo-sprite " + cls);
  c.style.width = c.style.height = 32 * scale + "px";
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", "olo");
  const s = { form, color, state };
  const sync = () => { c.dataset.oloForm = s.form; c.dataset.state = s.state; c.dataset.color = s.color; };
  const draw = (t) => { ctx.clearRect(0, 0, 32, 32); drawOlo(ctx, { ...s, t }); };
  sync();
  let off = ticker.add(draw);
  const obs = new MutationObserver(() => { if (!c.isConnected) { off(); obs.disconnect(); } });
  requestAnimationFrame(() => obs.observe(document.body, { childList: true, subtree: true }));
  c.olo = {
    set(next) { Object.assign(s, next); sync(); draw(ticker.t); },
    get: () => ({ ...s }),
    draw: (target, x, y, t) => drawOlo(target, { ...s, t, ox: x, oy: y }),
  };
  return c;
}
