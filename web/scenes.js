// 故事分镜：192×108 像素画布，暖色黄昏调，分层视差 + 逐帧粒子。可被 assets/scenes/sceneN.mp4 替换。
import { canvas, P, rng, ticker, drawOlo, REDUCED } from "./pixel.js";

export const W = 192, H = 108;
const SKY = ["#3a1f3d", "#5a2a4a", "#83394f", "#b24f52", "#de7a55", "#f4a862", "#ffcf80"];
const pointer = { x: 0, y: 0 };
addEventListener("pointermove", (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; });

function sky(ctx, t, seed = 1) {
  const band = H / SKY.length;
  SKY.forEach((c, i) => P(ctx, 0, Math.floor(i * band), c, W, Math.ceil(band) + 1));
  // 带抖动的色带过渡
  for (let i = 1; i < SKY.length; i++) { const y = Math.floor(i * band); for (let x = (i % 2); x < W; x += 2) P(ctx, x, y - 1, SKY[i]); }
  const r = rng(seed);
  for (let i = 0; i < 34; i++) {
    const x = (r() * W) | 0, y = (r() * H * 0.3) | 0, ph = (r() * 30) | 0;
    const on = (t + ph) % 30;
    P(ctx, x - pointer.x * 2, y, on < 2 ? "#fff4dc" : on < 20 ? "#d98a8a" : "#8a4a62");
    if (on === 0 && r() > 0.5) { P(ctx, x - 1 - pointer.x * 2, y, "#fff4dc"); P(ctx, x + 1 - pointer.x * 2, y, "#fff4dc"); }
  }
  // 慢慢飘过的暖色云
  for (let i = 0; i < 4; i++) {
    const cw = 26 + ((r() * 30) | 0), cy = 10 + ((r() * 34) | 0), cx = ((r() * W + t * (0.05 + i * 0.03)) % (W + cw)) - cw - pointer.x * (3 + i);
    P(ctx, cx, cy, i % 2 ? "#f2a07a" : "#e8806a", cw, 2); P(ctx, cx + 4, cy - 1, i % 2 ? "#ffc89a" : "#f6a487", cw - 10, 1); P(ctx, cx + 6, cy + 2, "#c8605e", cw - 8, 1);
  }
}

function moon(ctx, x, y, t) {
  // 落日：大圆盘 + 条纹 + 呼吸光晕
  const R = 11, g = 16 + ((t >> 3) % 2);
  for (let yy = -g; yy <= g; yy++) for (let xx = -g; xx <= g; xx++) {
    const d = Math.hypot(xx, yy);
    if (d <= R) { if (yy > 3 && (yy - 3) % 3 === 0) continue; P(ctx, x + xx, y + yy, d < 6 ? "#fff6d8" : d < 9 ? "#ffe39a" : "#ffc46b"); }
    else if (d < g && (xx + yy) % 2 === 0) { ctx.globalAlpha = 0.22 * (1 - (d - R) / (g - R)); P(ctx, x + xx, y + yy, "#ffe39a"); ctx.globalAlpha = 1; }
  }
}

function hills(ctx, base, amp, freq, color, off) {
  for (let x = 0; x < W; x++) {
    const h = Math.round(base - amp * (Math.sin((x + off) * freq) * 0.6 + Math.sin((x + off) * freq * 2.3 + 1) * 0.4));
    P(ctx, x, h, color, 1, H - h);
  }
}

function water(ctx, top, t) {
  const cols = ["#c8645a", "#9a4a58", "#6e3550", "#4a2442"];
  const band = (H - top) / cols.length;
  cols.forEach((c, i) => P(ctx, 0, Math.floor(top + i * band), c, W, Math.ceil(band) + 1));
  const r = rng(7);
  for (let i = 0; i < 46; i++) {
    const y = top + 2 + ((r() * (H - top - 2)) | 0);
    const len = 3 + ((r() * 7) | 0);
    const speed = 0.3 + (y - top) / 60;
    const x = ((r() * W + t * speed) % (W + 20)) - 10;
    P(ctx, x, y, (t + i) % 9 < 5 ? "#ffb878" : "#e08a6a", len, 1);
  }
}

