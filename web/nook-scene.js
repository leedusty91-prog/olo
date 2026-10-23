// olo 的小窝（唯一来源）：手机端 apps/mobile/src/nookScene.js 是原样拷贝（server 测试核对一致）。
// 纯函数、无 DOM：输入天色 sky + 逻辑尺寸 + 状态（花的阶段、今日新物、下雨），输出 RGBA 位图层，调用方自己上屏。
// 层：room（固有色 + 光照烘焙，窗里嵌着 sky-scene 的天空）· glow（灯笼/发光书的光晕，单独呼吸）· ball（可以扔的小球）。
// 夜里的光照用 8 级 + 4×4 Bayer 抖动的径向衰减，暖光从灯笼和 olo 身上漫出来，冷光从窗户斜落地板。
// paintScene 由调用方传入（网页 sky-scene.js / 手机 skyScene.js），这样两边文件逐字节相同。
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

function rgba(c) {
  if (c[0] === "#") return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
  const m = c.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
}
const CACHE = new Map();
const col = (c) => { let v = CACHE.get(c); if (!v) { v = rgba(c); CACHE.set(c, v); } return v; };

function canvas(W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  const dot = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const [r, g, b, a] = col(c), i = (y * W + x) * 4, da = d[i + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    d[i] = (r * a + d[i] * da * (1 - a)) / oa; d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa; d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa; d[i + 3] = oa * 255;
  };
  const P = (x, y, c, w = 1, h = 1) => { x = Math.round(x); y = Math.round(y); for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) dot(x + k, y + j, c); };
  const poly = (pts, c, dith) => {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; if ((y + 0.5 >= y1) !== (y + 0.5 >= y2)) xs.push(x1 + ((y + 0.5 - y1) / (y2 - y1)) * (x2 - x1)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) if (!dith || bay(x, y) < dith) dot(x, y, c);
    }
  };
  const ell = (cx, cy, rx, ry, c, dith) => { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1 && (!dith || bay(cx + x, cy + y) < dith)) dot(cx + x, cy + y, c); };
  const blit = (L, sx, sy, w, h, dx, dy) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((sy + y) * L.W + ((sx + x) % L.W)) * 4, a = L.data[s + 3] / 255; if (a > 0) dot(dx + x, dy + y, `rgba(${L.data[s]},${L.data[s + 1]},${L.data[s + 2]},${a.toFixed(3)})`); } };
  return { W, H, data: d, P, poly, ell, blit };
}

// 今日新物：按日期轮换（一天一件，摆在窗台左边）
export const DAILY_ITEMS = [
  { id: "shell", name: "小贝壳", line: "灯籽湾捡的，贴着耳朵能听见很远的水声。" },
  { id: "chime", name: "小风铃", line: "风一吹它就叮一声，像有人在门口打招呼。" },
  { id: "leaf", name: "老灯树的叶子", line: "晚上会微微亮一下，我夹了好久才压平。" },
  { id: "feather", name: "白羽毛", line: "豆灯送信时掉的，它自己都没发现。" },
  { id: "pebble", name: "圆石头", line: "落雾滩上最圆的一颗，摸起来暖暖的。" },
  { id: "star", name: "纸星星", line: "我用晾话廊上掉下来的纸条折的。" },
  { id: "acorn", name: "小橡果", line: "说不定种下去会长出一棵会说话的树。" },
];
export function dailyItem(dayIndex) { return DAILY_ITEMS[((dayIndex % DAILY_ITEMS.length) + DAILY_ITEMS.length) % DAILY_ITEMS.length]; }
// 天气：按日期确定（同一天全天一样），没有网络也能下雨
export function weatherFor(dayIndex) { const h = (Math.imul(dayIndex | 0, 2654435761) >>> 0) % 10; return h < 3 ? "rain" : h < 6 ? "cloudy" : "clear"; }
export const PLANT_NAMES = ["种子", "小芽", "两片叶", "花苞", "开花啦"];

