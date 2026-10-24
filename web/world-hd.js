// 高清插画版世界美术：同一套 (ctx, X, Y, t, o) 接口，替换像素 ART / CRITTER / 地砖 / 柔光。
// 图在 assets/world/（自制生成、无真人；见 assets/world/README.md）。坐标仍是逻辑像素，
// 画布用 setTransform 放大到设备分辨率，所以这里全部走平滑插值和矢量路径。
import { REDUCED } from "./pixel.js";
import { TW, TH, hash2, iso } from "./world-art.js";

const IMG = new Map();
const NAMES = ["ball", "bed", "bench", "board", "boat", "bun", "butterfly", "cat", "chime", "chimney", "crates", "cushion", "dock", "door", "duck", "fish", "flowers", "frame", "frog", "ladder", "lamp", "leaf", "mushroom", "musicbox", "npc", "pigeon", "pine", "pinecone", "plant0", "plant1", "plant2", "plant3", "plant4", "pot", "reeds", "rock", "shelf", "shell", "sign", "snowman", "stall", "stove", "swing", "table", "telescope", "tree", "well", "window"];
export function img(n) {
  let im = IMG.get(n);
  if (!im) { im = new Image(); im.decoding = "async"; im.src = new URL(`./assets/world/${n}.png`, import.meta.url).href; IMG.set(n, im); }
  return im;
}
export const preloadWorld = () => Promise.all(NAMES.map((n) => { const im = img(n); return im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }); }));
const ok = (im) => im.complete && im.naturalWidth > 0;
// 底边中点对齐 (X,Y)，按高度 h（逻辑像素）等比缩放
export function spr(ctx, n, X, Y, h, { flip = false, rot = 0, sx = 1, alpha = 1 } = {}) {
  const im = img(n); if (!ok(im)) return false;
  const w = h * im.naturalWidth / im.naturalHeight;
  ctx.save(); ctx.translate(X, Y); if (rot) ctx.rotate(rot); ctx.scale(flip ? -sx : sx, 1); if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(im, -w / 2, -h, w, h); ctx.restore(); return true;
}
const blob = (ctx, X, Y, rx, ry, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(X, Y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
const soft = (ctx, X, Y, w) => blob(ctx, X, Y, w, w * 0.32, "rgba(60,30,40,0.18)");
const path = (ctx, pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };

// 柔光：径向渐变（高分辨率，取代抖动像素光晕）
const glowCache = new Map();
export function glowSprite(r, col) {
  const key = r + col; let c = glowCache.get(key); if (c) return c;
  const R = Math.max(8, Math.ceil(r * 4)); c = document.createElement("canvas"); c.width = c.height = R * 2;
  const g = c.getContext("2d");
  g.fillStyle = col; g.fillRect(0, 0, R * 2, R * 2);
  const gr = g.createRadialGradient(R, R, 0, R, R, R); gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.3, "rgba(0,0,0,0.6)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.globalCompositeOperation = "destination-in"; g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
  glowCache.set(key, c); return c;
}

// ---------- 地砖：水彩感的菱形（底色 + 柔和斑块 + 边缘暗角），4 倍分辨率缓存 ----------
const Z = 4;
const PAL = {
  grass: ["#86bf62", "#9fd072", "#6fa955", "#c9e08a"], forest: ["#5a8a4c", "#6c9a58", "#4a7642", "#7aa860"],
  path: ["#dac6a0", "#e6d4b0", "#c4ae88", "#efe2c4"], plaza: ["#d8cbb0", "#e4d8be", "#c4b698", "#ece2cc"],
  dirt: ["#b08656", "#c0966a", "#986e46", "#caa274"], sand: ["#ead69e", "#f4e4b4", "#d8c088", "#fff2cc"],
  wood: ["#b98352", "#c8925e", "#a06c40", "#d4a06c"], rug: ["#c45a54", "#d06a5e", "#a84a4a", "#e8c46a"],
  roof: ["#bc5c40", "#cc6c4c", "#9e4a32", "#d8805c"], roof2: ["#5e3644", "#6c3e4e", "#4c2a38", "#7a4a5a"],
  water: ["#5a98cc", "#6aa8d8", "#4a88c0", "#cfeaf6"], deep: ["#3c70a8", "#4a7eb4", "#30609a", "#8ab8e0"],
  stone: ["#a2a2ae", "#b2b2bc", "#8a8a96", "#c8c8d2"],
};
const tileCache = new Map();
export function tileSprite(type, variant, frame = 0, i = 0, j = 0) {
  const pal = PAL[type]; if (!pal) return null;
  const alt = type === "plaza" || type === "rug" || type === "wood" ? (i + j) % 2 : 0;
  const key = `${type}:${variant}:${frame}:${alt}`;
  let c = tileCache.get(key); if (c) return c;
  c = document.createElement("canvas"); c.width = TW * Z; c.height = (TH + 4) * Z;
  const g = c.getContext("2d"); g.scale(Z, Z);
  const dia = (e = 0.7) => { g.beginPath(); g.moveTo(TW / 2, -e); g.lineTo(TW + e * 2, TH / 2); g.lineTo(TW / 2, TH + e); g.lineTo(-e * 2, TH / 2); g.closePath(); };
  // 侧面厚度（遮接缝）
  g.fillStyle = pal[2]; g.beginPath(); g.moveTo(-1.4, TH / 2); g.lineTo(TW / 2, TH + 0.7); g.lineTo(TW + 1.4, TH / 2); g.lineTo(TW + 1.4, TH / 2 + 4); g.lineTo(TW / 2, TH + 4); g.lineTo(-1.4, TH / 2 + 4); g.closePath(); g.fill();
  dia(); g.save(); g.clip();
  g.fillStyle = alt && type === "plaza" ? pal[1] : pal[0]; g.fillRect(-2, -2, TW + 4, TH + 4);
  const r = (k) => hash2(variant * 13 + k, frame * 7 + alt, 3);
  for (let k = 0; k < 7; k++) { const x = r(k) * TW, y = r(k + 20) * TH, rr = 2 + r(k + 40) * 4; g.globalAlpha = 0.35; blob(g, x, y, rr, rr * 0.5, pal[1 + (k % 2)]); }
  g.globalAlpha = 1;
  if (type === "water" || type === "deep") { g.strokeStyle = pal[3]; g.globalAlpha = 0.55; g.lineWidth = 0.5; g.lineCap = "round"; for (let k = 0; k < 2; k++) { const x = (r(k + 60) * 14 + frame * 3 + k * 9) % 18 + 3, y = 3 + k * 4 + r(k + 61) * 2; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y - 0.8, x + 4, y); g.stroke(); } g.globalAlpha = 1; }
  if (type === "grass" && r(80) > 0.7) { g.fillStyle = r(81) > 0.5 ? "#fff4e0" : "#ffd36b"; blob(g, 6 + r(82) * 12, 3 + r(83) * 6, 0.7, 0.6, g.fillStyle); }
  if (type === "plaza" || type === "stone") { g.strokeStyle = "rgba(120,100,80,0.25)"; g.lineWidth = 0.35; dia(-0.6); g.stroke(); }
  if (type === "wood") { g.strokeStyle = "rgba(90,50,30,0.25)"; g.lineWidth = 0.35; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(k * 6 - 6, 0); g.lineTo(k * 6 + 6, TH); g.stroke(); } }
  if (type === "rug") { g.strokeStyle = "#e8c46a"; g.globalAlpha = 0.6; g.lineWidth = 0.6; dia(-2.2); g.stroke(); g.globalAlpha = 1; }
  if (type === "roof" || type === "roof2") { g.strokeStyle = "rgba(60,20,20,0.3)"; g.lineWidth = 0.5; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, k * 3 + 1); g.lineTo(TW, k * 3 + 1 + 6); g.stroke(); } }
  // 暗角让每格有一点体积
  const gr = g.createRadialGradient(TW / 2, TH / 2, 2, TW / 2, TH / 2, TW * 0.6); gr.addColorStop(0, "rgba(255,250,235,0.10)"); gr.addColorStop(1, "rgba(60,30,30,0.10)");
  g.fillStyle = gr; g.fillRect(0, 0, TW, TH); g.restore();
  tileCache.set(key, c); return c;
}

