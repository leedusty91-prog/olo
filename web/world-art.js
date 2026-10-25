// 雾里集小世界的像素美术：等距地砖、像素多边形、等距方块，以及所有道具 / 小动物的程序绘制（全部原创）。
// 坐标约定：屏幕 X = (wx - wy) * 12，Y = (wx + wy) * 6；道具的 draw(ctx, X, Y, t, o) 以「脚下地面中心」为锚点。
import { P } from "./pixel.js";

export const TW = 24, TH = 12;
export const hash2 = (x, y, s = 0) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 2246822519, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const iso = (u, v) => [(u - v) * TW / 2, (u + v) * TH / 2];

// 扫描线填充多边形（整数像素，不走抗锯齿）
export function poly(ctx, pts, col) {
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  ctx.fillStyle = col;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { const a = Math.round(xs[k]), b = Math.round(xs[k + 1]); if (b > a) ctx.fillRect(a, y, b - a, 1); }
  }
}
// 等距方块：中心 (X,Y)，半宽 hu/hv（格），高 h（像素），顶面/左面/右面三色
export function prism(ctx, X, Y, hu, hv, h, top, left, right, z = 0) {
  const c = (u, v, zz) => { const [x, y] = iso(u, v); return [X + x, Y + y - zz]; };
  const a = c(-hu, -hv, z + h), b = c(hu, -hv, z + h), cc = c(hu, hv, z + h), d = c(-hu, hv, z + h);
  const c0 = c(hu, hv, z), d0 = c(-hu, hv, z), b0 = c(hu, -hv, z);
  poly(ctx, [d, cc, c0, d0], left);
  poly(ctx, [cc, b, b0, c0], right);
  poly(ctx, [a, b, cc, d], top);
  return { a, b, c: cc, d };
}
export const disc = (ctx, x, y, r, col, sy = 1) => { for (let j = -Math.ceil(r * sy); j <= Math.ceil(r * sy); j++) { const w = Math.round(Math.sqrt(Math.max(0, r * r - (j / sy) ** 2))); if (w > 0) P(ctx, x - w, y + j, col, w * 2, 1); } };

// ---------- 地砖 ----------
const DIA = (px, py) => { const r = py < 6 ? py : 11 - py, w = (r + 1) * 2; return px >= 12 - w && px < 12 + w; };
export const TILES = {
  grass: (x, y, h) => (h < 0.08 ? "#8cc46a" : (x + y * 3) % 7 === 0 ? "#5d9c4d" : h > 0.93 ? (h > 0.97 ? "#ffd36b" : "#f5f0e0") : "#72b25a"),
  forest: (x, y, h) => (h < 0.1 ? "#4a7440" : (x * 5 + y) % 9 === 0 ? "#3e6538" : h > 0.95 ? "#c8783a" : "#557f46"),
  path: (x, y, h) => ((x + (y % 2) * 3) % 6 === 0 || y % 4 === 0 ? "#a68e6c" : h < 0.3 ? "#cdb894" : "#d8c6a2"),
  plaza: (x, y, h, i, j) => (x === 0 || y === 0 ? "#a89478" : (i + j) % 2 ? (h < 0.2 ? "#cfc2a6" : "#dccfb2") : (h < 0.2 ? "#c2b496" : "#cbbd9f")),
  dirt: (x, y, h) => (h < 0.15 ? "#9a7448" : (x + y) % 5 === 0 ? "#8a6640" : "#b08656"),
  sand: (x, y, h) => (h < 0.1 ? "#d8c084" : h > 0.96 ? "#fff6dc" : "#e8d49a"),
  wood: (x, y) => ((x + y * 2) % 12 === 0 ? "#7a4e2e" : y % 4 === 0 ? "#8e5c36" : (x + y) % 2 ? "#b27c4a" : "#a87244"),
  rug: (x, y, h, i, j) => { const e = x < 1 || y < 1; const k = (i * 3 + j) % 3; return e ? "#7a2e3a" : (x + y) % 6 < 2 ? "#e8c46a" : ["#c0504e", "#b0464a", "#c85a54"][k]; },
  roof: (x, y, h) => (y % 3 === 0 ? "#8a3a26" : (x + Math.floor(y / 3) * 3) % 6 === 0 ? "#9a442c" : h < 0.1 ? "#d06a48" : "#b8563a"),
  roof2: (x, y, h) => (y % 3 === 0 ? "#4a2a36" : h < 0.1 ? "#6a3a44" : "#5a3240"),
  water: (x, y, h, i, j, f) => ((x * 2 + y * 5 + f * 3 + i * 7) % 23 === 0 ? "#cfeaf6" : (x + y * 3 + f + j * 5) % 11 === 0 ? "#7ab8e0" : "#4a88c0"),
  deep: (x, y, h, i, j, f) => ((x * 3 + y * 7 + f * 2 + i * 5) % 31 === 0 ? "#9ac8e8" : "#3a6ea6"),
  stone: (x, y, h) => (h < 0.2 ? "#8a8a96" : (x + y) % 5 === 0 ? "#6e6e7a" : "#9e9eaa"),
  void: () => null,
};
const tileCache = new Map();
// 一张地砖：24×12 菱形 + 4 像素高的侧面（让地面有厚度、遮住接缝）
export function tileSprite(type, variant, frame = 0, i = 0, j = 0) {
  const key = `${type}:${variant}:${frame}:${type === "plaza" || type === "rug" ? (i + j) % 2 + ":" + (i * 3 + j) % 3 : ""}`;
  let c = tileCache.get(key);
  if (c) return c;
  c = document.createElement("canvas"); c.width = TW; c.height = TH + 4;
  const ctx = c.getContext("2d"), fn = TILES[type];
  for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
    if (!DIA(px, py)) continue;
    const col = fn(px, py, hash2(px, py, variant * 31 + 7), i, j, frame);
    if (col) P(ctx, px, py, col);
  }
  tileCache.set(key, c);
  return c;
}