function mist(ctx, y, t, speed, alpha, seed) {
  const r = rng(seed);
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 6; i++) {
    const w = 30 + ((r() * 40) | 0), x = ((r() * W + t * speed) % (W + w)) - w, yy = y + ((r() * 8) | 0);
    for (let k = 0; k < w; k++) if ((k + yy) % 2 === 0 || (k > 4 && k < w - 4)) P(ctx, x + k, yy, "#ffe0c4");
    for (let k = 6; k < w - 6; k += 2) P(ctx, x + k + (yy % 2), yy - 1, "#ffe0c4");
  }
  ctx.globalAlpha = 1;
}

function seedLamp(ctx, x, y, t, i = 0, big = false) {
  const pulse = (t + i * 3) % 12 < 6;
  const R = big ? 6 : 4;
  for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
    const d = Math.hypot(xx, yy);
    if (d < R && d > (big ? 2.5 : 1.6) && (xx + yy) % 2 === 0) { ctx.globalAlpha = pulse ? 0.55 : 0.3; P(ctx, x + xx, y + yy, "#ffe27a"); }
  }
  ctx.globalAlpha = 1;
  P(ctx, x - 1, y - 1, "#fff8d8", 2, 2);
  P(ctx, x - 1, y + 1, "#ffcf5a", 2, 1);
  if (big) { P(ctx, x - 2, y - 1, "#ffcf5a", 1, 2); P(ctx, x + 1, y - 1, "#ffcf5a", 1, 2); P(ctx, x - 1, y - 2, "#fff8d8", 2, 1); P(ctx, x - 1, y - 4, "#5fbf7f"); P(ctx, x, y - 5, "#8be3a8", 2, 1); P(ctx, x - 2, y - 5, "#47b06c"); }
}

// ---------- 分镜 ----------
const city = (() => {
  const r = rng(11), far = [], near = [];
  for (let x = -10; x < W + 20;) { const w = 8 + ((r() * 12) | 0); far.push([x, w, 20 + ((r() * 30) | 0)]); x += w + 1; }
  for (let x = -10; x < W + 20;) { const w = 12 + ((r() * 16) | 0); near.push([x, w, 26 + ((r() * 34) | 0), (r() * 1000) | 0]); x += w + 2; }
  return { far, near };
})();
const rising = [];

function scene1(ctx, t) {
  sky(ctx, t, 3);
  moon(ctx, 150 - pointer.x * 3, 50, t);
  const fo = pointer.x * 4;
  city.far.forEach(([x, w, h]) => P(ctx, x - fo, H - 18 - h, "#8a3f5a", w, h + 18));
  const no = pointer.x * 9;
  city.near.forEach(([x, w, h, s]) => {
    P(ctx, x - no, H - h, "#4a2340", w, h);
    P(ctx, x - no, H - h, "#ff9a6a", w, 1); P(ctx, x - no + w - 1, H - h, "#3a1a33", 1, h);
    const r = rng(s);
    for (let yy = H - h + 4; yy < H - 4; yy += 5) for (let xx = x + 2; xx < x + w - 2; xx += 4) {
      const lit = r() > 0.55, flick = lit && (t + s + xx) % 53 === 0;
      if (lit && !flick) P(ctx, xx - no, yy, r() > 0.3 ? "#ffdf8a" : "#ffb35c", 2, 2);
      if (lit && !REDUCED && r() > 0.985 && rising.length < 60) rising.push({ x: xx - no + 1, y: yy, life: 0, w: r() * 6 });
    }
  });
  // 没说出口的话：从窗口里升起的雾
  for (let i = rising.length - 1; i >= 0; i--) {
    const p = rising[i]; p.life++; p.y -= 0.45; p.x += Math.sin((p.life + p.w) / 6) * 0.35;
    const a = p.life < 10 ? p.life / 10 : Math.max(0, 1 - (p.life - 10) / 60);
    ctx.globalAlpha = a * 0.8; P(ctx, p.x, p.y, p.life % 8 < 4 ? "#fff0d8" : "#ffc9a8", p.life > 30 ? 2 : 1, p.life > 30 ? 2 : 1); ctx.globalAlpha = 1;
    if (p.life > 70) rising.splice(i, 1);
  }
  mist(ctx, 70, t, 0.3, 0.25, 5);
}

