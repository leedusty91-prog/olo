// 像素插画天空（唯一来源）：网页 app.js 和手机端 apps/mobile/src/skyScene.js 共用这份代码（手机端是原样拷贝，server 测试核对一致）。
// 纯函数、无 DOM：输入天色 sky（skyAt 的结果）+ 尺寸 + 日期，输出几层 RGBA 位图，调用方各自上屏，之后只做平移/透明度动画。
// 层：back（抖动色带天空、银河、星星、日/月）· cloudsFar / cloudsNear（可横向无缝循环的云带）· front（远山、雾、倒影小镇屋顶）· lights（夜里窗灯和灯笼，单独呼吸）。
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function grad(stops, t) { const f = clamp(t, 0, 0.9999) * (stops.length - 1), i = Math.floor(f); return mix(stops[i], stops[i + 1], f - i); }

function layer(W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, c, a = 1, wrap = false) => {
    x = Math.round(x); y = Math.round(y);
    if (wrap) x = ((x % W) + W) % W;
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 4, da = d[i + 3] / 255, oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = (c[k] * a + d[i + k] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  };
  const get = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  return { W, H, data: d, put, get };
}

// 月相：0 新月 → 0.5 满月 → 1（按真实日期，朔望月 29.53 天）
export function moonPhase(date = new Date()) {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  return (((days / 29.530588853) % 1) + 1) % 1;
}

export function sceneGeometry(W, H, hour) {
  const horizon = Math.round(H * 0.74);
  const p = hour >= 5.5 && hour <= 19 ? (hour - 5.5) / 13.5 : null;
  const sun = p === null ? null : { x: Math.round(W * (0.14 + 0.72 * p)), y: Math.round(H * 0.6 - Math.sin(Math.PI * p) * H * 0.46), r: Math.max(4, Math.round(Math.min(W, H) * 0.05)), low: Math.sin(Math.PI * p) < 0.38 };
  const moon = { x: Math.round(W * 0.74), y: Math.round(H * 0.15), r: Math.max(5, Math.round(Math.min(W, H) * 0.055)) };
  return { horizon, sun, moon };
}

function cloudPalette(sky) {
  const h = sky.hour, warm = Math.max(0, 1 - Math.abs(h - 6.4) / 1.7, 1 - Math.abs(h - 18.5) / 1.7);
  const day = { hl: [255, 255, 250], body: [250, 246, 238], mid: [228, 232, 240], under: [196, 206, 226] };
  const w = h < 12
    ? { hl: [255, 236, 214], body: [252, 206, 200], mid: [236, 164, 170], under: [196, 120, 148] }
    : { hl: [255, 226, 160], body: [252, 180, 140], mid: [226, 120, 110], under: [160, 76, 98] };
  const night = { hl: [128, 128, 170], body: [74, 70, 112], mid: [58, 54, 94], under: [40, 36, 70] };
  const out = {};
  for (const k of ["hl", "body", "mid", "under"]) out[k] = mix(mix(day[k], w[k], clamp(warm * 1.1)), night[k], clamp((sky.star - 0.25) / 0.6));
  return out;
}

