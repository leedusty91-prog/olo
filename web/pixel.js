// olo 像素引擎：程序化生成的原创像素角色（32×32），挤压拉伸 / 预备动作 / 嫩芽二级运动 / 待机小动作 / 情绪表情符号。
import { PX_FORMS } from "./forms-px.js";
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

// 一次跳跃：预备下蹲 → 拉伸起跳 → 空中 → 落地压扁 → 回弹。返回 {y, sx, sy}
function hop(p, height = 4) {
  if (p < 0 || p >= 1) return { y: 0, sx: 1, sy: 1 };
  if (p < 0.22) { const k = Math.sin((p / 0.22) * Math.PI * 0.5); return { y: 0, sx: 1 + 0.16 * k, sy: 1 - 0.2 * k }; }
  if (p < 0.7) {
    const k = (p - 0.22) / 0.48, y = -height * 4 * k * (1 - k);
    const st = 1 - Math.abs(2 * k - 1);
    return { y, sx: 1 - 0.1 * (1 - st * 0.6), sy: 1 + 0.16 * (1 - st * 0.6) };
  }
  const k = (p - 0.7) / 0.3, d = Math.sin(k * Math.PI) * Math.exp(-k * 2);
  return { y: 0, sx: 1 + 0.2 * d, sy: 1 - 0.22 * d };
}

// ---------- v2 火焰的有符号距离场（64px 概念稿坐标；绘制时按 H 缩放到 32px） ----------
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b * (1 - h) + a * h - k * h * (1 - h); };
const strokes = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
const G_TIP = strokes(24, (t) => [32 + 3 * t ** 1.6 - 2.1 * Math.sin(Math.PI * t), 46 - t * 30, 12.5 * (1 - t) ** 1.15 + 0.4]);
const G_FL = strokes(14, (t) => [32 - 9 - 2.5 * t ** 1.3, 42 - t * 10, 4.8 * (1 - t) ** 0.9 + 0.6]);
const G_FR = strokes(14, (t) => [32 + 9 + 2 * t ** 1.3, 44 - t * 7, 4.2 * (1 - t) ** 0.9 + 0.6]);
const brushD = (pts, X, Y) => { let d = 1e9; for (const [px, py, r] of pts) d = Math.min(d, Math.hypot(X - px, Y - py) - r); return d; };
function glowSd(X, Y) {
  const base = Math.hypot(X - 32, Y - 46) - 12.5;
  return smin(smin(smin(base, brushD(G_TIP, X, Y), 3), brushD(G_FL, X, Y), 3), brushD(G_FR, X, Y), 3);
}
const GLOW_SPAN = 42.5;                                  // 概念稿里火焰从底到焰尖的高度（px）

// ---------- 形体：10 只灯籽（设定稿重画的像素剪影，见 forms-px.js / scripts/gen_pixel_forms.py） ----------
// 都是软果冻身子 + 头顶一撮卷毛，没有手脚、没有蝴蝶结。eyeY：眼睛离脚底的高度占比。
const FORM_TUNE = {
  buddy: { eyeY: 0.36 }, cloud: { eyeY: 0.36, gap: 4 }, glow: { eyeY: 0.36, float: 3 }, bud: { eyeY: 0.36 }, dew: { eyeY: 0.32 },
  star: { eyeY: 0.42, gap: 3 }, peach: { eyeY: 0.36 }, acorn: { eyeY: 0.36, gap: 3 }, moon: { eyeY: 0.3, gap: 3, dx: -2 }, amber: { eyeY: 0.36 },
};
const FORMS = Object.fromEntries(Object.entries(PX_FORMS).map(([id, { g, pal }]) => [id, {
  bmp: g, pal, W: g[0].length, H: g.length, half: () => 0, eyes: "big", gap: 4, tip: 0, dx: 0, ...FORM_TUNE[id],
}]));
export const FORM_IDS = Object.keys(PX_FORMS);
const CAP_PAL = ["#3a1e0c", "#6a3c1c", "#8a542e", "#a8703e", "#c8945e", "#e8c08c"];
const FIXED_ACCENT = { buddy: "sun", cloud: "sky", glow: "lavender", bud: "mint", dew: "sky", star: "sun", peach: "blush", acorn: "sun", moon: "sky", amber: "sun" };
function formPal(form) { return (FORMS[form] || FORMS.buddy).pal; }

// 情绪符号（像素图案）
const EMOTES = {
  heart: [".x.x.", "xxxxx", "xxxxx", ".xxx.", "..x.."],
  note: ["..xx", "..x.", "..x.", "xxx.", "xx.."],
  drop: ["..x..", ".xxx.", "xxxxx", "xxxxx", ".xxx."],
  dots: ["x.x.x"],
  bang: ["x", "x", "x", ".", "x"],
  zz: ["xxx.", "..x.", ".x..", "xxx."],
  spark: ["..x..", "..x..", "xxxxx", "..x..", "..x.."],
};
function emote(ctx, name, x, y, c, outline = INK) {
  const g = EMOTES[name]; if (!g) return;
  for (let yy = 0; yy < g.length; yy++) for (let xx = 0; xx < g[yy].length; xx++) if (g[yy][xx] === "x") {
    P(ctx, x + xx, y + yy, c);
  }
  if (name === "heart") P(ctx, x + 1, y + 1, "#ffd6d6");
}

