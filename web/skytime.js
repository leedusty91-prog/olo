import { SKY_KEYS as KEYS } from "./sky-keys.js?v=20261026e";
// 背景天色随用户本地时间变化：黎明 / 白天 / 黄昏 / 夜晚，关键帧之间平滑插值。
// 时区优先用服务器存的用户时区，其次浏览器时区；?bg_hour=5.5 可固定时刻（截图/调试）。
export const BROWSER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
let userTz = "";
export function setUserTz(tz) { userTz = tz || ""; }

const override = (() => { const v = new URLSearchParams(location.search).get("bg_hour"); const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? ((n % 24) + 24) % 24 : null; })();

export function localHour(date = new Date()) {
  if (override !== null) return override;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: userTz || BROWSER_TZ || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const g = (k) => Number(parts.find((p) => p.type === k)?.value || 0);
    return g("hour") + g("minute") / 60;
  } catch { return date.getHours() + date.getMinutes() / 60; }
}

const lerp = (a, b, f) => a + (b - a) * f;
// 倒影国：天色整体往奶油 / 蜜桃 / 薰衣草提亮（低对比、夜里也不发黑），关键帧本身不改。
const LIFT = [255, 236, 226];
const pastel = (c, k = 0.5) => c.map((v, j) => Math.round(v + (LIFT[j] - v) * k));

export function skyAt(hour) {
  let i = 0; while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
  const f = h1 === h0 ? 0 : Math.min(1, Math.max(0, (hour - h0) / (h1 - h0)));
  const s = f * f * (3 - 2 * f); // smoothstep
  return {
    sky: a.sky.map((c, k) => pastel(c.map((v, j) => lerp(v, b.sky[k][j], s)))),
    star: lerp(a.star, b.star, s), lamp: lerp(a.lamp, b.lamp, s), sun: lerp(a.sun, b.sun, s),
    phase: s < 0.5 ? a.name : b.name, hour,
  };
}

export function bands(sky, n = 14) {
  return Array.from({ length: n }, (_, i) => {
    const k = i / (n - 1) * (sky.length - 1), a = sky[Math.floor(k)], b = sky[Math.min(sky.length - 1, Math.floor(k) + 1)], f = k % 1;
    return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(",")})`;
  });
}

// 角色小场景（聊天页 hero）的地面配色，和天色同一时间轴
const GROUND = [
  [0,    { hill: [44, 26, 58], grass: [40, 58, 52], tip: [70, 96, 70] }],
  [4.5,  { hill: [48, 28, 62], grass: [42, 60, 54], tip: [72, 98, 72] }],
  [6,    { hill: [112, 58, 86], grass: [92, 108, 56], tip: [170, 176, 80] }],
  [8,    { hill: [120, 150, 110], grass: [110, 150, 60], tip: [190, 214, 96] }],
  [16,   { hill: [128, 148, 104], grass: [112, 146, 58], tip: [196, 210, 92] }],
  [18.5, { hill: [122, 58, 88], grass: [106, 122, 52], tip: [168, 184, 74] }],
  [20,   { hill: [56, 32, 66], grass: [48, 66, 56], tip: [80, 106, 76] }],
  [24,   { hill: [44, 26, 58], grass: [40, 58, 52], tip: [70, 96, 70] }],
];
const rgb = (c) => `rgb(${c.join(",")})`;

export function groundAt(hour) {
  let i = 0; while (i < GROUND.length - 2 && hour >= GROUND[i + 1][0]) i++;
  const [h0, a] = GROUND[i], [h1, b] = GROUND[i + 1];
  const f = Math.min(1, Math.max(0, (hour - h0) / (h1 - h0))), s = f * f * (3 - 2 * f);
  const mix = (k) => rgb(pastel(a[k].map((v, j) => lerp(v, b[k][j], s)), 0.45));
  return { hill: mix("hill"), grass: mix("grass"), tip: mix("tip") };
}

// 太阳在 5.5–19 点沿弧线走；返回 0..1 的进度，夜里 null
export function sunProgress(hour) { return hour >= 5.5 && hour <= 19 ? (hour - 5.5) / 13.5 : null; }
