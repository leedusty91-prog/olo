// 雾里集的「镜头 + 触感」层：场景之间的连续镜头飞行（不切页）、物件的就地信息、轻触回弹与碎屑、
// 「透视」剖面（看看东西里面装着什么）、像素水面（闪光 / 倒影 / 涟漪）、走到边上才露出来的远景。全部程序绘制、原创。
import { P } from "./pixel.js";
import { hash2, disc } from "./world-art.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const easeOutBack = (k) => { const c = 1.7; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };

// ---------- 物件的一句话介绍（点到 / 悬停时才出现） ----------
export const INFO = {
  well: "老水井。听说井底连着雾的源头，喊一声会有回声。",
  tree: "灯籽树。摇一摇会下花瓣雨，偶尔掉片会变色的叶子。",
  lamp: "路灯。天黑自己亮，白天也可以踮脚帮它点一下。",
  bench: "长椅。晒太阳、打盹、看鸽子抢面包屑的好地方。",
  crates: "一摞旧木箱。很适合躲猫猫。",
  pot: "花盆。每天浇一次水，隔天长高一格。",
  stall: "蘑菇婶的包子摊。每天馅都不一样，一天最多五个。",
  board: "告示板。贴满了雾里集的传说，一次读一条。",
  bed: "olo 的小床。被子是云做的（它自己说的）。",
  shelf: "书架。夹着好多雾里集的旧故事。",
  stove: "小炉子。烤小饼要等一会儿，香味会飘满屋。",
  window: "窗户。外面的天气，在这里看得最清楚。",
  frame: "相框。第一次见面那天的照片。",
  musicbox: "八音盒。转起来是那首《雾里的灯》。",
  table: "小桌子。olo 会在上面给你留纸条。",
  jar: "腌萝卜的坛子。olo 每天都要掀开闻一闻。",
  swing: "树下的秋千。点 olo 能推得更高。",
  dock: "小码头。坐在这儿钓鱼，咬钩了就点一下屏幕。",
  rock: "石头。翻开看看下面住着谁。",
  telescope: "望远镜。夜里能看到灯籽星。",
  chimney: "烟囱。别凑太近，会呛到。",
  chime: "风铃。风一吹就说悄悄话。",
  cushion: "坐垫。坐下来，或者躺着看星星。",
  boat: "渡灯翁的船。雾天她会出来摆渡。",
  sign: "路牌。顺着走就是别的地方。",
  ladder: "梯子。上去是屋顶，下来是广场。",
  door: "小屋的门。里面暖暖的。",
  void: "",
};
export const PEEKABLE = new Set(["well", "stove", "musicbox", "crates", "pot", "telescope", "lamp", "chimney", "jar", "dock", "tree", "rock", "stall", "chime"]);

// ---------- 小工具 ----------
const ring = (ctx, cx, cy, r, col, sy = 1, step = 0.18) => { for (let a = 0; a < 6.283; a += step) P(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy, col); };
function gear(ctx, cx, cy, r, ang, col, hub = "#2a1422") {
  disc(ctx, cx, cy, r, col);
  for (let k = 0; k < 8; k++) { const a = ang + k / 8 * 6.283; P(ctx, cx + Math.cos(a) * (r + 1) - 1, cy + Math.sin(a) * (r + 1) - 1, col, 2, 2); }
  disc(ctx, cx, cy, Math.max(1, r * 0.35), hub);
}
const flame = (ctx, x, y, t, s = 1) => {
  const f = Math.sin(t * 0.4) > 0 ? 1 : 0;
  P(ctx, x - 2 * s, y - 3 * s, "#ff7a3a", 4 * s, 3 * s); P(ctx, x - 1 * s, y - 5 * s - f, "#ffb347", 2 * s, 3 * s); P(ctx, x - 1 * s, y - 2 * s, "#fff4c8", 2 * s, 1 * s);
};
const bubbles = (ctx, x0, w, yTop, yBot, t, col = "#cfeaf6", n = 6) => { for (let k = 0; k < n; k++) { const sp = 0.25 + hash2(k, 3) * 0.3, y = yBot - ((t * sp + hash2(k, 9) * 100) % (yBot - yTop)); P(ctx, x0 + hash2(k, 5) * w + Math.sin(t * 0.08 + k) * 1.5, y, col, 1 + (k % 2), 1 + (k % 2)); } };