// 柔光贴图：用于灯笼、萤火虫、窗光（'lighter' 叠加）
const glowCache = new Map();
export function glowSprite(r, col) {
  const key = r + col;
  let c = glowCache.get(key);
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = r * 2 + 1;
  const ctx = c.getContext("2d");
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.hypot(x, y * 1.25) / r;
    if (d >= 1) continue;
    const a = (1 - d) ** 1.6, dither = ((x + y) & 1) ? 0.85 : 1;
    ctx.globalAlpha = a * dither; P(ctx, x + r, y + r, col);
  }
  glowCache.set(key, c);
  return c;
}

// ---------- 道具 ----------
const OL = "#2a1422";
export const ART = {
  well(ctx, X, Y) {
    prism(ctx, X, Y, 0.7, 0.7, 9, "#4a6ea0", "#8a8a96", "#a8a8b4");
    prism(ctx, X, Y, 0.48, 0.48, 1, "#2a3a6a", "#4a5a8a", "#4a5a8a", 8);
    P(ctx, X - 3, Y - 10, "#cfeaf6", 2, 1);
    for (const s of [-1, 1]) P(ctx, X + s * 10 - 1, Y - 26, "#6a4228", 2, 18);
    poly(ctx, [[X - 15, Y - 26], [X, Y - 34], [X + 15, Y - 26], [X, Y - 22]], "#b84a3a");
    poly(ctx, [[X - 15, Y - 26], [X, Y - 22], [X, Y - 20], [X - 15, Y - 24]], "#8a3428");
    P(ctx, X - 9, Y - 23, "#8a5a38", 18, 1); P(ctx, X, Y - 22, "#c8b088", 1, 8); P(ctx, X - 2, Y - 14, "#7a5a3a", 4, 3);
  },
  tree(ctx, X, Y, t, o) {
    P(ctx, X - 2, Y - 18, "#6a4228", 4, 18); P(ctx, X - 2, Y - 18, "#8a5a38", 1, 18);
    const sway = o?.shake ? Math.round(Math.sin(t * 1.4) * 2) : 0, c = o?.col || ["#4f9a44", "#6fbf5a", "#9ad86a"];
    disc(ctx, X + sway, Y - 30, 13, OL); disc(ctx, X + sway, Y - 30, 12, c[0]); disc(ctx, X - 3 + sway, Y - 33, 9, c[1]); disc(ctx, X - 5 + sway, Y - 36, 4, c[2]);
    if (o?.fruit) for (const [dx, dy] of [[-6, -26], [5, -30], [0, -38], [7, -24]]) P(ctx, X + dx + sway, Y + dy, o.fruit, 2, 2);
  },
  pine(ctx, X, Y, t, o) {
    P(ctx, X - 1, Y - 8, "#5a3a24", 3, 8);
    const s = o?.s || 1;
    for (let k = 0; k < 4; k++) { const w = Math.round((12 - k * 3) * s), y = Y - 8 - k * 8 * s; poly(ctx, [[X - w - 1, y + 1], [X, y - 12 * s - 1], [X + w + 1, y + 1]], OL); poly(ctx, [[X - w, y], [X, y - 12 * s], [X + w, y]], k % 2 ? "#3e7a4a" : "#4a8a52"); P(ctx, X - Math.round(w / 2), y - 3, "#6aa868", 2, 1); }
    if (o?.snow) for (let k = 0; k < 4; k++) { const y = Y - 8 - k * 8 * s - 12 * s; P(ctx, X - 2, y + 1, "#f4f8ff", 4, 2); }
  },
  lamp(ctx, X, Y, t, o) {
    P(ctx, X - 1, Y - 32, "#3a2a30", 2, 32); P(ctx, X - 3, Y - 1, "#3a2a30", 6, 2);
    P(ctx, X - 4, Y - 40, "#3a2a30", 8, 2); P(ctx, X - 3, Y - 38, o?.on ? "#ffe39a" : "#8a8070", 6, 6); P(ctx, X - 4, Y - 32, "#3a2a30", 8, 1);
  },
  lantern(ctx, X, Y, t, o) { P(ctx, X, Y - 2, "#3a2a30", 1, 2); P(ctx, X - 2, Y, "#c83a2a", 5, 6); P(ctx, X - 1, Y + 1, o?.on ? "#ffd46a" : "#e85a3a", 3, 4); P(ctx, X - 1, Y + 6, "#e8c46a", 3, 1); },
  bench(ctx, X, Y) {
    for (const [u, v] of [[-0.7, -0.15], [0.7, -0.15], [-0.7, 0.15], [0.7, 0.15]]) { const [x, y] = iso(u, v); P(ctx, X + x, Y + y - 6, "#4a2e1e", 1, 6); }
    prism(ctx, X, Y, 0.85, 0.22, 2, "#c08a52", "#8a5a34", "#a06a3e", 6);
    prism(ctx, X, Y - 2, 0.85, 0.05, 6, "#b07a48", "#8a5a34", "#9a6438", 10);
  },
  crates(ctx, X, Y) {
    prism(ctx, X - 5, Y + 2, 0.4, 0.4, 9, "#c89a5a", "#8a6036", "#a87442");
    prism(ctx, X + 6, Y - 1, 0.35, 0.35, 8, "#c89a5a", "#8a6036", "#a87442");
    prism(ctx, X - 2, Y - 2, 0.32, 0.32, 7, "#d8aa6a", "#9a6c3e", "#b8824a", 9);
    P(ctx, X - 5, Y - 3, "#ff9a3a", 3, 2); P(ctx, X - 1, Y - 4, "#e84a3a", 2, 2);
  },
  pot(ctx, X, Y, t, o) {
    prism(ctx, X, Y, 0.28, 0.28, 6, "#5a3a24", "#a8543a", "#c86a48");
    drawPlant(ctx, X, Y - 6, o?.stage ?? 1, t, o?.flower);
  },
  stall(ctx, X, Y, t, o) {
    prism(ctx, X, Y, 1.2, 0.5, 10, "#d8b078", "#8a5a34", "#a8703e");
    for (const u of [-1.1, 1.1]) { const [x, y] = iso(u, -0.45); P(ctx, X + x - 1, Y + y - 30, "#5a3a24", 2, 22); }
    const [lx, ly] = iso(-1.25, -0.6), [rx, ry] = iso(1.25, -0.6);
    for (let k = 0; k < 6; k++) { const f = k / 6, f2 = (k + 1) / 6; poly(ctx, [[X + lx + (rx - lx) * f, Y + ly + (ry - ly) * f - 32], [X + lx + (rx - lx) * f2, Y + ly + (ry - ly) * f2 - 32], [X + lx + (rx - lx) * f2, Y + ly + (ry - ly) * f2 - 24], [X + lx + (rx - lx) * f, Y + ly + (ry - ly) * f - 24]], k % 2 ? "#fff4e0" : o?.col || "#d84a4a"); }
    // 蒸笼和包子
    prism(ctx, X - 6, Y - 1, 0.3, 0.3, 4, "#e8d0a0", "#a87a48", "#c8945a", 10);
    if (o?.buns !== 0) { disc(ctx, X - 6, Y - 16, 3, "#fff6e8"); P(ctx, X - 7, Y - 18, "#e8d8c0", 2, 1); }
    const sx = X + 8, sy = Y - 14;
    P(ctx, sx - 3, sy, "#e8a33a", 6, 3); P(ctx, sx - 2, sy - 2, "#ffd36b", 4, 2);
    if (o?.steam) for (let k = 0; k < 3; k++) { const yy = Y - 20 - ((t * 0.8 + k * 5) % 14); ctx.globalAlpha = 0.5 * (1 - ((t * 0.8 + k * 5) % 14) / 14); P(ctx, X - 7 + Math.round(Math.sin(t * 0.3 + k) * 2), yy, "#ffffff", 2, 2); ctx.globalAlpha = 1; }
  },
  board(ctx, X, Y) { P(ctx, X - 7, Y - 14, "#5a3a24", 2, 14); P(ctx, X + 5, Y - 14, "#5a3a24", 2, 14); P(ctx, X - 9, Y - 26, OL, 18, 13); P(ctx, X - 8, Y - 25, "#c8945a", 16, 11); P(ctx, X - 6, Y - 23, "#fff4e0", 5, 6); P(ctx, X + 1, Y - 22, "#e8f0ff", 5, 5); P(ctx, X - 5, Y - 21, "#a8323e", 3, 1); P(ctx, X + 2, Y - 20, "#4a6ea0", 3, 1); },
  door(ctx, X, Y, t, o) {
    // 房子正面（朝向镜头的一面墙）+ 门
    prism(ctx, X, Y - 2, 1.6, 0.2, 34, "#e8d8b8", "#d8c4a0", "#c8b088");
    poly(ctx, [[X - 26, Y - 36], [X, Y - 56], [X + 26, Y - 36], [X + 22, Y - 32], [X, Y - 50], [X - 22, Y - 32]], "#b8563a");
    P(ctx, X - 5, Y - 20, OL, 11, 20); P(ctx, X - 4, Y - 19, o?.open ? "#2a1422" : "#8a5a34", 9, 19); P(ctx, X + 2, Y - 10, "#ffd36b", 1, 2);
    P(ctx, X + 9, Y - 26, OL, 9, 8); P(ctx, X + 10, Y - 25, o?.lit ? "#ffd98a" : "#9ac8d8", 7, 6); P(ctx, X + 13, Y - 25, OL, 1, 6);
    P(ctx, X - 20, Y - 46, "#6a4a3a", 5, 10); // 烟囱
  },
  ladder(ctx, X, Y) { for (const s of [-4, 3]) P(ctx, X + s, Y - 46, "#8a5a34", 2, 46); for (let k = 0; k < 8; k++) P(ctx, X - 4, Y - 4 - k * 6, "#a8703e", 9, 1); },
  sign(ctx, X, Y, t, o) { P(ctx, X - 1, Y - 16, "#5a3a24", 2, 16); const d = o?.dir || 1; poly(ctx, [[X - 8 * d, Y - 18], [X + 6 * d, Y - 18], [X + 10 * d, Y - 15], [X + 6 * d, Y - 12], [X - 8 * d, Y - 12]], "#c8945a"); P(ctx, X - 5 * d - (d < 0 ? 0 : 0), Y - 16, "#5a3a24", 6, 1); },
  boat(ctx, X, Y, t) {
    const bob = Math.round(Math.sin(t * 0.12));
    poly(ctx, [[X - 16, Y - 6 + bob], [X + 16, Y - 6 + bob], [X + 11, Y + 1 + bob], [X - 11, Y + 1 + bob]], "#7a4a2a");
    P(ctx, X - 15, Y - 7 + bob, "#a8703e", 30, 2);
    P(ctx, X + 2, Y - 18 + bob, "#5a3a24", 1, 12); P(ctx, X + 3, Y - 18 + bob, "#ffd46a", 3, 3);
    // 渡灯翁：戴斗笠的老奶奶
    P(ctx, X - 7, Y - 14 + bob, "#6a6a8a", 6, 7); disc(ctx, X - 4, Y - 16 + bob, 3, "#f0c8a0"); poly(ctx, [[X - 11, Y - 17 + bob], [X - 4, Y - 22 + bob], [X + 3, Y - 17 + bob]], "#e8c46a");
  },
  dock(ctx, X, Y) { for (let k = 0; k < 4; k++) prism(ctx, X + k * 6, Y + k * 3, 0.3, 0.55, 2, k % 2 ? "#b07a48" : "#a06a3e", "#6a4228", "#7a4e30", 3); for (const k of [0, 3]) { P(ctx, X + k * 6 - 5, Y + k * 3 - 2, "#5a3a24", 2, 8); } },
  swing(ctx, X, Y, t, o) {
    ART.tree(ctx, X, Y - 8, t, { col: ["#3e7a3a", "#5a9a48", "#86c060"] });
    P(ctx, X - 18, Y - 36, "#6a4228", 22, 3);
    const a = o?.ang || 0, sx = X - 11 + Math.round(Math.sin(a) * 14), sy = Y - 10 - Math.round((1 - Math.cos(a)) * 6);
    ctx.fillStyle = "#d8c8a0"; for (let k = 0; k <= 10; k++) { const f = k / 10; P(ctx, X - 15 + (sx - X + 15 - 4) * f, Y - 34 + (sy - Y + 34) * f, "#d8c8a0"); P(ctx, X - 7 + (sx - X + 7 + 4) * f, Y - 34 + (sy - Y + 34) * f, "#d8c8a0"); }
    P(ctx, sx - 6, sy, "#8a5a34", 12, 2);
  },
  rock(ctx, X, Y, t, o) { const s = o?.s || 1; disc(ctx, X, Y - 3 * s, 6 * s, OL, 0.6); disc(ctx, X, Y - 3 * s, 5 * s, "#8a8a96", 0.6); P(ctx, X - 2 * s, Y - 6 * s, "#b8b8c4", 3 * s, 1); },
  reeds(ctx, X, Y, t) { for (let k = 0; k < 5; k++) { const h = 8 + (k * 7) % 6, sw = Math.round(Math.sin(t * 0.1 + k) * 1); P(ctx, X - 4 + k * 2 + sw, Y - h, "#6a8a3a", 1, h); if (k % 2) P(ctx, X - 4 + k * 2 + sw, Y - h - 2, "#8a5a34", 1, 3); } },
  flowers(ctx, X, Y, t, o) { const cs = o?.cols || ["#ff8ab0", "#ffd36b", "#fff4e0"]; for (let k = 0; k < 5; k++) { const dx = (k * 5) % 11 - 5, dy = (k * 3) % 5 - 2; P(ctx, X + dx, Y + dy - 2, "#4f9a44", 1, 2); P(ctx, X + dx - 1, Y + dy - 3, cs[k % cs.length], 2, 1); } },
  mushroom(ctx, X, Y, t, o) { P(ctx, X - 1, Y - 3, "#f4e8d8", 2, 3); disc(ctx, X, Y - 4, 3, o?.glow ? "#8ae8d8" : "#d84a4a", 0.7); P(ctx, X - 1, Y - 5, "#fff4e0", 1, 1); P(ctx, X + 1, Y - 4, "#fff4e0", 1, 1); },
  shell(ctx, X, Y) { disc(ctx, X, Y - 1, 2.5, "#ffd0c0", 0.8); P(ctx, X - 1, Y - 2, "#fff4ec", 1, 1); P(ctx, X, Y - 3, "#e89a8a", 1, 2); },
  bed(ctx, X, Y, t, o) { prism(ctx, X, Y, 0.6, 1.0, 6, "#fff4e0", "#8a5a34", "#a06a3e"); prism(ctx, X, Y + 3, 0.6, 0.6, 2, o?.col || "#6a8ae0", "#4a6ac0", "#5a7ad0", 6); prism(ctx, X - 6, Y - 3, 0.45, 0.22, 3, "#ffffff", "#d8d0c0", "#e8e0d0", 6); prism(ctx, X - 9, Y - 5, 0.6, 0.06, 14, "#8a5a34", "#6a4228", "#7a4e30"); },
  shelf(ctx, X, Y) { prism(ctx, X, Y, 0.7, 0.2, 30, "#8a5a34", "#6a4228", "#7a4e30"); for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const [x, y] = iso(-0.6 + k * 0.2, 0.2); P(ctx, X + x, Y + y - 8 - r * 9, ["#c0504e", "#4a6ea0", "#e8c46a", "#6aa868", "#8a6ae0", "#fff4e0"][(k + r * 2) % 6], 2, 6); } },
  stove(ctx, X, Y, t, o) { prism(ctx, X, Y, 0.5, 0.45, 14, "#4a4a56", "#3a3a46", "#5a5a66"); P(ctx, X - 4, Y - 6, o?.on ? "#ff8a3a" : "#2a1422", 6, 4); prism(ctx, X + 1, Y - 3, 0.22, 0.22, 5, "#c0504e", "#8a3428", "#a8403a", 14); P(ctx, X - 1, Y - 38, "#6a6a76", 3, 18); },
  window(ctx, X, Y, t, o) { P(ctx, X - 10, Y - 40, OL, 20, 16); P(ctx, X - 9, Y - 39, o?.col || "#9ac8d8", 18, 14); P(ctx, X - 1, Y - 39, OL, 1, 14); P(ctx, X - 9, Y - 33, OL, 18, 1); P(ctx, X - 11, Y - 24, "#c8945a", 22, 2); },
  jar(ctx, X, Y, t, o) { const sx = o?.shake ? Math.round(Math.sin(o.shake * 0.9)) : 0; disc(ctx, X + sx, Y - 7, 6, "#8a4a2a", 1.1); disc(ctx, X + sx, Y - 8, 5, "#b0643a", 1.1); P(ctx, X - 3 + sx, Y - 15, "#6a3a22", 6, 2); P(ctx, X - 4 + sx, Y - 17, "#c8a070", 8, 2); P(ctx, X - 2 + sx, Y - 10, "#fff4e0", 4, 3); P(ctx, X - 1 + sx, Y - 9, "#c8463a", 2, 1); P(ctx, X - 4 + sx, Y - 11, "#d8885a", 1, 3); },
  musicbox(ctx, X, Y, t, o) { prism(ctx, X, Y, 0.45, 0.45, 8, "#8a5a34", "#6a4228", "#7a4e30"); prism(ctx, X, Y, 0.3, 0.3, 4, "#e8c46a", "#b8943a", "#c8a44a", 8); if (o?.on) { P(ctx, X + 6, Y - 22 - Math.round(Math.sin(t * 0.4) * 2), "#fff4e0", 2, 3); P(ctx, X + 8, Y - 24 - Math.round(Math.sin(t * 0.4) * 2), "#fff4e0", 1, 4); } },
  frame(ctx, X, Y, t, o) { P(ctx, X - 6, Y - 40, "#c8945a", 12, 10); P(ctx, X - 5, Y - 39, o?.found ? "#ffd98a" : "#9ad86a", 10, 8); disc(ctx, X, Y - 35, 2, "#ffb34d"); },
  table(ctx, X, Y) { prism(ctx, X, Y, 0.55, 0.55, 2, "#c08a52", "#8a5a34", "#a06a3e", 8); P(ctx, X - 1, Y - 8, "#6a4228", 2, 8); P(ctx, X - 2, Y - 13, "#fff4e0", 4, 3); },
  telescope(ctx, X, Y, t, o) { for (const [dx, h] of [[-4, 10], [4, 10], [0, 12]]) P(ctx, X + dx, Y - h, "#5a3a24", 1, h); poly(ctx, [[X - 7, Y - 16], [X + 8, Y - 24], [X + 9, Y - 21], [X - 6, Y - 13]], "#c8a44a"); P(ctx, X + 8, Y - 24, "#4a6ea0", 2, 3); },
  chimney(ctx, X, Y, t) { prism(ctx, X, Y, 0.35, 0.35, 18, "#8a5a4a", "#6a3a2a", "#7a4a3a"); },
  chime(ctx, X, Y, t) { P(ctx, X - 1, Y - 30, "#5a3a24", 2, 30); P(ctx, X - 6, Y - 30, "#5a3a24", 12, 1); for (let k = 0; k < 4; k++) P(ctx, X - 5 + k * 3 + Math.round(Math.sin(t * 0.2 + k)), Y - 29, "#c8e8f8", 1, 5 + k); },
  rooftile(ctx, X, Y) { prism(ctx, X, Y, 0.5, 0.5, 12, "#7a3a44", "#4a2430", "#5a2c38"); },
  cushion(ctx, X, Y) { prism(ctx, X, Y, 0.45, 0.45, 3, "#8a6ae0", "#5a4ab0", "#6a5ac0"); },
  ball(ctx, X, Y) { disc(ctx, X, Y - 3, 3.5, OL); disc(ctx, X, Y - 3, 3, "#ff6f96"); P(ctx, X - 2, Y - 5, "#fff4e0", 2, 1); P(ctx, X - 3, Y - 3, "#ffd36b", 6, 1); },
  bun(ctx, X, Y) { disc(ctx, X, Y - 2, 3, OL, 0.8); disc(ctx, X, Y - 2, 2.5, "#fff6e8", 0.8); P(ctx, X - 1, Y - 4, "#e8d8c0", 2, 1); },
  pinecone(ctx, X, Y) { disc(ctx, X, Y - 3, 2.5, "#8a5a34", 1.3); P(ctx, X - 1, Y - 5, "#a8703e", 1, 1); P(ctx, X + 1, Y - 2, "#a8703e", 1, 1); },
  puddle(ctx, X, Y, t) { disc(ctx, X, Y, 7, "rgba(120,160,200,0.45)", 0.5); if ((t | 0) % 18 < 9) P(ctx, X - 2 + ((t | 0) % 5), Y - 1, "#cfeaf6", 2, 1); },
  snowman(ctx, X, Y) { disc(ctx, X, Y - 5, 5, "#f4f8ff"); disc(ctx, X, Y - 13, 3.5, "#ffffff"); P(ctx, X - 1, Y - 14, OL, 1, 1); P(ctx, X + 1, Y - 14, OL, 1, 1); P(ctx, X, Y - 12, "#ff8a3a", 2, 1); },
};

