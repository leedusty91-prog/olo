// 聊天背景（唯一来源）：网页 app.js 和手机端 apps/mobile/src/chatBg.js 共用（手机端原样拷贝，server 测试核对一致）。
// 纯函数、无 DOM：倒影国粉彩像素风景——奶油/蜜桃天空、薄荷绿水面与倒影、薰衣草树冠、柔亮小屋顶；雨往天上落。
// 清晨蜜桃、白天奶油青、黄昏浅杏、夜里淡紫也不发黑；聊天气泡栏垫一层奶油柔光，保证字清楚。
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// 地景：粉彩倒影国（蜜桃天空、薄荷水面、薰衣草树），夜里也提亮，不走秋黄昏橘褐
const NIGHT = { grade: [186, 176, 230], gradeA: 0.18, far: [168, 162, 210], mid: [148, 154, 200], near: [126, 138, 186], grass: [132, 168, 176], hl: [210, 214, 246], path: [198, 188, 220], wall: [214, 206, 236], roof: [186, 150, 210], leaf: [150, 168, 210], leaf2: [186, 198, 236], trunk: [120, 108, 156], flower: [230, 190, 230], water: [140, 168, 210], water2: [176, 198, 230] };
const DAWN = { grade: [255, 214, 204], gradeA: 0.22, far: [236, 198, 210], mid: [214, 186, 198], near: [190, 168, 176], grass: [186, 214, 198], hl: [255, 236, 228], path: [246, 224, 214], wall: [255, 240, 230], roof: [236, 176, 186], leaf: [198, 186, 230], leaf2: [222, 210, 246], trunk: [168, 140, 168], flower: [255, 220, 230], water: [170, 214, 214], water2: [210, 236, 232] };
const DAY = { grade: [255, 240, 220], gradeA: 0.2, far: [214, 226, 230], mid: [186, 214, 210], near: [168, 198, 190], grass: [168, 214, 196], hl: [246, 250, 236], path: [236, 226, 210], wall: [255, 248, 236], roof: [214, 176, 186], leaf: [186, 198, 230], leaf2: [210, 222, 246], trunk: [156, 140, 176], flower: [255, 228, 236], water: [150, 214, 214], water2: [198, 236, 230] };
const DUSK = { grade: [255, 214, 196], gradeA: 0.22, far: [230, 198, 206], mid: [210, 176, 186], near: [190, 158, 168], grass: [186, 198, 186], hl: [255, 230, 210], path: [246, 214, 198], wall: [255, 236, 220], roof: [214, 150, 168], leaf: [198, 176, 214], leaf2: [230, 198, 230], trunk: [156, 120, 148], flower: [255, 220, 214], water: [170, 198, 214], water2: [210, 222, 236] };
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
export function chatInk(dark) { return dark ? [255, 244, 230] : [62, 48, 96]; }


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

  // 1) 天空（paintScene 上部），整体朝粉彩抬一点；去掉重暗角感
  const SH = Math.round(H * 0.58), sc = paintScene(sky, { W, H: SH, date, seed: 7 });
  const comp = (L, ox = 0, a = 1) => { for (let y = 0; y < Math.min(L.H, SH); y++) for (let x = 0; x < W; x++) { const i = (y * L.W + ((x + ox) % L.W)) * 4, al = (L.data[i + 3] / 255) * a; if (al > 0) set(x, y, [L.data[i], L.data[i + 1], L.data[i + 2]], al); } };
  comp(sc.back); comp(sc.cloudsFar, Math.round(W * 0.3), 0.85); comp(sc.cloudsNear, Math.round(W * 0.7));
  // 远景屋顶剪影提亮成薰衣草色，不叠黑山
  for (let y = Math.round(SH * 0.62); y < SH; y++) for (let x = 0; x < W; x++) {
    const i = (y * sc.front.W + x) * 4, a = sc.front.data[i + 3] / 255;
    if (a > 0.2) set(x, y, mix([sc.front.data[i], sc.front.data[i + 1], sc.front.data[i + 2]], P.far, 0.55), a * 0.85);
  }
  if (sc.hasLights) comp(sc.lights, 0, clamp(lamp * 1.1));
  for (let y = 0; y < SH; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; set(x, y, mix([d[i], d[i + 1], d[i + 2]], P.grade, 0.45), P.gradeA * 0.85); }

  // 2) 薄荷水面：占中下部，带倒影波纹与亮线（倒影国的镜面）
  const waterTop = Math.round(H * 0.52);
  for (let y = waterTop; y < H; y++) {
    const k = (y - waterTop) / (H - waterTop);
    const base = mix(P.water2, P.water, k);
    for (let x = 0; x < W; x++) {
      const ripple = Math.sin(x * 0.18 + y * 0.07 + seed) * 0.5 + Math.sin(x * 0.07 + seed * 2) * 0.3;
      let c = mix(base, P.hl, clamp(0.15 + ripple * 0.12));
      if ((x + y * 3 + seed) % 17 === 0) c = mix(c, [255, 250, 246], 0.55);
      if (bay(x, y) < 0.12 * (1 - k)) c = mix(c, P.leaf2, 0.25);
      set(x, y, c);
    }
  }
  // 岸线：水面上方一条起伏的薄荷草坡
  const shore = [];
  for (let x = 0; x < W; x++) shore.push(Math.round(waterTop - 2 + wave(x, W, seed + 2, H * 0.02, 1.4)));
  for (let x = 0; x < W; x++) {
    const top = shore[x];
    for (let y = top; y < waterTop + 2; y++) set(x, y, y === top ? mix(P.grass, P.hl, 0.45) : P.grass);
    // 近岸浅滩
    for (let y = waterTop; y < waterTop + 4; y++) if (bay(x, y) < 0.55) set(x, y, mix(P.water2, P.path, 0.35));
  }

  // 3) 薰衣草 / 薄荷圆冠树（左右压边，水面后一排小树）
  const tree = (cx, by, r, lav = 0.5) => {
    for (let y = 0; y < r * 0.85; y++) set(cx, by - y, P.trunk), set(cx + 1, by - y, mix(P.trunk, [40, 30, 60], 0.15));
    const cy = by - r * 1.25, leafA = mix(P.leaf, P.grass, 1 - lav), leafB = mix(P.leaf2, P.hl, 0.3);
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r + 1; x++) {
      const dx = x - cx, dy = y - cy, rr = r * (0.92 + 0.12 * hash(x >> 1, y >> 1, seed));
      if (dx * dx + dy * dy > rr * rr) continue;
      const lit = (-dx - dy) / (r * 1.4);
      let c = lit > 0.3 ? leafB : lit < -0.4 ? mix(leafA, [80, 70, 120], 0.2) : leafA;
      if (hash(x, y, seed + 9) < 0.05) c = mix(c, P.flower, 0.5);
      set(x, y, c);
    }
  };
  for (let k = 0; k < Math.round(W / 11); k++) { const x = hash(k, 1, seed) * W; tree(x, shore[clamp(Math.round(x), 0, W - 1)] + 1, Math.max(1.5, U * 0.016), 0.4 + hash(k, 2, seed) * 0.5); }

  // 4) 对岸柔亮小屋（奶油墙、桃色屋顶），夜里窗灯暖一点但不压暗整幅
  const s = Math.max(8, Math.round(U * 0.16)), hx = Math.round(W * 0.68), hy = shore[hx] + Math.round(s * 0.1);
  const ww = s, wh = Math.round(s * 0.55), x0 = hx - (ww >> 1), y0 = hy - wh;
  for (let y = y0; y < hy; y++) for (let x = x0; x < x0 + ww; x++) set(x, y, x > x0 + ww * 0.72 ? mix(P.wall, P.trunk, 0.12) : P.wall);
  const rh = Math.round(s * 0.42);
  for (let y = 0; y <= rh; y++) { const half = (ww / 2 + 2) * (y / rh); for (let x = Math.floor(hx - half); x <= hx + half; x++) set(x, y0 - rh + y, y === rh || x <= hx - half + 1 ? mix(P.roof, [120, 60, 90], 0.2) : (x + y) % 4 === 0 ? mix(P.roof, P.hl, 0.3) : P.roof); }
  const win = [255, 214, 160], winOff = mix(P.wall, [120, 110, 160], 0.35);
  for (const wx of [x0 + Math.round(ww * 0.18), x0 + Math.round(ww * 0.58)]) {
    const wsz = Math.max(2, Math.round(s * 0.14));
    for (let y = 0; y < wsz; y++) for (let x = 0; x < wsz; x++) set(wx + x, y0 + Math.round(wh * 0.28) + y, mix(winOff, (x + y) % 3 ? win : [255, 236, 200], clamp(lamp * 1.3 + 0.2)));
    if (lamp > 0.12) glow(wx + wsz / 2, y0 + wh * 0.28 + wsz / 2, s * 0.4, win, 0.28 * lamp);
  }
  // 水面倒影：小屋淡淡映下来
  for (let y = 0; y < wh + rh; y++) for (let x = x0; x < x0 + ww; x++) {
    const sy = hy + 2 + y; if (sy >= H) continue;
    const i = ((y0 + wh - 1 - Math.min(y, wh - 1)) * W + x) * 4;
    // 用屋顶/墙色近似
    const src = y < rh ? P.roof : P.wall;
    if (bay(x, sy) < 0.55) set(x, sy, mix(P.water, src, 0.35), 0.45);
  }

  // 5) 近岸野花
  const fl = [P.flower, [255, 200, 186], [214, 230, 255]];
  for (let k = 0; k < Math.round(W * 0.9); k++) {
    const x = Math.floor(hash(k, 3, seed) * W), y = shore[x] - 1 - Math.floor(hash(k, 4, seed) * 3);
    set(x, y, mix(fl[k % 3], P.grass, dk * 0.35));
  }
  tree(W * 0.08, shore[clamp(Math.round(W * 0.08), 0, W - 1)] + s * 0.2, Math.max(4, U * 0.08), 0.7);
  tree(W * 0.92, shore[clamp(Math.round(W * 0.92), 0, W - 1)] + 2, Math.max(3.5, U * 0.07), 0.55);
  tree(W * 0.28, shore[clamp(Math.round(W * 0.28), 0, W - 1)] + 1, Math.max(3, U * 0.05), 0.4);

  // 6) 气泡栏奶油柔光（白天奶油，夜里浅紫，不再用深暖紫压暗）
  const sc2 = mix([255, 246, 232], [36, 28, 64], dk), sa = (0.3 + dk * 0.22) * scrim;
  const [c0, c1] = col || [-8, W + 8], fade = Math.max(3, Math.round((c1 - c0) * 0.08));
  const sum = [0, 0, 0]; let n = 0;
  for (let y = 0; y < H; y++) for (let x = Math.max(0, c0); x < Math.min(W, c1); x++) {
    const e = Math.min(x - c0, c1 - 1 - x) / fade, lv = e >= 1 ? 1 : Math.floor((e + bay(x, y) * 0.999) * 3) / 3;
    if (lv > 0) set(x, y, sc2, sa * lv);
    if (e >= 1) { const i = (y * W + x) * 4; sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; n++; }
  }
  // 7) 倒雨光点：夜里淡紫萤火往上飘，白天是花粉/光屑
  const motes = [], night = dk > 0.5;
  for (let k = 0; k < Math.round(W / 7) + 8; k++) {
    const x = hash(k, 7, seed) * W, y = H * (night ? 0.35 + 0.55 * hash(k, 8, seed) : 0.15 + 0.7 * hash(k, 8, seed));
    motes.push({ x, y, c: night ? [230, 214, 255] : [255, 246, 220], a: night ? 0.9 : 0.55, up: true });
  }
  return { W, H, data: d, dark: night, base: sum.map((v) => Math.round(v / Math.max(1, n))), motes };
}

/** WCAG 对比度 */
export function contrast(a, b) {
  const L = (c) => { const [r, g, bb] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