// ---------- 透视剖面：每种东西里面的样子（画在圆形切口里，cx,cy 为切口中心，r 为半径） ----------
export const PEEK = {
  well(ctx, cx, cy, r, t) {
    for (let y = cy - r; y < cy + r; y += 4) for (let x = cx - r; x < cx + r; x += 8) { const ox = ((y / 4) | 0) % 2 ? 4 : 0; P(ctx, x + ox, y, "#55506a", 7, 3); }
    P(ctx, cx - 9, cy - r, "#232038", 18, r * 2);
    const wy = cy + r * 0.45; P(ctx, cx - 9, wy, "#3a6ea6", 18, r); for (let k = 0; k < 4; k++) P(ctx, cx - 7 + ((t * 0.3 + k * 5) % 14), wy + 1 + k * 2, "#9ac8e8", 3, 1);
    P(ctx, cx + Math.sin(t * 0.05) * 2, wy + 3, "#fff8d0", 1, 1); // 井底的星星
    const by = cy - 4 + Math.sin(t * 0.04) * 3; P(ctx, cx, cy - r, "#c8b89a", 1, by - cy + r); P(ctx, cx - 3, by, "#8a5a34", 7, 5); P(ctx, cx - 3, by, "#b07a4a", 7, 1);
  },
  stove(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#3a2228", r * 2, r * 2); P(ctx, cx - 12, cy - 2, "#1a0c10", 24, 14);
    for (let k = -2; k <= 2; k++) flame(ctx, cx + k * 4, cy + 11, t + k * 7, 1);
    for (let k = 0; k < 6; k++) { const y = cy + 9 - ((t * 0.4 + k * 9) % 16); P(ctx, cx - 10 + hash2(k, 2) * 20, y, "#ffb347"); }
    P(ctx, cx - 12, cy - 4, "#6a6a76", 24, 1); disc(ctx, cx, cy - 7, 4, "#f4d8a8", 0.6); P(ctx, cx - 2, cy - 9, "#ffeecc", 3, 1);
    for (let k = 0; k < 3; k++) P(ctx, cx - 3 + k * 3, cy - 13 - ((t * 0.3 + k * 4) % 8), "rgba(240,236,250,.7)");
  },
  musicbox(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#2a1e2a", r * 2, r * 2);
    P(ctx, cx - 12, cy - 6, "#c8a44a", 24, 8); P(ctx, cx - 12, cy - 6, "#e8c46a", 24, 1);
    for (let k = 0; k < 10; k++) { const x = cx - 12 + ((k * 7 + t * 0.4) % 24); P(ctx, x, cy - 4 + (k % 3) * 2, "#fff4c8", 1, 1); }
    for (let k = 0; k < 9; k++) { const hit = ((t * 0.4 + k * 11) % 24) < 2; P(ctx, cx - 11 + k * 2.6, cy + 3 + (hit ? -1 : 0), hit ? "#fff4c8" : "#a8a8b8", 1, 6 - (k % 4)); }
    gear(ctx, cx - 8, cy + 12, 4, t * 0.05, "#b8943a"); gear(ctx, cx + 1, cy + 13, 3, -t * 0.066, "#d8b45a"); gear(ctx, cx + 9, cy + 11, 4, t * 0.05, "#b8943a");
  },
  crates(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#5a3a24", r * 2, r * 2); for (let y = cy - r; y < cy + r; y += 6) P(ctx, cx - r, y, "#4a2e1c", r * 2, 1);
    for (let k = 0; k < 5; k++) disc(ctx, cx - 10 + k * 4, cy + 10 - (k % 2) * 3, 2, k % 2 ? "#e84a4a" : "#ff8a5a");
    // 一只打盹的小老鼠
    const br = Math.sin(t * 0.06) > 0 ? 1 : 0; disc(ctx, cx + 4, cy - 2, 4 + br * 0.5, "#a8a0a8", 0.7); P(ctx, cx + 7, cy - 5, "#c8c0c8", 2, 2); P(ctx, cx + 1, cy - 1, "#d88aa0", 3, 1);
    if ((t / 40 | 0) % 2) { P(ctx, cx + 9, cy - 10, "#fff4e0", 3, 1); P(ctx, cx + 10, cy - 9, "#fff4e0"); P(ctx, cx + 9, cy - 8, "#fff4e0", 3, 1); }
    disc(ctx, cx - 6, cy - 6, 2, "#fff0b0"); P(ctx, cx - 6, cy - 9, "#6fcf98", 1, 2); // 一颗灯籽
  },
  pot(ctx, cx, cy, r, t, o) {
    P(ctx, cx - r, cy - r, "#5a3a2a", r * 2, r * 2); for (let k = 0; k < 30; k++) P(ctx, cx - r + hash2(k, 1) * r * 2, cy - r + hash2(k, 2) * r * 2, "#6a4a36");
    P(ctx, cx - r, cy - r, "#8ac8ff", r * 2, 3);
    const st = o?.stage ?? 1, len = 4 + st * 3;
    for (let k = 0; k < 5; k++) { let x = cx + (k - 2) * 2, y = cy - 4; for (let s = 0; s < len; s++) { y += 1; x += Math.sin(s * 0.7 + k + t * 0.02) * 0.7 + (k - 2) * 0.15; P(ctx, x, y, "#e8d4a8"); } }
    disc(ctx, cx, cy - 5, 3, "#fff0b0"); P(ctx, cx - 1, cy - 6, "#ffffff");
    const wx = cx - 8 + Math.sin(t * 0.03) * 6; for (let k = 0; k < 5; k++) P(ctx, wx + k, cy + 8 + Math.round(Math.sin(t * 0.2 + k)), "#e8909a");
  },
  telescope(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#141a34", r * 2, r * 2);
    P(ctx, cx - r, cy - 5, "#6a4228", r * 2, 10); P(ctx, cx - r, cy - 4, "#1e2240", r * 2, 8);
    for (const [x, w] of [[-10, 2], [0, 3], [9, 2]]) P(ctx, cx + x, cy - 5, "#9ac8e8", w, 10);
    for (let x = -r; x < r; x++) { const ph = ((x + t * 0.8) % 12 + 12) % 12; if (ph < 4) P(ctx, cx + x, cy + Math.round(x < -10 ? 3 : x < 0 ? 1 : x < 9 ? -1 : 0), "#fff4c8"); }
    P(ctx, cx + r - 6, cy - 12, "#fff8d0", 2, 2); P(ctx, cx + r - 8, cy - 11, "#fff8d0"); P(ctx, cx + r - 3, cy - 11, "#fff8d0");
  },
  lamp(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#20182c", r * 2, r * 2); P(ctx, cx - 7, cy - 10, "rgba(255,240,200,.18)", 14, 20); ring(ctx, cx, cy, 8, "#c8a44a", 1.2, 0.25);
    P(ctx, cx - 1, cy + 2, "#f4e8d8", 2, 6); flame(ctx, cx, cy + 2, t, 1);
    for (let k = 0; k < 3; k++) { const a = t * 0.06 + k * 2.1; P(ctx, cx + Math.cos(a) * 5, cy - 3 + Math.sin(a * 1.3) * 5, "#e8ff8a", 1, 1); }
  },
  chimney(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#4a2a2a", r * 2, r * 2); P(ctx, cx - 7, cy - r, "#140c10", 14, r * 2);
    for (let k = 0; k < 8; k++) { const y = cy + r - ((t * 0.35 + k * 7) % (r * 2)); P(ctx, cx - 4 + Math.sin(y * 0.3 + k) * 3, y, "rgba(216,208,220,.6)", 4, 3); }
    P(ctx, cx - 5, cy + r - 6, "#ff9a4a", 10, 2); P(ctx, cx - 3, cy + r - 8, "#ffd36b", 6, 2);
  },
  jar(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#3a2a22", r * 2, r * 2); disc(ctx, cx, cy + 2, 13, "#b8d89a", 0.95); P(ctx, cx - 13, cy - 6, "#d8ecc0", 26, 1);
    for (let k = 0; k < 5; k++) { const x = cx - 8 + k * 4 + Math.sin(t * 0.02 + k) * 1.5, y = cy + 1 + Math.sin(t * 0.03 + k * 2) * 3 + (k % 2) * 4; disc(ctx, x, y, 2, "#f4f0e8"); P(ctx, x - 1, y, "#e8a8b8", 2, 1); }
    bubbles(ctx, cx - 9, 18, cy - 5, cy + 13, t, "#f0fff0", 5);
    P(ctx, cx - 5, cy + 7, "#fff4e0", 10, 5); P(ctx, cx - 4, cy + 9, "#c8463a", 8, 1);
  },
  dock(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#2a5a8a", r * 2, r * 2); P(ctx, cx - r, cy - r, "#8a5a34", r * 2, 4);
    for (let k = 0; k < 6; k++) P(ctx, cx - r + ((k * 11 + t * 0.2) % (r * 2)), cy - r + 6, "#9ac8e8", 3, 1);
    for (let k = 0; k < 3; k++) { const x = cx - r + ((t * (0.3 + k * 0.1) + k * 17) % (r * 2 + 10)) - 5, y = cy + k * 5 - 2; P(ctx, x, y, "#c8d8e8", 5, 2); P(ctx, x - 2, y, "#a8b8c8", 2, 1); P(ctx, x - 2, y + 1, "#a8b8c8", 2, 1); P(ctx, x + 4, y, "#2a1422"); }
    for (let k = 0; k < 5; k++) { const x = cx - r + 4 + k * 7; for (let s = 0; s < 8; s++) P(ctx, x + Math.sin(t * 0.05 + s * 0.6 + k) * 1.5, cy + r - s, "#4a8a5a"); }
    for (let k = 0; k < 6; k++) P(ctx, cx - r + hash2(k, 4) * r * 2, cy + r - 2, "#c8b89a", 2, 2);
  },
  tree(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#6aa0c8", r * 2, r); P(ctx, cx - r, cy, "#5a3a2a", r * 2, r); P(ctx, cx - r, cy, "#72b25a", r * 2, 2);
    P(ctx, cx - 2, cy - r, "#7a4e2e", 4, r);
    for (let k = 0; k < 6; k++) { let x = cx, y = cy + 2; const d = (k - 2.5) * 0.6; for (let s = 0; s < 14; s++) { x += d; y += 0.8; P(ctx, x, y, (s + (t / 6 | 0)) % 9 === 0 ? "#ffd36b" : "#a87244"); } }
    disc(ctx, cx + 8, cy + 9, 3, "#c8a080", 0.7); P(ctx, cx + 6, cy + 8, "#2a1422"); // 地下睡着的鼹鼠
  },
  rock(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#5a4a3a", r * 2, r * 2); P(ctx, cx - r, cy - r, "#8a8a96", r * 2, 6);
    disc(ctx, cx, cy + 4, 4, "#e8604a", 0.7); const w = Math.sin(t * 0.15) > 0 ? -1 : 0; P(ctx, cx - 7, cy + 1 + w, "#e8604a", 3, 2); P(ctx, cx + 5, cy + 1, "#e8604a", 3, 2); P(ctx, cx - 2, cy + 2, "#2a1422"); P(ctx, cx + 1, cy + 2, "#2a1422");
    P(ctx, cx - 10, cy + 10, "#3a6ea6", 8, 2);
  },
  stall(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#3a2424", r * 2, r * 2);
    for (let l = 0; l < 3; l++) { const y = cy + 8 - l * 7; P(ctx, cx - 11, y, "#c8a070", 22, 5); P(ctx, cx - 11, y, "#e8c890", 22, 1); for (let k = 0; k < 3; k++) disc(ctx, cx - 6 + k * 6, y - 1, 2, "#fff4e0", 0.7); }
    for (let k = 0; k < 5; k++) P(ctx, cx - 8 + k * 4 + Math.sin(t * 0.05 + k) * 2, cy - 14 - ((t * 0.3 + k * 5) % 8), "rgba(240,236,250,.7)", 2, 2);
  },
  chime(ctx, cx, cy, r, t) {
    P(ctx, cx - r, cy - r, "#1e2a44", r * 2, r * 2); P(ctx, cx - 9, cy - 10, "#c8a44a", 18, 2);
    for (let k = 0; k < 5; k++) { const sw = Math.round(Math.sin(t * 0.08 + k) * 2); P(ctx, cx - 8 + k * 4, cy - 8, "#c8b89a", 1, 5 + k); P(ctx, cx - 9 + k * 4 + sw, cy - 3 + k, "#9ac8e8", 3, 8 - k); }
    if (Math.sin(t * 0.08) > 0.95) ring(ctx, cx, cy, 10, "#fff4c8", 0.6);
  },
};