// 植物：0 种子 1 芽 2 叶 3 花苞 4 开花
export function drawPlant(ctx, X, Y, stage, t = 0, flower = "#ff8ab0") {
  const sw = Math.round(Math.sin(t * 0.08));
  if (stage <= 0) { P(ctx, X - 1, Y - 1, "#6a4228", 2, 1); return; }
  const h = [0, 3, 7, 10, 11][stage];
  P(ctx, X + (stage > 2 ? sw : 0), Y - h, "#4f9a44", 1, h);
  if (stage >= 1) { P(ctx, X - 2, Y - 2, "#6fbf5a", 2, 1); P(ctx, X + 1, Y - 3, "#6fbf5a", 2, 1); }
  if (stage >= 2) { P(ctx, X - 3, Y - 5, "#86c060", 3, 2); P(ctx, X + 1, Y - 6, "#86c060", 3, 2); }
  if (stage === 3) P(ctx, X - 1 + sw, Y - h - 2, "#c8e890", 3, 2);
  if (stage >= 4) { const fx = X + sw, fy = Y - h - 1; for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) P(ctx, fx + dx - 1, fy + dy - 1, flower, 2, 2); P(ctx, fx - 1, fy - 1, "#ffd36b", 2, 2); }
}

// 小动物（每帧画，体积小）
export const CRITTER = {
  pigeon(ctx, X, Y, t, c) { const fly = c.z > 0; P(ctx, X - 3, Y - 4 - c.z, "#8a8aa0", 6, 3); P(ctx, X + (c.dir > 0 ? 2 : -4), Y - 6 - c.z, "#a8a8bc", 2, 2); P(ctx, X + (c.dir > 0 ? 4 : -5), Y - 5 - c.z, "#e8a33a", 1, 1); if (fly) { const f = (t | 0) % 4 < 2; P(ctx, X - 5, Y - (f ? 7 : 3) - c.z, "#c8c8d8", 3, 1); P(ctx, X + 2, Y - (f ? 7 : 3) - c.z, "#c8c8d8", 3, 1); } else if (Math.sin(t * 0.3 + c.seed * 9) > 0.7) P(ctx, X + (c.dir > 0 ? 3 : -4), Y - 3, "#8a8aa0", 2, 1); },
  cat(ctx, X, Y, t, c) { const d = c.dir > 0 ? 1 : -1, col = c.col || "#e8a35a", sleep = c.sleep; if (sleep) { disc(ctx, X, Y - 3, 5, col, 0.6); P(ctx, X + 3 * d, Y - 6, col, 3, 2); P(ctx, X + 3 * d, Y - 7, col, 1, 1); P(ctx, X + 5 * d, Y - 7, col, 1, 1); return; } const step = (t | 0) % 6 < 3 && c.moving ? 1 : 0; P(ctx, X - 5, Y - 7, col, 10, 4); P(ctx, X - 4, Y - 3, col, 1, 3 - step); P(ctx, X + 3, Y - 3, col, 1, 3 - (1 - step)); P(ctx, X + 4 * d - (d < 0 ? 3 : 0), Y - 11, col, 5, 5); P(ctx, X + 4 * d - (d < 0 ? 3 : 0), Y - 12, col, 1, 1); P(ctx, X + 4 * d + (d < 0 ? 1 : 4), Y - 12, col, 1, 1); P(ctx, X + 5 * d - (d < 0 ? 2 : -1), Y - 9, "#2a1422", 1, 1); P(ctx, X - 6 * d - (d < 0 ? 1 : 0), Y - 9 - Math.round(Math.sin(t * 0.2)), col, 1, 3); },
  duck(ctx, X, Y, t, c) { const d = c.dir > 0 ? 1 : -1, bob = Math.round(Math.sin(t * 0.15 + c.seed * 7)); P(ctx, X - 4, Y - 3 + bob, "#fff4e0", 8, 3); P(ctx, X + (d > 0 ? 2 : -4), Y - 6 + bob, "#fff4e0", 3, 3); P(ctx, X + (d > 0 ? 5 : -5), Y - 5 + bob, "#ff9a3a", 1, 1); P(ctx, X + (d > 0 ? 3 : -3), Y - 5 + bob, "#2a1422", 1, 1); ctx.globalAlpha = 0.4; P(ctx, X - 6, Y + 1, "#cfeaf6", 12, 1); ctx.globalAlpha = 1; },
  frog(ctx, X, Y, t, c) { P(ctx, X - 3, Y - 3 - c.z, "#5aa848", 6, 3); P(ctx, X - 3, Y - 5 - c.z, "#7ac860", 2, 2); P(ctx, X + 1, Y - 5 - c.z, "#7ac860", 2, 2); P(ctx, X - 2, Y - 5 - c.z, "#2a1422", 1, 1); P(ctx, X + 2, Y - 5 - c.z, "#2a1422", 1, 1); },
  butterfly(ctx, X, Y, t, c) { const f = (t | 0) % 4 < 2; P(ctx, X, Y - c.z, "#2a1422", 1, 2); P(ctx, X - (f ? 2 : 1), Y - c.z - 1, c.col, f ? 2 : 1, 2); P(ctx, X + 1, Y - c.z - 1, c.col, f ? 2 : 1, 2); },
  firefly(ctx, X, Y, t, c) { const on = Math.sin(t * 0.2 + c.seed * 20) > -0.3; if (on) { P(ctx, X, Y - c.z, "#f4ff9a"); } },
  fish(ctx, X, Y, t, c) { P(ctx, X - 3, Y - c.z, "#e8a35a", 5, 2); P(ctx, X + 2, Y - c.z - 1, "#e8a35a", 1, 4); P(ctx, X - 2, Y - c.z, "#2a1422", 1, 1); },
  npc(ctx, X, Y, t, c) { // 蘑菇婶：卖包子的小蘑菇人
    const b = Math.round(Math.sin(t * 0.1)); P(ctx, X - 3, Y - 8, "#f4e8d8", 6, 8); P(ctx, X - 2, Y - 6 + b, "#2a1422", 1, 1); P(ctx, X + 1, Y - 6 + b, "#2a1422", 1, 1);
    disc(ctx, X, Y - 11 + b, 6, "#2a1422", 0.6); disc(ctx, X, Y - 11 + b, 5, c.col || "#c0504e", 0.6); P(ctx, X - 3, Y - 13 + b, "#fff4e0", 2, 1); P(ctx, X + 2, Y - 12 + b, "#fff4e0", 1, 1); P(ctx, X - 4, Y - 3, "#fff4e0", 8, 3);
  },
};
