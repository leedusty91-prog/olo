// 聊天背景（唯一来源）：网页 app.js 和手机端 apps/mobile/src/chatBg.js 共用（手机端原样拷贝，server 测试核对一致）。
// 纯函数、无 DOM：一幅随时间变化的暖色像素风景——天空/日月星云沿用 sky-scene.js 的 paintScene（由调用方传入，免得两边 import 路径不同），
// 远处倒影小镇的屋顶，近处起伏的草坡、开着灯的小屋、暖色的树、蜿蜒小路和路灯笼。
// 清晨桃粉、白天暖金、黄昏琥珀、夜里深蓝配暖窗灯；聊天气泡那一栏垫一层暖色柔光，保证字清楚。
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// 地景配色：按小时插值，全部暖色系（白天是橄榄金草坡，不用灰绿）
const NIGHT = { grade: [70, 64, 140], gradeA: 0.22, far: [62, 52, 104], mid: [50, 40, 88], near: [40, 30, 70], grass: [58, 46, 92], hl: [96, 82, 140], path: [104, 84, 128], wall: [92, 76, 120], roof: [116, 58, 82], leaf: [50, 46, 92], leaf2: [74, 66, 120], trunk: [38, 24, 44], flower: [200, 150, 190] };
const DAWN = { grade: [255, 170, 160], gradeA: 0.2, far: [222, 158, 168], mid: [204, 136, 128], near: [180, 112, 96], grass: [200, 146, 104], hl: [255, 206, 170], path: [246, 204, 170], wall: [255, 222, 196], roof: [204, 96, 88], leaf: [212, 116, 98], leaf2: [246, 164, 120], trunk: [112, 60, 58], flower: [255, 236, 240] };
const DAY = { grade: [255, 214, 140], gradeA: 0.28, far: [214, 190, 128], mid: [190, 172, 84], near: [168, 148, 64], grass: [206, 182, 86], hl: [250, 230, 150], path: [246, 220, 168], wall: [255, 238, 204], roof: [200, 92, 62], leaf: [212, 132, 58], leaf2: [246, 186, 84], trunk: [122, 74, 46], flower: [255, 250, 230] };
const DUSK = { grade: [255, 150, 80], gradeA: 0.26, far: [206, 112, 100], mid: [180, 90, 72], near: [146, 66, 58], grass: [180, 104, 64], hl: [255, 180, 110], path: [238, 164, 112], wall: [248, 192, 150], roof: [170, 68, 60], leaf: [196, 88, 56], leaf2: [236, 136, 72], trunk: [92, 46, 40], flower: [255, 220, 170] };
const KEYS = [[0, NIGHT], [5, NIGHT], [6.6, DAWN], [8.6, DAY], [16.2, DAY], [18.4, DUSK], [20, NIGHT], [24, NIGHT]];

export function landPalette(hour) {
  let i = 0; while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1], f = clamp((hour - h0) / (h1 - h0)), s = f * f * (3 - 2 * f), o = {};
  for (const k in a) o[k] = typeof a[k] === "number" ? a[k] + (b[k] - a[k]) * s : mix(a[k], b[k], s);
  return o;
}

/** 0 白天 … 1 夜里：决定柔光底色和字色 */
export function chatDarkness(sky) { return clamp((sky.star - 0.15) / 0.6); }
/** 背景上的小字（时间戳、空状态）用色 */
export function chatInk(dark) { return dark ? [255, 240, 214] : [52, 24, 16]; }

function wave(x, W, s, amp, f) { const u = (x / W) * Math.PI * 2; return (Math.sin(u * f + s) * 0.6 + Math.sin(u * f * 2.2 + s * 1.9) * 0.28 + Math.sin(u * f * 5.1 + s * 3.3) * 0.08) * amp; }

/**
 * opts: { W, H, paintScene, date, seed=5, col:[x0,x1] 气泡栏（像素），scrim=1 }
 * 返回 { W, H, data, dark, base:[r,g,b]（气泡栏平均色）, motes:[{x,y,c,a}] }
 */