// 透视切口：裁成像素圆，里面画剖面，边上一圈金色描边
export function drawPeek(ctx, pk, t) {
  const { o, cx, cy, R } = pk, k = pk.k, r = Math.max(2, Math.round(R * (pk.closing ? clamp(pk.close / 12, 0, 1) : easeOutBack(clamp(k / 16, 0, 1)))));
  ctx.save(); ctx.beginPath();
  for (let j = -r; j <= r; j++) { const w = Math.round(Math.sqrt(r * r - j * j)); ctx.rect(cx - w, cy + j, w * 2, 1); }
  ctx.clip(); (PEEK[o.type] || PEEK.crates)(ctx, cx, cy, R, t, pk.oo);
  ctx.fillStyle = "rgba(120,200,255,0.06)"; for (let y = cy - r; y < cy + r; y += 3) ctx.fillRect(cx - r, y + ((t / 3) | 0) % 3, r * 2, 1); // 扫描线
  ctx.restore();
  for (let a = 0; a < 6.283; a += 1 / r) { const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r); P(ctx, x, y, "#ffd36b"); P(ctx, x + 1, y + 1, "#2a1422"); }
  for (let k2 = 0; k2 < 4; k2++) { const a = t * 0.03 + k2 * 1.57; P(ctx, cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3), "#fff4c8", 2, 2); }
}