// ---------- 物件 ----------
const H = { well: 38, tree: 52, lamp: 44, bench: 18, crates: 22, board: 26, ladder: 46, sign: 19, boat: 18, dock: 16, swing: 40, reeds: 15, flowers: 11, mushroom: 8, shell: 5, bed: 22, shelf: 36, stove: 30, musicbox: 11, table: 12, telescope: 24, chimney: 22, chime: 30, cushion: 8, ball: 7, bun: 6, pinecone: 6, snowman: 16, leaf: 5 };
const simple = (n) => (ctx, X, Y, t, o) => { soft(ctx, X, Y, H[n] * 0.45); spr(ctx, n, X, Y + 1, H[n] * (o?.s || 1)); };
export const PLANT_H = [4, 7, 11, 13, 15];
export function drawPlant(ctx, X, Y, stage, t = 0) {
  const st = Math.max(0, Math.min(4, stage | 0)), sw = REDUCED ? 0 : Math.sin(t * 0.05) * 0.06;
  spr(ctx, "plant" + st, X, Y + 1, PLANT_H[st], { rot: st ? sw : 0 });
}
export function lantern(ctx, X, Y, t, o) {
  const col = o?.col || "#ffb36b";
  ctx.strokeStyle = "rgba(58,42,48,0.9)"; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(X, Y - 3); ctx.lineTo(X, Y); ctx.stroke();
  const g = ctx.createRadialGradient(X - 0.8, Y + 2.2, 0.3, X, Y + 3, 3.6);
  g.addColorStop(0, o?.on ? "#fff6d0" : col); g.addColorStop(0.55, col); g.addColorStop(1, "rgba(80,30,30,0.9)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(X, Y + 3, 2.8, 3.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5a3a24"; ctx.fillRect(X - 1.2, Y - 0.6, 2.4, 0.9); ctx.fillRect(X - 1, Y + 6, 2, 0.8);
}
export const ART = {
  well: simple("well"), bench: simple("bench"), crates: simple("crates"), board: simple("board"), ladder: (ctx, X, Y) => spr(ctx, "ladder", X, Y + 1, H.ladder),
  reeds: (ctx, X, Y, t) => spr(ctx, "reeds", X, Y + 1, H.reeds, { rot: REDUCED ? 0 : Math.sin(t * 0.05 + X) * 0.05 }),
  flowers: simple("flowers"), mushroom: (ctx, X, Y, t, o) => { spr(ctx, "mushroom", X, Y + 0.5, H.mushroom); if (o?.glow) { ctx.globalAlpha = 0.35; blob(ctx, X, Y - 5, 4, 3, "#8ae8ff"); ctx.globalAlpha = 1; } },
  shell: simple("shell"), musicbox: (ctx, X, Y, t, o) => { soft(ctx, X, Y, 6); spr(ctx, "musicbox", X, Y + 1, H.musicbox); if (o?.on) note(ctx, X + 7, Y - 16 - (REDUCED ? 0 : Math.sin(t * 0.1) * 2)); },
  table: simple("table"), telescope: simple("telescope"), chimney: simple("chimney"), cushion: simple("cushion"), snowman: simple("snowman"),
  ball: (ctx, X, Y) => spr(ctx, "ball", X, Y, H.ball), bun: (ctx, X, Y) => spr(ctx, "bun", X, Y, H.bun), pinecone: (ctx, X, Y) => spr(ctx, "pinecone", X, Y, H.pinecone),
  chime: (ctx, X, Y, t) => spr(ctx, "chime", X, Y - 4, H.chime, { rot: REDUCED ? 0 : Math.sin(t * 0.08) * 0.05 }),
  tree: (ctx, X, Y, t, o) => { soft(ctx, X, Y, 12); spr(ctx, "tree", X, Y + 1, H.tree, { rot: o?.shake ? Math.sin(t * 1.4) * 0.03 : 0 }); if (o?.fruit) for (const [dx, dy] of [[-6, -30], [5, -36], [0, -42], [8, -28]]) blob(ctx, X + dx, Y + dy, 1.4, 1.4, o.fruit); },
  pine: (ctx, X, Y, t, o) => { const s = o?.s || 1; soft(ctx, X, Y, 9 * s); spr(ctx, "pine", X, Y + 1, 46 * s); if (o?.snow) { ctx.globalAlpha = 0.7; for (let k = 0; k < 3; k++) blob(ctx, X, Y - 14 * s - k * 10 * s, 6 - k * 1.5, 1.4, "#f4f8ff"); ctx.globalAlpha = 1; } },
  lamp: (ctx, X, Y, t, o) => { soft(ctx, X, Y, 4); spr(ctx, "lamp", X, Y + 1, H.lamp); if (o?.on) { ctx.globalAlpha = 0.5; blob(ctx, X + 0.2, Y - 38, 2.6, 3, "#fff2b0"); ctx.globalAlpha = 1; } },
  lantern,
  pot: (ctx, X, Y, t, o) => { soft(ctx, X, Y, 5); spr(ctx, "pot", X, Y + 1, 9); },
  stall: (ctx, X, Y, t, o) => {
    soft(ctx, X, Y, 18); spr(ctx, "stall", X, Y + 2, 38);
    if (o?.col) { ctx.fillStyle = o.col; ctx.globalAlpha = 0.9; path(ctx, [[X - 4, Y - 38], [X + 4, Y - 38], [X + 4, Y - 31], [X, Y - 33], [X - 4, Y - 31]], o.col); ctx.globalAlpha = 1; }
    if (o?.buns !== 0) { spr(ctx, "bun", X - 6, Y - 13, 5); spr(ctx, "bun", X - 2, Y - 13.5, 5); }
    if (o?.steam && !REDUCED) for (let k = 0; k < 3; k++) { const f = ((t * 0.8 + k * 5) % 14) / 14; ctx.globalAlpha = 0.45 * (1 - f); blob(ctx, X - 4 + Math.sin(t * 0.08 + k) * 2, Y - 19 - f * 14, 1.6 + f * 2, 1.4 + f * 1.6, "#ffffff"); }
    ctx.globalAlpha = 1;
  },
  door: (ctx, X, Y, t, o) => {
    // 房子正面：奶油墙 + 红瓦屋顶 + 插画木门 + 小窗（夜里亮灯）
    const g = ctx.createLinearGradient(0, Y - 36, 0, Y); g.addColorStop(0, "#f4e6c8"); g.addColorStop(1, "#dcc8a0");
    path(ctx, [[X - 24, Y - 34], [X + 24, Y - 34], [X + 24, Y + 2], [X - 24, Y + 2]], g);
    ctx.strokeStyle = "rgba(120,80,50,0.35)"; ctx.lineWidth = 0.6; ctx.strokeRect(X - 24, Y - 34, 48, 36);
    path(ctx, [[X - 28, Y - 33], [X, Y - 56], [X + 28, Y - 33], [X + 24, Y - 30], [X, Y - 50], [X - 24, Y - 30]], "#c0603e");
    path(ctx, [[X - 24, Y - 30], [X, Y - 50], [X + 24, Y - 30], [X + 22, Y - 31], [X, Y - 47], [X - 22, Y - 31]], "#9a4630");
    path(ctx, [[X - 20, Y - 48], [X - 15, Y - 48], [X - 15, Y - 40], [X - 20, Y - 36]], "#7a5446");
    spr(ctx, "door", X - 2, Y + 1.5, 22);
    const lit = o?.lit; ctx.fillStyle = "#5a3a24"; ctx.fillRect(X + 9, Y - 27, 10, 9);
    ctx.fillStyle = lit ? "#ffd98a" : "#a8d0e0"; ctx.fillRect(X + 9.8, Y - 26.2, 8.4, 7.4);
    ctx.fillStyle = "#5a3a24"; ctx.fillRect(X + 13.6, Y - 26.2, 0.8, 7.4); ctx.fillRect(X + 9.8, Y - 22.9, 8.4, 0.7);
  },
  sign: (ctx, X, Y, t, o) => { soft(ctx, X, Y, 4); spr(ctx, "sign", X, Y + 1, H.sign, { flip: (o?.dir || 1) < 0 }); },
  boat: (ctx, X, Y, t) => { const bob = REDUCED ? 0 : Math.sin(t * 0.12) * 0.8; ctx.globalAlpha = 0.35; blob(ctx, X, Y + 1, 18, 3, "#cfeaf6"); ctx.globalAlpha = 1; spr(ctx, "boat", X, Y + 2 + bob, H.boat); },
  dock: (ctx, X, Y) => spr(ctx, "dock", X + 9, Y + 9, 20),
  swing: (ctx, X, Y, t, o) => { ART.tree(ctx, X + 8, Y - 6, t, {}); const a = o?.ang || 0; spr(ctx, "swing", X - 8, Y + 1, 30, { rot: a * 0.25 }); },
  rock: (ctx, X, Y, t, o) => spr(ctx, "rock", X, Y + 1, 8 * (o?.s || 1)),
  bed: (ctx, X, Y) => { soft(ctx, X, Y + 2, 16); spr(ctx, "bed", X, Y + 6, H.bed); },
  shelf: simple("shelf"), stove: (ctx, X, Y, t, o) => { soft(ctx, X, Y, 9); spr(ctx, "stove", X, Y + 1, H.stove); if (o?.on) { ctx.globalAlpha = 0.6 + (REDUCED ? 0 : Math.sin(t * 0.3) * 0.2); blob(ctx, X - 0.5, Y - 9, 3, 2, "#ff9a3a"); ctx.globalAlpha = 1; } },
  window: (ctx, X, Y, t, o) => { spr(ctx, "window", X, Y - 20, 22); if (o?.lit) { ctx.globalAlpha = 0.25; blob(ctx, X, Y - 31, 8, 6, "#8ab0ff"); ctx.globalAlpha = 1; } },
  frame: (ctx, X, Y, t, o) => { spr(ctx, "frame", X, Y - 28, 12); if (o?.found) { ctx.globalAlpha = 0.35; blob(ctx, X, Y - 34, 7, 5, "#ffd98a"); ctx.globalAlpha = 1; } },
  rooftile: (ctx, X, Y) => {
    const c = (u, v, z) => { const [x, y] = iso(u, v); return [X + x, Y + y - z]; };
    path(ctx, [c(-0.5, 0.5, 0), c(0.5, 0.5, 0), c(0.5, 0.5, 12), c(-0.5, 0.5, 12)], "#5a2c38");
    path(ctx, [c(0.5, 0.5, 0), c(0.5, -0.5, 0), c(0.5, -0.5, 12), c(0.5, 0.5, 12)], "#6a3442");
    path(ctx, [c(-0.5, -0.5, 12), c(0.5, -0.5, 12), c(0.5, 0.5, 12), c(-0.5, 0.5, 12)], "#8a4a54");
  },
  puddle: (ctx, X, Y, t) => { ctx.globalAlpha = 0.5; blob(ctx, X, Y, 7, 2.6, "#86acd0"); ctx.globalAlpha = 0.6; blob(ctx, X - 2, Y - 0.6, 2, 0.6, "#e6f4ff"); ctx.globalAlpha = 1; },
};
function note(ctx, X, Y) { ctx.fillStyle = "#fff4e0"; blob(ctx, X, Y, 1.4, 1.1, "#fff4e0"); ctx.fillRect(X + 1, Y - 5, 0.6, 5); }

export const CRITTER = {
  pigeon: (ctx, X, Y, t, c) => { const fly = c.z > 0; spr(ctx, "pigeon", X, Y - c.z, 8, { flip: c.dir < 0, rot: fly ? Math.sin(t * 0.6) * 0.1 : 0, sx: fly ? 1 : 1 }); },
  cat: (ctx, X, Y, t, c) => spr(ctx, "cat", X, Y + 0.5, c.sleep ? 8 : 11, { flip: c.dir < 0 }),
  duck: (ctx, X, Y, t, c) => { const bob = REDUCED ? 0 : Math.sin(t * 0.15 + c.seed * 7) * 0.6; ctx.globalAlpha = 0.35; blob(ctx, X, Y + 1, 6, 1.2, "#cfeaf6"); ctx.globalAlpha = 1; spr(ctx, "duck", X, Y + 1 + bob, 9, { flip: c.dir < 0 }); },
  frog: (ctx, X, Y, t, c) => spr(ctx, "frog", X, Y - c.z + 0.5, 6),
  butterfly: (ctx, X, Y, t, c) => spr(ctx, "butterfly", X, Y - c.z, 5, { sx: REDUCED ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(t * 0.5 + (c.seed || 0) * 9)) }),
  firefly: (ctx, X, Y, t, c) => { const on = Math.sin(t * 0.2 + c.seed * 20) > -0.3; if (on) blob(ctx, X, Y - c.z, 0.8, 0.8, "#f4ff9a"); },
  fish: (ctx, X, Y, t, c) => spr(ctx, "fish", X, Y - c.z + 2, 5, { flip: (c.dir || 1) < 0, rot: -0.3 }),
  npc: (ctx, X, Y, t) => { soft(ctx, X, Y, 5); spr(ctx, "npc", X, Y + 1 + (REDUCED ? 0 : Math.sin(t * 0.1) * 0.4), 15); },
  leaf: (ctx, X, Y) => spr(ctx, "leaf", X, Y, H.leaf),
};
