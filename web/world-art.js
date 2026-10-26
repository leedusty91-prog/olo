// 倒影小镇小世界的像素美术：等距地砖、像素多边形、等距方块，以及所有道具 / 小动物的程序绘制（全部原创）。
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
  grass: (x, y, h) => (h < 0.08 ? "#c3e6dc" : (x + y * 3) % 7 === 0 ? "#b5dbd1" : h > 0.93 ? (h > 0.97 ? "#f4e7cb" : "#f8f5ed") : "#bde0d6"),
  forest: (x, y, h) => (h < 0.1 ? "#abd2c8" : (x * 5 + y) % 9 === 0 ? "#a5cfc4" : h > 0.95 ? "#e5c9b4" : "#afd4ca"),
  path: (x, y, h) => ((x + (y % 2) * 3) % 6 === 0 || y % 4 === 0 ? "#ddd2c2" : h < 0.3 ? "#eae1d2" : "#ede6d7"),
  plaza: (x, y, h, i, j) => (x === 0 || y === 0 ? "#ded4c6" : (i + j) % 2 ? (h < 0.2 ? "#ebe5d8" : "#efe9dd") : (h < 0.2 ? "#e6e0d2" : "#e9e3d5")),
  dirt: (x, y, h) => (h < 0.15 ? "#dbc8b3" : (x + y) % 5 === 0 ? "#d8c3ad" : "#dfcebc"),
  sand: (x, y, h) => (h < 0.1 ? "#ece3cd" : h > 0.96 ? "#fbf7ec" : "#f2ebd5"),
  wood: (x, y) => ((x + y * 2) % 12 === 0 ? "#d8afa1" : y % 4 === 0 ? "#dbbea8" : (x + y) % 2 ? "#dfcbb7" : "#dec7b3"),
  rug: (x, y, h, i, j) => { const e = x < 1 || y < 1; const k = (i * 3 + j) % 3; return e ? "#b5a1d8" : (x + y) % 6 < 2 ? "#f0e4c5" : ["#e3bbba", "#dfb5b7", "#e6bfbc"][k]; },
  roof: (x, y, h) => (y % 3 === 0 ? "#b59ede" : (x + Math.floor(y / 3) * 3) % 6 === 0 ? "#baa4df" : h < 0.1 ? "#e8c5b9" : "#e2bcb1"),
  roof2: (x, y, h) => (y % 3 === 0 ? "#ad9cca" : h < 0.1 ? "#b6a7d1" : "#b1a1cd"),
  water: (x, y, h, i, j, f) => ((x * 2 + y * 5 + f * 3 + i * 7) % 23 === 0 ? "#e7f3f8" : (x + y * 3 + f + j * 5) % 11 === 0 ? "#cae0ef" : "#b9cfe3"),
  deep: (x, y, h, i, j, f) => ((x * 3 + y * 7 + f * 2 + i * 5) % 31 === 0 ? "#d5e6f2" : "#aec6df"),
  stone: (x, y, h) => (h < 0.2 ? "#cbcbd9" : (x + y) % 5 === 0 ? "#bfbfd0" : "#d3d3df"),
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
const OL = "#a18bc7";
export const ART = {
  well(ctx, X, Y) {
    prism(ctx, X, Y, 0.7, 0.7, 9, "#b5c5dc", "#cbcbd9", "#d7d7e3");
    prism(ctx, X, Y, 0.48, 0.48, 1, "#9dabd5", "#b2bbd7", "#b2bbd7", 8);
    P(ctx, X - 3, Y - 10, "#e7f3f8", 2, 1);
    for (const s of [-1, 1]) P(ctx, X + s * 10 - 1, Y - 26, "#b19bd6", 2, 18);
    poly(ctx, [[X - 15, Y - 26], [X, Y - 34], [X + 15, Y - 26], [X, Y - 22]], "#e2b7b1");
    poly(ctx, [[X - 15, Y - 26], [X, Y - 22], [X, Y - 20], [X - 15, Y - 24]], "#b69fdd");
    P(ctx, X - 9, Y - 23, "#baa9d9", 18, 1); P(ctx, X, Y - 22, "#e8dece", 1, 8); P(ctx, X - 2, Y - 14, "#d5bea8", 4, 3);
  },
  tree(ctx, X, Y, t, o) {
    P(ctx, X - 2, Y - 18, "#b19bd6", 4, 18); P(ctx, X - 2, Y - 18, "#baa9d9", 1, 18);
    const sway = o?.shake ? Math.round(Math.sin(t * 1.4) * 2) : 0, c = o?.col || ["#b1dbd0", "#bee4d9", "#c5ece0"];
    disc(ctx, X + sway, Y - 30, 13, OL); disc(ctx, X + sway, Y - 30, 12, c[0]); disc(ctx, X - 3 + sway, Y - 33, 9, c[1]); disc(ctx, X - 5 + sway, Y - 36, 4, c[2]);
    if (o?.fruit) for (const [dx, dy] of [[-6, -26], [5, -30], [0, -38], [7, -24]]) P(ctx, X + dx + sway, Y + dy, o.fruit, 2, 2);
  },
  pine(ctx, X, Y, t, o) {
    P(ctx, X - 1, Y - 8, "#ad97d2", 3, 8);
    const s = o?.s || 1;
    for (let k = 0; k < 4; k++) { const w = Math.round((12 - k * 3) * s), y = Y - 8 - k * 8 * s; poly(ctx, [[X - w - 1, y + 1], [X, y - 12 * s - 1], [X + w + 1, y + 1]], OL); poly(ctx, [[X - w, y], [X, y - 12 * s], [X + w, y]], k % 2 ? "#aad4cb" : "#b2d7ce"); P(ctx, X - Math.round(w / 2), y - 3, "#c1ddd6", 2, 1); }
    if (o?.snow) for (let k = 0; k < 4; k++) { const y = Y - 8 - k * 8 * s - 12 * s; P(ctx, X - 2, y + 1, "#f3f7fc", 4, 2); }
  },
  lamp(ctx, X, Y, t, o) {
    P(ctx, X - 1, Y - 32, "#ab9ec2", 2, 32); P(ctx, X - 3, Y - 1, "#ab9ec2", 6, 2);
    P(ctx, X - 4, Y - 40, "#ab9ec2", 8, 2); P(ctx, X - 3, Y - 38, o?.on ? "#f7eed9" : "#d5cdc1", 6, 6); P(ctx, X - 4, Y - 32, "#ab9ec2", 8, 1);
  },
  lantern(ctx, X, Y, t, o) { P(ctx, X, Y - 2, "#ab9ec2", 1, 2); P(ctx, X - 2, Y, "#e7b3ad", 5, 6); P(ctx, X - 1, Y + 1, o?.on ? "#f4e8cb" : "#efc0b6", 3, 4); P(ctx, X - 1, Y + 6, "#f0e4c5", 3, 1); },
  bench(ctx, X, Y) {
    for (const [u, v] of [[-0.7, -0.15], [0.7, -0.15], [-0.7, 0.15], [0.7, 0.15]]) { const [x, y] = iso(u, v); P(ctx, X + x, Y + y - 6, "#a992d0", 1, 6); }
    prism(ctx, X, Y, 0.85, 0.22, 2, "#e4d0bb", "#dabda6", "#ddc4af", 6);
    prism(ctx, X, Y - 2, 0.85, 0.05, 6, "#dfcab6", "#dabda6", "#ddc1ab", 10);
  },
  crates(ctx, X, Y) {
    prism(ctx, X - 5, Y + 2, 0.4, 0.4, 9, "#e6d6be", "#dac1a7", "#dec8b2");
    prism(ctx, X + 6, Y - 1, 0.35, 0.35, 8, "#e6d6be", "#dac1a7", "#dec8b2");
    prism(ctx, X - 2, Y - 2, 0.32, 0.32, 7, "#ecdbc5", "#dcc5ae", "#e1cdb8", 9);
    P(ctx, X - 5, Y - 3, "#f0d6bc", 3, 2); P(ctx, X - 1, Y - 4, "#efbbb6", 2, 2);
  },
  pot(ctx, X, Y, t, o) {
    prism(ctx, X, Y, 0.28, 0.28, 6, "#ad97d2", "#dfbaae", "#e6c5b9");
    drawPlant(ctx, X, Y - 6, o?.stage ?? 1, t, o?.flower);
  },
  stall(ctx, X, Y, t, o) {
    prism(ctx, X, Y, 1.2, 0.5, 10, "#ecddc9", "#dabda6", "#dfc6b0");
    for (const u of [-1.1, 1.1]) { const [x, y] = iso(u, -0.45); P(ctx, X + x - 1, Y + y - 30, "#ad97d2", 2, 22); }
    const [lx, ly] = iso(-1.25, -0.6), [rx, ry] = iso(1.25, -0.6);
    for (let k = 0; k < 6; k++) { const f = k / 6, f2 = (k + 1) / 6; poly(ctx, [[X + lx + (rx - lx) * f, Y + ly + (ry - ly) * f - 32], [X + lx + (rx - lx) * f2, Y + ly + (ry - ly) * f2 - 32], [X + lx + (rx - lx) * f2, Y + ly + (ry - ly) * f2 - 24], [X + lx + (rx - lx) * f, Y + ly + (ry - ly) * f - 24]], k % 2 ? "#fbf6ed" : o?.col || "#eababa"); }
    // 蒸笼和包子
    prism(ctx, X - 6, Y - 1, 0.3, 0.3, 4, "#f2e9d7", "#decab5", "#e6d3be", 10);
    if (o?.buns !== 0) { disc(ctx, X - 6, Y - 16, 3, "#fcf7f0"); P(ctx, X - 7, Y - 18, "#f3ece2", 2, 1); }
    const sx = X + 8, sy = Y - 14;
    P(ctx, sx - 3, sy, "#efd8b6", 6, 3); P(ctx, sx - 2, sy - 2, "#f4e7cb", 4, 2);
    if (o?.steam) for (let k = 0; k < 3; k++) { const yy = Y - 20 - ((t * 0.8 + k * 5) % 14); ctx.globalAlpha = 0.5 * (1 - ((t * 0.8 + k * 5) % 14) / 14); P(ctx, X - 7 + Math.round(Math.sin(t * 0.3 + k) * 2), yy, "#fbf9f9", 2, 2); ctx.globalAlpha = 1; }
  },
  board(ctx, X, Y) { P(ctx, X - 7, Y - 14, "#ad97d2", 2, 14); P(ctx, X + 5, Y - 14, "#ad97d2", 2, 14); P(ctx, X - 9, Y - 26, OL, 18, 13); P(ctx, X - 8, Y - 25, "#e6d3be", 16, 11); P(ctx, X - 6, Y - 23, "#fbf6ed", 5, 6); P(ctx, X + 1, Y - 22, "#f0f4fc", 5, 5); P(ctx, X - 5, Y - 21, "#e1aab0", 3, 1); P(ctx, X + 2, Y - 20, "#b5c5dc", 3, 1); },
  door(ctx, X, Y, t, o) {
    // 房子正面（朝向镜头的一面墙）+ 门
    prism(ctx, X, Y - 2, 1.6, 0.2, 34, "#f3ecdf", "#ede5d6", "#e8dece");
    poly(ctx, [[X - 26, Y - 36], [X, Y - 56], [X + 26, Y - 36], [X + 22, Y - 32], [X, Y - 50], [X - 22, Y - 32]], "#e2bcb1");
    P(ctx, X - 5, Y - 20, OL, 11, 20); P(ctx, X - 4, Y - 19, o?.open ? "#a18bc7" : "#dabda6", 9, 19); P(ctx, X + 2, Y - 10, "#f4e7cb", 1, 2);
    P(ctx, X + 9, Y - 26, OL, 9, 8); P(ctx, X + 10, Y - 25, o?.lit ? "#f6ebd4" : "#d4e7ed", 7, 6); P(ctx, X + 13, Y - 25, OL, 1, 6);
    P(ctx, X - 20, Y - 46, "#b6a7d1", 5, 10); // 烟囱
  },
  ladder(ctx, X, Y) { for (const s of [-4, 3]) P(ctx, X + s, Y - 46, "#dabda6", 2, 46); for (let k = 0; k < 8; k++) P(ctx, X - 4, Y - 4 - k * 6, "#dfc6b0", 9, 1); },
  sign(ctx, X, Y, t, o) { P(ctx, X - 1, Y - 16, "#ad97d2", 2, 16); const d = o?.dir || 1; poly(ctx, [[X - 8 * d, Y - 18], [X + 6 * d, Y - 18], [X + 10 * d, Y - 15], [X + 6 * d, Y - 12], [X - 8 * d, Y - 12]], "#e6d3be"); P(ctx, X - 5 * d - (d < 0 ? 0 : 0), Y - 16, "#ad97d2", 6, 1); },
  boat(ctx, X, Y, t) {
    const bob = Math.round(Math.sin(t * 0.12));
    poly(ctx, [[X - 16, Y - 6 + bob], [X + 16, Y - 6 + bob], [X + 11, Y + 1 + bob], [X - 11, Y + 1 + bob]], "#b49ed9");
    P(ctx, X - 15, Y - 7 + bob, "#dfc6b0", 30, 2);
    P(ctx, X + 2, Y - 18 + bob, "#ad97d2", 1, 12); P(ctx, X + 3, Y - 18 + bob, "#f4e8cb", 3, 3);
    // 倒影国：船上没有人，一条自己漂的纸船
  },
  dock(ctx, X, Y) { for (let k = 0; k < 4; k++) prism(ctx, X + k * 6, Y + k * 3, 0.3, 0.55, 2, k % 2 ? "#dfcab6" : "#ddc4af", "#b19bd6", "#b6a2d7", 3); for (const k of [0, 3]) { P(ctx, X + k * 6 - 5, Y + k * 3 - 2, "#ad97d2", 2, 8); } },
  swing(ctx, X, Y, t, o) {
    ART.tree(ctx, X, Y - 8, t, { col: ["#a8d5ca", "#b3dbd0", "#c0e4da"] });
    P(ctx, X - 18, Y - 36, "#b19bd6", 22, 3);
    const a = o?.ang || 0, sx = X - 11 + Math.round(Math.sin(a) * 14), sy = Y - 10 - Math.round((1 - Math.cos(a)) * 6);
    ctx.fillStyle = "#ede7d6"; for (let k = 0; k <= 10; k++) { const f = k / 10; P(ctx, X - 15 + (sx - X + 15 - 4) * f, Y - 34 + (sy - Y + 34) * f, "#ede7d6"); P(ctx, X - 7 + (sx - X + 7 + 4) * f, Y - 34 + (sy - Y + 34) * f, "#ede7d6"); }
    P(ctx, sx - 6, sy, "#dabda6", 12, 2);
  },
  rock(ctx, X, Y, t, o) { const s = o?.s || 1; disc(ctx, X, Y - 3 * s, 6 * s, OL, 0.6); disc(ctx, X, Y - 3 * s, 5 * s, "#cbcbd9", 0.6); P(ctx, X - 2 * s, Y - 6 * s, "#dddde8", 3 * s, 1); },
  reeds(ctx, X, Y, t) { for (let k = 0; k < 5; k++) { const h = 8 + (k * 7) % 6, sw = Math.round(Math.sin(t * 0.1 + k) * 1); P(ctx, X - 4 + k * 2 + sw, Y - h, "#aad9ca", 1, h); if (k % 2) P(ctx, X - 4 + k * 2 + sw, Y - h - 2, "#dabda6", 1, 3); } },
  flowers(ctx, X, Y, t, o) { const cs = o?.cols || ["#f6d4df", "#f4e7cb", "#fbf6ed"]; for (let k = 0; k < 5; k++) { const dx = (k * 5) % 11 - 5, dy = (k * 3) % 5 - 2; P(ctx, X + dx, Y + dy - 2, "#b1dbd0", 1, 2); P(ctx, X + dx - 1, Y + dy - 3, cs[k % cs.length], 2, 1); } },
  mushroom(ctx, X, Y, t, o) { P(ctx, X - 1, Y - 3, "#f8f2ea", 2, 3); disc(ctx, X, Y - 4, 3, o?.glow ? "#d0f2ec" : "#eababa", 0.7); P(ctx, X - 1, Y - 5, "#fbf6ed", 1, 1); P(ctx, X + 1, Y - 4, "#fbf6ed", 1, 1); },
  shell(ctx, X, Y) { disc(ctx, X, Y - 1, 2.5, "#f9e9e4", 0.8); P(ctx, X - 1, Y - 2, "#fcf6f1", 1, 1); P(ctx, X, Y - 3, "#f2d6d0", 1, 2); },
  bed(ctx, X, Y, t, o) { prism(ctx, X, Y, 0.6, 1.0, 6, "#fbf6ed", "#dabda6", "#ddc4af"); prism(ctx, X, Y + 3, 0.6, 0.6, 2, o?.col || "#c5d0ee", "#b9c4e3", "#bfcae9", 6); prism(ctx, X - 6, Y - 3, 0.45, 0.22, 3, "#fbf9f9", "#eeeae1", "#f3efe7", 6); prism(ctx, X - 9, Y - 5, 0.6, 0.06, 14, "#dabda6", "#b19bd6", "#b6a2d7"); },
  shelf(ctx, X, Y) { prism(ctx, X, Y, 0.7, 0.2, 30, "#dabda6", "#b19bd6", "#b6a2d7"); for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const [x, y] = iso(-0.6 + k * 0.2, 0.2); P(ctx, X + x, Y + y - 8 - r * 9, ["#e3bbba", "#b5c5dc", "#f0e4c5", "#c1ddd6", "#d0c5ee", "#fbf6ed"][(k + r * 2) % 6], 2, 6); } },
  stove(ctx, X, Y, t, o) { prism(ctx, X, Y, 0.5, 0.45, 14, "#afafc6", "#a8a8c3", "#b7b7cb"); P(ctx, X - 4, Y - 6, o?.on ? "#f0d2bc" : "#a18bc7", 6, 4); prism(ctx, X + 1, Y - 3, 0.22, 0.22, 5, "#e3bbba", "#b69fdd", "#dfb1ae", 14); P(ctx, X - 1, Y - 38, "#bebecf", 3, 18); },
  window(ctx, X, Y, t, o) { P(ctx, X - 10, Y - 40, OL, 20, 16); P(ctx, X - 9, Y - 39, o?.col || "#d4e7ed", 18, 14); P(ctx, X - 1, Y - 39, OL, 1, 14); P(ctx, X - 9, Y - 33, OL, 18, 1); P(ctx, X - 11, Y - 24, "#e6d3be", 22, 2); },
  jar(ctx, X, Y, t, o) { const sx = o?.shake ? Math.round(Math.sin(o.shake * 0.9)) : 0; disc(ctx, X + sx, Y - 7, 6, "#b6a0dd", 1.1); disc(ctx, X + sx, Y - 8, 5, "#e1c1b0", 1.1); P(ctx, X - 3 + sx, Y - 15, "#af97d8", 6, 2); P(ctx, X - 4 + sx, Y - 17, "#e7d8c6", 8, 2); P(ctx, X - 2 + sx, Y - 10, "#fbf6ed", 4, 3); P(ctx, X - 1 + sx, Y - 9, "#e5b8b4", 2, 1); P(ctx, X - 4 + sx, Y - 11, "#ebcfbf", 1, 3); },
  musicbox(ctx, X, Y, t, o) { prism(ctx, X, Y, 0.45, 0.45, 8, "#dabda6", "#b19bd6", "#b6a2d7"); prism(ctx, X, Y, 0.3, 0.3, 4, "#f0e4c5", "#e2d4b1", "#e6d9b9", 8); if (o?.on) { P(ctx, X + 6, Y - 22 - Math.round(Math.sin(t * 0.4) * 2), "#fbf6ed", 2, 3); P(ctx, X + 8, Y - 24 - Math.round(Math.sin(t * 0.4) * 2), "#fbf6ed", 1, 4); } },
  frame(ctx, X, Y, t, o) { P(ctx, X - 6, Y - 40, "#e6d3be", 12, 10); P(ctx, X - 5, Y - 39, o?.found ? "#f6ebd4" : "#c5ece0", 10, 8); disc(ctx, X, Y - 35, 2, "#f2ddc2"); },
  table(ctx, X, Y) { prism(ctx, X, Y, 0.55, 0.55, 2, "#e4d0bb", "#dabda6", "#ddc4af", 8); P(ctx, X - 1, Y - 8, "#b19bd6", 2, 8); P(ctx, X - 2, Y - 13, "#fbf6ed", 4, 3); },
  telescope(ctx, X, Y, t, o) { for (const [dx, h] of [[-4, 10], [4, 10], [0, 12]]) P(ctx, X + dx, Y - h, "#ad97d2", 1, h); poly(ctx, [[X - 7, Y - 16], [X + 8, Y - 24], [X + 9, Y - 21], [X - 6, Y - 13]], "#e6d9b9"); P(ctx, X + 8, Y - 24, "#b5c5dc", 2, 3); },
  chimney(ctx, X, Y, t) { prism(ctx, X, Y, 0.35, 0.35, 18, "#d7bbb2", "#b19dd5", "#b8a8d5"); },
  chime(ctx, X, Y, t) { P(ctx, X - 1, Y - 30, "#ad97d2", 2, 30); P(ctx, X - 6, Y - 30, "#ad97d2", 12, 1); for (let k = 0; k < 4; k++) P(ctx, X - 5 + k * 3 + Math.round(Math.sin(t * 0.2 + k)), Y - 29, "#e5f2f9", 1, 5 + k); },
  rooftile(ctx, X, Y) { prism(ctx, X, Y, 0.5, 0.5, 12, "#b8a8d5", "#ab97cc", "#b09dcf"); },
  cushion(ctx, X, Y) { prism(ctx, X, Y, 0.45, 0.45, 3, "#d0c5ee", "#bdb7df", "#c4bee4"); },
  ball(ctx, X, Y) { disc(ctx, X, Y - 3, 3.5, OL); disc(ctx, X, Y - 3, 3, "#f4ccd7"); P(ctx, X - 2, Y - 5, "#fbf6ed", 2, 1); P(ctx, X - 3, Y - 3, "#f4e7cb", 6, 1); },
  bun(ctx, X, Y) { disc(ctx, X, Y - 2, 3, OL, 0.8); disc(ctx, X, Y - 2, 2.5, "#fcf7f0", 0.8); P(ctx, X - 1, Y - 4, "#f3ece2", 2, 1); },
  pinecone(ctx, X, Y) { disc(ctx, X, Y - 3, 2.5, "#dabda6", 1.3); P(ctx, X - 1, Y - 5, "#dfc6b0", 1, 1); P(ctx, X + 1, Y - 2, "#dfc6b0", 1, 1); },
  puddle(ctx, X, Y, t) { disc(ctx, X, Y, 7, "rgba(120,160,200,0.45)", 0.5); if ((t | 0) % 18 < 9) P(ctx, X - 2 + ((t | 0) % 5), Y - 1, "#e7f3f8", 2, 1); },
  snowman(ctx, X, Y) { disc(ctx, X, Y - 5, 5, "#f3f7fc"); disc(ctx, X, Y - 13, 3.5, "#fbf9f9"); P(ctx, X - 1, Y - 14, OL, 1, 1); P(ctx, X + 1, Y - 14, OL, 1, 1); P(ctx, X, Y - 12, "#f0d2bc", 2, 1); },
};