const WALL = "#e8c39a", WALL2 = "#dcb088", WALLD = "#c99572", WOOD = "#a8643a", WOODD = "#7a4026", WOODL = "#c98450", FLOOR = "#b9794a", FLOORD = "#94573a", FLOORL = "#d09060", INK = "#3a1c14";

/** 房间几何（逻辑像素）。H 随屏幕高度变化；可互动的东西都放在屏幕下半、底部聊天条之上（dock 逻辑高度）。 */
export function nookGeometry(W, H, dock = 44) {
  const BACK = Math.round(H * 0.58), L = 10, R = W - 24, F = H - dock - 6; // F：可见地板最下沿
  const win = { x: 16, y: BACK - 56, w: 28, h: 32 };
  const sill = win.y + win.h + 2;
  const shelf = { x: R - 26, y: BACK - 40, w: 22, h: 40 };
  const floorY = (x) => BACK + ((x - R) * 22) / (W - R); // 右侧墙与地板的交线
  const door = { x0: R + 5, x1: R + 18, h: 40 };
  return {
    W, H, BACK, L, R, F, win, sill,
    pot: { x: win.x + 17, y: sill - 6, w: 7, h: 6 },
    item: { x: win.x + 3, y: sill - 6, w: 7, h: 6 },
    shelf,
    book: { x: shelf.x + 13, y: shelf.y + 26, w: 6, h: 10 },
    door: { ...door, yb0: floorY(door.x0), yb1: floorY(door.x1), box: { x: door.x0 - 1, y: Math.round(floorY(door.x0) - door.h), w: door.x1 - door.x0 + 2, h: Math.round(floorY(door.x1) - floorY(door.x0) + door.h) } },
    lamp: { x: 4, y: F - 40, w: 11, h: 40, cx: 9, cy: F - 32 },
    rug: { x: 49, y: F - 14 },
    olo: { x: 49, y: F - 14 },
    bowl: { x: 18, y: F - 8, w: 12, h: 6 },
    ball: { x: 74, y: F - 4, r: 4 },
  };
}

function drawPlant(c, p, stage) {
  const { P } = c, x = p.x, y = p.y;
  P(x, y, "#c0603c", 7, 6); P(x - 1, y, "#d87850", 9, 2); P(x + 1, y + 2, "#a04a30", 1, 3); P(x + 1, y, "#6e3822", 5, 1);
  if (stage === 0) { P(x + 3, y - 1, "#7a4026", 1, 1); return; }
  const stem = [0, 3, 6, 7, 8][stage];
  P(x + 3, y - stem, "#4f7a2c", 1, stem);
  if (stage >= 1) { P(x + 2, y - stem, "#a6d65a", 1, 1); P(x + 4, y - stem, "#a6d65a", 1, 1); }
  if (stage >= 2) { P(x + 1, y - 4, "#a6d65a", 2, 1); P(x + 4, y - 3, "#a6d65a", 2, 1); P(x + 5, y - 4, "#5f9a33"); P(x, y - 5, "#5f9a33"); }
  if (stage === 3) { P(x + 2, y - stem - 2, "#ff9aa8", 3, 2); P(x + 3, y - stem - 3, "#ffd0d6"); }
  if (stage === 4) { for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) P(x + 3 + dx * 2 - 1, y - stem - 3 + dy * 2 - 1, "#ff9aa8", 3, 3); P(x + 2, y - stem - 4, "#ffd36b", 3, 3); P(x + 3, y - stem - 3, "#fff0c8"); }
}

