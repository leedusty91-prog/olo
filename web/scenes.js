// 故事分镜：192×108 像素画布，分层视差 + 逐帧粒子。可被 assets/scenes/sceneN.mp4 替换。
import { canvas, P, rng, ticker, drawOlo, REDUCED } from "./pixel.js";

export const W = 192, H = 108;
const SKY = ["#0d0f22", "#141634", "#1b1c44", "#231f52", "#2d2560", "#3a2b6b"];
const pointer = { x: 0, y: 0 };
addEventListener("pointermove", (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; });

function sky(ctx, t, seed = 1) {
  const band = H / SKY.length;
  SKY.forEach((c, i) => P(ctx, 0, Math.floor(i * band), c, W, Math.ceil(band) + 1));
  // 带抖动的色带过渡
  for (let i = 1; i < SKY.length; i++) { const y = Math.floor(i * band); for (let x = (i % 2); x < W; x += 2) P(ctx, x, y - 1, SKY[i]); }
  const r = rng(seed);
  for (let i = 0; i < 70; i++) {
    const x = (r() * W) | 0, y = (r() * H * 0.62) | 0, ph = (r() * 30) | 0;
    const on = (t + ph) % 30;
    P(ctx, x - pointer.x * 2, y, on < 2 ? "#ffffff" : on < 20 ? "#9a93d6" : "#5a548f");
    if (on === 0 && r() > 0.5) { P(ctx, x - 1 - pointer.x * 2, y, "#ffffff"); P(ctx, x + 1 - pointer.x * 2, y, "#ffffff"); }
  }
}

function moon(ctx, x, y, t) {
  for (let yy = -9; yy <= 9; yy++) for (let xx = -9; xx <= 9; xx++) {
    const d = Math.hypot(xx, yy);
    if (d <= 5.5) P(ctx, x + xx, y + yy, d < 4 ? "#fff6d8" : "#ffe7a6");
    else if (d < 9 && (xx + yy + (t >> 3)) % 2 === 0) { ctx.globalAlpha = 0.18; P(ctx, x + xx, y + yy, "#ffe7a6"); ctx.globalAlpha = 1; }
  }
  P(ctx, x - 2, y - 1, "#f1dca0"); P(ctx, x + 1, y + 2, "#f1dca0", 2, 1);
}

function hills(ctx, base, amp, freq, color, off) {
  for (let x = 0; x < W; x++) {
    const h = Math.round(base - amp * (Math.sin((x + off) * freq) * 0.6 + Math.sin((x + off) * freq * 2.3 + 1) * 0.4));
    P(ctx, x, h, color, 1, H - h);
  }
}

function water(ctx, top, t) {
  const cols = ["#1c2a5a", "#18234d", "#141c40", "#101634"];
  const band = (H - top) / cols.length;
  cols.forEach((c, i) => P(ctx, 0, Math.floor(top + i * band), c, W, Math.ceil(band) + 1));
  const r = rng(7);
  for (let i = 0; i < 46; i++) {
    const y = top + 2 + ((r() * (H - top - 2)) | 0);
    const len = 3 + ((r() * 7) | 0);
    const speed = 0.3 + (y - top) / 60;
    const x = ((r() * W + t * speed) % (W + 20)) - 10;
    P(ctx, x, y, (t + i) % 9 < 5 ? "#3d55a0" : "#2b3d7c", len, 1);
  }
}

function mist(ctx, y, t, speed, alpha, seed) {
  const r = rng(seed);
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 6; i++) {
    const w = 30 + ((r() * 40) | 0), x = ((r() * W + t * speed) % (W + w)) - w, yy = y + ((r() * 8) | 0);
    for (let k = 0; k < w; k++) if ((k + yy) % 2 === 0 || (k > 4 && k < w - 4)) P(ctx, x + k, yy, "#b9b0f0");
    for (let k = 6; k < w - 6; k += 2) P(ctx, x + k + (yy % 2), yy - 1, "#b9b0f0");
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
  moon(ctx, 160 - pointer.x * 3, 20, t);
  const fo = pointer.x * 4;
  city.far.forEach(([x, w, h]) => P(ctx, x - fo, H - 18 - h, "#24234a", w, h + 18));
  const no = pointer.x * 9;
  city.near.forEach(([x, w, h, s]) => {
    P(ctx, x - no, H - h, "#121230", w, h);
    P(ctx, x - no, H - h, "#1d1c40", w, 1);
    const r = rng(s);
    for (let yy = H - h + 4; yy < H - 4; yy += 5) for (let xx = x + 2; xx < x + w - 2; xx += 4) {
      const lit = r() > 0.55, flick = lit && (t + s + xx) % 53 === 0;
      if (lit && !flick) P(ctx, xx - no, yy, r() > 0.3 ? "#ffd677" : "#ffb35c", 2, 2);
      if (lit && !REDUCED && r() > 0.985 && rising.length < 60) rising.push({ x: xx - no + 1, y: yy, life: 0, w: r() * 6 });
    }
  });
  // 没说出口的话：从窗口里升起的雾
  for (let i = rising.length - 1; i >= 0; i--) {
    const p = rising[i]; p.life++; p.y -= 0.45; p.x += Math.sin((p.life + p.w) / 6) * 0.35;
    const a = p.life < 10 ? p.life / 10 : Math.max(0, 1 - (p.life - 10) / 60);
    ctx.globalAlpha = a * 0.8; P(ctx, p.x, p.y, p.life % 8 < 4 ? "#d9d2ff" : "#a99ee8", p.life > 30 ? 2 : 1, p.life > 30 ? 2 : 1); ctx.globalAlpha = 1;
    if (p.life > 70) rising.splice(i, 1);
  }
  mist(ctx, 70, t, 0.3, 0.25, 5);
}