// ---------- 轻触：碎屑粒子 ----------
export function burstBits(parts, X, Y, cols, n = 10) {
  for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 1 + Math.random() * 1.6; parts.push({ kind: "bit", sx: X, sy: Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, col: cols[k % cols.length], life: 26 + Math.random() * 14 }); }
}
export const BIT_COLS = { tree: ["#ff8ab0", "#8cc46a", "#ffd36b"], pot: ["#8ac8ff", "#8cc46a"], lamp: ["#ffd98a", "#fff4c8"], well: ["#9ac8e8", "#cfeaf6"], stall: ["#fff4e0", "#d84a4a"], stove: ["#ff9a4a", "#ffd36b"], jar: ["#d8ecc0", "#f4f0e8"], dock: ["#9ac8e8", "#c8b89a"], chime: ["#9ac8e8", "#fff4c8"], musicbox: ["#e8c46a", "#fff4c8"], default: ["#fff4e0", "#ffd36b", "#c8b89a"] };
export function stepBit(q) { q.sx += q.vx; q.sy += q.vy; q.vy += 0.12; q.vx *= 0.97; }
export function drawBit(ctx, q) { ctx.globalAlpha = clamp(q.life / 14, 0, 1); P(ctx, q.sx, q.sy, q.col, 2, 2); ctx.globalAlpha = 1; }