function drawItem(c, p, id) {
  const { P, ell } = c, x = p.x, y = p.y + 5;
  if (id === "shell") { ell(x + 3, y - 2, 3, 2, "#f6c0b0"); P(x + 1, y - 3, "#fff0e0", 1, 1); P(x + 3, y - 4, "#e8907e", 1, 3); P(x + 5, y - 3, "#e8907e", 1, 2); }
  else if (id === "chime") { P(x + 3, y - 12, INK, 1, 4); P(x + 1, y - 8, "#7fb4c7", 5, 2); for (const d of [-2, 0, 2]) P(x + 3 + d, y - 6, "#bfe0dc", 1, 3 + (d === 0 ? 2 : 0)); P(x + 3, y - 1, "#ffc46b", 1, 1); }
  else if (id === "leaf") { ell(x + 3, y - 2, 3, 2, "#ffc46b"); P(x, y - 2, "#c8641f", 6, 1); P(x + 6, y - 1, "#c8641f"); }
  else if (id === "feather") { P(x + 1, y - 1, "#c8d4e0", 1, 1); for (let i = 0; i < 5; i++) P(x + 2 + i, y - 2 - i, "#fffaf0", 1, 2); P(x + 3, y - 2, "#c8d4e0", 3, 1); }
  else if (id === "pebble") { ell(x + 3, y - 2, 3, 2, "#9a8a8a"); P(x + 2, y - 3, "#c8bcb8", 2, 1); }
  else if (id === "star") { P(x + 3, y - 5, "#ffd36b", 1, 5); P(x + 1, y - 3, "#ffd36b", 5, 1); P(x + 2, y - 4, "#ffd36b", 3, 3); P(x + 3, y - 3, "#fff6d0"); }
  else { ell(x + 3, y - 2, 2, 2, "#a8643a"); P(x + 1, y - 5, "#7a4026", 5, 2); P(x + 3, y - 6, "#4f7a2c"); }
}

/**
 * 画整间小窝。opts: { W, H, dock, date, plant(0..4), item(id), weather, away(olo 出门了), seed }
 * 返回 { room, glow, geom, night }：room 已经烘焙好光照；glow 只有夜里灯笼/书本的光晕（透明底）。
 */