export function paintChatScene(sky, { W, H, paintScene, date = new Date(), seed = 5, col = null, scrim = 1 }) {
  const d = new Uint8ClampedArray(W * H * 4);
  const P = landPalette(sky.hour), lamp = clamp(sky.lamp), dk = chatDarkness(sky);
  const U = Math.min(W, H);
  const set = (x, y, c, a = 1) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a; d[i + 3] = 255; };
  const glow = (cx, cy, r, c, a) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) { const g = clamp(1 - Math.hypot(x - cx, y - cy) / r); const lv = Math.floor(g * 4 + bay(x, y) * 0.999) / 4; if (lv > 0) set(x, y, c, lv * a); } };

  // 1) 天空 + 远景（paintScene 画在上部 68% 高，地平线落在约一半处），整体朝当时的暖色调一点
  const SH = Math.round(H * 0.7), sc = paintScene(sky, { W, H: SH, date, seed: 7 });
  const comp = (L, ox = 0, a = 1) => { for (let y = 0; y < Math.min(L.H, SH); y++) for (let x = 0; x < W; x++) { const i = (y * L.W + ((x + ox) % L.W)) * 4, al = (L.data[i + 3] / 255) * a; if (al > 0) set(x, y, [L.data[i], L.data[i + 1], L.data[i + 2]], al); } };
  comp(sc.back); comp(sc.cloudsFar, Math.round(W * 0.3), 0.9); comp(sc.cloudsNear, Math.round(W * 0.7)); comp(sc.front);
  for (let y = 0; y < SH; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; set(x, y, mix([d[i], d[i + 1], d[i + 2]], P.grade, 0.5), P.gradeA); }
  if (sc.hasLights) comp(sc.lights, 0, clamp(lamp * 1.2));
  for (let y = SH; y < H; y++) for (let x = 0; x < W; x++) set(x, y, P.near);

  // 2) 三层起伏的草坡：顶上一道受光的亮边，往下抖动变深
  const hills = [[0.5, P.far, 0.035, 1.3, 11], [0.6, P.mid, 0.05, 1.7, 23], [0.76, P.near, 0.06, 1.1, 37]];
  const tops = [];
  hills.forEach(([base, c, amp, f, s], li) => {
    const top = []; for (let x = 0; x < W; x++) top.push(Math.round(H * base + wave(x, W, s + seed, H * amp, f)));
    tops.push(top);
    for (let x = 0; x < W; x++) for (let y = top[x]; y < H; y++) {
      const dy = y - top[x];
      let cc = dy < 1 ? mix(c, P.hl, 0.55) : dy < 3 && bay(x, y) < 0.5 ? mix(c, P.hl, 0.3) : c;
      const deep = clamp((dy / (H * 0.25)) * 0.35); if (bay(x, y) < deep) cc = mix(cc, [40, 20, 40], 0.18);
      if (li > 0 && hash(x, y, s) < 0.05) cc = mix(cc, P.hl, 0.25); // 草叶颗粒
      set(x, y, cc);
    }
  });
  const topAt = (li, x) => tops[li][clamp(Math.round(x), 0, W - 1)];

  // 3) 树：圆冠，左上受光、右下背光，带树干；远坡上是一排小树
  const tree = (cx, by, r) => {
    for (let y = 0; y < r * 0.9; y++) set(cx, by - y, P.trunk), set(cx + 1, by - y, mix(P.trunk, [0, 0, 0], 0.2));
    const cy = by - r * 1.3;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r + 1; x++) {
      const dx = x - cx, dy = y - cy, rr = r * (0.92 + 0.12 * hash(x >> 1, y >> 1, seed));
      if (dx * dx + dy * dy > rr * rr) continue;
      const lit = (-dx - dy) / (r * 1.4);
      let c = lit > 0.35 ? P.leaf2 : lit > 0.05 && bay(x, y) < 0.5 ? P.leaf2 : lit < -0.45 ? mix(P.leaf, [30, 10, 30], 0.3) : P.leaf;
      if (hash(x, y, seed + 9) < 0.06) c = mix(c, P.hl, 0.4);
      set(x, y, c);
    }
  };
  for (let k = 0; k < Math.round(W / 9); k++) { const x = hash(k, 1, seed) * W; tree(x, topAt(0, x) + 1, Math.max(1.5, U * 0.018)); }

  // 4) 小屋：中坡右侧，暖色墙、红屋顶、烟囱，夜里窗子亮起来
  const s = Math.max(9, Math.round(U * 0.2)), hx = Math.round(W * 0.7), hy = topAt(1, hx) + Math.round(s * 0.15);
  const ww = s, wh = Math.round(s * 0.62), x0 = hx - (ww >> 1), y0 = hy - wh;
  for (let y = y0; y < hy; y++) for (let x = x0; x < x0 + ww; x++) set(x, y, x > x0 + ww * 0.72 ? mix(P.wall, [60, 20, 40], 0.18) : (y - y0) % 3 === 2 && bay(x, y) < 0.3 ? mix(P.wall, P.trunk, 0.2) : P.wall);
  const rh = Math.round(s * 0.5);
  for (let y = 0; y <= rh; y++) { const half = (ww / 2 + 2) * (y / rh); for (let x = Math.floor(hx - half); x <= hx + half; x++) set(x, y0 - rh + y, y === rh || x <= hx - half + 1 ? mix(P.roof, [40, 10, 20], 0.3) : (x + y) % 4 === 0 ? mix(P.roof, P.hl, 0.25) : P.roof); }
  for (let y = 0; y < rh * 0.7; y++) for (let x = 0; x < 2; x++) set(hx + ww * 0.25 + x, y0 - rh * 0.55 - y, mix(P.wall, P.trunk, 0.5));
  if (lamp < 0.6) for (let k = 0; k < 4; k++) set(hx + ww * 0.25 + k * 0.7, y0 - rh * 1.35 - k * 1.6, mix(P.hl, [255, 255, 255], 0.4), 0.45 - k * 0.08);
  const win = [255, 196, 104], winOff = mix(P.wall, [60, 50, 90], 0.45);
  for (const wx of [x0 + Math.round(ww * 0.18), x0 + Math.round(ww * 0.62)]) {
    const wsz = Math.max(2, Math.round(s * 0.16));
    for (let y = 0; y < wsz; y++) for (let x = 0; x < wsz; x++) set(wx + x, y0 + Math.round(wh * 0.25) + y, mix(winOff, (x + y) % 3 ? win : [255, 230, 160], clamp(lamp * 1.4 + 0.15)));
    if (lamp > 0.15) glow(wx + wsz / 2, y0 + wh * 0.25 + wsz / 2, s * 0.45, win, 0.35 * lamp);
  }
  const door = [x0 + Math.round(ww * 0.42), Math.max(2, Math.round(s * 0.18))];
  for (let y = hy - Math.round(wh * 0.55); y < hy; y++) for (let x = door[0]; x < door[0] + door[1]; x++) set(x, y, mix(P.trunk, win, lamp * 0.5));

  // 5) 蜿蜒小路：从画面底部中间绕到小屋门口，近宽远窄，边缘抖动，夹几颗石子
  const doorX = door[0] + door[1] / 2;
  for (let t = 0; t <= 1; t += 0.5 / H) {
    const y = H - (H - hy) * t, x = W * 0.42 + (doorX - W * 0.42) * t + Math.sin(t * Math.PI * 1.6) * W * 0.16 * (1 - t);
    const w = W * 0.12 * (1 - t) + s * 0.12;
    for (let dx = -w; dx <= w; dx++) { const e = 1 - Math.abs(dx) / w, X = Math.round(x + dx), Y = Math.round(y); if (e < 0.2 && bay(X, Y) > e * 5) continue; set(X, Y, hash(X, Y, seed + 3) < 0.06 ? mix(P.path, P.trunk, 0.35) : e < 0.3 ? mix(P.path, P.near, 0.3) : P.path); }
  }

  // 6) 野花和草丛（近坡）
  const fl = [P.flower, [255, 170, 150], [255, 214, 110]];
  for (let k = 0; k < Math.round((W * H) / 70); k++) { const x = Math.floor(hash(k, 3, seed) * W), y = Math.floor(hash(k, 4, seed) * H); if (y < topAt(2, x) + 2) continue; set(x, y, mix(fl[k % 3], P.near, dk * 0.5)); if (k % 2) set(x, y + 1, mix(P.near, P.hl, 0.3)); }
  // 近处大树（左右各一，压住画面）
  tree(W * 0.1, topAt(2, W * 0.1) + s * 0.35, Math.max(4, U * 0.09));
  tree(W * 0.94, topAt(1, W * 0.94) + 2, Math.max(3, U * 0.06));
  tree(W * 0.27, topAt(1, W * 0.27) + 2, Math.max(3, U * 0.05));

  // 7) 路边灯笼：白天是红纸灯笼，傍晚以后点亮，带一圈暖光
  for (const [t, side] of [[0.18, 1], [0.48, -1], [0.78, 1]]) {
    const y = H - (H - hy) * t, x = W * 0.42 + (doorX - W * 0.42) * t + Math.sin(t * Math.PI * 1.6) * W * 0.16 * (1 - t) + side * (W * 0.12 * (1 - t) + s * 0.5);
    const ph = Math.max(4, Math.round(s * (0.9 - t * 0.5)));
    for (let k = 0; k < ph; k++) set(x, y - k, P.trunk);
    set(x + side, y - ph, P.trunk);
    const lc = mix([210, 80, 60], [255, 190, 90], lamp), lx = x + side * 2, ly = y - ph + 2;
    if (lamp > 0.1) glow(lx, ly, Math.max(3, s * 0.5 * (1 - t * 0.4)), [255, 180, 90], 0.4 * lamp);
    for (let yy = -1; yy <= 2; yy++) for (let xx = -1; xx <= 1; xx++) set(lx + xx, ly + yy, yy === -1 || yy === 2 ? mix(lc, [40, 16, 20], 0.45) : xx === 0 ? mix(lc, [255, 240, 200], 0.2 + lamp * 0.6) : lc);
  }

  // 8) 气泡栏的暖色柔光：两侧抖动淡出，白天奶油色，夜里暖紫
  const sc2 = mix([255, 238, 208], [40, 26, 54], dk), sa = (0.34 + dk * 0.1) * scrim;
  const [c0, c1] = col || [-8, W + 8], fade = Math.max(3, Math.round((c1 - c0) * 0.08));
  const sum = [0, 0, 0]; let n = 0;
  for (let y = 0; y < H; y++) for (let x = Math.max(0, c0); x < Math.min(W, c1); x++) {
    const e = Math.min(x - c0, c1 - 1 - x) / fade, lv = e >= 1 ? 1 : Math.floor((e + bay(x, y) * 0.999) * 3) / 3;
    if (lv > 0) set(x, y, sc2, sa * lv);
    if (e >= 1) { const i = (y * W + x) * 4; sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; n++; }
  }
  // 9) 会动的小光点：夜里萤火（草坡上），白天飘的花粉
  const motes = [], night = dk > 0.5;
  for (let k = 0; k < Math.round(W / 8) + 6; k++) { const x = hash(k, 7, seed) * W, y = H * (night ? 0.55 + 0.4 * hash(k, 8, seed) : 0.2 + 0.7 * hash(k, 8, seed)); motes.push({ x, y, c: night ? [255, 214, 110] : [255, 240, 190], a: night ? 0.95 : 0.6 }); }
  return { W, H, data: d, dark: night, base: sum.map((v) => Math.round(v / Math.max(1, n))), motes };
}

/** WCAG 对比度 */
export function contrast(a, b) {
  const L = (c) => { const [r, g, bb] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