// 状态 → 姿态参数（s 为秒）
function pose(state, s, form) {
  const o = { y: 0, sx: 1, sy: 1, lean: 0, look: [0, 0], blink: false, eyes: "open", mouth: "smile", arms: [0, 0], sprout: 0, emote: null, emoteP: 0, sweat: false, tear: -1, spin: 0 };
  const breathe = Math.sin((s / 2.6) * Math.PI * 2);
  o.sy = 1 + 0.035 * breathe; o.sx = 1 - 0.03 * breathe;
  // 眨眼：约 3.4 秒一次，偶尔连眨
  const bp = s % 3.4, bk = Math.floor(s / 3.4);
  o.blink = bp < 0.12 || (hash(bk) > 0.7 && bp > 0.24 && bp < 0.34);
  if (state === "happy") {
    const p = (s % 0.9) / 0.9, h = hop(p, form === "glow" ? 3 : 5);
    Object.assign(o, { y: h.y, sx: h.sx, sy: h.sy, eyes: "joy", mouth: "open", arms: [-1, -1], blink: false });
    o.emote = "heart"; o.emoteP = (s % 1.8) / 1.8;
  } else if (state === "held") {
    // 被抓起来：瞪大眼、张嘴、冒小星星（拖拽时由 hero 物理负责形变，这里不再呼吸缩放）
    Object.assign(o, { sx: 1, sy: 1, eyes: "open", mouth: "o", arms: [-1, -1], blink: false, sprout: -1 });
    o.emote = "spark"; o.emoteP = (s % 1.2) / 1.2;
  } else if (state === "talking") {
    const k = Math.abs(Math.sin(s * Math.PI * 3.2));
    o.y = -Math.round(k); o.sy += 0.05 * k; o.sx -= 0.04 * k;
    o.mouth = ["o", "open", "small", "open"][Math.floor(s * 8) % 4];
    o.arms = [Math.floor(s * 3) % 2 ? -1 : 0, Math.floor(s * 3) % 2 ? 0 : -1];
  } else if (state === "sad") {
    o.sy = 0.92 + 0.02 * breathe; o.sx = 1.06; o.lean = Math.sin(s * 1.3) * 0.6;
    o.eyes = "sad"; o.mouth = "frown"; o.sprout = 1; o.arms = [1, 1]; o.blink = false;
    o.tear = (s % 1.6) / 1.6; o.emote = "drop"; o.emoteP = (s % 2.4) / 2.4;
  } else if (state === "thinking") {
    o.lean = 1.2 + Math.sin(s * 1.6) * 0.3; o.look = [1, -1]; o.mouth = "flat"; o.arms = [0, -1];
    o.emote = "dots"; o.emoteP = (s % 1.5) / 1.5; o.sprout = -0.5;
  } else {
    // 待机小动作：每 7 秒一段，前 2.4 秒表演
    const seg = Math.floor(s / 7), ph = s % 7, v = Math.floor(hash(seg + 17) * 5);
    if (ph < 2.4) {
      if (v === 1) { o.look = [ph < 0.8 ? -1 : ph < 1.6 ? 1 : 0, 0]; }
      else if (v === 2) { const h = hop(ph / 0.8, 3); if (ph < 0.8) Object.assign(o, { y: h.y, sx: h.sx, sy: h.sy }); o.emote = ph > 0.5 ? "spark" : null; o.emoteP = (ph - 0.5) / 1.9; }
      else if (v === 3) { o.spin = ph / 2.4; o.eyes = ph > 0.3 && ph < 2 ? "joy" : "open"; }
      else if (v === 4) { o.lean = Math.sin(ph * Math.PI * 1.6) * 1; o.emote = "note"; o.emoteP = ph / 2.4; o.eyes = "joy"; o.mouth = "small"; }
    } else if (ph > 5.2 && ph < 6.4 && hash(seg + 99) > 0.6) {
      // 打个哈欠
      const k = smooth(5.2, 5.6, ph) * (1 - smooth(6, 6.4, ph));
      o.sy += 0.08 * k; o.sx -= 0.05 * k; o.mouth = k > 0.4 ? "yawn" : "smile"; o.eyes = k > 0.4 ? "shut" : o.eyes;
      o.emote = k > 0.2 ? "zz" : null; o.emoteP = (ph - 5.2) / 1.2;
    }
  }
  if (form === "cloud") {
    // 慢：大幅慢呼吸 + 左右轻晃 + 贴地漂浮；开心时不蹦，而是鼓起来晃一晃
    const slowB = Math.sin((s / 4.2) * Math.PI * 2);
    o.sx = (state === "happy" ? 1.1 + 0.06 * Math.sin(s * 5) : 1 + 0.06 * slowB) * (o.sx / Math.max(0.5, o.sx));
    o.sy = state === "happy" ? 0.94 - 0.05 * Math.sin(s * 5) : 1 - 0.05 * slowB;
    if (state === "happy" || state === "idle") o.y = Math.sin(s * 1.1) * 1.2 - 2;
    if (state !== "sad" && state !== "thinking") o.lean = Math.sin(s * 0.7) * 1.4;
  } else if (form === "glow") {
    // 火苗：一直轻轻闪；悬空上下浮；开心时火苗窜高
    const fl = Math.sin(s * 9) * 0.5 + Math.sin(s * 13.7) * 0.35;
    o.lean += fl * 1.1;
    o.sx = 1 + 0.05 * Math.sin(s * 11);
    if (state === "held") o.sy = 1; else o.sy = (state === "happy" ? 1.18 + 0.06 * Math.sin(s * 8) : state === "sad" ? 0.82 : 1 + 0.05 * Math.sin(s * 7));
    o.y = (state === "happy" ? Math.sin(s * 3) * 2 : Math.sin(s * 2.1) * 1.6) - 4;
    o.arms = [0, 0];
  } else if (state === "idle") {
    // 小团子：待机时也会时不时原地小蹦一下
    const p = (s % 2.6) / 2.6;
    if (p > 0.8) { const h = hop((p - 0.8) / 0.2, 2); o.y += h.y; o.sx *= h.sx; o.sy *= h.sy; }
  }
  if (state === "sleep") Object.assign(o, { eyes: "shut", blink: false, mouth: "small", arms: [1, 1], y: Math.sin(s * 0.9) * 0.8 + 1, sy: 0.96 + 0.03 * Math.sin(s * 0.9) });  // 打盹
  return o;
}