function paintClouds(sky, W, H, seed, far) {
  const CW = W * 2, CH = Math.round(H * 0.62), L = layer(CW, CH), r = rng(seed), pal = cloudPalette(sky);
  const stops = sky.sky, n = Math.round(CW / (far ? 34 : 52)) + 2;
  for (let c = 0; c < n; c++) {
    const cx = r() * CW, base = Math.round(CH * (far ? 0.12 + r() * 0.5 : 0.18 + r() * 0.7));
    const s = far ? 4 + r() * 5 : 7 + r() * 9, puffs = 3 + Math.floor(r() * 3), P = [];
    for (let k = 0; k < puffs; k++) { const t = puffs === 1 ? 0.5 : k / (puffs - 1); const pr = s * (0.55 + 0.45 * Math.sin(Math.PI * t)) * (0.8 + r() * 0.35); P.push([cx + (t - 0.5) * s * 2.6, base - pr * 0.55, pr]); }
    const x0 = Math.floor(cx - s * 2.2), x1 = Math.ceil(cx + s * 2.2), y0 = Math.floor(base - s * 1.6);
    const inside = (x, y) => y <= base && P.some(([px, py, pr]) => (x - px) ** 2 + (y - py) ** 2 <= pr * pr);
    const skyAtY = grad(stops, base / (H * 0.74)), fade = far ? 0.45 : 0.12;
    for (let y = y0; y <= base; y++) for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      const up = !inside(x, y - 1), up2 = !inside(x, y - 2), lowRow = base - y;
      let col = up ? pal.hl : up2 && bay(x, y) < 0.5 ? pal.hl : lowRow < 1 ? pal.under : lowRow < 3 ? (bay(x, y) < (3 - lowRow) / 3 ? pal.under : pal.mid) : pal.body;
      if (lowRow >= 3 && lowRow < 5 && bay(x, y) < 0.3) col = pal.mid;
      L.put(x, y, mix(col, skyAtY, fade), 1, true);
    }
  }
  // 低处几缕细长的层云（晨昏最明显）
  for (let k = 0; k < (far ? 0 : Math.round(CW / 60)); k++) {
    const y = Math.round(CH * (0.6 + r() * 0.35)), x0 = r() * CW, len = 14 + r() * 30, skyAtY = grad(stops, y / (H * 0.74));
    for (let j = 0; j < len; j++) { const e = Math.min(j, len - j); if (e < 1 && bay(j, y) < 0.5) continue; L.put(x0 + j, y, mix(pal.hl, skyAtY, 0.3), 1, true); if (e > 4 && j % 7 < 5) L.put(x0 + j, y + 1, mix(pal.under, skyAtY, 0.25), 1, true); }
  }
  return L;
}

function ridge(W, x, s, amp, freq) {
  const u = (x / W) * Math.PI * 2;
  return (Math.sin(u * freq + s) * 0.55 + Math.sin(u * freq * 2.3 + s * 1.7) * 0.28 + Math.sin(u * freq * 4.3 + s * 3.1) * 0.1 + (hash(x >> 2, 0, s * 99) - 0.5) * 0.03) * amp;
}

