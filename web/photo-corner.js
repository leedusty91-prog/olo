// 照片 → 像素小角落（客户端这一半）
// 1) analyzePhoto：照片只在本机缩成 12×9 像素缩略图 + 主色 + 几个画面特征，原图不上传。
// 2) buildCornerScene：把服务端（聊天模型，thinking 开着）给的布局变成一个能走进去的 8×8 场景，结构和 SCENES 一样。
import { P } from "./pixel.js";

const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export async function analyzePhoto(file) {
  const bmp = await createImageBitmap(file);
  const W = 48, H = 36, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true });
  // 居中裁成 4:3 再缩小
  const s = Math.min(bmp.width / 4, bmp.height / 3), sw = s * 4, sh = s * 3;
  x.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, W, H);
  bmp.close?.();
  return analyzePixels(x.getImageData(0, 0, W, H).data, W, H);
}

export function analyzePixels(d, W, H) {
  const n = W * H, buckets = new Map();
  let lum = 0, warm = 0, green = 0, blue = 0, sat = 0, busy = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum += (0.299 * r + 0.587 * g + 0.114 * b) / 255; sat += mx ? (mx - mn) / mx : 0;
    if (r > b + 24 && r >= g - 10) warm++; if (g > r + 8 && g > b + 8) green++; if (b > r + 12 && b >= g - 6) blue++;
    if (i % W) busy += (Math.abs(r - d[i * 4 - 4]) + Math.abs(g - d[i * 4 - 3]) + Math.abs(b - d[i * 4 - 2])) / 765;
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5); const e = buckets.get(k) || [0, 0, 0, 0];
    e[0] += r; e[1] += g; e[2] += b; e[3]++; buckets.set(k, e);
  }
  const palette = [...buckets.values()].sort((a, b) => b[3] - a[3]).slice(0, 6).map((e) => hex(e[0] / e[3], e[1] / e[3], e[2] / e[3]));
  const thumb = [], bx = W / 12, by = H / 9;
  for (let j = 0; j < 9; j++) for (let i = 0; i < 12; i++) {
    let r = 0, g = 0, b = 0, m = 0;
    for (let y = Math.floor(j * by); y < Math.floor((j + 1) * by); y++) for (let x = Math.floor(i * bx); x < Math.floor((i + 1) * bx); x++) { const o = (y * W + x) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; m++; }
    thumb.push(hex(r / m, g / m, b / m));
  }
  const f = (v) => Math.round(v * 100) / 100;
  return { palette, thumb, stats: { bright: f(lum / n), warm: f(warm / n), green: f(green / n), blue: f(blue / n), sat: f(sat / n), busy: f(Math.min(1, busy / n * 6)) } };
}

// 画架：把 12×9 缩略图按 2px 一格画上去，像一张小像素画
export function drawEasel(ctx, X, Y, t, o) {
  P(ctx, X - 9, Y - 4, "#b19bd6", 2, 6); P(ctx, X + 7, Y - 4, "#b19bd6", 2, 6); P(ctx, X - 1, Y - 6, "#ab94d4", 2, 6);
  P(ctx, X - 14, Y - 30, "#a48dcd", 28, 22); P(ctx, X - 13, Y - 29, "#e6d3be", 26, 20);
  const th = o?.thumb || [];
  for (let k = 0; k < th.length; k++) P(ctx, X - 12 + (k % 12) * 2, Y - 28 + Math.floor(k / 12) * 2, th[k], 2, 2);
  P(ctx, X - 14, Y - 8, "#dabda6", 28, 2);
}

const DECO = {
  grass: (h) => (h < 0.16 ? { type: "pine", o: { s: 0.8 + h * 2 } } : h < 0.24 ? { type: "flowers" } : null),
  forest: (h) => (h < 0.22 ? { type: "pine", o: { s: 0.8 + h * 2 } } : h < 0.27 ? { type: "mushroom" } : null),
  sand: (h) => (h < 0.06 ? { type: "reeds" } : h < 0.1 ? { type: "rock", o: { s: 0.7 } } : null),
  dirt: (h) => (h < 0.1 ? { type: "rock", o: { s: 0.8 } } : h < 0.18 ? { type: "pine", o: { s: 0.9 } } : null),
  path: (h) => (h < 0.12 ? { type: "pine", o: { s: 0.9 } } : null),
  stone: (h) => (h < 0.1 ? { type: "rock", o: { s: 0.9 } } : null),
};
// 边缘地面和角落地面一样时换一种，让 8×8 的小角落有清楚的边界
const ALT = { grass: "forest", forest: "grass", sand: "grass", path: "grass", plaza: "grass", wood: "plaza", stone: "grass", dirt: "grass", roof: "roof2" };
const ACT_FOR = { bench: "bench", cushion: "bench" };

export function buildCornerScene(L) {
  const pond = !!L.pond, inPond = (i, j) => pond && Math.hypot(i + 0.5 - 6.3, (j + 0.5 - 6.2) * 1.2) < 1.5;
  const indoorish = L.floor === "wood" || L.floor === "roof", edge = L.edge && L.edge !== L.floor ? L.edge : ALT[L.floor] || "grass";
  const objs = L.props.map((p, k) => ({
    id: `c${k}`, type: p.type, x: p.x, y: p.y, r: p.type === "flowers" || p.type === "shell" ? 0 : 0.45, hit: p.hit,
    act: ACT_FOR[p.type] || "prop", label: p.label, say: p.say || "", info: p.say || "",
  }));
  if (L.thumb?.length === 108) objs.push({ id: "easel", type: "easel", x: 1.2, y: 6.9, r: 0.4, hit: [28, 32], act: "prop", label: "你的照片", say: "这是你拍的那张，我把它画成像素啦。", info: "olo 把你的照片画成了一小幅像素画。", o: { thumb: L.thumb } });
  return {
    id: "corner", name: L.title || "照片里的角落", W: 8, H: 8, horizon: indoorish ? 0.3 : 0.22, spawn: [4, 6.6], amb: pond ? "river" : "city",
    floor: (i, j) => (inPond(i, j) ? (Math.hypot(i + 0.5 - 6.3, (j + 0.5 - 6.2) * 1.2) < 0.8 ? "deep" : "water") : L.floor),
    fill: () => edge,
    walk: (t) => t !== "water" && t !== "deep",
    deco: DECO[edge] ? (i, j, h) => DECO[edge](h) : undefined,
    objs,
    exits: [{ x0: 3, y0: 7.6, x1: 5, y1: 9, to: "plaza", at: [7, 7.2] }],
    critters: L.floor === "grass" || edge === "forest" ? [["butterfly", 3, 3, { col: "#f4e7cb" }], ["butterfly", 5, 2, { col: "#f6d4df" }]] : pond ? [["duck", 6.3, 6.2]] : [["pigeon", 5, 4]],
    items: [],
    corner: L.id, line: L.line,
  };
}
