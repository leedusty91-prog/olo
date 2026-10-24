// 插画花园：手机端同一套高清天色图 + 插画植物，按阶段长出植物、路灯、萤火；有新雨滴时下一阵金色的雨。
// 逻辑坐标仍是 128×72（方便和旧布局对齐），画布按设备像素放大，全部平滑绘制。
import { canvas, rng, ticker, drawOlo, REDUCED } from "./pixel.js";
import { spr, PLANT_H, preloadWorld } from "./world-hd.js?v=20261025a";

const GW = 128, GH = 72, Z = 10;
const BG = {};
const bg = (k) => { if (!BG[k]) { const im = new Image(); im.decoding = "async"; im.src = new URL(`./assets/bg/bg-${k}.jpg`, import.meta.url).href; BG[k] = im; } return BG[k]; };

export function mountGarden(host, g, profile, { rain = false } = {}) {
  const [c, ctx] = canvas(GW * Z, GH * Z, "garden-canvas olo-hd");
  host.appendChild(c);
  preloadWorld();
  const level = g.level, r0 = rng(5);
  const spots = Array.from({ length: 10 }, (_, i) => ({ x: 10 + i * 11 + ((r0() * 5) | 0), st: 1 + ((r0() * 3) | 0) }));
  const count = [1, 3, 5, 8, 10][level - 1] ?? 0;
  const drops = [];
  const start = ticker.t;
  const sky = bg("dusk");
  const draw = (T) => {
    const t = REDUCED ? 40 : T - start;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (sky.complete && sky.naturalWidth) {
      // 取天色图的中下部（地平线附近），铺满 16:9
      const sw = sky.naturalWidth, sh = sw * GH / GW, sy = Math.max(0, sky.naturalHeight * 0.5 - sh * 0.55);
      ctx.drawImage(sky, 0, sy, sw, sh, 0, 0, c.width, c.height);
    } else { const gr = ctx.createLinearGradient(0, 0, 0, c.height); gr.addColorStop(0, "#6e3050"); gr.addColorStop(1, "#f6b068"); ctx.fillStyle = gr; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.setTransform(Z, 0, 0, Z, 0, 0);
    // 远山与草地（柔和曲线）
    const hill = (base, amp, f, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, GH); for (let x = 0; x <= GW; x += 2) ctx.lineTo(x, base - amp * Math.sin(x * f) - amp * 0.5 * Math.sin(x * f * 2.6 + 1)); ctx.lineTo(GW, GH); ctx.closePath(); ctx.fill(); };
    hill(47, 3.5, 0.08, "rgba(122,74,104,0.75)"); hill(51, 2, 0.13, "rgba(96,60,90,0.85)");
    const gr = ctx.createLinearGradient(0, 53, 0, GH); gr.addColorStop(0, "#9cb85a"); gr.addColorStop(1, "#5e7a34");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, 54); for (let x = 0; x <= GW; x += 4) ctx.lineTo(x, 54 - Math.sin(x * 0.3) * 0.5); ctx.lineTo(GW, GH); ctx.lineTo(0, GH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,240,180,0.18)"; for (let x = 3; x < GW; x += 9) { ctx.beginPath(); ctx.ellipse(x, 62 + ((x >> 1) % 6), 1.2, 0.4, 0, 0, 7); ctx.fill(); }
    // 路灯
    if (level >= 3) {
      const on = REDUCED || (t >> 2) % 6 !== 0;
      spr(ctx, "lamp", 105, 55, 28);
      const gl = ctx.createRadialGradient(105, 30, 0, 105, 30, 9); gl.addColorStop(0, `rgba(255,230,154,${on ? 0.55 : 0.3})`); gl.addColorStop(1, "rgba(255,230,154,0)");
      ctx.fillStyle = gl; ctx.fillRect(94, 19, 22, 22);
    }
    // 植物：按阶段长高（种子 → 芽 → 叶 → 花苞），等级 4 起一半开花
    spots.slice(0, count).forEach((s, i) => {
      const grow = Math.min(1, Math.max(0.15, (t - i * 3) / 20));
      const st = level >= 4 && i % 2 === 0 ? 4 : Math.min(3, s.st + (level >= 3 ? 1 : 0));
      spr(ctx, "plant" + st, s.x, 56, PLANT_H[st] * 0.9 * grow, { rot: REDUCED ? 0 : Math.sin(t * 0.08 + i) * 0.05 });
    });
    // olo 坐在花园中间
    ctx.save(); ctx.translate(48, 28); drawOlo(ctx, { form: profile.form, state: rain && t < 30 ? "happy" : "idle", t: ticker.ft, ox: 0, oy: 0 }); ctx.restore();
    // 萤火
    const flies = level >= 5 ? 12 : level >= 4 ? 5 : level >= 2 ? 2 : 0;
    for (let i = 0; i < flies; i++) {
      const fx = 8 + ((i * 37) % 112) + Math.sin((t + i * 11) / 8) * 5, fy = 24 + ((i * 17) % 24) + Math.cos((t + i * 5) / 6) * 3;
      if (REDUCED || (t + i * 3) % 14 < 10) { const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 2.4); fg.addColorStop(0, "rgba(255,243,160,0.95)"); fg.addColorStop(1, "rgba(255,243,160,0)"); ctx.fillStyle = fg; ctx.fillRect(fx - 3, fy - 3, 6, 6); }
    }
    // 金色的雨
    if (rain && t < 40 && !REDUCED) for (let k = 0; k < 3; k++) drops.push({ x: Math.random() * GW, y: -2, s: 2 + Math.random() });
    ctx.strokeStyle = "rgba(255,217,168,0.85)"; ctx.lineWidth = 0.35; ctx.lineCap = "round";
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.y += d.s;
      if (d.y >= 54) { ctx.fillStyle = "rgba(255,233,200,0.8)"; ctx.beginPath(); ctx.ellipse(d.x, 54, 1.4, 0.4, 0, 0, 7); ctx.fill(); drops.splice(i, 1); continue; }
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x, d.y + 2); ctx.stroke();
    }
  };
  draw(ticker.t);
  return ticker.add(draw);
}