// ---------- 水面 ----------
// 每块水砖上加几道随时间滑动的高光（像 Water Pro 那种细碎反光，换成像素版）
export function waterShimmer(ctx, X, Y, i, j, t, night) {
  const h = hash2(i, j, 21), ph = (t * 0.05 + h * 40) % 40;
  if (ph < 10) { const a = ph < 5 ? ph / 5 : (10 - ph) / 5; ctx.globalAlpha = a * (night ? 0.5 : 0.85); P(ctx, X - 6 + h * 8 + ph * 0.3, Y + 4 + ((h * 7) | 0) % 4, night ? "#cfd8ff" : "#ffffff", 3, 1); ctx.globalAlpha = 1; }
  const ph2 = (t * 0.03 + h * 77) % 60; if (ph2 < 6) { ctx.globalAlpha = 0.5; P(ctx, X + 2 - ph2 * 0.4, Y + 7, "#cfeaf6", 2, 1); ctx.globalAlpha = 1; }
}
// 倒影：贴图上下翻转、逐行左右晃，压暗压淡
export function reflect(ctx, img, sw, sh, X, Y, w, h, t, alpha = 0.32) {
  ctx.globalAlpha = alpha;
  for (let r = 0; r < h; r++) { const src = Math.floor(sh * (1 - (r + 0.5) / h)), off = Math.round(Math.sin(t * 0.12 + r * 0.7) * (r / h) * 2); ctx.drawImage(img, 0, src, sw, 1, X - w / 2 + off, Y + r, w, 1); }
  ctx.globalAlpha = 1;
}
// 涟漪：等距椭圆一圈圈散开
export function drawRipple(ctx, X, Y, q) {
  const age = q.max - q.life; if (age < 0) return; const r = 2 + age * 0.35; ctx.globalAlpha = clamp(q.life / q.max, 0, 1) * 0.9;
  for (let a = 0; a < 6.283; a += 0.9 / r) P(ctx, X + Math.cos(a) * r, Y + Math.sin(a) * r * 0.5, "#e8f6ff");
  ctx.globalAlpha = 1;
}