function riverBase(ctx, t) {
  sky(ctx, t, 9);
  moon(ctx, 30 - pointer.x * 3, 18, t);
  hills(ctx, 58, 8, 0.045, "#2a2558", pointer.x * 4);
  hills(ctx, 66, 6, 0.07, "#1d1a44", 40 + pointer.x * 8);
  water(ctx, 70, t);
  // 月亮倒影
  for (let i = 0; i < 6; i++) if ((t + i) % 6 < 4) P(ctx, 27 + ((i * 3) % 5) - pointer.x * 3, 74 + i * 5, "#e9d79a", 4 - (i % 3), 1);
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
  P(ctx, gx, y - 14, "#6f6492", 8, 13); P(ctx, gx + 1, y - 15, "#7f74a6", 6, 1);
  for (let k = 0; k < 8; k += 2) P(ctx, gx + k, y - 3, "#5a5078", 1, 2);
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
  for (let k = 0; k < 6; k++) { ctx.globalAlpha = 0.5 - k * 0.07; P(ctx, bx - 4 - k * 6, by + 6 + (k % 2), "#6f86d6", 4, 1); ctx.globalAlpha = 1; }
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
  P(ctx, 0, 0, "#191a33", W, H);
  for (let y = 0; y < 80; y += 8) for (let x = (y / 8) % 2 ? 0 : 8; x < W; x += 16) P(ctx, x, y, "#1b1c37", 8, 8);
  // 窗
  const wx = 18, wy = 12;
  P(ctx, wx - 2, wy - 2, "#3b3560", 64, 50);
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, 60, 46); ctx.clip();
  ctx.translate(wx - 20, wy - 10); sky(ctx, t, 4); ctx.restore();
  P(ctx, wx + 29, wy, "#3b3560", 2, 46); P(ctx, wx, wy + 22, "#3b3560", 60, 2);
  // 桌子
  P(ctx, 0, 82, "#5b3d2c", W, 4); P(ctx, 0, 86, "#3f291d", W, H - 86); P(ctx, 0, 82, "#7a5440", W, 1);
  // 台灯
  P(ctx, 150, 56, "#6b5b8a", 18, 8); P(ctx, 158, 64, "#4a3f66", 2, 18); P(ctx, 152, 80, "#4a3f66", 14, 2);
  // 手机（立在支架上）
  const px = 104, py = 48, pw = 24, ph = 34;
  const landT = 26, glow = t > landT;
  P(ctx, px + 6, py + ph, "#2a2440", 12, 2); P(ctx, px + 10, py + ph - 2, "#2a2440", 4, 2);
  P(ctx, px - 1, py - 1, "#0b0b16", pw + 2, ph + 2);
  P(ctx, px + 1, py + 2, glow ? ((t - landT) % 10 < 5 ? "#fff1c0" : "#ffd98a") : "#2a3160", pw - 2, ph - 5);
  P(ctx, px + pw / 2 - 2, py, "#22223a", 4, 1);
  if (!glow) { P(ctx, px + 3, py + 6, "#3a4380", 12, 2); P(ctx, px + 3, py + 10, "#3a4380", 16, 2); P(ctx, px + 3, py + 14, "#3a4380", 9, 2); }
  if (glow) {
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
    drawOlo(ctx, { state: up >= 16 ? "happy" : "idle", t, ox: px - 4, oy: py - up - 8 + 6 });
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
