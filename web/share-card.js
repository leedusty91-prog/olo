// 分享卡片：把一张明信片 / 一篇日记画成像素风分享图。网页 web/share-card.js 与手机 apps/mobile/src/shareCard.js 是同一份（字节一致，pytest 盯着）。
// 这里只画像素底图（暖色风景 + 纸片 + 邮戳 + olo 水印）并给出排版；字和 olo 小人由各端按 layout 叠上去（网页 canvas fillText，手机 Text + view-shot），
// 因为中文要用 FusionPixel 字体渲染，纯 JS 里没有字形。
// 所有尺寸都是低分辨率像素单位，乘 K 得到导出像素：1x1 1080², 4x5 1080×1350, 9x16 1080×1920, 16x9 1920×1080。

export const SHARE_SIZES = {
  "1x1": { W: 270, H: 270, K: 4 },
  "4x5": { W: 216, H: 270, K: 5 },
  "9x16": { W: 180, H: 320, K: 6 },
  "16x9": { W: 320, H: 180, K: 6 },
};
export const GLYPH = 12; // FusionPixel 12px：一个字 = 12 个低分辨率像素
const PAPER = [255, 246, 226], PAPER2 = [244, 226, 194], EDGE = [122, 64, 38], SHADOW = [60, 28, 20];
export const SHARE_INK = "#3a1c10", SHARE_MUTED = "#8a5a3c", SHARE_ACCENT = "#c8641f";

// 3×5 小像素字：只够写水印 "olo"
const MINI = { o: ["111", "101", "101", "101", "111"], l: ["100", "100", "100", "100", "111"] };

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
  const panel = wide ? { x: Math.round(W * 0.46), y: 14, w: Math.round(W * 0.5), h: H - 28 }
    : { x: 10, y: Math.round(H * (H / W > 1.5 ? 0.46 : 0.4)), w: W - 20, h: 0 };
  if (!wide) panel.h = H - 16 - panel.y;
  const pad = 9, cols = Math.floor((panel.w - pad * 2) / GLYPH);
  const title = { x: panel.x + pad, y: panel.y + pad + 4 };
  const date = { x: panel.x + panel.w - pad, y: panel.y + pad + 4 };
  const body = { x: panel.x + pad, y: title.y + GLYPH + 8, lineH: GLYPH + 4, cols, maxLines: Math.max(1, Math.floor((panel.y + panel.h - pad - 10 - (title.y + GLYPH + 8)) / (GLYPH + 4))) };
  const spriteS = wide ? 2 : W >= 260 ? 2 : 1;
  const sprite = wide ? { x: Math.round(W * 0.2) - 16 * spriteS, y: H - 20 - 32 * spriteS, s: spriteS } : { x: panel.x + 6, y: panel.y - 32 * spriteS + 6 * spriteS, s: spriteS };
  const mark = { x: panel.x + panel.w - pad - 14, y: panel.y + panel.h - pad - 4 };
  return { ...S, wide, panel, title, date, body, sprite, mark };
}

/**
 * 画分享卡底图。card: { kind: "postcard"|"diary", size, date, seed }
 * deps: { paintChatScene, paintScene }（传进来，两端才能字节一致）
 * 返回 { W, H, K, data(RGBA), layout }
 */
export function paintShareCard(sky, card, deps) {
  const L = shareLayout(card.size), { W, H } = L;
  const scene = deps.paintChatScene(sky, { W, H, paintScene: deps.paintScene, date: card.date || new Date(), seed: card.seed ?? 5, scrim: 0 });
  const d = scene.data;
  const set = (x, y, c, a = 1) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a; d[i + 3] = 255; };
  const rect = (x, y, w, h, c, a = 1) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c, a); };
  const P = L.panel;
  // 纸片：投影 + 描边 + 纸色 + 横格线
  rect(P.x + 3, P.y + 3, P.w, P.h, SHADOW, 0.45);
  rect(P.x - 1, P.y - 1, P.w + 2, P.h + 2, EDGE);
  rect(P.x, P.y, P.w, P.h, PAPER);
  for (let y = L.body.y + GLYPH + 2; y < P.y + P.h - 10; y += L.body.lineH) rect(P.x + 6, y, P.w - 12, 1, PAPER2);
  rect(P.x + 6, L.title.y + GLYPH + 3, P.w - 12, 1, [232, 190, 150]);
  // 纸角折一下
  for (let k = 0; k < 6; k++) rect(P.x + P.w - 6 + k, P.y + P.h - 6 + (5 - k), 6 - k, 1, PAPER2);
  if (card.kind === "postcard") {
    // 邮票：齿孔小方块，放在纸片右上外沿
    const sx = P.x + P.w - 22, sy = P.y - 10;
    rect(sx, sy, 18, 20, [255, 255, 255]);
    for (let i = 0; i < 18; i += 2) { set(sx + i, sy, EDGE, 0.4); set(sx + i, sy + 19, EDGE, 0.4); }
    rect(sx + 2, sy + 2, 14, 16, [236, 124, 96]); rect(sx + 2, sy + 11, 14, 7, [108, 191, 160]); rect(sx + 9, sy + 5, 4, 4, [255, 217, 138]);
  } else {
    // 书签丝带
    const bx = P.x + P.w - 18; rect(bx, P.y - 4, 6, 18, [196, 84, 94]); set(bx + 2, P.y + 13, [196, 84, 94]); set(bx + 3, P.y + 13, [196, 84, 94]); rect(bx + 2, P.y + 14, 2, 1, PAPER);
  }
  // olo 水印：小像素字 + 一颗暖点
  let mx = L.mark.x;
  for (const ch of "olo") { MINI[ch].forEach((row, j) => [...row].forEach((b, i) => b === "1" && set(mx + i, L.mark.y + j, [200, 150, 110]))); mx += 4; }
  set(L.mark.x - 3, L.mark.y + 2, [255, 179, 71]);
  return { W, H, K: L.K, data: d, layout: L };
}