// ---------- 商店装扮：发型 / 眼睛 / 脸颊（与 server/olo/forms.py 的描述一致） ----------
// 图案：每行一个字符串，"." 透明；字母查 col 表。底行贴在头顶表面。
const HAIR = {
  bow:    { g: ["oa.ao", "abcba", "oa.ao"], col: { o: "#c8406a", a: "#ff6f96", b: "#ffc0d2", c: "#8a2a4a" } },
  leaf:   { g: ["..oaa", ".oaba", "oaao.", "s...."], col: { o: "#3f6e24", a: "#7ab83f", b: "#c8ec7a", s: "#4f7a2c" } },
  spike:  { g: [".a.", ".a.", "aba", "aba"], col: { a: "#7a3a22", b: "#c0703e" } },
  curl:   { g: [".aaa.", "a...a", "a.a.a", "a..a.", ".a..."], col: { a: "#7a3a22" } },
  crest:  { g: [".a.a.a.", "aaaaaaa", ".abbba."], col: { a: "#e0403a", b: "#ff8a6a" } },
  bun:    { g: [".ooo.", "obbao", "oaaao", ".ooo.", "..c.."], col: { o: "#4a2a1a", a: "#8a5a3a", b: "#c08a5a", c: "#ff6f96" } },
  sun:    { g: ["..y..", ".aaa.", "yabay", ".aaa.", "..y.."], col: { y: "#ffd36b", a: "#ff9e2a", b: "#fff0a0" } },
};
// 每种形态的挂点（相对头顶中线的 x 偏移）。小团子正中是嫩芽：装饰放两侧，鸡冠画在嫩芽后面。
const HAIR_AT = {
  buddy: { bow: [4], leaf: [5], spike: [-5, -2, 2, 5], curl: [-4], crest: [0], bun: [-4], sun: [4] },
  cloud: { bow: [6], leaf: [-6], spike: [-5, 0, 5], curl: [-2], crest: [0], bun: [0], sun: [6] },
  glow:  { bow: [3], leaf: [-3], spike: [-2, 2], curl: [-1], crest: [0], bun: [0], sun: [3] },
};
function stamp(ctx, grid, x, y, col, flip = false) {
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
    const ch = grid[r][flip ? grid[r].length - 1 - c : c];
    if (ch !== "." && col[ch]) P(ctx, x + c, y + r, col[ch]);
  }
}
// topAt(X)：该列身体最上面一格的 y（没有身体则 null）
function drawHair(ctx, { hair, form, topAt, C, ox, oy, s, state, lag, behind }) {
  if (!hair || hair === "none") return;
  if (hair === "halo") return;                        // 光环单独画（在最上层）
  const key = hair === "spikes" ? "spike" : hair;
  const H = HAIR[key]; if (!H) return;
  const isBehind = form === "buddy" && key === "crest";
  if (behind !== isBehind) return;
  for (const dx of (HAIR_AT[form] || HAIR_AT.buddy)[key]) {
    const w = H.g[0].length, X = C + dx, top = topAt(X);
    if (top == null) continue;
    let y = top - H.g.length + 1 + (key === "crest" || key === "spike" ? 1 : 0) + lag;
    // 小动作：开心时蝴蝶结/叶子跟着弹，难过时叶子耷拉一格
    if (state === "sad" && (key === "leaf" || key === "bow")) y += 1;
    let col = H.col;
    if (key === "sun") col = { ...col, y: (Math.floor(s * (state === "happy" ? 6 : 2)) % 2) ? col.y : "#fff6d0" };
    stamp(ctx, H.g, ox + X - Math.floor(w / 2), oy + y, col, key === "leaf" && dx > 0);
  }
}
function drawHalo(ctx, { ox, oy, C, crown, s, state }) {
  const bob = REDUCED ? 0 : Math.round(Math.sin(s * 2.4) * 0.8);
  const y = crown - 3 + bob;
  ctx.globalAlpha = state === "sad" ? 0.45 : 0.75 + 0.25 * Math.sin(s * 3);
  P(ctx, ox + C - 3, oy + y, "#ffe9a0", 7, 1); P(ctx, ox + C - 4, oy + y + 1, "#ffd36b", 1, 1); P(ctx, ox + C + 4, oy + y + 1, "#ffd36b", 1, 1); P(ctx, ox + C - 3, oy + y + 2, "#ffd36b", 7, 1);
  ctx.globalAlpha = 1;
}
const CHEEK_STYLE = {
  dots: { c: "#a8443e", px: [[0, 0], [2, 0], [1, 1]] },
  triangle: { c: "#f0506a", px: [[-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [1, 1]] },
  warpaint: { c: "#c0303a", px: [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]] },
};