export function paintNook(sky, opts, paintScene) {
  const { W, H, dock = 44, date = new Date(), plant = 0, item = "shell", weather = "clear", seed = 9 } = opts;
  const G = nookGeometry(W, H, dock), { BACK, L, R, F, win } = G;
  const night = clamp((sky.lamp ?? sky.star) * 1.15), dusk = clamp(night * 1.6) * (1 - night);
  const c = canvas(W, H), { P, poly, ell } = c;
  const EMIT = [];

  // 地板：透视木板
  const VP = [W / 2, 40];
  P(0, BACK, FLOOR, W, H - BACK);
  for (let i = -6; i <= 16; i++) {
    const xb = L + i * 7, k = (H - VP[1]) / (BACK - VP[1]), xe = VP[0] + (xb - VP[0]) * k;
    for (let y = BACK; y < H; y++) P(xb + ((xe - xb) * (y - BACK)) / (H - BACK), y, FLOORD);
  }
  for (let y = BACK + 5, s = 5, row = 0; y < H; y += s, s += 3, row++) for (let i = -6; i <= 16; i++) {
    if ((i + row) % 3) continue;
    const f = (y - BACK) / (H - BACK), xb = L + i * 7, x0 = xb + (VP[0] + (xb - VP[0]) * ((H - VP[1]) / (BACK - VP[1])) - xb) * f, w = 7 * (1 + f * 1.47);
    P(x0 + 1, y, FLOORD, Math.max(1, w - 1), 1); P(x0 + 1, y + 1, FLOORL, Math.max(1, w - 1), 1);
  }
  // 天花板 + 两侧墙 + 后墙
  P(0, 0, "#8c4c30", W, 22); for (let x = 0; x < W; x += 9) P(x, 12, "#6e3822", 1, 10); P(0, 20, "#6e3822", W, 2);
  poly([[0, 22], [L, 22], [L, BACK], [0, BACK + 16]], WALL2); poly([[R, 22], [W, 22], [W, BACK + 22], [R, BACK]], WALL2);
  P(L, 22, WALL, R - L, BACK - 22);
  for (let x = L + 3; x < R; x += 6) for (let y = 24; y < BACK - 16; y++) if (bay(x, y) < 0.25) P(x, y, WALLD);
  for (let x = L + 3; x < R; x += 12) for (let y = 28; y < BACK - 20; y += 12) P(x + 3 + ((y / 12) % 2) * 6, y, "#f2d3a8");
  P(L, BACK - 14, WOOD, R - L, 14); P(L, BACK - 14, WOODL, R - L, 1); for (let x = L + 4; x < R; x += 8) P(x, BACK - 12, WOODD, 1, 11);
  poly([[0, BACK - 12], [L, BACK - 14], [L, BACK], [0, BACK + 16]], WOOD); P(0, BACK - 13, WOODL, L, 1);
  poly([[R, BACK - 14], [W, BACK - 10], [W, BACK + 22], [R, BACK]], WOOD); for (let x = R; x < W; x++) P(x, BACK - 14 + ((x - R) * 4) / (W - R), WOODL);
  P(L, 22, WALLD, 1, BACK - 22); P(R - 1, 22, WALLD, 1, BACK - 22);
  P(L, BACK, "#6e3822", R - L, 1);

  // 窗：里面是同一套 sky-scene 天空
  const sc = paintScene(sky, { W: win.w * 2, H: win.h + 16, date, seed });
  P(win.x - 3, win.y - 3, WOODD, win.w + 6, win.h + 6); P(win.x - 2, win.y - 2, WOOD, win.w + 4, win.h + 4);
  for (const Ly of [sc.back, sc.cloudsFar, sc.cloudsNear, sc.front, sc.lights]) c.blit(Ly, Math.round(win.w / 2), 8, win.w, win.h, win.x, win.y);
  if (weather === "cloudy" || weather === "rain") for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) if (bay(x, y) < (weather === "rain" ? 0.45 : 0.25)) P(win.x + x, win.y + y, night > 0.5 ? "rgba(40,44,70,.55)" : "rgba(170,180,200,.5)");
  EMIT.push([win.x, win.y, win.w, win.h]);
  P(win.x + win.w / 2 - 1, win.y, WOOD, 2, win.h); P(win.x, win.y + win.h / 2 - 1, WOOD, win.w, 2); P(win.x + 1, win.y + 1, "#fff4dc", 3, 1); P(win.x + 1, win.y + 1, "#fff4dc", 1, 3);
  for (const [cx, dir] of [[win.x - 5, 1], [win.x + win.w + 1, -1]]) for (let y = win.y - 4; y < win.y + win.h + 2; y++) { const sw = y < win.y + 8 ? 5 : 4 - Math.round(Math.sin((y - win.y) / 6)); for (let j = 0; j < sw; j++) P(cx + (dir > 0 ? j : 4 - j), y, j % 2 ? "#d9604e" : "#ec7c60"); }
  P(win.x - 6, win.y - 5, WOODD, win.w + 12, 2);
  P(win.x - 4, G.sill, WOODL, win.w + 8, 2); P(win.x - 4, G.sill + 2, WOODD, win.w + 8, 1);
  drawPlant(c, G.pot, plant);
  drawItem(c, G.item, item);

  // 矮书柜（发光的那本是今天的传说）
  const S = G.shelf;
  P(S.x + S.w, S.y + 2, WOODD, 2, S.h - 2); P(S.x, S.y, WOOD, S.w, S.h); P(S.x, S.y, WOODL, S.w, 1); P(S.x + 2, S.y + 2, "#5a2c1a", S.w - 4, S.h - 4);
  const SP = ["#c4545e", "#4f7fa0", "#6cbfa0", "#f0973a", "#cf82a0", "#ffc46b", "#7a4026", "#a6d65a"];
  for (let s = 0; s < 3; s++) {
    const sy = S.y + 2 + s * 12; P(S.x + 1, sy + 10, WOODL, S.w - 2, 2);
    let x = S.x + 3, n = s * 5 + 1;
    while (x < S.x + S.w - 4) { const w = 2 + (n % 2), h = 6 + ((n * 7) % 4); if (s === 2 && x > S.x + 10) break; P(x, sy + 10 - h, SP[n % 8], w, h); P(x, sy + 12 - h, "rgba(255,255,255,.35)", w, 1); x += w + (n % 3 === 0 ? 1 : 0); n++; }
  }
  const B = G.book; P(B.x, B.y - 2, "#f6e3b0", 6, 8); P(B.x + 1, B.y, "#c8641f", 4, 1); P(B.x + 1, B.y + 3, "#c8641f", 3, 1);
  EMIT.push([B.x, B.y - 2, 6, 8]);
  P(S.x + 4, S.y - 6, "#6cbfa0", 5, 6); P(S.x + 3, S.y - 7, "#a8e0bd", 7, 2); P(S.x + 14, S.y - 4, "#ffc46b", 4, 4);

  // 门：右侧墙上一扇真正的门（平行四边形，跟着透视）
  const D = G.door;
  const doorPoly = (inset, cl) => poly([[D.x0 + inset, D.yb0 - D.h + inset], [D.x1 - inset, D.yb1 - D.h + inset], [D.x1 - inset, D.yb1], [D.x0 + inset, D.yb0]], cl);
  doorPoly(-1, WOODD); doorPoly(0, "#8a4a2c"); doorPoly(2, opts.away ? "#2a1430" : "#b06a3e");
  if (!opts.away) {
    for (let x = D.x0 + 3; x < D.x1 - 2; x += 4) { const t = (x - D.x0) / (D.x1 - D.x0), yb = D.yb0 + (D.yb1 - D.yb0) * t; P(x, yb - D.h + 5, "#8a4a2c", 1, D.h - 8); }
    const kx = D.x1 - 4, ky = D.yb0 + (D.yb1 - D.yb0) * 0.8 - D.h / 2; P(kx, ky, "#ffd36b", 2, 2);
    const wy = D.yb0 + (D.yb1 - D.yb0) * 0.5 - D.h + 7; P(D.x0 + 5, wy, "#7fb4c7", 4, 4); P(D.x0 + 5, wy, "#bfe0dc", 2, 1); // 门上的小圆窗
  } else EMIT.push([D.x0 + 2, Math.round(D.yb0 - D.h + 2), D.x1 - D.x0 - 4, D.h]);
  P(D.x0 - 2, D.yb0 + 1, "#6e3822", D.x1 - D.x0 + 4, 1);

  // 落地灯笼（左前方）
  const LP = G.lamp, lit = opts.lamp ?? night > 0.3;
  P(LP.cx - 3, F - 2, "#6e3822", 7, 2); P(LP.cx, LP.y + 14, INK, 1, F - LP.y - 15);
  P(LP.cx - 1, LP.y + 2, INK, 3, 1); P(LP.cx, LP.y, INK, 1, 2);
  P(LP.cx - 3, LP.y + 3, "#7a2c20", 7, 1); ell(LP.cx, LP.y + 8, 4, 4, lit ? "#ff9a5a" : "#d9504a"); P(LP.cx - 3, LP.y + 12, "#7a2c20", 7, 1);
  for (let y = LP.y + 5; y < LP.y + 12; y += 3) P(LP.cx - 4, y, lit ? "#ffc070" : "#b8403a", 9, 1);
  if (lit) EMIT.push([LP.cx - 4, LP.y + 4, 9, 9]);

  // 地毯 + 坐垫
  const RG = G.rug;
  ell(RG.x, RG.y, 30, 9, "#c4545e"); ell(RG.x, RG.y, 27, 8, "#e88a6e"); ell(RG.x, RG.y, 22, 6, "#c4545e"); ell(RG.x, RG.y, 19, 5, "#f2b9a0", 0.5); ell(RG.x, RG.y, 16, 4, "#e88a6e");
  ell(RG.x, RG.y - 1, 12, 3, "#6b3a5a"); ell(RG.x, RG.y - 2, 11, 2, "#9a5a86"); P(RG.x - 8, RG.y - 3, "#c78ab0", 4, 1);
  // 小碗（里面是网页里那种小包子——olo 不吃饭，只是爱闻）
  const BW = G.bowl;
  ell(BW.x + 6, BW.y + 5, 8, 2, "rgba(60,20,10,.35)"); poly([[BW.x, BW.y], [BW.x + 12, BW.y], [BW.x + 10, BW.y + 5], [BW.x + 2, BW.y + 5]], "#4f7fa0"); P(BW.x, BW.y, "#7fb4c7", 12, 1); P(BW.x + 3, BW.y + 2, "#fff0c8", 6, 1);
  P(BW.x + 2, BW.y - 2, "#fff4e0", 4, 2); P(BW.x + 6, BW.y - 3, "#ffe2b0", 4, 3); P(BW.x + 7, BW.y - 3, "#f0973a", 1, 1);

  // ---------- 光照烘焙 ----------
  const d = c.data, inR = (x, y, r) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
  const lampG = (x, y) => clamp(1 - Math.hypot(x - LP.cx, (y - (LP.y + 8)) * 0.8) / 78);
  const oloG = (x, y) => clamp(1 - Math.hypot(x - G.olo.x, (y - G.olo.y + 8) * 1.4) / 34);
  const LV = 8; // 8 级光阶 + Bayer：夜里过渡细腻，不出硬圈
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (EMIT.some((r) => inR(x, y, r))) continue;
    const i = (y * W + x) * 4, depth = clamp((y - 22) / (H - 22));
    let m = [1 - depth * 0.05, 1 - depth * 0.06, 1 - depth * 0.04], add = [0, 0, 0];
    if (x < L || x >= R) m = m.map((v) => v * 0.9);
    // 白天：窗光斜落到地板（平行四边形光斑，边缘抖动）
    const day = 1 - night;
    if (day > 0.05 && weather !== "rain") {
      const fy = y - BACK, x0 = win.x - 6 + fy * 0.55, x1 = win.x + win.w + 8 + fy * 0.9;
      if (fy > 0 && fy < 46 && x > x0 && x < x1) { const e = Math.min(fy, 46 - fy, x - x0, x1 - x); if (e > 2 || bay(x, y) < 0.5) add = [40 * day, 28 * day, 6 * day].map((v) => (dusk > 0.2 ? v * 1.2 : v)); }
    }
    if (night > 0) {
      const g = Math.min(1, lampG(x, y) ** 2 * 1.35 * (lit ? 1 : 0.15) + oloG(x, y) * 0.5 * (opts.away ? 0 : 1));
      const lv = Math.floor(g * LV + bay(x, y) * 0.999) / LV;
      const nm = [0.36 + lv * 0.88, 0.34 + lv * 0.62, 0.56 + lv * 0.16];
      m = m.map((v, k) => v * (1 - night) + nm[k] * night);
      const fy = y - BACK, inBeam = fy > 0 && fy < 36 && x > win.x + fy * 0.5 && x < win.x + win.w + fy * 0.8;
      if (inBeam && bay(x, y) < 0.5 && lv < 0.4) add = [6 * night, 10 * night, 26 * night];
    }
    if (dusk > 0) m = [m[0] * (1 + dusk * 0.06), m[1] * (1 - dusk * 0.04), m[2] * (1 - dusk * 0.08)];
    for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * m[k] + add[k];
  }

  // 光晕层（单独呼吸）
  const glow = canvas(W, H);
  if (lit) for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) { const r = Math.hypot(x, y); if (r > 5 && r < 16 && bay(LP.cx + x, LP.y + 8 + y) < 0.4 * (1 - r / 16)) glow.P(LP.cx + x, LP.y + 8 + y, "rgba(255,190,110,.6)"); }
  for (let y = -5; y <= 10; y++) for (let x = -4; x <= 9; x++) if (!inR(B.x + x, B.y + y, [B.x, B.y - 2, 6, 8]) && bay(B.x + x, B.y + y) < 0.28) glow.P(B.x + x, B.y + y, "rgba(255,230,150,.5)");
  return { room: { W, H, data: c.data }, glow: { W, H, data: glow.data }, geom: G, night };
}