// 植物：0 种子 1 芽 2 叶 3 花苞 4 开花
export function drawPlant(ctx, X, Y, stage, t = 0, flower = "#f6d4df") {
  const sw = Math.round(Math.sin(t * 0.08));
  if (stage <= 0) { P(ctx, X - 1, Y - 1, "#b19bd6", 2, 1); return; }
  const h = [0, 3, 7, 10, 11][stage];
  P(ctx, X + (stage > 2 ? sw : 0), Y - h, "#b1dbd0", 1, h);
  if (stage >= 1) { P(ctx, X - 2, Y - 2, "#bee4d9", 2, 1); P(ctx, X + 1, Y - 3, "#bee4d9", 2, 1); }
  if (stage >= 2) { P(ctx, X - 3, Y - 5, "#c0e4da", 3, 2); P(ctx, X + 1, Y - 6, "#c0e4da", 3, 2); }
  if (stage === 3) P(ctx, X - 1 + sw, Y - h - 2, "#d2f2e8", 3, 2);
  if (stage >= 4) { const fx = X + sw, fy = Y - h - 1; for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) P(ctx, fx + dx - 1, fy + dy - 1, flower, 2, 2); P(ctx, fx - 1, fy - 1, "#f4e7cb", 2, 2); }
}

// 小动物（每帧画，体积小）
export const CRITTER = {
  pigeon(ctx, X, Y, t, c) { const fly = c.z > 0; P(ctx, X - 3, Y - 4 - c.z, "#ccccdc", 6, 3); P(ctx, X + (c.dir > 0 ? 2 : -4), Y - 6 - c.z, "#d7d7e5", 2, 2); P(ctx, X + (c.dir > 0 ? 4 : -5), Y - 5 - c.z, "#efd8b6", 1, 1); if (fly) { const f = (t | 0) % 4 < 2; P(ctx, X - 5, Y - (f ? 7 : 3) - c.z, "#e4e4ee", 3, 1); P(ctx, X + 2, Y - (f ? 7 : 3) - c.z, "#e4e4ee", 3, 1); } else if (Math.sin(t * 0.3 + c.seed * 9) > 0.7) P(ctx, X + (c.dir > 0 ? 3 : -4), Y - 3, "#ccccdc", 2, 1); },
  cat(ctx, X, Y, t, c) { const d = c.dir > 0 ? 1 : -1, col = c.col || "#f0d9c0", sleep = c.sleep; if (sleep) { disc(ctx, X, Y - 3, 5, col, 0.6); P(ctx, X + 3 * d, Y - 6, col, 3, 2); P(ctx, X + 3 * d, Y - 7, col, 1, 1); P(ctx, X + 5 * d, Y - 7, col, 1, 1); return; } const step = (t | 0) % 6 < 3 && c.moving ? 1 : 0; P(ctx, X - 5, Y - 7, col, 10, 4); P(ctx, X - 4, Y - 3, col, 1, 3 - step); P(ctx, X + 3, Y - 3, col, 1, 3 - (1 - step)); P(ctx, X + 4 * d - (d < 0 ? 3 : 0), Y - 11, col, 5, 5); P(ctx, X + 4 * d - (d < 0 ? 3 : 0), Y - 12, col, 1, 1); P(ctx, X + 4 * d + (d < 0 ? 1 : 4), Y - 12, col, 1, 1); P(ctx, X + 5 * d - (d < 0 ? 2 : -1), Y - 9, "#a18bc7", 1, 1); P(ctx, X - 6 * d - (d < 0 ? 1 : 0), Y - 9 - Math.round(Math.sin(t * 0.2)), col, 1, 3); },
  duck(ctx, X, Y, t, c) { const d = c.dir > 0 ? 1 : -1, bob = Math.round(Math.sin(t * 0.15 + c.seed * 7)); P(ctx, X - 4, Y - 3 + bob, "#fbf6ed", 8, 3); P(ctx, X + (d > 0 ? 2 : -4), Y - 6 + bob, "#fbf6ed", 3, 3); P(ctx, X + (d > 0 ? 5 : -5), Y - 5 + bob, "#f0d6bc", 1, 1); P(ctx, X + (d > 0 ? 3 : -3), Y - 5 + bob, "#a18bc7", 1, 1); ctx.globalAlpha = 0.4; P(ctx, X - 6, Y + 1, "#e7f3f8", 12, 1); ctx.globalAlpha = 1; },
  frog(ctx, X, Y, t, c) { P(ctx, X - 3, Y - 3 - c.z, "#b5ded3", 6, 3); P(ctx, X - 3, Y - 5 - c.z, "#c0e6dc", 2, 2); P(ctx, X + 1, Y - 5 - c.z, "#c0e6dc", 2, 2); P(ctx, X - 2, Y - 5 - c.z, "#a18bc7", 1, 1); P(ctx, X + 2, Y - 5 - c.z, "#a18bc7", 1, 1); },
  butterfly(ctx, X, Y, t, c) { const f = (t | 0) % 4 < 2; P(ctx, X, Y - c.z, "#a18bc7", 1, 2); P(ctx, X - (f ? 2 : 1), Y - c.z - 1, c.col, f ? 2 : 1, 2); P(ctx, X + 1, Y - c.z - 1, c.col, f ? 2 : 1, 2); },
  firefly(ctx, X, Y, t, c) { const on = Math.sin(t * 0.2 + c.seed * 20) > -0.3; if (on) { P(ctx, X, Y - c.z, "#f3f7d9"); } },
  fish(ctx, X, Y, t, c) { P(ctx, X - 3, Y - c.z, "#f0d9c0", 5, 2); P(ctx, X + 2, Y - c.z - 1, "#f0d9c0", 1, 4); P(ctx, X - 2, Y - c.z, "#a18bc7", 1, 1); },
  npc(ctx, X, Y, t, c) { // 蘑菇婶：卖包子的小蘑菇人
    const b = Math.round(Math.sin(t * 0.1)); P(ctx, X - 3, Y - 8, "#f8f2ea", 6, 8); P(ctx, X - 2, Y - 6 + b, "#a18bc7", 1, 1); P(ctx, X + 1, Y - 6 + b, "#a18bc7", 1, 1);
    disc(ctx, X, Y - 11 + b, 6, "#a18bc7", 0.6); disc(ctx, X, Y - 11 + b, 5, c.col || "#e3bbba", 0.6); P(ctx, X - 3, Y - 13 + b, "#fbf6ed", 2, 1); P(ctx, X + 2, Y - 12 + b, "#fbf6ed", 1, 1); P(ctx, X - 4, Y - 3, "#fbf6ed", 8, 3);
  },
};
