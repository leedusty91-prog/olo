// 收起聊天后的 2.5D 小场景：倒影小镇的小广场（等距视角像素画，全部程序绘制、原创）。
// 一块浮在雾河湾里的石板小广场：天色/日月随用户本地时间；纸船撑着小船在岛前慢慢划过；墙角挂着一串涟漪兽灯笼。
// 道具和 olo 按深度（wx+wy）排序遮挡；olo 脚下有随高度缩放的影子。
// 玩法：点场景里的道具或底部去处按钮 → olo 走过去玩（看井 / 坐长椅 / 浇花 / 摇树 / 够路灯 / 躲猫猫 / 朝船挥手），头顶冒一句短话；
// 点 olo 有反应，也能抓起来扔：在 2.5D 空间里抛物线飞、撞墙/撞道具反弹、落地挤压。
import { drawOlo, canvas, ticker, REDUCED, P } from "./pixel.js";
import { sfx } from "./audio.js";
import { bands, groundAt, localHour, skyAt, sunProgress } from "./skytime.js?v=20261026e";

const N = 8, TW = 20, TH = 10, WH = 30;               // 8×8 格，格子 20×10，后墙高 30
// 道具：位置（格坐标）、碰撞半径、高度、点击框（半宽, 高，画布像素）、olo 过去玩时站的位置
export const PROPS = [
  { id: "well", x: 4.2, y: 3.6, r: 0.95, h: 16, box: [13, 32], at: [4.6, 5.0] },
  { id: "tree", x: 1.4, y: 6.2, r: 0.7, h: 34, box: [15, 50], at: [2.5, 5.7] },
  { id: "lamp", x: 6.6, y: 1.3, r: 0.35, h: 34, box: [6, 40], at: [6.3, 2.3] },
  { id: "bench", x: 1.6, y: 2.0, r: 0.8, h: 8, box: [12, 16], at: [1.6, 2.0] },
  { id: "crates", x: 6.5, y: 6.3, r: 0.75, h: 14, box: [13, 26], at: [5.4, 5.6] },
  { id: "pot", x: 3.3, y: 7.2, r: 0.4, h: 9, box: [6, 16], at: [3.4, 6.3] },
];
// 每个去处：短名、无障碍动词、HUD 上的「正在…」、时长（帧）、说的话（夜里可换一套）。（手机端已改用原生小窝 Nook.tsx，不再导出这份。）
export const SPOTS = {
  well: { label: "水井", verb: "看看水井", doing: "趴在井边往下看", dur: 150, say: ["井里有星星在眨眼。", "喂——（回声：喂——）", "井水好凉，像早上的雾。"] },
  bench: { label: "长椅", verb: "去长椅坐坐", doing: "坐在长椅上打盹", dur: 260, say: ["坐一会儿，脚不酸了。", "这儿晒太阳最舒服。"], night: ["嘘……星星在数羊。"] },
  pot: { label: "花盆", verb: "给花盆浇水", doing: "给小花浇水", dur: 170, say: ["喝吧喝吧，快点开花。", "小花说谢谢。"] },
  tree: { label: "小树", verb: "摇摇小树", doing: "摇小树", dur: 150, say: ["花瓣下雨啦！", "树说：痒。"] },
  lamp: { label: "路灯", verb: "够一够路灯", doing: "踮脚够路灯", dur: 150, say: ["白天它在打盹，不吵它。"], night: ["亮一点，给晚归的人照路。"] },
  crates: { label: "木箱", verb: "躲到木箱后面", doing: "躲在木箱后面", dur: 210, say: ["嘿！找到我啦？"] },
  boat: { label: "小船", verb: "朝漂过的纸船挥手", doing: "朝漂过的纸船挥手", dur: 170, say: ["纸船——！", "船上的灯，和我一样亮吗？"], at: [7.2, 6.2] },
  come: { label: "叫它", verb: "叫它过来", doing: "跑到你跟前", dur: 90, say: ["来啦！", "叫我？"], at: [5.0, 5.8] },
};
const HIDE = [5.8, 5.8];                              // 躲猫猫：木箱后面（深度比木箱小，会被挡住）
const PART = { dawn: "清晨", day: "白天", dusk: "傍晚", night: "夜里" };
const MOOD = { idle: "在广场上溜达", happy: "开心得蹦蹦跳", sad: "有点低落，慢慢走", thinking: "在想事情", talking: "在哼小曲", listening: "竖着耳朵" };

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const mixc = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
const rgb = (c) => `rgb(${c.join(",")})`;

// 场景几何（与 apps/mobile/src/Room.tsx 共用同一套数字）
export function geometry(RW, RH) {
  const ox = Math.round(RW / 2), oy = Math.round((RH - N * TH + WH) / 2 + 2);
  const proj = (wx, wy, z = 0) => [ox + (wx - wy) * TW / 2, oy + (wx + wy) * TH / 2 - z];
  const unproj = (sx, sy, z = 0) => { const a = (sx - ox) / (TW / 2), b = (sy + z - oy) / (TH / 2); return [(a + b) / 2, (b - a) / 2]; };
  return { ox, oy, proj, unproj };
}
// 小船沿着浮岛前方的河湾弧线来回轻摇（始终留在深水区画面内）
export function boatPose(G, t = 0) {
  const ph = REDUCED ? 0.55 : t * 0.014 + 0.55, dx = Math.round(Math.sin(ph) * 36);
  const fy = G.oy + N * TH;
  return { x: G.ox + dx, y: fy + 17 - Math.round((dx * dx) / 150) + (REDUCED ? 0 : Math.round(Math.cos(ph * 2) * 1)), dir: Math.cos(ph) >= 0 ? 1 : -1 };
}

export function light(hr) {
  const sk = skyAt(hr), g = groundAt(hr), sp = sunProgress(hr);
  const night = sk.star, dusk = sk.phase === "dusk" || sk.phase === "dawn";
  return { sk, g, sp, night, dusk, cols: bands(sk.sky, 10) };
}

// 雾河湾的颜色跟着天色走：水面偏青蓝（夜里深靛），波光与薄雾偏暖白
export function water(L) {
  const s = L.sk.sky;
  return {
    top: mixc(s[3], L.night > 0.4 ? [36, 62, 92] : [68, 138, 166], 0.58),
    deep: mixc(s[1], [18, 34, 54], 0.62),
    hi: mixc(s[3], [255, 248, 230], 0.65),
    fog: mixc(s[3], [255, 246, 236], 0.72),
  };
}

// 一串涟漪兽灯笼：从后墙角拉到路灯顶上，自然下垂
export function lanterns(G) {
  const [ax, ay] = G.proj(0, 0), [bx, by] = G.proj(6.6, 1.3);
  const A = [ax, ay - WH + 2], B = [bx, by - 37];
  const at = (f) => [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f + 36 * f * (1 - f)];
  return { at, lamps: [0.2, 0.38, 0.56, 0.74].map(at) };
}