// ---------- 远景：走到雾里集的边上，地平线往下让，露出雾海、远山、小岛和灯塔 ----------
export function drawVista(ctx, RW, hz, extra, camx, t, L, sid, weather) {
  const night = L.night, top = hz - 16 - extra, seaTop = hz - 8 - Math.round(extra * 0.55);
  const sky = night > 0.5 ? ["#2a3060", "#3a4478"] : L.phase === "dusk" ? ["#e89a7a", "#f0b890"] : ["#a8c8e0", "#c8dcea"];
  // 远山
  for (let x = 0; x < RW; x += 2) {
    const wx = x + camx * 0.05, h = 10 + Math.abs(Math.sin(wx * 0.013)) * 16 + Math.sin(wx * 0.041) * 5 + extra * 0.25;
    ctx.fillStyle = night > 0.5 ? "#3a3a68" : "#a8a4c4"; ctx.fillRect(x, seaTop - h, 2, h);
    if (!night && h > 26) { ctx.fillStyle = "#f4f4fa"; ctx.fillRect(x, seaTop - h, 2, 2); }
  }
  // 雾海
  const rows = hz - seaTop + 2;
  for (let y = 0; y < rows; y++) { ctx.fillStyle = y < rows / 2 ? sky[0] : sky[1]; ctx.fillRect(0, seaTop + y, RW, 1); }
  const sunX = Math.round(RW * 0.68 - camx * 0.04);
  for (let y = seaTop + 1; y < hz; y += 2) {
    const n = (RW / 14) | 0;
    for (let k = 0; k < n; k++) { const x = ((k * 37 + hash2(k, y, 3) * 30 + t * (0.15 + (y - seaTop) * 0.02) - camx * 0.1) % (RW + 20) + RW + 20) % (RW + 20) - 10; if (hash2(k, y, 8) < 0.5) { ctx.fillStyle = night > 0.5 ? "rgba(200,210,255,.35)" : "rgba(255,255,255,.55)"; ctx.fillRect(x | 0, y, 3 + ((y - seaTop) >> 2), 1); } }
    const gw = 2 + ((y - seaTop) >> 1), wob = Math.round(Math.sin(t * 0.09 + y) * 2);
    if (Math.sin(t * 0.13 + y * 1.7) > -0.3) { ctx.fillStyle = night > 0.5 ? "rgba(255,248,208,.6)" : "rgba(255,250,220,.8)"; ctx.fillRect(sunX - gw / 2 + wob, y, gw, 1); }
  }
  // 小岛 + 灯塔
  const isl = (bx, w, hgt, tower) => {
    const x = Math.round(((bx - camx * 0.12) % (RW + 120) + RW + 120) % (RW + 120) - 60), y = seaTop + 2 + Math.round(extra * 0.2);
    ctx.fillStyle = night > 0.5 ? "#2a3048" : "#6a8070"; for (let k = -w; k <= w; k++) { const hh = Math.round(hgt * (1 - (k / w) ** 2)); ctx.fillRect(x + k, y - hh, 1, hh + 1); }
    ctx.fillStyle = night > 0.5 ? "rgba(200,210,255,.25)" : "rgba(255,255,255,.35)"; ctx.fillRect(x - w, y + 2, w * 2, 1);
    if (tower) { ctx.fillStyle = "#f4ecdc"; ctx.fillRect(x - 1, y - hgt - 9, 3, 9); ctx.fillStyle = "#c8463a"; ctx.fillRect(x - 1, y - hgt - 6, 3, 2); const on = (t / 30 | 0) % 3 !== 0; ctx.fillStyle = on ? "#fff4a0" : "#8a8070"; ctx.fillRect(x - 1, y - hgt - 11, 3, 2); if (on && night > 0.4) { ctx.globalAlpha = 0.35; ctx.fillStyle = "#fff4a0"; const d = Math.sin(t * 0.03) > 0 ? 1 : -1; ctx.fillRect(d > 0 ? x + 2 : x - 30, y - hgt - 11, 28, 2); ctx.globalAlpha = 1; } }
  };
  isl(RW * 0.25, 14, 5, false); isl(RW * 0.8, 9, 4, true); isl(RW * 1.3, 18, 6, false);
  // 小帆船
  const bx = ((t * 0.08 - camx * 0.1) % (RW + 40) + RW + 40) % (RW + 40) - 20, by = seaTop + Math.max(3, rows / 2 | 0);
  ctx.fillStyle = "#6a4228"; ctx.fillRect(bx | 0, by, 7, 2); ctx.fillStyle = "#fff4e0"; ctx.fillRect((bx | 0) + 3, by - 6, 1, 6); ctx.fillRect((bx | 0) + 4, by - 5, 2, 4);
  // 鸟
  if (night < 0.5 && weather !== "rain") for (let k = 0; k < 3; k++) { const x = ((t * (0.25 + k * 0.05) + k * 90 - camx * 0.15) % (RW + 30) + RW + 30) % (RW + 30) - 15, y = top + 4 + k * 5 + Math.sin(t * 0.05 + k) * 2, f = ((t / 8 + k) | 0) % 2; ctx.fillStyle = "#4a3a4a"; ctx.fillRect(x | 0, y | 0, 1, 1); ctx.fillRect((x | 0) - 2, (y | 0) - f, 2, 1); ctx.fillRect((x | 0) + 1, (y | 0) - f, 2, 1); }
}

