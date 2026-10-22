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

// 4 个色标（上→下）+ 星星 / 灯光 / 太阳强度
const KEYS = [
  [0,    { sky: [[22, 14, 38], [34, 20, 50], [56, 30, 60], [78, 40, 64]], star: 1, lamp: 1, sun: 0, name: "night" }],
  [4.5,  { sky: [[24, 16, 42], [38, 24, 56], [62, 34, 66], [86, 46, 70]], star: 1, lamp: 1, sun: 0, name: "night" }],
  [6,    { sky: [[74, 52, 96], [150, 88, 112], [226, 136, 118], [255, 196, 140]], star: 0.25, lamp: 0.4, sun: 0.6, name: "dawn" }],
  [8,    { sky: [[120, 168, 196], [168, 196, 204], [236, 214, 178], [252, 226, 176]], star: 0, lamp: 0, sun: 1, name: "day" }],
  [16,   { sky: [[112, 160, 194], [170, 192, 198], [238, 208, 168], [250, 214, 158]], star: 0, lamp: 0, sun: 1, name: "day" }],
  [18.5, { sky: [[64, 32, 62], [130, 58, 78], [214, 104, 82], [250, 168, 98]], star: 0.3, lamp: 0.6, sun: 0.5, name: "dusk" }],
  [20,   { sky: [[30, 18, 44], [48, 26, 58], [80, 40, 66], [108, 54, 66]], star: 0.9, lamp: 1, sun: 0, name: "night" }],
  [24,   { sky: [[22, 14, 38], [34, 20, 50], [56, 30, 60], [78, 40, 64]], star: 1, lamp: 1, sun: 0, name: "night" }],
];
const lerp = (a, b, f) => a + (b - a) * f;

export function skyAt(hour) {
  let i = 0; while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
  const f = h1 === h0 ? 0 : Math.min(1, Math.max(0, (hour - h0) / (h1 - h0)));
  const s = f * f * (3 - 2 * f); // smoothstep
  return {
    sky: a.sky.map((c, k) => c.map((v, j) => Math.round(lerp(v, b.sky[k][j], s)))),
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
  const mix = (k) => rgb(a[k].map((v, j) => Math.round(lerp(v, b[k][j], s))));
  return { hill: mix("hill"), grass: mix("grass"), tip: mix("tip") };
}

// 太阳在 5.5–19 点沿弧线走；返回 0..1 的进度，夜里 null
export function sunProgress(hour) { return hour >= 5.5 && hour <= 19 ? (hour - 5.5) / 13.5 : null; }