function riverBase(ctx, t) {
  sky(ctx, t, 9);
  moon(ctx, 44 - pointer.x * 3, 58, t);
  hills(ctx, 58, 8, 0.045, "#8a3f5a", pointer.x * 4);
  hills(ctx, 66, 6, 0.07, "#5a2848", 40 + pointer.x * 8);
  water(ctx, 70, t);
  // 月亮倒影
  for (let i = 0; i < 8; i++) if ((t + i) % 6 < 4) P(ctx, 36 + ((i * 3) % 7) - i - pointer.x * 3, 72 + i * 4, i < 3 ? "#fff0b0" : "#ffcf7a", 16 - i * 1.5, 1);
  mist(ctx, 62, t, 0.5, 0.3, 2);
}

function scene2(ctx, t) {
  riverBase(ctx, t);
  const r = rng(21);
  for (let i = 0; i < 11; i++) {
    const bx = 14 + i * 16 + ((r() * 8) | 0) - pointer.x * 10, by = 76 + ((r() * 22) | 0);
    const appear = t - i * 3;
    if (appear < 0) continue;
    const y = by + (((t + i * 5) >> 3) % 2);
    seedLamp(ctx, bx, y, t, i);
    for (let k = 1; k < 4; k++) if ((t + k + i) % 4 < 3) { ctx.globalAlpha = 0.4 / k; P(ctx, bx - 1, y + 3 + k * 2, "#ffe27a", 2, 1); ctx.globalAlpha = 1; }
  }
  mist(ctx, 86, t, 0.8, 0.22, 4);
}

function boat(ctx, x, y, t) {
  // 船身
  P(ctx, x, y, "#5a3b2a", 44, 3); P(ctx, x + 2, y + 3, "#4a2f22", 40, 2); P(ctx, x + 5, y + 5, "#3a2419", 34, 1);
  P(ctx, x - 2, y - 2, "#6e4a34", 3, 2); P(ctx, x + 43, y - 2, "#6e4a34", 3, 2); P(ctx, x + 1, y - 1, "#7d5740", 42, 1);
  // 芦婆婆：蓑衣 + 斗笠 + 竹篙
  const gx = x + 10;
  P(ctx, gx, y - 14, "#7a5a78", 8, 13); P(ctx, gx + 1, y - 15, "#9a7a90", 6, 1); P(ctx, gx, y - 14, "#ffb88a", 1, 13);
  for (let k = 0; k < 8; k += 2) P(ctx, gx + k, y - 3, "#5a4060", 1, 2);
  P(ctx, gx + 2, y - 18, "#e8c9a6", 4, 3);
  P(ctx, gx - 3, y - 19, "#c9a24f", 14, 1); P(ctx, gx - 1, y - 20, "#d9b65f", 10, 1); P(ctx, gx + 1, y - 21, "#e6c56c", 6, 1); P(ctx, gx + 3, y - 22, "#e6c56c", 2, 1);
  const lean = (t >> 3) % 2;
  for (let k = 0; k < 30; k++) P(ctx, gx + 9 + ((k * (3 + lean)) / 10) | 0, y - 16 + k, "#cdb48a");
  P(ctx, gx + 7, y - 11, "#e8c9a6", 2, 2);
  // 船头的灯籽
  P(ctx, x + 36, y - 9, "#4a2f22", 1, 8);
  seedLamp(ctx, x + 37, y - 11, t, 0, true);
}