// 斗笠（v2 修正版）：帽冠卡在身体约 6px 宽的那一行，火焰的焰尖从帽顶小孔钻出来，小团子的嫩芽也从孔里长出
const STRAW = { a: "#e8c46a", b: "#c8963e", rim: "#a8742e", ol: "#5a3414" };
function drawStraw(ctx, { mask, ox, oy, F, bodyCol, C }) {
  const rows = new Map();
  for (const [x, y] of mask) { const r = rows.get(y) || [99, -99]; rows.set(y, [Math.min(r[0], x), Math.max(r[1], x)]); }
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const y0 = ys.find((y) => rows.get(y)[1] - rows.get(y)[0] + 1 >= (F.flame ? 6 : 8)); if (y0 == null) return;
  const [a, b] = rows.get(y0), x0 = F.flame ? Math.round((a + b) / 2) : C;
  const H = 3, Wb = 13, base = y0 + (F.flame ? 1 : 0), top = base - H + 1;
  for (let j = 0; j < H; j++) {
    const half = Math.round(1.5 + (Wb / 2 - 1.5) * (j + 1) / H);
    for (let i = -half; i <= half; i++) P(ctx, ox + x0 + i, oy + top + j, j === H - 1 ? STRAW.rim : (i + j) % 3 ? STRAW.a : STRAW.b);
    P(ctx, ox + x0 - half - 1, oy + top + j, STRAW.ol); P(ctx, ox + x0 + half + 1, oy + top + j, STRAW.ol);
  }
  P(ctx, ox + x0 - Math.floor(Wb / 2) - 1, oy + base + 1, STRAW.ol, Wb + 2, 1);
  P(ctx, ox + x0 - 1, oy + top - 1, STRAW.ol, 3, 1);
  if (F.flame) for (const [x, y] of mask) if (y < top || (y < base && Math.abs(x - x0) < 1)) P(ctx, ox + x, oy + y, bodyCol.get(x + y * 64));
}