export function paintScene(sky, { W, H, date = new Date(), seed = 7 }) {
  const hour = sky.hour, stops = sky.sky, G = sceneGeometry(W, H, hour), hz = G.horizon;
  const back = layer(W, H), front = layer(W, H), lights = layer(W, H), twinkles = [];
  const night = clamp((sky.star - 0.2) / 0.7), sunA = sky.sun > 0.15 && G.sun ? clamp(sky.sun * 1.3) : 0;
  const sun = G.sun, warmSun = sun && sun.low ? [255, 150, 90] : [255, 226, 150];

  // 1) 天空：12 条色带，带与带之间 35% 的 Bayer 抖动过渡；太阳附近一圈分级暖光
  const NB = 12;
  for (let y = 0; y < H; y++) {
    const f = clamp(y / hz, 0, 1) * (NB - 1), i = Math.floor(f), fr = f - i;
    for (let x = 0; x < W; x++) {
      const b = fr > 0.65 && (fr - 0.65) / 0.35 > bay(x, y) ? i + 1 : i;
      let c = grad(stops, Math.min(NB - 1, b) / (NB - 1));
      if (sunA > 0) {
        const d = Math.hypot(x - sun.x, (y - sun.y) * 1.15), g = clamp(1 - d / (sun.r * (sun.low ? 11 : 8)));
        const lv = Math.floor(g * 4 + bay(x, y) * 0.999) / 4;
        if (lv > 0) c = mix(c, warmSun, lv * 0.32 * sunA);
      }
      if (night > 0) { const g = clamp(1 - Math.hypot(x - G.moon.x, y - G.moon.y) / (G.moon.r * 9)); const lv = Math.floor(g * 3 + bay(x, y) * 0.999) / 3; if (lv > 0) c = mix(c, [120, 116, 170], lv * 0.16 * night); }
      const n = (hash(x, y, seed) - 0.5) * 5; // 细颗粒
      back.put(x, y, [c[0] + n, c[1] + n, c[2] + n]);
    }
  }

  // 2) 银河：斜带 + 噪点密度
  if (night > 0.05) {
    const ax = W * 0.05, ay = H * 0.02, bx = W * 0.95, by = H * 0.6, L = Math.hypot(bx - ax, by - ay), wid = Math.min(W, H) * 0.09;
    for (let y = 0; y < hz * 0.9; y++) for (let x = 0; x < W; x++) {
      const dist = Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax) / L;
      const dens = Math.exp(-((dist / wid) ** 2)) * (0.55 + 0.45 * Math.sin(x * 0.21 + y * 0.13) * Math.sin(x * 0.07 - y * 0.11));
      if (hash(x, y, seed + 3) < dens * 0.5) back.put(x, y, [168, 150, 206], 0.16 * night);
      if (hash(x, y, seed + 4) < dens * 0.05) back.put(x, y, [236, 228, 255], 0.5 * night);
    }
  }

  // 3) 星星：大小、亮度、色温各不同；亮的几颗交给调用方做眨眼
  if (sky.star > 0.03) {
    const r = rng(seed + 11), n = Math.round((W * hz) / 70);
    for (let k = 0; k < n; k++) {
      const x = Math.floor(r() * W), y = Math.floor(Math.pow(r(), 1.3) * hz * 0.86), b = r() * r();
      const col = [[255, 246, 220], [214, 226, 255], [255, 216, 186]][Math.floor(r() * 3)];
      const a = sky.star * (0.28 + 0.72 * b) * clamp((hz * 0.86 - y) / (hz * 0.25));
      if (b > 0.72 && twinkles.length < 14) { twinkles.push({ x, y, c: col, a }); back.put(x, y, col, a * 0.6); continue; }
      back.put(x, y, col, a);
      if (b > 0.5) { back.put(x + 1, y, col, a * 0.25); back.put(x, y + 1, col, a * 0.18); }
    }
  }

  // 4) 太阳：像素圆盘 + 两圈抖动光晕 + 光芒；低空时偏橙、带两道横切线
  if (sunA > 0) {
    const R = sun.r, core = sun.low ? [255, 222, 150] : [255, 252, 232], rim = sun.low ? [255, 160, 92] : [255, 222, 128];
    for (let dy = -R - 14; dy <= R + 14; dy++) for (let dx = -R - 14; dx <= R + 14; dx++) {
      const x = sun.x + dx, y = sun.y + dy, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
      if (d2 <= R * R + R * 0.8) {
        if (sun.low && dy > R * 0.25 && (dy === Math.round(R * 0.45) || dy === Math.round(R * 0.8))) continue;
        const c = d > R - 1.2 ? rim : dx < -R * 0.2 && dy < -R * 0.2 && d < R * 0.75 ? [255, 255, 246] : core;
        back.put(x, y, c, sunA);
      } else if (d <= R + 2.5) { if (bay(x, y) < 0.5) back.put(x, y, rim, 0.55 * sunA); }
      else if (d <= R + 5) { if (bay(x, y) < 0.2) back.put(x, y, rim, 0.45 * sunA); }
    }
    if (!sun.low) for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4, len = k % 2 ? 2 : 4;
      for (let j = 0; j < len; j++) { const dd = R + 7 + j; back.put(sun.x + Math.cos(ang) * dd, sun.y + Math.sin(ang) * dd, rim, (0.6 - j * 0.12) * sunA); }
    }
  }

  // 5) 月亮：真实月相 + 陨石坑 + 暗面地照 + 柔光晕
  let phase = moonPhase(date);
  if (night > 0.45) {
    const { x: mx, y: my, r: R } = G.moon, k = Math.cos(2 * Math.PI * phase), waxing = phase < 0.5, illum = (1 - k) / 2;
    const craters = [[-0.35, -0.15, 0.24], [0.28, 0.3, 0.2], [0.12, -0.48, 0.13], [-0.12, 0.5, 0.12], [0.45, -0.1, 0.1]];
    for (let dy = -R - 8; dy <= R + 8; dy++) for (let dx = -R - 8; dx <= R + 8; dx++) {
      const x = mx + dx, y = my + dy, d = Math.hypot(dx, dy);
      if (d <= R + 0.4) {
        const half = Math.sqrt(Math.max(0.01, R * R - dy * dy)), xp = dx / half;
        const lit = waxing ? xp > k : -xp > k;
        if (lit) {
          let c = d > R - 1 ? [222, 204, 176] : [246, 236, 208];
          if (craters.some(([cx, cy, cr]) => Math.hypot(dx / R - cx, dy / R - cy) < cr)) c = [212, 196, 168];
          back.put(x, y, c, night);
        } else back.put(x, y, [70, 62, 104], 0.75 * night);
      } else if (illum > 0.15 && d <= R + 3) { if (bay(x, y) < 0.35) back.put(x, y, [214, 206, 240], 0.3 * night * illum); }
      else if (illum > 0.15 && d <= R + 7) { if (bay(x, y) < 0.12) back.put(x, y, [200, 194, 236], 0.28 * night * illum); }
    }
  }

  // 6) 前景：远山（带受光边）→ 雾 → 近丘与树冠 → 雾 → 倒影小镇屋顶
  const dark = [96, 88, 140];  // 倒影国：远山/屋顶剪影用淡紫，不叠近黑
  const farC = mix(mix(stops[3], stops[1], 0.4), dark, 0.08 + 0.22 * night), nearC = mix(farC, dark, 0.14 + 0.16 * night), townC = mix(farC, dark, 0.22 + 0.2 * night);
  const mistC = mix(stops[3], night > 0.5 ? [150, 136, 186] : [255, 250, 240], 0.35);
  const rimC = mix(farC, sunA > 0 ? warmSun : [170, 160, 210], sunA > 0 ? 0.5 : 0.3 * night);
  const yF = H * 0.66, yN = H * 0.75, yT = H * 0.82;
  for (let x = 0; x < W; x++) {
    const top = Math.round(yF - ridge(W, x, seed, H * 0.075, 1.6) - H * 0.025);
    for (let y = top; y < H; y++) front.put(x, y, y === top ? rimC : y === top + 1 && bay(x, y) < 0.5 ? rimC : farC);
  }
  const mist = (yc, hgt, a) => { for (let y = Math.round(yc - hgt); y <= yc + hgt; y++) for (let x = 0; x < W; x++) { const v = 1 - Math.abs(y - yc) / hgt, wisp = 0.5 + 0.5 * Math.sin((x / W) * 9 + seed + y * 0.35) * Math.sin((x / W) * 3.7 - seed); const dens = v * v * (0.35 + 0.65 * wisp); if (dens > 0.02) front.put(x, y, mistC, Math.floor((dens * a + bay(x, y) * 0.25) * 4) / 4 * 0.7); } };
  mist(yF + H * 0.04, H * 0.035, 0.9);
  for (let x = 0; x < W; x++) {
    let top = yN - ridge(W, x, seed + 5, H * 0.025, 3.1);
    const tc = Math.floor(x / 6), tx = x - tc * 6 - 3; if (hash(tc, 1, seed) < 0.55) top -= Math.max(0, 2.6 - Math.abs(tx) * 0.8) * (1 + hash(tc, 2, seed) * 1.5);
    for (let y = Math.round(top); y < H; y++) front.put(x, y, nearC);
  }
  mist(yN + H * 0.035, H * 0.025, 0.75);
  // 倒影小镇：两排屋顶（后排浅、前排深），飞檐上翘、偶有两层小楼，挂灯笼的杆；窗只开在墙上
  const lit = sky.lamp, frontC = mix(townC, dark, 0.3 + 0.3 * night);
  const town = (base, col, sc, sd, winA) => {
    const r = rng(sd); let bx = -Math.floor(r() * 10);
    for (let y = Math.round(base); y < H; y++) for (let x = 0; x < W; x++) front.put(x, y, col);
    while (bx < W) {
      const bw = Math.round((9 + r() * 12) * sc), wh = Math.round((4 + r() * 9) * sc), wallTop = Math.round(base - wh), tiers = r() < 0.2 ? 2 : 1;
      if (r() < 0.16) { // 树
        const tx = bx + 4, th = Math.round((7 + r() * 6) * sc), tr = Math.round((3 + r() * 2) * sc);
        for (let dy = -tr; dy <= tr; dy++) for (let dx = -tr - 1; dx <= tr + 1; dx++) if ((dx * dx) / ((tr + 1) * (tr + 1)) + (dy * dy) / (tr * tr) <= 1 && hash(tx + dx, dy, sd) > 0.08) front.put(tx + dx, base - th + dy, col);
        for (let y = base - th; y < base; y++) front.put(tx, y, col);
        bx += tr * 2 + 4; continue;
      }
      let top = wallTop;
      for (let y = wallTop; y < base; y++) for (let x = bx; x < bx + bw; x++) front.put(x, y, col);
      for (let t = 0; t < tiers; t++) {
        const ww = t ? Math.max(5, bw - 6) : bw, wx = bx + Math.round((bw - ww) / 2), roofH = Math.round((t ? 3 : 4) * Math.max(1, sc * 0.9)), ty = t ? top - Math.round(4 * sc) : top;
        if (t) for (let y = ty; y < top; y++) for (let x = wx; x < wx + ww; x++) front.put(x, y, col);
        for (let rr = 0; rr < roofH; rr++) { const inset = roofH - 1 - rr; for (let x = wx - 2 + inset; x <= wx + ww + 1 - inset; x++) front.put(x, ty - roofH + rr, col); }
        front.put(wx - 3, ty - 2, col); front.put(wx + ww + 2, ty - 2, col); front.put(wx - 3, ty - 3, col); front.put(wx + ww + 2, ty - 3, col);
        front.put(wx + roofH - 2, ty - roofH - 1, col); front.put(wx + ww - roofH + 1, ty - roofH - 1, col);
        // 屋檐下一道阴影线
        for (let x = wx - 1; x <= wx + ww; x++) front.put(x, ty, mix(col, dark, 0.35));
        if (t === 0) {
          for (let y = ty + 2; y < base - 1; y += 3) for (let x = wx + 2; x < wx + ww - 2; x += 3) {
            if (hash(x, y, sd + 7) >= winA) continue;
            if (hash(x, y, sd + 8) < 0.8 * lit) { lights.put(x, y, [255, 210, 128], 1); lights.put(x + 1, y, [255, 196, 110], 1); lights.put(x, y + 1, [236, 150, 76], 1); lights.put(x + 1, y + 1, [236, 150, 76], 1); }
            else { const wc = mix(col, stops[1], 0.22); front.put(x, y, wc); front.put(x + 1, y, wc); front.put(x, y + 1, mix(col, stops[1], 0.14)); front.put(x + 1, y + 1, mix(col, stops[1], 0.14)); }
          }
        }
        top = ty - roofH;
      }
      if (r() < 0.45) { // 灯笼杆
        const px = bx + bw + 1, ph = Math.round((6 + r() * 5) * sc);
        for (let y = base - ph; y < base; y++) front.put(px, y, col);
        for (let j = 0; j < 4; j++) front.put(px + j, base - ph, col);
        const lx = px + 3, ly = Math.round(base - ph + 2), lc = lit > 0.1 ? [238, 96, 66] : mix(col, [170, 66, 56], 0.55);
        front.put(lx, ly - 1, col); front.put(lx, ly, lc); front.put(lx, ly + 1, lc); front.put(lx + 1, ly, mix(lc, col, 0.3)); front.put(lx + 1, ly + 1, mix(lc, col, 0.4));
        if (lit > 0.1) { lights.put(lx, ly, [255, 140, 90], 1); lights.put(lx, ly + 1, [236, 96, 66], 1); for (let dy = -5; dy <= 6; dy++) for (let dx = -5; dx <= 6; dx++) { const d = Math.hypot(dx - 0.5, dy - 0.5); if (d > 1.5 && d < 5.5 && bay(lx + dx, ly + dy) < 0.45 * (1 - d / 5.5)) lights.put(lx + dx, ly + dy, [255, 150, 80], 0.6 * lit); } }
      }
      bx += bw + 2 + Math.floor(r() * 6 * sc);
    }
  };
  town(Math.round(yT), townC, 1, seed + 21, 0.32);
  mist(yT + H * 0.03, H * 0.018, 0.6);
  town(Math.round(yT + H * 0.075), frontC, 1.35, seed + 22, 0.38);
  // 窗灯暖晕
  if (lit > 0.1) { const L = lights.data; for (let y = Math.round(yT - 24); y < H; y++) for (let x = 0; x < W; x++) if (L[(y * W + x) * 4 + 3] === 255 && L[(y * W + x) * 4 + 1] > 200) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1]]) if (bay(x + dx, y + dy) < 0.5) lights.put(x + dx, y + dy, [255, 170, 90], 0.35 * lit); }

  return {
    W, H, back, front, lights, twinkles, phase, geometry: G,
    cloudsFar: paintClouds(sky, W, H, seed + 31, true), cloudsNear: paintClouds(sky, W, H, seed + 41, false),
    hasLights: lit > 0.1,
  };
}