/** 可以扔的小球（11×11，中心在 5,5）；夜里压暗一点 */
export function paintBall(night = 0) {
  const c = canvas(11, 11);
  c.ell(5, 5, 4, 4, "#ee8a7e"); for (let y = -4; y <= 4; y++) c.P(4, 5 + y, "#fff0c8"); c.P(2, 3, "#ffbfa3"); c.P(3, 2, "#fffaf0");
  if (night > 0) for (let i = 0; i < c.data.length; i += 4) { c.data[i] *= 1 - night * 0.45; c.data[i + 1] *= 1 - night * 0.5; c.data[i + 2] *= 1 - night * 0.3; }
  return { W: 11, H: 11, data: c.data };
}

/** 明信片画面 64×40：sky-scene 的天 + 地点前景（广场灯串 / 湖面倒影 / 屋顶瓦片） */
export function paintPostcard(sky, place, paintScene, seed = 12) {
  const W = 64, H = 40, c = canvas(W, H), s = paintScene(sky, { W, H, seed });
  for (const Ly of [s.back, s.cloudsNear]) c.blit(Ly, 0, 0, W, H, 0, 0);
  const dark = clamp(sky.star);
  if (place === "lake") {
    for (let y = 26; y < H; y++) for (let x = 0; x < W; x++) c.P(x, y, y % 3 === 0 && bay(x, y) < 0.35 && Math.sin(x * 0.3 + y * 2) > 0.2 ? "#f0a070" : y < 33 ? "#a0506a" : "#6a3458");
    for (let x = 0; x < W; x++) { const h = Math.round(4 + 3 * Math.sin(x * 0.15) + 2 * Math.sin(x * 0.41)); c.P(x, 26 - h, "#3a2040", 1, h); }
    c.P(38, 23, "#ffd88a", 6, 1); c.P(37, 24, "#ffd88a", 8, 1); c.P(40, 21, "#3a2040", 1, 2);
  } else if (place === "roof") {
    for (let y = 24; y < H; y++) for (let x = 0; x < W; x++) { const row = Math.floor((y - 24) / 3); c.P(x, y, (x + row * 2) % 6 === 0 || (y - 24) % 3 === 0 ? "#6e3822" : row % 2 ? "#c4545e" : "#a8443e"); }
    c.P(48, 14, "#7a4026", 5, 10); c.P(47, 13, "#5a2c1a", 7, 2); for (let i = 0; i < 4; i++) c.P(50 + (i % 2), 11 - i * 2, "rgba(255,240,220,.5)", 2, 2);
    c.P(14, 8, "#fff6d0"); c.P(13, 9, "#fff6d0", 3, 1); c.P(14, 10, "#fff6d0");
  } else {
    c.P(0, 30, "#c99572", W, 10); for (let x = 0; x < W; x += 6) for (let y = 30; y < H; y += 4) c.P(x + ((y / 4) % 2) * 3, y, "#b08060", 5, 1);
    for (const sx of [6, 44]) { c.P(sx, 18, "#7a4026", 14, 12); c.P(sx - 1, 16, sx === 6 ? "#4f7fa0" : "#c4545e", 16, 3); for (let x = sx; x < sx + 16; x += 4) c.P(x, 19, "#fff0c8", 2, 1); }
    for (let x = 0; x < W; x++) { const y = 8 + Math.round(Math.sin((x / W) * Math.PI) * 6); c.P(x, y, "#3a1c14"); if (x % 7 === 3) { c.P(x - 1, y + 1, dark > 0.3 ? "#ffd36b" : "#f0973a", 3, 3); } }
  }
  return { W, H, data: c.data };
}
