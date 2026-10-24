// 聊天背景（唯一来源）：网页 web/chat-bg.js 与手机端 apps/mobile/src/chatBg.js 是同一份（server 测试逐字节核对）。
// 雾里集高清插画四幅（黎明 / 白天 / 黄昏 / 夜里），按本地小时选图，两端都用淡入交叉切换；
// 这里只放纯数据和纯函数：选图、每幅图的平均色、压字用的薄纱（scrim）、字色和对比度。
export const CHAT_BG_KEYS = ["dawn", "day", "dusk", "night"];

export function bgFor(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 16.5) return "day";
  if (h >= 16.5 && h < 19.5) return "dusk";
  return "night";
}

// base：图片整体平均色（测试会对照两端的 jpg 实测，误差 ≤ 12）；scrim：叠在图上的一层纱 [r,g,b,a]
export const CHAT_BG = {
  dawn: { base: [169, 138, 139], scrim: [255, 240, 225, 0.32], dark: false },
  day: { base: [224, 189, 167], scrim: [255, 244, 228, 0.22], dark: false },
  dusk: { base: [164, 128, 132], scrim: [255, 236, 220, 0.34], dark: false },
  night: { base: [97, 77, 95], scrim: [18, 10, 28, 0.42], dark: true },
};

export const chatDark = (key) => CHAT_BG[key].dark;
export function chatInk(dark) { return dark ? [255, 240, 214] : [52, 24, 16]; }
export const scrimCss = (key) => { const [r, g, b, a] = CHAT_BG[key].scrim; return `rgba(${r},${g},${b},${a})`; };
// 纱叠上去之后的有效底色（字和气泡就压在它上面）
export function chatSurface(key) {
  const { base, scrim } = CHAT_BG[key], a = scrim[3];
  return base.map((v, i) => Math.round(v * (1 - a) + scrim[i] * a));
}

function lum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