// ---------- 镜头飞行：旧场景和新场景画在同一张画布上，拉远—横移—推近（不是黑场切换） ----------
const fogPuffs = Array.from({ length: 14 }, (_, k) => [hash2(k, 1, 77), hash2(k, 2, 77), 0.6 + hash2(k, 3, 77) * 0.8]);
export function drawFlight(ctx, F, cur, RW, RH, t) {
  const e = ease(clamp(F.k, 0, 1)), dir = F.dir;
  ctx.clearRect(0, 0, RW, RH); ctx.imageSmoothingEnabled = false;
  const put = (img, x, y, s, a = 1) => { if (a <= 0) return; ctx.globalAlpha = a; const w = Math.round(RW * s), h = Math.round(RH * s); ctx.drawImage(img, Math.round(x + (RW - w) / 2), Math.round(y + (RH - h) / 2), w, h); ctx.globalAlpha = 1; };
  if (F.kind === "dive") { // 进门 / 出门：朝门口推进去，新场景从远处浮上来
    const [px, py] = F.at, s0 = 1 + e * 1.6, s1 = 0.72 + 0.28 * e;
    put(cur, 0, 0, s1, clamp((e - 0.25) / 0.6, 0, 1));
    ctx.globalAlpha = 1 - clamp((e - 0.2) / 0.6, 0, 1); const w = RW * s0, h = RH * s0; ctx.drawImage(F.snap, Math.round(px - px * s0), Math.round(py - py * s0), Math.round(w), Math.round(h)); ctx.globalAlpha = 1;
  } else {
    const z = 1 - 0.2 * Math.sin(Math.PI * e), span = RW * 1.08 * z;
    put(F.snap, -dir * e * span, Math.sin(Math.PI * e) * 6, z);
    put(cur, dir * (1 - e) * span, Math.sin(Math.PI * e) * 6, z);
  }
  // 近处的雾团跑得比画面快（视差），盖住接缝
  const m = Math.sin(Math.PI * e);
  for (const [a, b, s] of fogPuffs) {
    const x = ((a * RW * 2 - dir * e * RW * 1.9 * s) % (RW * 2) + RW * 2) % (RW * 2) - RW * 0.4, y = b * RH, w = 60 * s, h = 18 * s;
    ctx.globalAlpha = 0.55 * m; ctx.fillStyle = "#ece8f4"; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); ctx.fillRect((x + w * 0.2) | 0, (y - h * 0.4) | 0, (w * 0.6) | 0, (h * 0.5) | 0);
  }
  ctx.globalAlpha = 1;
}