// ---------- 绘制一帧 ----------
// t：以 0.1 秒为单位（可为小数）
export function drawOlo(ctx, { form = "buddy", color = "sun", state = "idle", t = 0, ox = 0, oy = 0, hair = "none", eyes = "circle", cheeks = "blush" }) {
  // 每种样子颜色固定：小团子永远是暖橘色，云朵/微光用自己的色板，不随存储的 color 变
  const userPal = PALETTES[FIXED_ACCENT[form] || "sun"];
  const F = FORMS[form] || FORMS.buddy;
  const pal = formPal(form);
  const s = REDUCED ? 0.5 : t / 10;
  const o = pose(state, s, form);
  const base = 28;                                   // 脚底
  const W = F.W * o.sx, H = F.H * o.sy;
  const cx = 16, top = base - H + o.y;
  const rows = Math.ceil(H) + 1;

  // 影子（离地越高越小）
  const air = clamp(-o.y / 6, 0, 1);
  const sw = Math.round((F.W * (F.flame ? 0.5 : F.float ? 0.75 : 0.85)) * (1 - 0.4 * air) * o.sx);
  ctx.globalAlpha = 0.3 - air * 0.12; P(ctx, ox + cx - sw / 2, oy + base + 1, "#3a1a10", sw, 1); P(ctx, ox + cx - sw / 2 + 2, oy + base + 2, "#3a1a10", Math.max(0, sw - 4), 1); ctx.globalAlpha = 1;

  // 微光：冷色光晕 + 往上飘的火星
  if (F.flame) {
    const gy = base - H * 0.35 + o.y;
    for (let y = -11; y <= 10; y++) for (let x = -11; x <= 11; x++) {
      const r = (x / 11) ** 2 + (y / 11) ** 2;
      if (r < 1 && r > 0.45 && (x + y + Math.floor(s * 4)) % 2 === 0) { ctx.globalAlpha = 0.35 * (1 - r); P(ctx, ox + cx + x, oy + gy + y, pal[4]); }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5; i++) { const k = ((s * 0.9 + i / 5) % 1); ctx.globalAlpha = 1 - k; P(ctx, ox + cx + Math.sin((s + i) * 2.3) * 4, oy + base - H + o.y - k * 7, i % 2 ? pal[4] : userPal[3]); }
    ctx.globalAlpha = 1;
  }

  // 身体遮罩
  const inside = (x, y) => {
    const vp = base + o.y - (y + 0.5), v = vp / H;
    const xx = x + 0.5 - cx - o.lean * clamp(v, 0, 1);
    if (F.bmp) { const u = Math.floor(xx / o.sx + F.W / 2), r = Math.floor(F.H - vp / o.sy); return r >= 0 && r < F.H && u >= 0 && u < F.W && F.bmp[r][u] !== "."; }
    if (F.sd) { const k = GLOW_SPAN / F.H; return F.sd(32 + xx * k / o.sx, 58.5 - vp * k / o.sy) <= 0; }
    if (v >= 0 && v <= 1 && Math.abs(xx) <= F.half(v) * W / 2) return true;
    if (F.nubs) for (const [px, py, r] of F.nubs) { const dx = xx - px * W / 2, dy = vp - py * H; if (dx * dx + dy * dy < r * r) return true; }
    if (F.puffs) for (const [px, py, r] of F.puffs) { const dx = xx - px * W / 2, dy = vp - py * H, R = r * W / 2; if (vp >= 0 && dx * dx + dy * dy < R * R) return true; }
    return false;
  };
  const y0 = Math.floor(top - 6), y1 = base + 1;
  const mask = [];
  for (let y = y0; y <= y1; y++) for (let x = 0; x < 32; x++) if (inside(x, y)) mask.push([x, y]);
  const has = new Set(mask.map(([x, y]) => x + y * 64));
  const In = (x, y) => has.has(x + y * 64);

  // 小脚
  if (F.feet) {
    const fy = base - (o.y < -0.5 ? 1 : 0) + Math.round(o.y);
    for (const fx of [cx - 5, cx + 3]) { P(ctx, ox + fx - 1 + (o.y < -0.5 ? (fx < cx ? 1 : -1) : 0), oy + fy, pal[0], 4, 1); P(ctx, ox + fx + (o.y < -0.5 ? (fx < cx ? 1 : -1) : 0), oy + fy, pal[1], 2, 1); }
  }
  // 小手（身体两侧的小圆块）
  if (F.arms) {
    const ay = base + o.y - H * 0.42;
    [[-1, o.arms[0]], [1, o.arms[1]]].forEach(([side, up]) => {
      const hw = F.half(0.42) * W / 2;
      const ax = cx + side * (hw + 0.5) + o.lean * 0.42, yy = ay + up * 3;
      if (F.small) { P(ctx, ox + ax - 1, oy + yy, pal[0], 2, 2); P(ctx, ox + ax - (side < 0 ? 0 : 1), oy + yy, pal[3], 1, 1); }
      else { P(ctx, ox + ax - 1, oy + yy - 1, pal[0], 3, 3); P(ctx, ox + ax, oy + yy, side < 0 ? pal[3] : pal[2], 1, 1); }
    });
  }

  // 身体：描边 + 顶光明暗 + 抖动过渡 + 右侧暖色轮廓光 + 腹部灯芯
  const bodyCol = new Map();
  for (const [x, y] of mask) {
    const edge = !In(x - 1, y) || !In(x + 1, y) || !In(x, y - 1) || !In(x, y + 1);
    let c;
    const capCell = F.bmp && form === "acorn" && (() => { const vp = base + o.y - (y + 0.5), xx = x + 0.5 - cx - o.lean * clamp(vp / H, 0, 1); const r = Math.floor(F.H - vp / o.sy), u = Math.floor(xx / o.sx + F.W / 2); return F.bmp[r]?.[u] === "c"; })();
    if (edge) c = capCell ? CAP_PAL[0] : pal[0];
    else {
      const nx = (x + 0.5 - cx) / (W / 2), ny = (y + 0.5 - (top + H / 2)) / (H / 2);
      const L = -nx * 0.55 - ny * 0.85;               // 左上暖光
      const d = (x + y) % 2 === 0;
      const band = (v, th) => Math.abs(v - th) < 0.07 && d;
      c = L > 0.62 ? pal[4] : L > 0.05 ? pal[3] : L > -0.6 ? pal[2] : pal[1];
      if (band(L, 0.62)) c = pal[3]; else if (band(L, 0.05)) c = pal[2]; else if (band(L, -0.6)) c = pal[1];
      if (F.puffs) {                                             // 云朵：棉团之间的褶线
        const vp = base + o.y - (y + 0.5), xx = x + 0.5 - cx - o.lean * clamp(vp / H, 0, 1);
        F.puffs.forEach(([px, py, r], i) => { if (i === 1) return; const R = r * W / 2, dd = Math.hypot(xx - px * W / 2, vp - py * H); if (dd > R - 1 && dd < R && vp > py * H - 1 && Math.abs(xx) < W * 0.32) c = pal[1]; });
      }
      if (F.flame) {                                             // 火苗：下半部亮芯，越往上越淡
        const vp = (base + o.y - (y + 0.5)) / H, cxo = Math.abs(x + 0.5 - cx - o.lean * vp);
        const core = (cxo / 3.6) ** 2 + ((vp - 0.26) / 0.26) ** 2;
        c = core < 0.45 ? pal[5] : core < 1 ? pal[4] : vp > 0.7 ? pal[2] : pal[3];
        if (vp > 0.6 && (x + y + Math.floor(s * 8)) % 3 === 0) c = pal[2];
      }
      if (F.mochi) {                                             // 麻薯：高光嵌在体积里（左上一团柔光），底部一条暖色反光
        const q = ((x + 0.5 - (cx - W * 0.22 + o.lean * 0.8)) / 2.3) ** 2 + ((y + 0.5 - (top + H * 0.24)) / 1.4) ** 2;
        if (q < 0.9) c = pal[4];
        if (y + 0.5 > top + H * 0.82 && Math.abs(x + 0.5 - cx) < 5 && In(x, y + 1) && !In(x, y + 2) && (x + y) % 2 === 0) c = "#e07a34";
      }
      if (!In(x, y + 1)) c = F.flame ? pal[3] : pal[1];          // 底部暗边
      if (!F.flame && (!In(x + 1, y) || !In(x + 1, y - 1))) { if (nx > 0.2 && ny < 0.3 && ny > -0.7) c = form === "cloud" ? userPal[3] : RIM; }  // 右侧暖色轮廓光
      // 灯芯：腹部一团柔光，随呼吸明灭
    }
    if (form === "amber" && !edge && !capCell && hash(x * 31 + y * 7) > 0.9) c = pal[5];   // 琥珀里细碎的金点
    if (capCell && !edge) { const nx = (x + 0.5 - cx) / (W / 2); c = (x + y) % 4 === 0 || (x - y + 64) % 4 === 0 ? CAP_PAL[1] : nx < -0.3 ? CAP_PAL[4] : nx < 0.3 ? CAP_PAL[3] : CAP_PAL[2]; }
    P(ctx, ox + x, oy + y, c); bodyCol.set(x + y * 64, c);
  }
  // 高光
  const hx = cx - W * 0.26 + o.lean * 0.8, hy = top + H * (F.bmp ? 0.42 : 0.2);
  if (!F.flame && !F.mochi) { P(ctx, ox + hx, oy + hy, WHITE, 2, 1); P(ctx, ox + hx - 1, oy + hy + 1, WHITE, 1, 2); }

  const colTop = new Map();
  for (const [x, y] of mask) if (!colTop.has(x) || y < colTop.get(x)) colTop.set(x, y);
  const topAt = (X) => colTop.get(Math.round(X)) ?? null;
  const C = Math.round(cx + o.lean);
  const hvel = (pose(state, s - 0.06, form).y - o.y) / 0.06;
  const hairArgs = { hair, form, topAt, C, ox, oy, s, state, lag: REDUCED ? 0 : Math.round(clamp(hvel * 0.04, -1, 1)) };
  drawHair(ctx, { ...hairArgs, behind: true });
  if (hair === "straw") drawStraw(ctx, { mask, ox, oy, F, bodyCol, C });
  const heart = 0.55 + 0.45 * Math.sin(s * 2.2);
  if (F.sprout) {
  // 嫩芽：茎随速度滞后摆动（二级运动），叶片可旋转
  const vel = (pose(state, s - 0.06, form).y - o.y) / 0.06;        // 向上为正
  let ang = clamp(-vel * 0.05, -0.9, 0.9) + Math.sin(s * 1.9) * 0.15 + o.lean * 0.18;
  if (o.sprout > 0) ang = 1.25 + Math.sin(s * 1.2) * 0.1;
  const stemLen = F.small ? 3 : 4;
  let sx = cx + o.lean, sy = top + (F.tip ? 0.5 : 1);
  for (let i = 0; i < stemLen; i++) {
    const a = ang * (i / stemLen);
    sx += Math.sin(a); sy -= Math.cos(a);
    P(ctx, ox + sx - 0.5, oy + sy, i < 1 ? pal[0] : STEM);
  }
  // 两片叶子
  const spin = o.spin ? Math.sin(o.spin * Math.PI * 4) * 1.2 : 0;
  const leaf = (dir, len, wid, col, hi) => {
    const a = ang + dir * (o.sprout > 0 ? 0.6 : 1.15) + (o.sprout < 0 ? -0.6 : 0) + spin * dir;
    const ux = Math.sin(a), uy = -Math.cos(a);
    for (let yy = -7; yy <= 7; yy++) for (let xx = -7; xx <= 7; xx++) {
      const u = xx * ux + yy * uy, w = -xx * uy + yy * ux;
      const k = u / len; if (k < 0 || k > 1) continue;
      const half = wid * Math.sin(k * Math.PI) * (1 - 0.25 * k);
      if (Math.abs(w) <= half) P(ctx, ox + sx + xx - 0.5, oy + sy + yy, Math.abs(w) <= half - 1 ? (w * dir < 0 ? hi : col) : LEAF_D);
    }
  };
  leaf(-1, F.small ? 4.2 : 5.6, 1.7, LEAF_L, LEAF_H);
  leaf(1, F.small ? 3.6 : 5, 1.5, LEAF_L, LEAF_H);
  // 嫩芽顶端的小灯苞：灯籽的光
  P(ctx, ox + sx - 0.5, oy + sy - 1, heart > 0.75 ? "#fffbe0" : BUD);

  }
  drawHair(ctx, { ...hairArgs, behind: false });
  // 脸
  const ey = Math.round(top + H * (1 - F.eyeY) - 2), lean = o.lean * F.eyeY + (F.dx || 0);
  const gap = F.gap;
  const lx = Math.round(cx - gap - 2 + lean + o.look[0]), rx = Math.round(cx + gap - 1 + lean + o.look[0]);
  const eyY = ey + o.look[1];
  for (const ex of [lx, rx]) {
    if (o.eyes === "joy") { P(ctx, ox + ex, oy + eyY + 2, INK); P(ctx, ox + ex + 1, oy + eyY + 1, INK, 1, 1); P(ctx, ox + ex + 2, oy + eyY + 2, INK); }
    else if (o.eyes === "shut" || o.blink) { P(ctx, ox + ex, oy + eyY + 2, F.flame ? pal[0] : INK, 3, 1); }
    else if (eyes === "almond" && o.eyes === "sleepy") { const out = ex === lx ? -1 : 3; P(ctx, ox + ex, oy + eyY + 2, INK, 3, 1); P(ctx, ox + ex + (ex === lx ? 1 : 0), oy + eyY + 3, INK, 2, 1); P(ctx, ox + ex + out, oy + eyY + 1, INK, 1, 1); P(ctx, ox + ex + out + (ex === lx ? -1 : 1), oy + eyY, INK, 1, 1); }
    else if (eyes === "almond" && o.eyes === "dot") { const L = ex === lx; P(ctx, ox + ex, oy + eyY + 1, pal[0], 3, 1); P(ctx, ox + ex + (L ? 1 : 0), oy + eyY, pal[0], 2, 1); P(ctx, ox + ex + (L ? 0 : 1), oy + eyY + 2, pal[0], 2, 1); P(ctx, ox + ex + 1, oy + eyY + 1, "#ffffff", 1, 1); }
    else if (o.eyes === "sleepy") { P(ctx, ox + ex, oy + eyY + 2, INK, 3, 1); P(ctx, ox + ex, oy + eyY + 3, INK, 3, 1); P(ctx, ox + ex + 1, oy + eyY + 3, "#6b4a52", 1, 1); P(ctx, ox + ex - (ex === lx ? 1 : -3), oy + eyY + 1, INK, 1, 1); }
    else if (o.eyes === "dot") { P(ctx, ox + ex + 1, oy + eyY, pal[0], 2, 3); P(ctx, ox + ex + 1, oy + eyY, "#ffffff", 1, 1); }
    else if (o.eyes === "sad") {
      P(ctx, ox + ex, oy + eyY + 1, INK, 3, 3); P(ctx, ox + ex + (ex === lx ? 0 : 1), oy + eyY + 1, WHITE, 2, 1);
      P(ctx, ox + ex + (ex === lx ? -1 : 2), oy + eyY - 1, INK, 2, 1); P(ctx, ox + ex + (ex === lx ? 1 : 0), oy + eyY - 2, INK, 2, 1);
    } else if (eyes === "almond") {
      // 杏眼：外眼角上挑的斜杏仁形
      const L = ex === lx;
      P(ctx, ox + ex + (L ? 1 : 0), oy + eyY, INK, 2, 1); P(ctx, ox + ex, oy + eyY + 1, INK, 3, 2); P(ctx, ox + ex + (L ? 0 : 1), oy + eyY + 3, INK, 2, 1);
      P(ctx, ox + ex + 1, oy + eyY + 1, WHITE, 1, 1);
    } else {
      P(ctx, ox + ex, oy + eyY, INK, 3, 4); P(ctx, ox + ex + (o.look[0] > 0 ? 1 : 0), oy + eyY, WHITE, 2, 1); P(ctx, ox + ex + 2 - (o.look[0] > 0 ? 0 : 0), oy + eyY + 2, WHITE, 1, 1);
    }
  }
  // 腮红
  ctx.globalAlpha = o.eyes === "joy" ? 0.95 : 0.7;
  const CS = CHEEK_STYLE[cheeks];
  if (CS) {
    // 微光没有腮红：画上去是两处淡淡的光痕
    ctx.globalAlpha = F.flame ? 0.7 + 0.2 * Math.sin(s * 3) : 0.9;
    const c = F.flame ? "#ffffff" : CS.c;
    for (const [dx, dy] of CS.px) { P(ctx, ox + lx - 2 + dx, oy + ey + 4 + dy, c); P(ctx, ox + rx + 4 - dx, oy + ey + 4 + dy, c); }
  } else if (cheeks === "none") { /* 不画 */ }
  else if (form === "cloud") { P(ctx, ox + lx - 2, oy + ey + 4, userPal[2], 2, 1); P(ctx, ox + rx + 3, oy + ey + 4, userPal[2], 2, 1); }
  else if (!F.flame) { P(ctx, ox + lx - 2, oy + ey + 4, CHEEK, 2, 1); P(ctx, ox + rx + 3, oy + ey + 4, CHEEK, 2, 1); }
  ctx.globalAlpha = 1;
  // 嘴
  const mx = Math.round(cx - 1 + lean + o.look[0] * 0.5), my = ey + 4;
  if (F.flame && !["open", "o", "yawn"].includes(o.mouth)) o.mouth = "none";
  switch (o.mouth) {
    case "none": break;
    case "open": P(ctx, ox + mx - 1, oy + my, INK, 4, 1); P(ctx, ox + mx - 1, oy + my + 1, INK); P(ctx, ox + mx + 2, oy + my + 1, INK); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); P(ctx, ox + mx, oy + my + 2, INK, 2, 1); break;
    case "o": P(ctx, ox + mx, oy + my, INK, 2, 1); P(ctx, ox + mx - 1, oy + my + 1, INK); P(ctx, ox + mx + 2, oy + my + 1, INK); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); P(ctx, ox + mx, oy + my + 2, INK, 2, 1); break;
    case "small": P(ctx, ox + mx, oy + my, INK, 2, 1); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); break;
    case "yawn": P(ctx, ox + mx - 1, oy + my, INK, 4, 3); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); break;
    case "frown": P(ctx, ox + mx, oy + my, INK, 2, 1); P(ctx, ox + mx - 1, oy + my + 1, INK); P(ctx, ox + mx + 2, oy + my + 1, INK); break;
    case "flat": P(ctx, ox + mx + 1, oy + my, INK, 2, 1); break;
    default: P(ctx, ox + mx - 1, oy + my, INK); P(ctx, ox + mx, oy + my + 1, INK, 2, 1); P(ctx, ox + mx + 2, oy + my, INK);
  }
  // 眼泪
  if (o.tear >= 0) { const k = o.tear; ctx.globalAlpha = 1 - k * 0.8; P(ctx, ox + lx, oy + ey + 4 + k * 6, TEAR, 1, 2); ctx.globalAlpha = 1; }

  if (hair === "halo") {
    let crown = Math.min(...colTop.values());
    if (F.sprout) crown -= 10;                         // 小团子：光环浮在嫩芽灯苞上方
    drawHalo(ctx, { ox, oy, C, crown: Math.max(3, crown), s, state });
  }
  // 情绪符号：从右上方飘起
  if (o.emote && o.emoteP >= 0 && o.emoteP <= 1) {
    const k = o.emoteP, pop = k < 0.15 ? k / 0.15 : 1;
    const ex = Math.round(cx + W / 2 - 1 + (o.emote === "dots" ? 0 : Math.sin(k * 6) * 1)), eyy = Math.round(top - 2 - k * 5);
    ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    const col = { heart: "#ff6b7a", note: "#fff0c8", drop: TEAR, dots: "#fff0c8", bang: "#ffd36b", zz: "#fff0c8", spark: SPARK }[o.emote];
    if (o.emote === "dots") { const n = Math.min(3, Math.floor(k * 4) + 1); for (let i = 0; i < n; i++) P(ctx, ox + cx + W / 2 - 3 + i * 2, oy + top - 1, col); }
    else if (pop > 0.5) emote(ctx, o.emote, ox + Math.min(26, ex), oy + Math.max(0, eyy - 4), col);
    ctx.globalAlpha = 1;
  }
  // 开心：周围闪光
  if (state === "happy") [[3, 9], [27, 12], [5, 20]].forEach(([x, y], i) => {
    const k = (s * 2 + i * 0.37) % 1; if (k < 0.5) { P(ctx, ox + x, oy + y - 1, SPARK); P(ctx, ox + x - 1, oy + y, SPARK, 3, 1); P(ctx, ox + x, oy + y + 1, SPARK); } else if (k < 0.7) P(ctx, ox + x, oy + y, WHITE);
  });
}

// ---------- 可挂载的 olo 精灵 ----------
export function oloSprite({ form = "buddy", color = "sun", state = "idle", scale = 4, cls = "", hair = "none", eyes = "circle", cheeks = "blush" } = {}) {
  const [c, ctx] = canvas(32, 32, "olo-sprite " + cls);
  c.style.width = c.style.height = 32 * scale + "px";
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", "olo");
  const s = { form, color, state, hair, eyes, cheeks };
  const phase = Math.random() * 50;
  const sync = () => { c.dataset.oloForm = s.form; c.dataset.state = s.state; c.dataset.color = s.color; c.dataset.hair = s.hair; c.dataset.eyes = s.eyes; c.dataset.cheeks = s.cheeks; };
  const draw = (t) => { ctx.clearRect(0, 0, 32, 32); drawOlo(ctx, { ...s, t: t + phase }); };
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
