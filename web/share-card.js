// 分享卡片（插画风）：明信片 / 日记 → 分享图。网页 web/share-card.js 与手机 apps/mobile/src/shareCard.js 是同一份（字节一致，pytest 盯着）。
// 这里只给排版和配色（导出像素单位）；底图是打包的高清插画（黄昏 / 夜晚），纸片是大圆角半透明奶油卡，字用霞鹜文楷，
// 角色用当前灯籽的立绘。网页用 canvas 画，手机用 View + Text + Image 再 view-shot。
// 尺寸：1x1 1080², 4x5 1080×1350, 9x16 1080×1920, 16x9 1920×1080。

export const SHARE_SIZES = {
  "1x1": { W: 1080, H: 1080, K: 1 },
  "4x5": { W: 1080, H: 1350, K: 1 },
  "9x16": { W: 1080, H: 1920, K: 1 },
  "16x9": { W: 1920, H: 1080, K: 1 },
};
export const SHARE_FONT = 44; // 正文字号（px）
export const SHARE_INK = "#50301E", SHARE_MUTED = "#8C6450", SHARE_ACCENT = "#E6823C";
export const SHARE_PAPER = "rgba(255,248,241,0.92)", SHARE_PAPER_LINE = "rgba(230,130,60,0.18)", SHARE_SHADOW = "rgba(122,74,58,0.28)";
export const SHARE_BG = { day: "bg-dusk", night: "bg-night" };

/** 背景插画：19 点到 5 点用夜晚，其余用黄昏 */
export function shareBg(hour) {
  return hour >= 19 || hour < 5 ? SHARE_BG.night : SHARE_BG.day;
}

/** 按格子数断行：中文一个字一格，ASCII 半格；超过 maxLines 用 … 收尾 */
export function wrapShareText(text, cols, maxLines) {
  const out = []; let line = "", w = 0;
  for (const para of String(text || "").replace(/\r/g, "").split("\n")) {
    for (const ch of para) {
      const cw = ch.charCodeAt(0) < 128 ? 0.5 : 1;
      if (w + cw > cols) {
        if ("，。、！？；：）」』…,.!?".includes(ch)) { line += ch; out.push(line); line = ""; w = 0; continue; } // 标点不放行首
        out.push(line); line = ""; w = 0;
      }
      line += ch; w += cw;
    }
    out.push(line); line = ""; w = 0;
  }
  while (out.length && !out[out.length - 1]) out.pop();
  if (out.length > maxLines) { const cut = out.slice(0, maxLines); cut[maxLines - 1] = cut[maxLines - 1].slice(0, Math.max(0, cut[maxLines - 1].length - 1)) + "…"; return cut; }
  return out;
}

export function shareLayout(size) {
  const S = SHARE_SIZES[size] || SHARE_SIZES["1x1"], { W, H } = S, wide = W > H;
  const m = Math.round(Math.min(W, H) * 0.06);
  const panel = wide ? { x: Math.round(W * 0.44), y: m, w: Math.round(W * 0.56) - m, h: H - m * 2 }
    : { x: m, y: Math.round(H * (H / W > 1.5 ? 0.5 : 0.44)), w: W - m * 2, h: 0 };
  if (!wide) panel.h = H - m - panel.y;
  panel.r = Math.round(Math.min(W, H) * 0.045);
  const fs = SHARE_FONT, pad = Math.round(fs * 1.1), lineH = Math.round(fs * 1.55);
  const cols = Math.floor((panel.w - pad * 2) / fs);
  const title = { x: panel.x + pad, y: panel.y + pad, fs: Math.round(fs * 1.15) };
  const date = { x: panel.x + panel.w - pad, y: panel.y + pad + 6, fs: Math.round(fs * 0.72) };
  const bodyY = title.y + title.fs + Math.round(fs * 0.9);
  const body = { x: panel.x + pad, y: bodyY, fs, lineH, cols, maxLines: Math.max(3, Math.floor((panel.y + panel.h - pad - fs - bodyY) / lineH)) };
  const spriteSize = Math.round(Math.min(W, H) * (wide ? 0.42 : 0.34));
  const sprite = wide ? { x: Math.round(W * 0.22 - spriteSize / 2), y: Math.round(H - m - spriteSize), size: spriteSize }
    : { x: Math.round(W / 2 - spriteSize / 2), y: panel.y - spriteSize + Math.round(spriteSize * 0.12), size: spriteSize };
  const mark = { x: panel.x + panel.w - pad, y: panel.y + panel.h - pad - Math.round(fs * 0.7), fs: Math.round(fs * 0.7) };
  return { ...S, wide, panel, title, date, body, sprite, mark };
}

/** 正文放不下时先缩字（最小到 0.62 倍），还放不下才用 … 收尾 —— 日记里的「引语」不再被截断 */
export function fitShareBody(L, text) {
  const b = L.body, bottom = b.y + b.maxLines * b.lineH, width = b.cols * b.fs;
  for (let k = 1; k >= 0.62; k -= 0.04) {
    const fs = Math.round(b.fs * k), lineH = Math.round(fs * 1.55), cols = Math.floor(width / fs);
    const maxLines = Math.max(3, Math.floor((bottom - b.y) / lineH));
    const all = wrapShareText(text, cols, 999);
    if (all.length <= maxLines) return { ...b, fs, lineH, cols, maxLines, lines: all };
  }
  const fs = Math.round(b.fs * 0.62), lineH = Math.round(fs * 1.55), cols = Math.floor(width / fs);
  const maxLines = Math.max(3, Math.floor((bottom - b.y) / lineH));
  return { ...b, fs, lineH, cols, maxLines, lines: wrapShareText(text, cols, maxLines) };
}
