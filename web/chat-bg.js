// 聊天背景（唯一来源）：网页 app.js 和手机端 apps/mobile/src/chatBg.js 共用（手机端原样拷贝，server 测试核对一致）。
// 纯函数、无 DOM：按此刻天色（skyAt 的结果，sky-keys 同一套色标）画一张「磨砂纸」像素面板——
// 天色色带用 Bayer 抖动过渡并朝纸色/夜色收拢（保证气泡对比度），叠一层纸纹颗粒；夜里有暗星，返回萤火/花粉的落点给调用方做动画。
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function hash(x, y, s) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function grad(stops, t) { const f = clamp(t, 0, 0.9999) * (stops.length - 1), i = Math.floor(f); return mix(stops[i], stops[i + 1], f - i); }

export const PAPER = [246, 226, 196];
export const DUSK_PAPER = [58, 36, 66];

/** 纸面暗度 0（白天纸色）…1（夜色）：跟着星光走，黄昏渐暗 */
export function chatDarkness(sky) { return clamp((sky.star - 0.15) / 0.6); }

/**
 * opts: { W, H, seed=3, alpha=1, fade=0 }  fade>0 时四边各 fade 像素抖动淡出成透明（网页聊天栏用）
 * 返回 { W, H, data, dark, base:[r,g,b], motes:[{x,y,c,a}] }
 */
export function paintChatBg(sky, { W, H, seed = 3, alpha = 1, fade = 0 }) {
  const d = new Uint8ClampedArray(W * H * 4);
  const dk = chatDarkness(sky), dark = dk > 0.5;
  const paper = mix(PAPER, DUSK_PAPER, dk);
  const keep = 0.64 + dk * 0.12; // 朝纸色收拢的比例：越大越素，气泡越清楚
  const NB = 10;
  let sum = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const f = (y / Math.max(1, H - 1)) * (NB - 1), i = Math.floor(f), fr = f - i;
    for (let x = 0; x < W; x++) {
      const b = fr > 0.6 && (fr - 0.6) / 0.4 > bay(x, y) ? i + 1 : i;
      let c = mix(grad(sky.sky, 0.15 + 0.8 * (Math.min(NB - 1, b) / (NB - 1))), paper, keep);
      // 纸纹：稀疏的颗粒 + 每 7 行一条若有若无的纤维
      const n = hash(x, y, seed);
      if (n < 0.1) c = mix(c, dark ? [255, 240, 220] : [150, 100, 70], 0.06);
      else if (n > 0.93) c = mix(c, dark ? [10, 4, 20] : [255, 255, 250], 0.08);
      if (y % 7 === 3 && bay(x, y) < 0.18) c = mix(c, dark ? [120, 90, 140] : [235, 205, 170], 0.25);
      // 四角轻微暗角（2 级抖动）
      const ex = Math.min(x, W - 1 - x) / Math.max(1, W * 0.18), ey = Math.min(y, H - 1 - y) / Math.max(1, H * 0.12);
      const v = clamp(1 - Math.min(ex, ey));
      if (v > 0 && bay(x, y) < v * 0.5) c = mix(c, dark ? [20, 8, 30] : [210, 160, 120], 0.12);
      let a = alpha;
      if (fade > 0) { const e = Math.min(x, W - 1 - x, y, H - 1 - y) / fade; if (e < 1) a *= Math.floor((e + bay(x, y) * 0.999) * 4) / 4; }
      const k = (y * W + x) * 4;
      d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = Math.round(a * 255);
      sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
    }
  }
  // 夜里的暗星（纸面上淡淡的几颗）
  const star = clamp((sky.star - 0.3) / 0.6);
  if (star > 0) for (let i = 0; i < Math.round(W * H / 220); i++) {
    const x = Math.floor(hash(i, 1, seed + 7) * W), y = Math.floor(hash(i, 2, seed + 7) * H), k = (y * W + x) * 4;
    const t = 0.25 + 0.35 * hash(i, 3, seed) * star;
    d[k] += (255 - d[k]) * t; d[k + 1] += (240 - d[k + 1]) * t; d[k + 2] += (200 - d[k + 2]) * t;
  }
  const motes = [];
  const n = Math.round((W * H) / 900) + 4;
  for (let i = 0; i < n; i++) motes.push({ x: hash(i, 5, seed) * W, y: hash(i, 6, seed) * H, c: dark ? [255, 214, 120] : [255, 236, 180], a: dark ? 0.9 : 0.55 });
  const px = W * H;
  return { W, H, data: d, dark, base: sum.map((v) => Math.round(v / px)), motes };
}

/** WCAG 对比度（给测试和调用方挑字色用） */
export function contrast(a, b) {
  const L = (c) => { const [r, g, bb] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 背景上的小字（时间戳、空状态）用什么颜色：亮纸用深棕，暗纸用暖白 */
export function chatInk(dark) { return dark ? [255, 240, 214] : [74, 40, 30]; }