function scene3(ctx, t) {
  riverBase(ctx, t);
  const travel = Math.min(1, t / 50);
  const ease = 1 - (1 - travel) ** 3;
  const bx = -50 + ease * 110 - pointer.x * 10;
  const by = 80 + (((t >> 3) % 2));
  // 尾迹
  for (let k = 0; k < 6; k++) { ctx.globalAlpha = 0.5 - k * 0.07; P(ctx, bx - 4 - k * 6, by + 6 + (k % 2), "#ffd0a0", 4, 1); ctx.globalAlpha = 1; }
  boat(ctx, bx, by, t);
  // 倒影
  ctx.globalAlpha = 0.25; P(ctx, bx + 2, by + 8, "#5a3b2a", 40, 2); P(ctx, bx + 36, by + 10, "#ffe27a", 2, 3); ctx.globalAlpha = 1;
  // 萤火
  const r = rng(33);
  for (let i = 0; i < 8; i++) {
    const fx = (r() * W + Math.sin((t + i * 9) / 9) * 6) | 0, fy = 50 + ((r() * 30) | 0) + Math.round(Math.cos((t + i * 7) / 7) * 3);
    if ((t + i * 4) % 16 < 11) { P(ctx, fx, fy, "#fff3a0"); ctx.globalAlpha = 0.35; P(ctx, fx - 1, fy, "#fff3a0", 3, 1); P(ctx, fx, fy - 1, "#fff3a0", 1, 3); ctx.globalAlpha = 1; }
  }
  mist(ctx, 92, t, 1, 0.2, 8);
}