// ---------- 雾河湾：环抱着浮岛前缘的等距水面、波光、薄雾、芦苇（外缘像素抖动渐隐，不碰画布边界） ----------
function drawRiver(ctx, L, t, G) {
  const W = water(L), [, ly] = G.proj(0, N), [, fy] = G.proj(N, N);
  const y0 = ly - 2, y1 = fy + 29, cy = (ly + fy) / 2 + 9, ry = (y1 - y0) / 2, rx = N * (TW / 2) + 18;
  for (let y = y0; y <= y1; y++) {
    const ny = (y - cy) / ry; if (Math.abs(ny) >= 1) continue;
    const hw = Math.round(rx * Math.sqrt(1 - ny * ny));
    const col = rgb(mixc(W.top, W.deep, Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))));
    for (let dx = -hw; dx <= hw; dx++) {
      const d = Math.hypot(dx / rx, ny);
      if (d > 0.92 && ((dx + y) & 1)) continue;
      if (d > 0.84 && ((dx & 1) && (y & 1))) continue;
      ctx.globalAlpha = d > 0.78 ? Math.max(0.18, (1 - d) / 0.22) * 0.75 : 0.82;
      P(ctx, G.ox + dx, y, col);
    }
  }
  // 粼粼波光：沿着河湾内部缓缓漂移
  ctx.globalAlpha = 0.65;
  for (let i = 0; i < 22; i++) {
    const y = ly + 4 + ((i * 7) % (fy - ly + 18)), ny = (y - cy) / ry;
    if (Math.abs(ny) >= 0.86) continue;
    const span = Math.max(12, Math.round(rx * Math.sqrt(1 - ny * ny) * 0.78));
    const dx = (((i * 29 + Math.round(t * (0.15 + (i % 3) * 0.06))) % (span * 2)) - span);
    if (((t | 0) + i * 5) % 28 < 23) P(ctx, G.ox + dx, y, rgb(W.hi), 2 + (i % 3), 1);
  }
  // 几缕薄雾贴着水面慢慢飘
  for (let k = 0; k < 3; k++) {
    const w = 26 + k * 8, y = ly + 6 + k * 14, drift = REDUCED ? 0 : Math.sin(t / 18 + k * 2) * 14;
    const cx = G.ox + (k === 0 ? -34 : k === 1 ? 32 : -4) + Math.round(drift);
    ctx.globalAlpha = 0.28;
    for (let dy = -2; dy <= 2; dy++) {
      const hw = Math.round((w / 2) * Math.sqrt(1 - (dy / 3) ** 2));
      for (let dx = -hw; dx < hw; dx++) if (((dx + dy) & 1) === 0) P(ctx, cx + dx, y + dy, rgb(W.fog));
    }
  }
  ctx.globalAlpha = 1;
  // 芦苇：贴着浮岛左右岸边各长一丛，芦花随风轻摆
  const [lx, lY] = G.proj(0, N), [rX, rY] = G.proj(N, 0);
  for (const [bx0, by0, hh0] of [[lx - 9, lY + 7, 16], [lx - 4, lY + 11, 20], [rX + 4, rY + 11, 19], [rX + 9, rY + 7, 15]]) for (let s = 0; s < 3; s++) {
    const bx = bx0 + s * 2 - 2, by = by0 + (s % 2) * 2, hh = hh0 - s * 3, sway = REDUCED ? 0 : Math.round(Math.sin(t / 12 + bx0 + s) * 1.1);
    for (let j = 0; j < hh; j++) P(ctx, bx + Math.round((sway * j) / hh), by - j, j < 3 ? "#9cd0bf" : "#a4d6c6");
    P(ctx, bx + sway - 1, by - hh - 3, "#f3eee2", 2, 4); P(ctx, bx + sway, by - hh - 4, "#fbf6ec");
  }
}

