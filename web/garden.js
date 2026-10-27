// 像素倒影小镇缩影：128×72，粉彩；按阶段长出植物、路灯、萤火；有新涟漪时下倒雨。
import { canvas, P, rng, ticker, drawOlo, REDUCED } from "./pixel.js";

const GW = 128, GH = 72;
const FLOWER = ["#f6d4d4", "#f4e7cb", "#f8dfe7", "#cbeae5"];

function plant(ctx, x, base, h, t, i, bloom) {
  const sway = ((t >> 3) + i) % 2;
  for (let k = 0; k < h; k++) P(ctx, x + (k > h - 3 ? sway : 0), base - k, k % 3 === 0 ? "#9fd8c8" : "#a8dece");
  const top = base - h;
  P(ctx, x - 3 + sway, top + 3, "#b4e2d4", 3, 1); P(ctx, x - 2 + sway, top + 2, "#b4e2d4", 2, 1);
  P(ctx, x + 1 + sway, top + 4, "#c0eddf", 3, 1); P(ctx, x + 2 + sway, top + 3, "#c0eddf", 2, 1);
  if (bloom) {
    const c = FLOWER[i % FLOWER.length], fx = x + sway, fy = top - 1;
    P(ctx, fx - 1, fy, c, 3, 1); P(ctx, fx, fy - 1, c, 1, 3); P(ctx, fx - 2, fy, c); P(ctx, fx + 2, fy, c); P(ctx, fx, fy - 2, c); P(ctx, fx, fy + 2, c);
    P(ctx, fx, fy, "#faf7e7");
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
    // 粉彩天空（奶油→蜜桃→浅紫，不发黑）
    ["#fff6ee", "#ffe8e0", "#f8dce8", "#e8d4f0", "#d8e8f0", "#c8e8e0"].forEach((col, i) => P(ctx, 0, i * 8, col, GW, 8));
    for (let i = 1; i < 6; i++) for (let x = i % 2; x < GW; x += 2) P(ctx, x, i * 8 - 1, ["#fff6ee", "#ffe8e0", "#f8dce8", "#e8d4f0", "#d8e8f0", "#c8e8e0"][i]);
    const rs = rng(3);
    for (let i = 0; i < 14; i++) { const x = (rs() * GW) | 0, y = (rs() * 14) | 0; P(ctx, x, y, (t + i * 7) % 24 < 3 ? "#fbf6ec" : "#dfbfc9"); }
    // 落日
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) { const d = Math.hypot(x, y); if (d < 7 && !(y > 2 && y % 2 === 0)) P(ctx, 30 + x, 44 + y, d < 4 ? "#faf5e6" : "#f5e8cf"); }
    // 远山与地面
    for (let x = 0; x < GW; x++) { const h = 46 - Math.round(4 * Math.sin(x * 0.08) + 2 * Math.sin(x * 0.21)); P(ctx, x, h, "#b8a8d5", 1, GH - h); }
    for (let x = 0; x < GW; x++) { const h = 50 - Math.round(2 * Math.sin(x * 0.13 + 2)); P(ctx, x, h, "#b09dcf", 1, GH - h); }
    P(ctx, 0, 54, "#a4d6c6", GW, 18); P(ctx, 0, 60, "#9ed2c1", GW, 12);
    for (let x = 0; x < GW; x++) { P(ctx, x, 54 - ((x * 7) % 3 === 0 ? 1 : 0), (x % 4 ? "#dbe1b8" : "#ebe6c1")); if ((x * 13) % 5 === 0) P(ctx, x, 57 + ((x * 3) % 9), "#99d0be"); }
    for (let x = 2; x < GW; x += 9) P(ctx, x, 62 + ((x >> 1) % 6), "#dabda6", 2, 1);
    // 路灯
    if (level >= 3) {
      const lx = 104; P(ctx, lx, 30, "#ad9cca", 2, 25); P(ctx, lx - 2, 29, "#b19cd7", 6, 1);
      const on = (t >> 2) % 6 !== 0;
      for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) if (Math.hypot(x, y) < 7 && (x + y) % 2 === 0) { ctx.globalAlpha = on ? 0.3 : 0.18; P(ctx, lx + 1 + x, 27 + y, "#f7efd9"); }
      ctx.globalAlpha = 1; P(ctx, lx - 1, 25, "#f9f5e5", 4, 4);
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
      if ((t + i * 3) % 14 < 10) { P(ctx, fx, fy, "#f7f3db"); ctx.globalAlpha = 0.35; P(ctx, fx - 1, fy, "#f7f3db", 3, 1); P(ctx, fx, fy - 1, "#f7f3db", 1, 3); ctx.globalAlpha = 1; }
    }
    // 雨滴
    // 倒雨：往天上落
    if (rain && t < 40 && !REDUCED) for (let k = 0; k < 3; k++) drops.push({ x: Math.random() * GW, y: 54, s: 2 + Math.random() });
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.y -= d.s;
      if (d.y <= 4) { drops.splice(i, 1); continue; }
      P(ctx, d.x, d.y, "#f8ecdd", 1, 2);
    }
  };
  draw(ticker.t);
  return ticker.add(draw);
}