const sparks = [];
function scene4(ctx, t, host) {
  // 房间
  P(ctx, 0, 0, "#5a3330", W, H);
  for (let y = 0; y < 82; y += 6) for (let x = (y / 6) % 2 ? 0 : 6; x < W; x += 12) P(ctx, x + 2, y + 2, "#62393a", 2, 2);
  P(ctx, 0, 0, "#4a2a2a", W, 3); P(ctx, 0, 78, "#4a2a2a", W, 4);
  // 台灯的暖光锥
  for (let y = 58; y < 86; y++) { const hw = (y - 58) * 1.3 + 6; for (let x = -hw; x <= hw; x++) if (((x | 0) + y) % 2 === 0) { ctx.globalAlpha = 0.16; P(ctx, 159 + x, y, "#ffd98a"); } }
  ctx.globalAlpha = 1;
  // 窗
  const wx = 18, wy = 12;
  P(ctx, wx - 2, wy - 2, "#8a5a3a", 64, 50); P(ctx, wx - 4, wy + 46, "#a8724a", 68, 3);
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, 60, 46); ctx.clip();
  ctx.translate(wx - 20, wy - 10); sky(ctx, t, 4); moon(ctx, 60, 50, t); ctx.restore();
  P(ctx, wx + 29, wy, "#8a5a3a", 2, 46); P(ctx, wx, wy + 22, "#8a5a3a", 60, 2); P(ctx, wx - 6, wy - 4, "#c0605a", 6, 54); P(ctx, wx + 60, wy - 4, "#c0605a", 6, 54); for (let k = 0; k < 54; k += 3) { P(ctx, wx - 4, wy - 4 + k, "#a04a4a"); P(ctx, wx + 62, wy - 4 + k, "#a04a4a"); }
  // 桌子
  P(ctx, 0, 82, "#a8683e", W, 4); P(ctx, 0, 86, "#6e4128", W, H - 86); P(ctx, 0, 82, "#d89a5a", W, 1); for (let x = 6; x < W; x += 23) P(ctx, x, 88, "#5a3420", 10, 1);
  // 台灯
  P(ctx, 150, 52, "#e8a050", 18, 7); P(ctx, 152, 51, "#ffc46b", 14, 1); P(ctx, 152, 59, "#fff0b0", 14, 1); P(ctx, 158, 60, "#6e4128", 2, 22); P(ctx, 152, 80, "#6e4128", 14, 2); P(ctx, 30, 70, "#6aa060", 6, 8); P(ctx, 28, 66, "#8ac070", 4, 4); P(ctx, 34, 64, "#8ac070", 4, 5); P(ctx, 29, 76, "#c0705a", 8, 6);
  // 手机（立在支架上）
  const px = 104, py = 48, pw = 24, ph = 34;
  const landT = 26, glow = t > landT;
  P(ctx, px + 6, py + ph, "#3a2420", 12, 2); P(ctx, px + 10, py + ph - 2, "#3a2420", 4, 2);
  P(ctx, px - 1, py - 1, "#2a1614", pw + 2, ph + 2);
  P(ctx, px + 1, py + 2, glow ? ((t - landT) % 10 < 5 ? "#ffd98a" : "#ffcb78") : "#4a3048", pw - 2, ph - 5);
  P(ctx, px + pw / 2 - 2, py, "#4a2a2a", 4, 1);
  if (!glow) { P(ctx, px + 3, py + 6, "#7a5070", 12, 2); P(ctx, px + 3, py + 10, "#7a5070", 16, 2); P(ctx, px + 3, py + 14, "#7a5070", 9, 2); }
  if (glow) {
    for (let yy = py + 3; yy < py + ph - 3; yy += 3) P(ctx, px + 2, yy, "#ffe9b8", pw - 4, 1);
    const cx = px + pw / 2, cy = py + ph / 2, R = 30 + ((t >> 2) % 2) * 2;
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y * 1.2);
      if (d < R && d > 14 && (x + y) % 2 === 0 && (d < 22 || (x * 3 + y) % 4 === 0)) { ctx.globalAlpha = 0.22; P(ctx, cx + x, cy + y, "#ffd98a"); }
    }
    ctx.globalAlpha = 1;
  }
  // 灯籽沿弧线落下
  if (t <= landT) {
    const k = t / landT, sx = wx + 40 + k * (px + 12 - wx - 40), sy = wy + 14 + k * k * (py + 14 - wy - 14) - Math.sin(k * Math.PI) * 14;
    for (let j = 1; j < 7; j++) { const kk = Math.max(0, (t - j) / landT); ctx.globalAlpha = 0.6 - j * 0.08; P(ctx, wx + 40 + kk * (px + 12 - wx - 40), wy + 14 + kk * kk * (py + 14 - wy - 14) - Math.sin(kk * Math.PI) * 14, "#ffe27a"); ctx.globalAlpha = 1; }
    seedLamp(ctx, sx, sy, t, 0, true);
  }
  if (t === landT + 1 && !REDUCED) {
    host?.classList.add("shake"); setTimeout(() => host?.classList.remove("shake"), 400);
    for (let i = 0; i < 26; i++) sparks.push({ x: px + 12, y: py + 14, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3, life: 0 });
  }
  if (t > landT && t < landT + 4) { ctx.globalAlpha = 0.5 - (t - landT) * 0.12; P(ctx, 0, 0, "#fff6d8", W, H); ctx.globalAlpha = 1; }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.life++; s.x += s.vx; s.y += s.vy; s.vy += 0.15;
    P(ctx, s.x, s.y, s.life % 4 < 2 ? "#fff3a0" : "#ffcf5a");
    if (s.life > 24) sparks.splice(i, 1);
  }
  // olo 从屏幕光里探出头来
  if (t > landT + 8) {
    const up = Math.min(16, (t - landT - 8) * 2);
    ctx.save(); ctx.beginPath(); ctx.rect(px - 12, 0, pw + 24, py + 6); ctx.clip();
    drawOlo(ctx, { state: up >= 16 ? "happy" : "idle", t: ticker.ft, ox: px - 4, oy: py - up - 8 + 6 });
    ctx.restore();
  }
}

const SCENES = [scene1, scene2, scene3, scene4];

export async function mountScene(host, index) {
  const src = `assets/scenes/scene${index + 1}.mp4`;
  try {
    const head = await fetch(src, { method: "HEAD" });
    if (head.ok && (head.headers.get("content-type") || "").includes("video")) {
      const v = document.createElement("video");
      Object.assign(v, { src, autoplay: true, loop: true, muted: true, playsInline: true });
      v.className = "scene-video";
      host.appendChild(v);
      host.dataset.mode = "video";
      return () => v.remove();
    }
  } catch {}
  const [c, ctx] = canvas(W, H, "scene-canvas");
  host.appendChild(c);
  host.dataset.mode = "canvas";
  rising.length = 0; sparks.length = 0;
  const start = ticker.t;
  const draw = (t) => SCENES[index](ctx, REDUCED ? 60 : t - start, host);
  draw(start);
  return ticker.add(draw);
}