// ---------- 静态部分：（天空）、雾河湾、浮岛侧面、墙、灯串、地面 ----------
export function drawBackdrop(ctx, RW, RH, L, t = 0, sky = true) {
  const G = geometry(RW, RH), { proj } = G;
  const { sk, sp, cols } = L;
  const bh = RH / cols.length;
  if (!sky) ctx.clearRect(0, 0, RW, RH);
  if (sky) cols.forEach((col, i) => P(ctx, 0, Math.floor(i * bh), col, RW, Math.ceil(bh) + 1));
  if (sky && sk.star > 0.05) for (let i = 0; i < 40; i++) { const x = (i * 53 + 7) % RW, y = (i * 29 + 5) % Math.round(RH * 0.45), on = REDUCED ? 5 : ((t | 0) + i * 7) % 40; ctx.globalAlpha = sk.star * (on < 3 ? 1 : 0.6); P(ctx, x, y, on < 3 ? "#fbf7ec" : "#f3e9df"); }
  ctx.globalAlpha = 1;
  if (!sky) { /* 网页版：全屏 #bg 已经画了天空和日月 */ }
  else if (sp !== null && sk.sun > 0.15) {
    const sx = Math.round(RW * (0.08 + 0.84 * sp)), sy = Math.round(RH * (0.36 - 0.28 * Math.sin(Math.PI * sp))), low = 1 - Math.sin(Math.PI * sp) > 0.6;
    for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) { const d = Math.hypot(x, y);
      if (d < 6) P(ctx, sx + x, sy + y, d < 4 ? (low ? "#f7eedb" : "#fbf7eb") : low ? "#f2d8c6" : "#f5e8cf");
      else if (d < 10 && (x + y) % 2 === 0) { ctx.globalAlpha = 0.25 * (1 - (d - 6) / 4); P(ctx, sx + x, sy + y, "#f5e8cf"); ctx.globalAlpha = 1; } }
  } else {
    const mx = Math.round(RW * 0.8), my = Math.round(RH * 0.12);
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) { const d = Math.hypot(x, y); if (d <= 5.5 && Math.hypot(x - 2.6, y - 1.6) > 4.6) P(ctx, mx + x, my + y, "#faf4e6"); }
  }
  if (sky) for (let x = 0; x < RW; x++) { const hh = Math.round(RH * 0.4 + 6 * Math.sin(x * 0.05) + 3 * Math.sin(x * 0.13)); ctx.globalAlpha = 0.55; P(ctx, x, hh, L.g.hill, 1, RH - hh); }
  ctx.globalAlpha = 1;
  drawRiver(ctx, L, t, G);
  const [ax, ay] = proj(0, 0), [lx, ly] = proj(0, N), [rx, ry] = proj(N, 0), [fx, fy] = proj(N, N);
  const W = water(L);
  // 浮岛侧面（前两面），泥土色，左暗右亮；底边泡在水里，一圈水波
  for (let x = Math.floor(lx); x <= Math.ceil(rx); x++) {
    const top = x <= fx ? ly + (x - lx) * (fy - ly) / (fx - lx || 1) : fy + (x - fx) * (ry - fy) / (rx - fx || 1);
    const dark = x <= fx;
    for (let j = 0; j < 10; j++) P(ctx, x, Math.round(top) + j, j < 2 ? L.g.grass : j === 9 ? "#a48dcd" : ((x + j) % 5 === 0 ? "#b19bd6" : dark ? "#b6a2d7" : "#dcc2af"));
    if (x % 3 !== 0) { ctx.globalAlpha = 0.65; P(ctx, x, Math.round(top) + 10 + ((((x >> 2) + ((t / 6) | 0)) & 1)), rgb(W.hi)); ctx.globalAlpha = 1; }
  }
  // 后墙：左墙（x=0 面）偏暗，右墙（y=0 面）偏亮；砖缝；右墙有条纹雨棚和茶案，左墙有窗和常春藤
  const wall = (x0, y0, x1, y1, base, mortar, side) => {
    for (let x = Math.floor(Math.min(x0, x1)); x <= Math.ceil(Math.max(x0, x1)); x++) {
      const f = (x - x0) / (x1 - x0 || 1), fy0 = y0 + (y1 - y0) * f;
      for (let j = 0; j < WH; j++) {
        const yy = Math.round(fy0) - j, row = Math.floor(j / 5), joint = j % 5 === 0 || (x + row * 5 + (side ? 0 : 3)) % 10 === 0;
        P(ctx, x, yy, j === WH - 1 ? "#af9cd0" : joint ? mortar : base);
      }
    }
  };
  wall(lx, ly, ax, ay, "#e0d0c2", "#d6c4b4", 0);
  wall(ax, ay, rx, ry, "#ebddcd", "#dfd1c1", 1);
  // 左墙常春藤 + 窗（夜里透出暖光，窗台摆一盆小绿植）
  for (const [wy, len] of [[1.2, 11], [1.6, 16], [2.0, 9], [6.2, 13], [6.6, 8]]) {
    const [vx, vy] = proj(0, wy);
    for (let j = 0; j < len; j++) P(ctx, vx + ((j * 3) % 2), Math.round(vy - WH + 2 + j), j % 3 === 0 ? "#bee6da" : "#a4d9ca");
  }
  const [wx0, wy0] = proj(0, 4.6);
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) { const x = wx0 - 4 + i, y = Math.round(wy0 - 12 - j + i * 0.5);
    P(ctx, x, y, i === 0 || i === 8 || j === 0 || j === 8 || i === 4 ? "#a78ed2" : L.night > 0.4 ? "#f6ebd4" : "#d4e7ed"); }
  for (let i = -5; i <= 5; i++) P(ctx, wx0 + i, Math.round(wy0 - 11 + (i + 4) * 0.5), "#ab94d4");
  // 雨棚（右墙）+ 棚下小茶案与两只茶盏
  const [sx0, sy0] = proj(3.2, 0), [sx1, sy1] = proj(5.6, 0);
  for (let x = Math.round(sx0); x <= Math.round(sx1); x++) {
    const f = (x - sx0) / (sx1 - sx0), yBase = Math.round(sy0 + (sy1 - sy0) * f), y = yBase - 20;
    for (let j = 0; j < 6; j++) P(ctx, x, y + j, Math.floor((x - sx0) / 3) % 2 ? "#fbf5ec" : "#edc2c0");
    P(ctx, x, y + 6, x % 2 ? "#dfaeae" : "#edc2c0");
    P(ctx, x, yBase - 7, "#b19bd6", 1, 2);
  }
  const [cx0, cy0] = proj(4.1, 0), [cx1, cy1] = proj(4.9, 0);
  P(ctx, cx0, cy0 - 9, "#fbf6ec", 2, 2); P(ctx, cx1, cy1 - 10, "#ead0ba", 2, 3);
  // 灯串：一根绳 + 四盏小灯笼（涟漪兽的样子），夜里点亮
  const S = lanterns(G);
  for (let i = 0; i <= 80; i++) { const [x, y] = S.at(i / 80); P(ctx, x, y, "#a78ed2"); }
  S.lamps.forEach(([x, y], i) => {
    const on = L.night > 0.3, col = on ? (i % 2 ? "#f7eed9" : "#f5e8cf") : i % 2 ? "#f2e1c6" : "#f2d3c6";
    P(ctx, x, y + 1, "#a78ed2"); P(ctx, x - 1, y + 2, "#a48dcd", 3, 1); P(ctx, x - 1, y + 3, col, 3, 3); P(ctx, x - 1, y + 3, on ? "#faf6e6" : "#f7ebdb"); P(ctx, x, y + 6, "#a48dcd");
  });
  // 地面：先铺整块石板底缝（防透底），再铺亮暗交错的石板格、井周暖砖拼花与石缝青草
  for (let dy = 0; dy <= N * TH; dy++) {
    const hw = Math.round((N * TW / 2) * (1 - Math.abs(dy - (N * TH) / 2) / (N * TH / 2)));
    if (hw > 0) P(ctx, ax - hw, ay + dy, "#ded3c7", hw * 2, 1);
  }
  for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
    const [cx, cy] = proj(gx + 0.5, gy + 0.5), alt = (gx + gy) % 2, hsh = (gx * 7 + gy * 13) % 7;
    const plazaCenter = gx >= 3 && gx <= 5 && gy >= 2 && gy <= 4;
    const tileCol = plazaCenter ? (alt ? "#ecded0" : "#f1e5d8") : (alt ? "#e8dfd3" : "#ede6da");
    for (let dy = -TH / 2; dy < TH / 2; dy++) {
      const hw = Math.floor((TW / 2) * (1 - Math.abs(dy + 0.5) / (TH / 2)));
      if (hw <= 0) continue;
      P(ctx, cx - hw, cy + dy, tileCol, hw * 2, 1);
      P(ctx, cx - hw, cy + dy, "#ded3c7", 1, 1);
    }
    if (hsh === 0) { P(ctx, cx - 3, cy, "#b7dfd3", 2, 1); P(ctx, cx + 2, cy + 1, "#c0e6db"); }
    else if (hsh === 1 && (gx === 0 || gy === N - 1)) { P(ctx, cx - 2, cy, "#b7dfd3", 2, 1); P(ctx, cx - 1, cy - 1, "#fbf6ec"); }
    else if (hsh === 3) P(ctx, cx - 1, cy - 1, "#e3d9cd", 3, 1);
  }
}

