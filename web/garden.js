// 像素花园：128×72，黄昏调；按阶段长出植物、路灯、萤火；有新雨滴时下一阵金色的雨。
import { canvas, P, rng, ticker, drawOlo, REDUCED } from "./pixel.js";

const GW = 128, GH = 72;
const FLOWER = ["#ff8a8a", "#ffd36b", "#ffb0c8", "#7fd0c0"];

function plant(ctx, x, base, h, t, i, bloom) {
  const sway = ((t >> 3) + i) % 2;
  for (let k = 0; k < h; k++) P(ctx, x + (k > h - 3 ? sway : 0), base - k, k % 3 === 0 ? "#4f7a2c" : "#5f9a33");
  const top = base - h;
  P(ctx, x - 3 + sway, top + 3, "#7ab83f", 3, 1); P(ctx, x - 2 + sway, top + 2, "#7ab83f", 2, 1);
  P(ctx, x + 1 + sway, top + 4, "#b8e05a", 3, 1); P(ctx, x + 2 + sway, top + 3, "#b8e05a", 2, 1);
  if (bloom) {
    const c = FLOWER[i % FLOWER.length], fx = x + sway, fy = top - 1;
    P(ctx, fx - 1, fy, c, 3, 1); P(ctx, fx, fy - 1, c, 1, 3); P(ctx, fx - 2, fy, c); P(ctx, fx + 2, fy, c); P(ctx, fx, fy - 2, c); P(ctx, fx, fy + 2, c);
    P(ctx, fx, fy, "#fff6c9");
  }
}

export function mountGarden(host, g, profile, { rain = false } = {}) {
  const [c, ctx] = canvas(GW, GH, "garden-canvas");
  host.appendChild(c);
  const level = g.level, r0 = rng(5);
  const spots = Array.from({ length: 10 }, (_, i) => ({ x: 10 + i * 11 + ((r0() * 5) | 0), h: 5 + ((r0() * 7) | 0) }));
  const count = [1, 3, 5, 8, 10][level - 1] ?? 0;
  const drops = [];
  const start = ticker.t;
  const draw = (T) => {
    const t = REDUCED ? 40 : T - start;
    // 夜空
    ["#4a2444", "#6e3050", "#9a4256", "#c85e58", "#e8875a", "#f6b068"].forEach((col, i) => P(ctx, 0, i * 8, col, GW, 8));
    for (let i = 1; i < 6; i++) for (let x = i % 2; x < GW; x += 2) P(ctx, x, i * 8 - 1, ["#4a2444", "#6e3050", "#9a4256", "#c85e58", "#e8875a", "#f6b068"][i]);
    const rs = rng(3);
    for (let i = 0; i < 14; i++) { const x = (rs() * GW) | 0, y = (rs() * 14) | 0; P(ctx, x, y, (t + i * 7) % 24 < 3 ? "#fff4dc" : "#b0607a"); }
    // 落日
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) { const d = Math.hypot(x, y); if (d < 7 && !(y > 2 && y % 2 === 0)) P(ctx, 30 + x, 44 + y, d < 4 ? "#fff3c8" : "#ffd27a"); }
    // 远山与地面
    for (let x = 0; x < GW; x++) { const h = 46 - Math.round(4 * Math.sin(x * 0.08) + 2 * Math.sin(x * 0.21)); P(ctx, x, h, "#7a3a58", 1, GH - h); }
    for (let x = 0; x < GW; x++) { const h = 50 - Math.round(2 * Math.sin(x * 0.13 + 2)); P(ctx, x, h, "#5a2c48", 1, GH - h); }
    P(ctx, 0, 54, "#6a7a34", GW, 18); P(ctx, 0, 60, "#55642c", GW, 12);
    for (let x = 0; x < GW; x++) { P(ctx, x, 54 - ((x * 7) % 3 === 0 ? 1 : 0), (x % 4 ? "#a8b84a" : "#d8c860")); if ((x * 13) % 5 === 0) P(ctx, x, 57 + ((x * 3) % 9), "#4a5626"); }
    for (let x = 2; x < GW; x += 9) P(ctx, x, 62 + ((x >> 1) % 6), "#8a5a34", 2, 1);
    // 路灯
    if (level >= 3) {
      const lx = 104; P(ctx, lx, 30, "#4a2a2a", 2, 25); P(ctx, lx - 2, 29, "#6e4128", 6, 1);
      const on = (t >> 2) % 6 !== 0;
      for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) if (Math.hypot(x, y) < 7 && (x + y) % 2 === 0) { ctx.globalAlpha = on ? 0.3 : 0.18; P(ctx, lx + 1 + x, 27 + y, "#ffe69a"); }
      ctx.globalAlpha = 1; P(ctx, lx - 1, 25, "#fff3c4", 4, 4);
    }
    // 植物
    spots.slice(0, count).forEach((s, i) => {
      const grow = Math.min(s.h, Math.max(1, ((t - i * 3) >> 1)));
      plant(ctx, s.x, 54, grow, t, i, level >= 4 && i % 2 === 0 && grow >= s.h);
    });
    // olo 坐在花园中间
    drawOlo(ctx, { form: profile.form, color: profile.color, state: rain && t < 30 ? "happy" : "idle", t: ticker.ft, ox: 48, oy: 30 });
    // 萤火
    const flies = level >= 5 ? 12 : level >= 4 ? 5 : level >= 2 ? 2 : 0;
    for (let i = 0; i < flies; i++) {
      const fx = 8 + ((i * 37) % 112) + Math.round(Math.sin((t + i * 11) / 8) * 5), fy = 24 + ((i * 17) % 24) + Math.round(Math.cos((t + i * 5) / 6) * 3);
      if ((t + i * 3) % 14 < 10) { P(ctx, fx, fy, "#fff3a0"); ctx.globalAlpha = 0.35; P(ctx, fx - 1, fy, "#fff3a0", 3, 1); P(ctx, fx, fy - 1, "#fff3a0", 1, 3); ctx.globalAlpha = 1; }
    }
    // 雨滴
    if (rain && t < 40 && !REDUCED) for (let k = 0; k < 3; k++) drops.push({ x: Math.random() * GW, y: -2, s: 2 + Math.random() });
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.y += d.s;
      if (d.y >= 54) { P(ctx, d.x - 1, 53, "#ffe9c8", 3, 1); drops.splice(i, 1); continue; }
      P(ctx, d.x, d.y, "#ffd9a8", 1, 2);
    }
  };
  draw(ticker.t);
  return ticker.add(draw);
}