// ---------- 黄金时刻（按用户本地时间） ----------
// 0..1：16:00 起慢慢变暖，17:30–18:45 最浓，19:45 落完；清晨 5:45–7:15 也有一点（最多 0.45）。
export function goldenAt(h) {
  const ramp = (a, b) => Math.min(1, Math.max(0, (h - a) / (b - a)));
  const dusk = ramp(16, 17.5) * (1 - ramp(18.75, 19.75));
  const dawn = 0.45 * ramp(5.75, 6.4) * (1 - ramp(6.6, 7.25));
  return Math.round(Math.max(dusk, dawn) * 100) / 100;
}
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// 长影子：太阳在西边低处，影子朝东（屏幕右下）拉长。阶梯状像素条，越远越淡（4×4 抖动），不做平滑渐变。
export function longShadow(ctx, X, Y, h, w, gold) {
  if (gold <= 0.03) return;
  const len = Math.round(h * (0.25 + 1.1 * gold)), half = Math.max(1, w >> 1);
  for (let k = 0; k < len; k++) {
    const fade = 1 - k / len, x = X + k, y = Y + (k >> 1), ww = Math.max(1, Math.round(half * (0.6 + 0.4 * fade)));
    ctx.fillStyle = `rgba(60,24,40,${(0.32 * gold * (0.4 + 0.6 * fade)).toFixed(3)})`;
    for (let j = -ww; j < ww; j++) if (BAYER4[((y & 3) << 2) | ((x + j) & 3)] / 16 < 0.35 + 0.65 * fade) ctx.fillRect(x + j - (j >> 1), y, 1, 1);
  }
}
// 调色：整体往琥珀色推（source-atop 只染已经画了东西的像素），地平线附近再叠 4 条阶梯暖光带。
export function goldenGrade(ctx, RW, RH, hz, gold) {
  if (gold <= 0.03) return;
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(255,150,70,${(0.16 * gold).toFixed(3)})`; ctx.fillRect(0, 0, RW, RH);
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = `rgba(255,190,110,${(0.5 * gold).toFixed(3)})`; ctx.fillRect(0, 0, RW, RH);
  ctx.globalCompositeOperation = "lighter";
  const band = Math.max(4, Math.round(RH / 28));
  for (let k = 0; k < 4; k++) { ctx.fillStyle = `rgba(255,170,90,${(0.06 * gold * (4 - k) / 4).toFixed(3)})`; ctx.fillRect(0, hz - 6 + k * band, RW, band); }
  ctx.globalCompositeOperation = "source-over";
}

// ---------- 合批 ----------
// 同色同透明度的小方块攒成一条 path，一次 fill：水面高光、粒子、长影子都走这里（透明度量化成 8 档）。
export class RectBatch {
  constructor() { this.m = new Map(); this.n = 0; }
  add(col, a, x, y, w, h) {
    if (a <= 0.02) return;
    const k = col + "|" + Math.min(8, Math.round(a * 8)); let l = this.m.get(k); if (!l) this.m.set(k, (l = []));
    l.push(Math.round(x), Math.round(y), w, h); this.n++;
  }
  flush(ctx) {
    for (const [k, l] of this.m) {
      if (!l.length) continue; const i = k.lastIndexOf("|");
      ctx.fillStyle = k.slice(0, i); ctx.globalAlpha = Number(k.slice(i + 1)) / 8; ctx.beginPath();
      for (let j = 0; j < l.length; j += 4) ctx.rect(l[j], l[j + 1], l[j + 2], l[j + 3]);
      ctx.fill(); l.length = 0;
    }
    ctx.globalAlpha = 1; const n = this.n; this.n = 0; return n;
  }
}
export function waterShimmerB(B, X, Y, i, j, t, night) {
  const h = hash2(i, j, 21), ph = (t * 0.05 + h * 40) % 40;
  if (ph < 10) { const a = ph < 5 ? ph / 5 : (10 - ph) / 5; B.add(night ? "#cfd8ff" : "#ffffff", a * (night ? 0.5 : 0.85), X - 6 + h * 8 + ph * 0.3, Y + 4 + ((h * 7) | 0) % 4, 3, 1); }
  const ph2 = (t * 0.03 + h * 77) % 60; if (ph2 < 6) B.add("#cfeaf6", 0.5, X + 2 - ph2 * 0.4, Y + 7, 2, 1);
}
export function longShadowB(B, X, Y, h, w, gold) {
  if (gold <= 0.03) return;
  const len = Math.round(h * (0.25 + 1.1 * gold)), half = Math.max(1, w >> 1);
  for (let k = 0; k < len; k++) {
    const fade = 1 - k / len, x = X + k, y = Y + (k >> 1), ww = Math.max(1, Math.round(half * (0.6 + 0.4 * fade))), a = 0.32 * gold * (0.4 + 0.6 * fade);
    for (let j = -ww; j < ww; j++) if (BAYER4[((y & 3) << 2) | ((x + j) & 3)] / 16 < 0.35 + 0.65 * fade) B.add("#3c1828", a, x + j - (j >> 1), y, 1, 1);
  }
}