// ---------- 道具（像素小物件），以脚底投影点 (X,Y) 为锚；fx.shake 摇树、fx.boost 路灯更亮 ----------
export function drawProp(ctx, id, X, Y, L, t = 0, fx = {}) {
  X = Math.round(X); Y = Math.round(Y);
  const shadow = (w) => { ctx.globalAlpha = 0.25; P(ctx, X - w, Y, "#9f85cc", w * 2, 2); ctx.globalAlpha = 1; };
  if (id === "well") {
    shadow(12);
    for (let j = 0; j < 10; j++) { const w = 11 - (j === 9 ? 1 : 0); P(ctx, X - w, Y - j - 1, "#d1c3ba", w * 2, 1); for (let i = -w; i < w; i += 4) P(ctx, X + i + (j % 2) * 2, Y - j - 1, "#b7acc9"); }
    P(ctx, X - 11, Y - 12, "#dacfc8", 22, 2); P(ctx, X - 9, Y - 11, "#9db9d5", 18, 2); P(ctx, X - 6, Y - 11, "#b4cbdb", 6, 1);
    P(ctx, X - 10, Y - 28, "#b19bd6", 2, 16); P(ctx, X + 8, Y - 28, "#b19bd6", 2, 16);
    for (let i = 0; i < 26; i++) { const yy = Math.round(Y - 30 + Math.abs(i - 13) * 0.45); P(ctx, X - 13 + i, yy, i % 3 ? "#e1b9b0" : "#b6a0dd", 1, 3); }
    P(ctx, X - 1, Y - 26, "#a895c7", 1, 8); P(ctx, X - 2, Y - 18, "#dcc7af", 3, 2);
  } else if (id === "tree") {
    shadow(10);
    P(ctx, X - 2, Y - 14, "#b19bd6", 4, 14); P(ctx, X - 2, Y - 14, "#baa9d9", 1, 14);
    const sway = REDUCED ? 0 : Math.round(Math.sin(t / 14) + (fx.shake || 0) * 2.4 * Math.sin(t * 2.2));
    for (let y = -18; y <= 12; y++) for (let x = -14; x <= 14; x++) { const d = (x / 14) ** 2 + (y / 13) ** 2; if (d < 1) P(ctx, X + x + (y < -6 ? sway : y < 4 ? Math.round(sway / 2) : 0), Y - 30 + y, d > 0.8 ? "#99d8c6" : (x + y) < -6 ? "#bfeadd" : (x * 3 + y * 5) % 7 === 0 ? "#aedfd1" : "#b6e2d5"); }
    [[-6, -36], [5, -28], [-2, -22]].forEach(([dx, dy]) => P(ctx, X + dx + (dy < -36 ? sway : 0), Y + dy, "#f7d9d9", 2, 2));
  } else if (id === "lamp") {
    shadow(4);
    const on = L.night > 0.3 || fx.boost > 0;
    P(ctx, X - 3, Y - 3, "#ab9ec2", 6, 3); P(ctx, X - 1, Y - 30, "#ab9ec2", 2, 28);
    P(ctx, X - 4, Y - 38, "#ab9ec2", 8, 2); P(ctx, X - 3, Y - 36, fx.boost > 0 ? "#faf6e6" : on ? "#f7eed9" : "#d5cdc1", 6, 6); P(ctx, X - 4, Y - 30, "#ab9ec2", 8, 1);
  } else if (id === "bench") {
    shadow(11);
    for (let i = 0; i < 20; i++) { const yy = Y - 7 + Math.round(i * 0.25); P(ctx, X - 10 + i, yy, i % 4 ? "#dfcab6" : "#dabda6", 1, 3); P(ctx, X - 10 + i, yy - 7, "#dcc4ae", 1, 2); }
    P(ctx, X - 9, Y - 5, "#ad97d2", 2, 6); P(ctx, X + 8, Y - 1, "#ad97d2", 2, 4);
  } else if (id === "crates") {
    shadow(12);
    const box = (bx, by, s) => { P(ctx, bx, by - s, "#e3d0b9", s, s); P(ctx, bx, by - s, "#eedbc2", s, 2); P(ctx, bx, by - s, "#b19bd6", 1, s); P(ctx, bx + s - 1, by - s, "#b19bd6", 1, s); P(ctx, bx, by - 1, "#b19bd6", s, 1); P(ctx, bx + 2, by - s + 4, "#dbbea4", s - 4, 1); };
    box(X - 11, Y, 12); box(X + 1, Y + 1, 10); box(X - 6, Y - 12, 9);
    P(ctx, X + 3, Y - 12, "#efd7b5", 3, 3); P(ctx, X + 6, Y - 11, "#ecc0b5", 3, 3);
  } else if (id === "pot") {
    shadow(5);
    P(ctx, X - 4, Y - 6, "#e2beb1", 8, 6); P(ctx, X - 5, Y - 7, "#eacaba", 10, 2);
    P(ctx, X - 1, Y - 12, "#a8dece", 1, 5); P(ctx, X - 3, Y - 14, "#f4e7cb", 3, 3); P(ctx, X + 1, Y - 11, "#f6d4da", 2, 2);
  }
}

// ---------- 纸船的小船（锚点 = 船中间的吃水线）；wave>0 时婆婆挥手、船灯闪 ----------
export function drawBoat(ctx, X, Y, L, t = 0, wave = 0, dir = 1) {
  X = Math.round(X); Y = Math.round(Y);
  const f = (dx) => X + dx * dir;
  ctx.globalAlpha = 0.25; for (let i = -11; i < 11; i += 2) P(ctx, X + i, Y + 2 + ((i >> 1) & 1), "#ae89c4", 2, 1); ctx.globalAlpha = 1;
  for (let i = -12; i <= 12; i++) { const lift = Math.max(0, Math.abs(i) - 9); P(ctx, X + i, Y - 3 - lift, i % 4 ? "#dabda6" : "#b19bd6", 1, lift > 1 ? 2 : 3); P(ctx, X + i, Y - 4 - lift, "#dfcab6"); }
  P(ctx, X - 9, Y, "#a78ed2", 18, 1);
  for (let i = -7; i <= 3; i++) { const hh = 6 - Math.round(Math.abs(i + 2) * 0.35); for (let j = 0; j < hh; j++) P(ctx, f(i), Y - 5 - j, (i + j) % 3 ? "#e7d8c4" : "#dbc9b1"); P(ctx, f(i), Y - 5 - hh, "#d6b1a4"); }
  // 倒影国：船上没有人，纸船自己漂
  const on = L.night > 0.3 || wave > 0, blink = wave > 0 && (t | 0) % 3 === 0, lx = f(-10);        // 船尾的涟漪兽小灯
  P(ctx, f(-9), Y - 16, "#a48dcd", 1, 11); P(ctx, lx - 1, Y - 16, "#a48dcd", 3, 1); P(ctx, lx, Y - 15, "#a48dcd");
  P(ctx, lx - 1, Y - 14, blink ? "#faf6e6" : on ? "#f5e8cf" : "#edcbbb", 3, 3); P(ctx, lx, Y - 11, "#a48dcd");
}

// 光照：夜里整体压暗 + 路灯/窗户/灯串/船灯暖光；黄昏偏橙；清晨偏粉。ex: { boost, boat: { x, y, dir } }
export function drawLighting(ctx, RW, RH, L, t, ex = {}) {
  const G = geometry(RW, RH), { proj } = G;
  if (L.night > 0.05) { ctx.globalCompositeOperation = "source-atop"; ctx.globalAlpha = 0.38 * L.night; P(ctx, 0, 0, "#8890cf", RW, RH); ctx.globalCompositeOperation = "source-over"; }
  else if (L.dusk) { ctx.globalCompositeOperation = "source-atop"; ctx.globalAlpha = 0.14; P(ctx, 0, 0, L.sk.phase === "dusk" ? "#f0cdbc" : "#f7d9df", RW, RH); ctx.globalCompositeOperation = "source-over"; }
  ctx.globalAlpha = 1;
  const glow = (gx, gy, R, col, k = 1) => { for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const d = Math.hypot(x, y * 1.4); if (d < R && (x + y) % 2 === 0) { ctx.globalAlpha = Math.min(0.6, 0.32 * k * (1 - d / R)); P(ctx, gx + x, gy + y, col); } } ctx.globalAlpha = 1; };
  const boost = ex.boost || 0;
  if (L.night > 0.3 || boost > 0) {
    const br = (REDUCED ? 0.9 : 0.85 + 0.15 * Math.sin(t / 9)) * Math.max(L.night, boost);
    const [lx, ly] = proj(6.6, 1.3); glow(lx, ly - 33, Math.round(26 + 8 * boost), "#f1ddc0", br * (1 + boost));
  }
  if (L.night > 0.3) {
    const br = (REDUCED ? 0.9 : 0.85 + 0.15 * Math.sin(t / 9)) * L.night;
    const [wx, wy] = proj(0, 4.6); glow(wx, wy - 16, 14, "#f4e5cc", br);
    lanterns(G).lamps.forEach(([x, y], i) => glow(x, y + 4, 7, "#f4e5cc", br * (REDUCED ? 1 : 0.8 + 0.2 * Math.sin(t / 6 + i * 1.7))));
    if (ex.boat) glow(ex.boat.x - 10 * (ex.boat.dir || 1), ex.boat.y - 13, 9, "#f4e5cc", br);
  }
}

// 小粒子（水滴、花瓣、Zzz、星光、爱心、井水涟漪）
function drawFx(ctx, f) {
  const a = 1 - f.age / f.life, x = Math.round(f.x), y = Math.round(f.y);
  ctx.globalAlpha = f.kind === "ripple" ? a * 0.8 : Math.min(1, a * 1.6);
  if (f.kind === "drop") P(ctx, x, y, "#d4e8f6", 1, 2);
  else if (f.kind === "petal") P(ctx, x + Math.round(Math.sin(f.age / 5)), y, f.col || "#f7d9dd", 2, 1);
  else if (f.kind === "z") { const c = "#fbf6ec"; P(ctx, x, y, c, 3, 1); P(ctx, x + 1, y + 1, c); P(ctx, x, y + 2, c, 3, 1); }
  else if (f.kind === "spark") { const c = (f.age >> 2) % 2 ? "#f8f4df" : "#f5e8cf"; P(ctx, x, y - 1, c); P(ctx, x - 1, y, c, 3, 1); P(ctx, x, y + 1, c); }
  else if (f.kind === "heart") { const c = "#f5cfd4"; P(ctx, x - 2, y, c, 2, 1); P(ctx, x + 1, y, c, 2, 1); P(ctx, x - 2, y + 1, c, 5, 1); P(ctx, x - 1, y + 2, c, 3, 1); P(ctx, x, y + 3, c); }
  else if (f.kind === "ripple") { const r = 1 + f.age / 4; for (let i = 0; i < 16; i++) { const th = (i / 16) * Math.PI * 2; P(ctx, x + Math.cos(th) * r * 1.6, y + Math.sin(th) * r * 0.5, "#e8f2fa"); } }
  ctx.globalAlpha = 1;
}

// 悬停/聚焦的东西头上：一个一跳一跳的小箭头
function drawMarker(ctx, X, Y, t) {
  const b = REDUCED ? 0 : ((t | 0) % 6 < 3 ? 0 : 1);
  [[3, 0], [2, 1], [1, 2], [0, 3]].forEach(([w, j]) => { P(ctx, X - w - 1, Y + j + b, "#9d7ed2", w * 2 + 3, 1); P(ctx, X - w, Y + j + b - 1, "#fbf6ec", w * 2 + 1, 1); });
}

// ---------- 可交互的广场 ----------
export function mountRoom(host, p, { onOpenChat } = {}) {
  host.classList.add("room"); host.dataset.testid = "room";
  const spotIds = [...PROPS.map((q) => q.id), "boat"];
  host.innerHTML = `<canvas class="room-px" role="img" aria-label="倒影小镇的小广场：一块浮在雾河上的石板地，olo 在这里溜达"></canvas>
    <div class="room-hud px-box dark" data-testid="room-hud">
      <b class="room-place">倒影小镇 · 小广场</b>
      <span class="room-clock" data-testid="room-clock"></span>
      <span class="room-doing" data-testid="room-doing"></span>
    </div>
    <div class="room-bubble px-box" data-testid="room-bubble" aria-hidden="true" hidden></div>
    <p class="sr-only" aria-live="polite" data-testid="room-live"></p>
    <div class="room-dock">
      <p class="room-hint" data-testid="room-hint"></p>
      <div class="room-spots" role="group" aria-label="广场上可以玩的东西">
        ${spotIds.map((id) => `<button type="button" class="room-chip px-box" data-spot="${id}" data-testid="spot-${id}" aria-label="${SPOTS[id].verb}">${SPOTS[id].label}</button>`).join("")}
      </div>
      <div class="room-actions">
        <button type="button" class="btn px-box ghost room-call" data-testid="room-call">♪ 叫它过来</button>
        <button type="button" class="btn px-box room-open" data-testid="room-open-chat">✉ 回去聊天</button>
      </div>
    </div>`;
  const $ = (s) => host.querySelector(s);
  const c = $("canvas"), ctx = c.getContext("2d");
  const bubble = $(".room-bubble"), live = $("[data-testid=room-live]"), hint = $(".room-hint"), clockEl = $(".room-clock"), doingEl = $(".room-doing");
  const btns = Object.fromEntries([...host.querySelectorAll(".room-chip")].map((b) => [b.dataset.spot, b]));
  // 名字是用户输入：只走 textContent，不拼进 HTML
  const name = String(p.name || "olo").slice(0, 24);
  hint.textContent = `点点广场上的东西，${name} 会跑过去玩`;
  const HINT_KEY = "olo.roomHintSeen";
  const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return false; } };
  if (hintSeen()) hint.hidden = true;
  const hideHint = () => { if (hint.hidden) return; hint.hidden = true; try { localStorage.setItem(HINT_KEY, "1"); } catch { /* 隐私模式：只是不记住 */ } };
  $(".room-open").addEventListener("click", () => onOpenChat?.());

  let RW = 200, RH = 176, K = 3, G = geometry(RW, RH);
  const resize = () => {
    const w = host.clientWidth || 360, h = host.clientHeight || 480;
    K = Math.max(2, Math.min(4, Math.floor(Math.min(w / 184, h / 192))));
    RW = Math.ceil(w / K); RH = Math.ceil(h / K); c.width = RW; c.height = RH; ctx.imageSmoothingEnabled = false;
    c.style.width = RW * K + "px"; c.style.height = RH * K + "px"; G = geometry(RW, RH);
  };

  let L = light(localHour());
  const relight = () => {
    const hr = localHour(); L = light(hr);
    host.dataset.daypart = L.sk.phase; host.dataset.celestial = L.sp !== null && L.sk.sun > 0.15 ? "sun" : "moon";
    clockEl.textContent = `${PART[L.sk.phase] || ""} ${String(Math.floor(hr)).padStart(2, "0")}:${String(Math.floor((hr % 1) * 60)).padStart(2, "0")}`;
  };
  relight();
  const [sc, spr] = canvas(48, 44);
  const s = { state: "idle" };
  const D = { mode: "home", x: 3.2, y: 4.8, z: 0, vx: 0, vy: 0, vz: 0, sx: 1, sy: 1, ss: 0, sAxis: "y", goal: null, wait: 40, ph: 0, still: 0, last: [], react: 0, boingAt: 0,
    task: null, ignore: null, ignoreT: 0, hover: null, focus: null, sayT: 0, shake: 0, boost: 0, wave: 0, thrown: false };
  const fx = [];
  host.dataset.drag = "home"; host.dataset.squash = ""; host.dataset.state = "idle"; host.dataset.act = ""; host.dataset.spot = "";
  const now = () => performance.now();
  const setMode = (m) => { D.mode = m; host.dataset.drag = m; };
  const boing = (v) => { if (v > 1.4 && now() - D.boingAt > 140) { D.boingAt = now(); sfx("boing"); } };
  const spawn = (o) => { if (!REDUCED && fx.length < 90) fx.push({ vx: 0, vy: 0, g: 0, life: 40, ...o, age: 0 }); };
  const B0 = 0.45, B1 = N - 0.45;
  const blocked = (x, y, pad = 0.35) => PROPS.some((q) => Math.hypot(x - q.x, y - q.y) < q.r + pad);
  const pickGoal = () => { for (let i = 0; i < 30; i++) { const x = 0.8 + Math.random() * (N - 1.6), y = 0.8 + Math.random() * (N - 1.6); if (!blocked(x, y, 0.6)) return [x, y]; } return [3.2, 4.8]; };
  const collide = (bounce) => {
    if (D.x < B0 || D.x > B1) { D.x = clamp(D.x, B0, B1); if (bounce) { boing(Math.abs(D.vx) * 9); D.vx *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vx) * 1.6); D.sAxis = "x"; } }
    if (D.y < B0 || D.y > B1) { D.y = clamp(D.y, B0, B1); if (bounce) { boing(Math.abs(D.vy) * 9); D.vy *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vy) * 1.6); D.sAxis = "x"; } }
    for (const q of PROPS) {
      if (q.id === D.ignore) continue;                 // 正要去 / 刚离开的那个道具：允许走进它的范围（坐长椅、躲木箱）
      const dx = D.x - q.x, dy = D.y - q.y, d = Math.hypot(dx, dy), R = q.r + 0.3;
      if (d < R && D.z < q.h) {
        const nx = dx / (d || 1), ny = dy / (d || 1); D.x = q.x + nx * R; D.y = q.y + ny * R;
        if (bounce) { const vn = D.vx * nx + D.vy * ny; if (vn < 0) { D.vx -= 1.7 * vn * nx; D.vy -= 1.7 * vn * ny; boing(-vn * 9); D.ss = Math.min(0.35, -vn * 1.6); D.sAxis = "x"; } }
      }
    }
  };
  const propAt = (id) => PROPS.find((q) => q.id === id);
  const hitTest = (mx, my) => { const [X, Y] = G.proj(D.x, D.y, D.z); return mx > X - 11 && mx < X + 11 && my > Y - 26 && my < Y + 3; };
  const hitSpot = (mx, my) => {
    const bp = boatPose(G, ticker.ft);
    if (mx > bp.x - 14 && mx < bp.x + 14 && my > bp.y - 18 && my < bp.y + 4) return "boat";
    for (const q of [...PROPS].sort((a, b) => b.x + b.y - (a.x + a.y))) { const [X, Y] = G.proj(q.x, q.y); if (mx > X - q.box[0] && mx < X + q.box[0] && my > Y - q.box[1] && my < Y + 3) return q.id; }
    return null;
  };
  const toRoom = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / K, (e.clientY - r.top) / K]; };

  // ---------- 说话 / 正在做什么 ----------
  let doingText = "";
  const say = (text, frames = 170) => { bubble.textContent = text; bubble.hidden = false; live.textContent = `${name}：${text}`; D.sayT = REDUCED ? 1e9 : frames; };
  const doing = () => {
    if (D.mode === "held") return "被你拎起来了";
    if (D.mode === "fling") return D.thrown ? "飞起来啦" : "开心地蹦了一下";
    if (D.task) return D.task.phase === "walk" ? `正跑去${SPOTS[D.task.id].verb.replace(/^(去|给|朝)/, "")}` : SPOTS[D.task.id].doing;
    return MOOD[s.state] || MOOD.idle;
  };
  const syncDoing = () => {
    const t = `${name} ${doing()}`;
    if (t !== doingText) { doingText = t; doingEl.textContent = t; }
    for (const [id, b] of Object.entries(btns)) b.classList.toggle("on", D.task?.id === id);
  };

  // ---------- 去某处玩 ----------
  const targetOf = (id) => (id === "bench" ? [propAt("bench").x, propAt("bench").y] : SPOTS[id].at || propAt(id).at);
  const endTask = () => {
    if (!D.task) return;
    const id = D.task.id; D.task = null; host.dataset.act = ""; host.dataset.spot = "";
    if (id === "bench" || id === "crates") { D.ignore = id; D.ignoreT = 70; }
    D.z = 0; D.sx = D.sy = 1;
  };
  const go = (id, byUser = true) => {
    if (!SPOTS[id] || D.mode !== "home") return;
    endTask(); D.goal = null;
    D.task = { id, phase: "walk", t: 0, steps: 0 }; host.dataset.spot = id; host.dataset.act = "";
    D.ignore = id === "bench" ? "bench" : null;
    if (byUser) { hideHint(); sfx("select"); }
    if (REDUCED) { [D.x, D.y] = targetOf(id); startAct(); }
  };
  const startAct = () => {
    const T = D.task; T.phase = "act"; T.t = 0; host.dataset.act = T.id;
    const S = SPOTS[T.id], lines = L.night > 0.5 && S.night ? S.night : S.say;
    if (T.id === "crates") { D.ignore = "crates"; say("（躲好了……）", 120); }
    else say(pick(lines));
    if (T.id === "lamp" && L.night > 0.3) D.boost = 1;
    if (T.id === "boat") D.wave = 1;
    if (T.id === "come" || T.id === "boat") sfx("happy");
    if (REDUCED && T.id === "bench") D.z = 7;
  };
  const updateAct = () => {
    const T = D.task, t = ++T.t, S = SPOTS[T.id];
    const [PX, PY] = (() => { const q = propAt(T.id); return q ? G.proj(q.x, q.y) : [0, 0]; })();
    if (T.id === "well") {
      D.sx = 1 + 0.05 * Math.sin(t / 6); D.sy = 1 - 0.04 * Math.sin(t / 6);
      if (t === 30 || t === 80) { spawn({ kind: "ripple", x: PX, y: PY - 11, life: 36 }); sfx("tick"); }
    } else if (T.id === "bench") {
      D.z = t < 18 ? 7 * (t / 18) + Math.sin((Math.PI * t) / 18) * 6 : 7;
      if (t > 40 && t % 55 === 0) spawn({ kind: "z", x: G.proj(D.x, D.y, D.z)[0] + 6, y: G.proj(D.x, D.y, D.z)[1] - 26, vx: 0.12, vy: -0.25, life: 60 });
      if (t >= S.dur - 14) D.z = 7 * ((S.dur - t) / 14);
    } else if (T.id === "pot") {
      D.z = Math.abs(Math.sin(t / 8)) * 2;
      if (t > 10 && t < 100 && t % 5 === 0) spawn({ kind: "drop", x: PX - 4 + Math.random() * 8, y: PY - 24, vy: 0.6, g: 0.05, life: 22 });
      if (t === 110) { for (let i = 0; i < 6; i++) spawn({ kind: "spark", x: PX - 6 + Math.random() * 12, y: PY - 18 - Math.random() * 6, vy: -0.15, life: 40 }); sfx("sparkle"); }
    } else if (T.id === "tree") {
      if (t === 12) { boing(3); D.ss = 0.3; D.sAxis = "x"; D.shake = 1; }
      if (t < 12) D.sx = 1 + t * 0.01; else { D.ss *= 0.85; D.sx = 1 - D.ss; D.sy = 1 + D.ss * 0.6; }
      if (t > 12 && t < 70 && t % 5 === 0) spawn({ kind: "petal", x: PX - 12 + Math.random() * 24, y: PY - 44 + Math.random() * 10, vx: 0.1, vy: 0.35, life: 70 });
    } else if (T.id === "lamp") {
      D.z = t < 80 ? Math.abs(Math.sin(t / 12)) * 10 : 0;
      if (t === 40 && D.boost > 0) { const [LX, LY] = G.proj(6.6, 1.3); for (let i = 0; i < 5; i++) spawn({ kind: "spark", x: LX - 6 + Math.random() * 12, y: LY - 40 + Math.random() * 6, vy: -0.1, life: 40 }); sfx("sparkle"); }
    } else if (T.id === "crates") {
      const at = SPOTS.crates.at || propAt("crates").at;
      if (t <= 24) { const f = t / 24; D.x = lerp(at[0], HIDE[0], f); D.y = lerp(at[1], HIDE[1], f); D.sy = 1 - 0.4 * f; D.sx = 1 + 0.15 * f; }
      else if (t < 170) { D.sy = 0.6 + 0.07 * Math.sin(t / 9); D.sx = 1.15; }
      else { const f = Math.min(1, (t - 170) / 18); D.x = lerp(HIDE[0], at[0], f); D.y = lerp(HIDE[1], at[1], f); D.sx = D.sy = 1; D.z = Math.sin(Math.PI * f) * 10;
        if (t === 171) { say(pick(S.say)); sfx("happy"); } }
    } else if (T.id === "boat" || T.id === "come") {
      D.z = Math.abs(Math.sin(t / 9)) * (T.id === "come" ? 6 : 9);
      if (t % 30 === 0) spawn({ kind: "heart", x: G.proj(D.x, D.y, D.z)[0], y: G.proj(D.x, D.y, D.z)[1] - 30, vy: -0.3, life: 30 });
    }
    if (t >= S.dur) { endTask(); D.wait = 90 + Math.random() * 120; }
  };

  const step = () => {
    if (D.ignoreT > 0 && --D.ignoreT === 0 && !D.task) D.ignore = null;
    if (D.sayT > 0 && --D.sayT === 0) bubble.hidden = true;
    D.shake *= 0.97; if (D.shake < 0.02) D.shake = 0;
    if (D.boost > 0) D.boost = Math.max(0, D.boost - 1 / 360);
    if (D.wave > 0) D.wave = Math.max(0, D.wave - 1 / 200);
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.age++; f.x += f.vx; f.y += f.vy; f.vy += f.g; if (f.age >= f.life) fx.splice(i, 1); }
    if (D.mode === "home") {
      if (D.react > 0) D.react--;
      if (REDUCED) { if (D.task?.phase === "act" && ++D.task.t >= SPOTS[D.task.id].dur) endTask(); return; }
      if (D.task?.phase === "act") updateAct();
      else if (D.task) {
        // 一蹦一蹦走过去；绕不过去就直接到（不让它卡在道具边上原地踏步）
        const [tx, ty] = targetOf(D.task.id), dx = tx - D.x, dy = ty - D.y, d = Math.hypot(dx, dy), sp = (p.form === "cloud" ? 0.024 : 0.036) * (s.state === "sad" ? 0.7 : 1);
        if (d < sp || ++D.task.steps > 420) { D.x = tx; D.y = ty; D.z = 0; startAct(); }
        else { D.x += (dx / d) * sp; D.y += (dy / d) * sp; D.ph += 0.18; const hp = Math.abs(Math.sin(D.ph)); D.z = p.form === "buddy" ? hp * 4 : 0; D.sx = 1 + (hp < 0.15 ? 0.08 : -0.03); D.sy = 1 - (hp < 0.15 ? 0.08 : -0.05); collide(false); }
      } else {
        // 溜达：停一会儿 → 有时自己去玩点什么，有时选个空地一蹦一蹦走过去
        if (!D.goal) { if (--D.wait <= 0) { if (Math.random() < 0.3) go(pick(PROPS).id, false); else D.goal = pickGoal(); } }
        else {
          const dx = D.goal[0] - D.x, dy = D.goal[1] - D.y, d = Math.hypot(dx, dy), sp = (p.form === "cloud" ? 0.018 : 0.028) * (s.state === "sad" ? 0.7 : 1);
          if (d < sp) { D.goal = null; D.wait = 60 + Math.random() * 140; D.z = 0; D.ph = 0; }
          else { D.x += (dx / d) * sp; D.y += (dy / d) * sp; D.ph += 0.16; const hp = Math.abs(Math.sin(D.ph)); D.z = p.form === "buddy" ? hp * 4 : 0; D.sx = 1 + (hp < 0.15 ? 0.08 : -0.03); D.sy = 1 - (hp < 0.15 ? 0.08 : -0.05); collide(false); }
        }
        if (!D.goal && !D.task) { D.sx += (1 - D.sx) * 0.3; D.sy += (1 - D.sy) * 0.3; if (D.z > 0) D.z = Math.max(0, D.z - 1); }
      }
    } else if (D.mode === "held") {
      D.z += (14 - D.z) * 0.3;
      const sp = Math.hypot(D.vx, D.vy) * 10, k = Math.min(0.3, sp * 0.4), ax = Math.abs(D.vx - D.vy) > Math.abs(D.vx + D.vy) * 0.5;
      D.sx += ((ax ? 1 + k : 1 - k * 0.6) - D.sx) * 0.4; D.sy += ((ax ? 1 - k * 0.6 : 1 + k) - D.sy) * 0.4;
      D.vx *= 0.8; D.vy *= 0.8;
    } else if (D.mode === "fling") {
      D.vz -= 0.4; D.x += D.vx; D.y += D.vy; D.z += D.vz;
      collide(true);
      if (D.z <= 0) {
        const imp = -D.vz; D.z = 0;
        if (imp > 1.3) { boing(imp * 2); D.ss = Math.min(0.42, imp * 0.07); D.sAxis = "y"; D.vz = imp * 0.55; D.vx *= 0.8; D.vy *= 0.8; }
        else { D.vz = 0; D.vx *= 0.86; D.vy *= 0.86; }
      }
      D.ss *= 0.8;
      const air = D.z > 0 ? Math.min(0.2, Math.abs(D.vz) * 0.05) : 0, ax = D.sAxis === "x";
      D.sx = ax ? 1 - D.ss : 1 + D.ss - air * 0.5; D.sy = ax ? 1 + D.ss * 0.6 : 1 - D.ss + air;
      D.still = D.z === 0 && Math.hypot(D.vx, D.vy) < 0.006 && D.ss < 0.02 ? D.still + 1 : 0;
      if (D.still > 12) { setMode("home"); D.goal = null; D.wait = 50; D.react = 40; if (D.thrown) say(pick(["晕乎乎……", "再来一次！", "我会飞啦！"]), 120); D.thrown = false; }
    }
    if ((Math.abs(D.sx - 1) > 0.04 || Math.abs(D.sy - 1) > 0.04) && !host.dataset.squash.includes(D.mode)) host.dataset.squash += " " + D.mode;
  };

  const render = (t = ticker.ft) => {
    drawBackdrop(ctx, RW, RH, L, t, false);
    const bp = boatPose(G, t);
    drawBoat(ctx, bp.x, bp.y, L, t, D.wave, bp.dir);
    // 深度排序：道具 + olo，按 wx+wy 从后往前画
    const items = PROPS.map((q) => ({ id: q.id, d: q.x + q.y, draw: () => { const [X, Y] = G.proj(q.x, q.y); drawProp(ctx, q.id, X, Y, L, t, { shake: q.id === "tree" ? D.shake : 0, boost: q.id === "lamp" ? D.boost : 0 }); } }));
    const sitting = D.task?.id === "bench" && D.task.phase === "act";
    items.push({ id: "olo", d: D.x + D.y + (sitting ? 0.05 : 0), draw: () => {
      const [X, Y] = G.proj(D.x, D.y, sitting ? 7 : 0), air = clamp((D.z - (sitting ? 7 : 0)) / 30, 0, 1), w = Math.round(9 * (1 - 0.5 * air));
      ctx.globalAlpha = 0.32 * (1 - air * 0.5); P(ctx, X - w, Y - 1, "#9f85cc", w * 2, 2); P(ctx, X - w + 2, Y + 1, "#9f85cc", w * 2 - 4, 1); ctx.globalAlpha = 1;
      const happyAct = D.task?.phase === "act" && ["pot", "tree", "lamp", "boat", "come"].includes(D.task.id);
      const st = D.mode === "held" ? "held" : D.mode === "fling" || D.react > 0 || happyAct ? "happy" : s.state === "talking" ? "idle" : s.state;
      spr.clearRect(0, 0, 48, 44);
      drawOlo(spr, { form: p.form, color: p.color, hair: p.hair, eyes: p.eyes, cheeks: p.cheeks, state: st, t, ox: 8, oy: 8 });
      const [SX, SY] = G.proj(D.x, D.y, D.z);
      ctx.drawImage(sc, Math.round(SX - 24 * D.sx), Math.round(SY - 36 * D.sy), Math.round(48 * D.sx), Math.round(44 * D.sy));
      host.dataset.x = String(Math.round(SX * K)); host.dataset.y = String(Math.round(SY * K));
      if (!bubble.hidden) { const top = SY - 30 * D.sy; bubble.style.left = clamp(c.offsetLeft + SX * K, 90, host.clientWidth - 90) + "px"; bubble.style.top = c.offsetTop + top * K + "px"; }
    } });
    items.sort((a, b) => a.d - b.d);
    host.dataset.order = items.map((i) => i.id).join(",");
    items.forEach((i) => i.draw());
    drawLighting(ctx, RW, RH, L, t, { boost: D.boost, boat: bp });
    fx.forEach((f) => drawFx(ctx, f));
    const hov = D.focus || D.hover;
    if (hov && D.mode === "home" && !D.task) {
      if (hov === "boat") drawMarker(ctx, bp.x, bp.y - 22, t);
      else { const q = propAt(hov), [X, Y] = G.proj(q.x, q.y); drawMarker(ctx, X, Y - q.box[1] - 6, t); }
    }
    syncDoing();
  };

  // ---------- 点一下 / 抓起来扔 / 点道具 ----------
  c.addEventListener("pointerdown", (e) => {
    const [mx, my] = toRoom(e);
    if (!hitTest(mx, my)) { const id = hitSpot(mx, my); if (id) { e.preventDefault(); go(id); } return; }
    e.preventDefault(); c.setPointerCapture?.(e.pointerId);
    endTask(); D.ignore = null;
    D.down = { t: now(), x: e.clientX, y: e.clientY, moved: false };
    setMode("held"); host.dataset.squash = ""; D.goal = null; D.vx = D.vy = D.vz = 0;
    const [wx, wy] = G.unproj(mx, my + 10, 14); D.grab = [D.x - wx, D.y - wy]; D.last = [[now(), D.x, D.y]];
    sfx("select");
  });
  c.addEventListener("pointermove", (e) => {
    const [mx, my] = toRoom(e);
    const onOlo = hitTest(mx, my), spot = !onOlo && D.mode !== "held" ? hitSpot(mx, my) : null;
    D.hover = spot;
    c.style.cursor = D.mode === "held" ? "grabbing" : onOlo ? "grab" : spot ? "pointer" : "";
    if (D.mode !== "held") return;
    if (Math.hypot(e.clientX - D.down.x, e.clientY - D.down.y) > 6) D.down.moved = true;
    const [wx, wy] = G.unproj(mx, my + 10, 14), nx = clamp(wx + D.grab[0], B0, B1), ny = clamp(wy + D.grab[1], B0, B1);
    D.vx = D.vx * 0.5 + (nx - D.x) * 0.5; D.vy = D.vy * 0.5 + (ny - D.y) * 0.5; D.x = nx; D.y = ny;
    D.last.push([now(), D.x, D.y]); if (D.last.length > 6) D.last.shift();
  });
  c.addEventListener("pointerleave", () => { D.hover = null; });
  const release = (e) => {
    if (D.mode !== "held") return;
    c.releasePointerCapture?.(e.pointerId);
    if (!D.down.moved && now() - D.down.t < 350) {
      // 点一下：开心地蹦一下、冒爱心、叫一声、说句话
      setMode("home"); D.z = 0; D.react = 45; sfx("happy"); host.dataset.taps = String(+(host.dataset.taps || 0) + 1);
      say(pick(["嘿嘿。", "痒！", "再戳一下？", "找我呀？"]), 110);
      const [SX, SY] = G.proj(D.x, D.y, D.z); for (let i = 0; i < 3; i++) spawn({ kind: "heart", x: SX - 8 + i * 8, y: SY - 30, vy: -0.35 - i * 0.05, life: 34 });
      if (!REDUCED) { D.vz = 3.2; D.vx = D.vy = 0; D.ss = 0; D.thrown = false; setMode("fling"); D.react = 45; }
      return;
    }
    if (REDUCED) { D.z = 0; D.sx = D.sy = 1; collide(false); setMode("home"); return; }
    const a = D.last[0], b = D.last[D.last.length - 1], dt = Math.max(16, b[0] - a[0]);
    D.vx = clamp(((b[1] - a[1]) / dt) * 16, -0.45, 0.45); D.vy = clamp(((b[2] - a[2]) / dt) * 16, -0.45, 0.45);
    D.vz = 2.2 + Math.hypot(D.vx, D.vy) * 6; D.still = 0; D.ss = 0; D.thrown = true; setMode("fling");
  };
  c.addEventListener("pointerup", release); c.addEventListener("pointercancel", release);
  // 底部去处按钮：悬停/聚焦时在 2.5D 道具头顶画箭头，点按让 olo 跑过去玩
  for (const [id, b] of Object.entries(btns)) {
    b.addEventListener("click", () => go(id));
    b.addEventListener("mouseenter", () => { D.focus = id; });
    b.addEventListener("mouseleave", () => { if (D.focus === id) D.focus = null; });
    b.addEventListener("focus", () => { D.focus = id; });
    b.addEventListener("blur", () => { if (D.focus === id) D.focus = null; });
  }
  $(".room-call").addEventListener("click", () => go("come"));

  let raf = 0, alive = true, iv2 = 0;
  const loop = () => { if (!alive) return; raf = requestAnimationFrame(loop); step(); render(ticker.ft); };
  resize(); addEventListener("resize", resize);
  if (REDUCED) { render(); iv2 = setInterval(() => { step(); render(); }, 200); } else loop();
  const iv = setInterval(relight, 20_000); addEventListener("olo:tz", relight);
  return {
    setState(st) { s.state = st; host.dataset.state = st; },
    stop() { alive = false; cancelAnimationFrame(raf); clearInterval(iv); clearInterval(iv2); removeEventListener("resize", resize); removeEventListener("olo:tz", relight); },
  };
}
