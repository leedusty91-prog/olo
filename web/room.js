// 收起聊天后的 2.5D 小场景：雾里集的小广场（等距视角像素画，全部程序绘制、原创）。
// 天色/太阳月亮随用户本地时间；道具和 olo 按深度（wx+wy）排序遮挡；olo 脚下有随高度缩放的影子。
// olo 会自己溜达，点一下会有反应，也能抓起来扔：在 2.5D 空间里抛物线飞、撞墙/撞道具反弹、落地挤压。
import { drawOlo, canvas, ticker, REDUCED, P } from "./pixel.js";
import { sfx } from "./audio.js";
import { bands, groundAt, localHour, skyAt, sunProgress } from "./skytime.js?v=20261023b";

const N = 8, TW = 20, TH = 10, WH = 30;               // 8×8 格，格子 20×10，后墙高 30
// 道具：位置（格坐标）、碰撞半径、高度
export const PROPS = [
  { id: "well", x: 4.2, y: 3.6, r: 0.95, h: 16 },
  { id: "tree", x: 1.4, y: 6.2, r: 0.7, h: 34 },
  { id: "lamp", x: 6.6, y: 1.3, r: 0.35, h: 34 },
  { id: "bench", x: 1.6, y: 2.0, r: 0.8, h: 8 },
  { id: "crates", x: 6.5, y: 6.3, r: 0.75, h: 14 },
  { id: "pot", x: 3.3, y: 7.2, r: 0.4, h: 9 },
];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 场景几何（与 apps/mobile/src/Room.tsx 共用同一套数字）
export function geometry(RW, RH) {
  const ox = Math.round(RW / 2), oy = Math.round((RH - N * TH + WH) / 2 + 12);
  const proj = (wx, wy, z = 0) => [ox + (wx - wy) * TW / 2, oy + (wx + wy) * TH / 2 - z];
  const unproj = (sx, sy, z = 0) => { const a = (sx - ox) / (TW / 2), b = (sy + z - oy) / (TH / 2); return [(a + b) / 2, (b - a) / 2]; };
  return { ox, oy, proj, unproj };
}

export function light(hr) {
  const sk = skyAt(hr), g = groundAt(hr), sp = sunProgress(hr);
  const night = sk.star, dusk = sk.phase === "dusk" || sk.phase === "dawn";
  return { sk, g, sp, night, dusk, cols: bands(sk.sky, 10) };
}

// ---------- 静态部分：天空、墙、地面、浮岛侧面 ----------
export function drawBackdrop(ctx, RW, RH, L, t = 0, sky = true) {
  const { proj } = geometry(RW, RH);
  const { sk, sp, cols } = L;
  const bh = RH / cols.length;
  if (!sky) ctx.clearRect(0, 0, RW, RH);
  if (sky) cols.forEach((col, i) => P(ctx, 0, Math.floor(i * bh), col, RW, Math.ceil(bh) + 1));
  if (sky && sk.star > 0.05) for (let i = 0; i < 40; i++) { const x = (i * 53 + 7) % RW, y = (i * 29 + 5) % Math.round(RH * 0.45), on = REDUCED ? 5 : ((t | 0) + i * 7) % 40; ctx.globalAlpha = sk.star * (on < 3 ? 1 : 0.6); P(ctx, x, y, on < 3 ? "#fff6dc" : "#e8d0b8"); }
  ctx.globalAlpha = 1;
  if (!sky) { /* 网页版：全屏 #bg 已经画了天空和日月 */ }
  else if (sp !== null && sk.sun > 0.15) {
    const sx = Math.round(RW * (0.08 + 0.84 * sp)), sy = Math.round(RH * (0.36 - 0.28 * Math.sin(Math.PI * sp))), low = 1 - Math.sin(Math.PI * sp) > 0.6;
    for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) { const d = Math.hypot(x, y);
      if (d < 6) P(ctx, sx + x, sy + y, d < 4 ? (low ? "#ffe0a0" : "#fff6d8") : low ? "#ff9e5a" : "#ffd27a");
      else if (d < 10 && (x + y) % 2 === 0) { ctx.globalAlpha = 0.25 * (1 - (d - 6) / 4); P(ctx, sx + x, sy + y, "#ffd27a"); ctx.globalAlpha = 1; } }
  } else {
    const mx = Math.round(RW * 0.8), my = Math.round(RH * 0.12);
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) { const d = Math.hypot(x, y); if (d <= 5.5 && Math.hypot(x - 2.6, y - 1.6) > 4.6) P(ctx, mx + x, my + y, "#fff0c8"); }
  }
  // 远处的雾和山
  if (sky) for (let x = 0; x < RW; x++) { const hh = Math.round(RH * 0.4 + 6 * Math.sin(x * 0.05) + 3 * Math.sin(x * 0.13)); ctx.globalAlpha = 0.55; P(ctx, x, hh, L.g.hill, 1, RH - hh); }
  ctx.globalAlpha = 1;
  const [ax, ay] = proj(0, 0), [lx, ly] = proj(0, N), [rx, ry] = proj(N, 0), [fx, fy] = proj(N, N);
  // 浮岛侧面（前两面），泥土色，左暗右亮
  for (let x = Math.floor(lx); x <= Math.ceil(rx); x++) {
    const top = x <= fx ? ly + (x - lx) * (fy - ly) / (fx - lx || 1) : fy + (x - fx) * (ry - fy) / (rx - fx || 1);
    const dark = x <= fx;
    for (let j = 0; j < 10; j++) P(ctx, x, Math.round(top) + j, j < 2 ? L.g.grass : j === 9 ? "#3a2418" : ((x + j) % 5 === 0 ? "#6a4228" : dark ? "#7a4e30" : "#9a6640"));
  }
  // 后墙：左墙（x=0 面）偏暗，右墙（y=0 面）偏亮；砖缝；右墙上有个小摊的条纹雨棚，左墙上有扇窗
  const wall = (x0, y0, x1, y1, base, mortar, side) => {
    for (let x = Math.floor(Math.min(x0, x1)); x <= Math.ceil(Math.max(x0, x1)); x++) {
      const f = (x - x0) / (x1 - x0 || 1), fy0 = y0 + (y1 - y0) * f;
      for (let j = 0; j < WH; j++) {
        const yy = Math.round(fy0) - j, row = Math.floor(j / 5), joint = j % 5 === 0 || (x + row * 5 + (side ? 0 : 3)) % 10 === 0;
        P(ctx, x, yy, j === WH - 1 ? "#5a3a2a" : joint ? mortar : base);
      }
    }
  };
  wall(lx, ly, ax, ay, "#b08a6a", "#8a6a50", 0);
  wall(ax, ay, rx, ry, "#d4ae84", "#b08c66", 1);
  // 窗（左墙）：夜里透出暖光
  const [wx0, wy0] = proj(0, 4.6);
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) { const x = wx0 - 4 + i, y = Math.round(wy0 - 12 - j + i * 0.5);
    P(ctx, x, y, i === 0 || i === 8 || j === 0 || j === 8 || i === 4 ? "#4a2a1a" : L.night > 0.4 ? "#ffd98a" : "#9ac8d8"); }
  // 雨棚（右墙）
  const [sx0, sy0] = proj(3.2, 0), [sx1, sy1] = proj(5.6, 0);
  for (let x = Math.round(sx0); x <= Math.round(sx1); x++) { const f = (x - sx0) / (sx1 - sx0), y = Math.round(sy0 + (sy1 - sy0) * f) - 20;
    for (let j = 0; j < 6; j++) P(ctx, x, y + j, Math.floor((x - sx0) / 3) % 2 ? "#fff0dc" : "#e0605a"); P(ctx, x, y + 6, x % 2 ? "#a83a3a" : "#e0605a"); }
  // 地面：石板格子（亮暗交错 + 缝）
  for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
    const [cx, cy] = proj(gx + 0.5, gy + 0.5), alt = (gx + gy) % 2, hsh = (gx * 7 + gy * 13) % 5;
    for (let dy = -TH / 2; dy < TH / 2; dy++) {
      const hw = Math.floor((TW / 2) * (1 - Math.abs(dy + 0.5) / (TH / 2)));
      if (hw <= 0) continue;
      P(ctx, cx - hw, cy + dy, alt ? "#c8b49a" : "#d8c6aa", hw * 2, 1);
      P(ctx, cx - hw, cy + dy, "#a8927a", 1, 1);
    }
    if (hsh === 0) { P(ctx, cx - 3, cy, "#7cae4a", 2, 1); P(ctx, cx + 2, cy + 1, "#9ac860"); }      // 石缝里冒的草
    if (hsh === 2) P(ctx, cx - 1, cy - 1, "#b8a28a", 3, 1);
  }
}

// ---------- 道具（像素小物件），以脚底投影点 (X,Y) 为锚 ----------
export function drawProp(ctx, id, X, Y, L, t = 0) {
  X = Math.round(X); Y = Math.round(Y);
  const shadow = (w) => { ctx.globalAlpha = 0.25; P(ctx, X - w, Y, "#2a1810", w * 2, 2); ctx.globalAlpha = 1; };
  if (id === "well") {
    shadow(12);
    for (let j = 0; j < 10; j++) { const w = 11 - (j === 9 ? 1 : 0); P(ctx, X - w, Y - j - 1, "#7a6a60", w * 2, 1); for (let i = -w; i < w; i += 4) P(ctx, X + i + (j % 2) * 2, Y - j - 1, "#5a4a44"); }
    P(ctx, X - 11, Y - 12, "#9a8a80", 22, 2); P(ctx, X - 9, Y - 11, "#2a4a6a", 18, 2); P(ctx, X - 6, Y - 11, "#4a7a9a", 6, 1);
    P(ctx, X - 10, Y - 28, "#6a4228", 2, 16); P(ctx, X + 8, Y - 28, "#6a4228", 2, 16);
    for (let i = 0; i < 26; i++) { const yy = Math.round(Y - 30 + Math.abs(i - 13) * 0.45); P(ctx, X - 13 + i, yy, i % 3 ? "#b0503a" : "#8a3a2a", 1, 3); }
    P(ctx, X - 1, Y - 26, "#3a2a20", 1, 8); P(ctx, X - 2, Y - 18, "#9a7040", 3, 2);
  } else if (id === "tree") {
    shadow(10);
    P(ctx, X - 2, Y - 14, "#6a4228", 4, 14); P(ctx, X - 2, Y - 14, "#8a5a38", 1, 14);
    const sway = REDUCED ? 0 : Math.round(Math.sin(t / 14));
    for (let y = -18; y <= 12; y++) for (let x = -14; x <= 14; x++) { const d = (x / 14) ** 2 + (y / 13) ** 2; if (d < 1) P(ctx, X + x + (y < -6 ? sway : 0), Y - 30 + y, d > 0.8 ? "#3f6e24" : (x + y) < -6 ? "#a8d65a" : (x * 3 + y * 5) % 7 === 0 ? "#6aa83a" : "#7cbc44"); }
    [[-6, -36], [5, -28], [-2, -22]].forEach(([dx, dy]) => P(ctx, X + dx, Y + dy, "#ff9a9a", 2, 2));
  } else if (id === "lamp") {
    shadow(4);
    P(ctx, X - 3, Y - 3, "#3a2a30", 6, 3); P(ctx, X - 1, Y - 30, "#3a2a30", 2, 28);
    P(ctx, X - 4, Y - 38, "#3a2a30", 8, 2); P(ctx, X - 3, Y - 36, L.night > 0.3 ? "#ffe39a" : "#8a8070", 6, 6); P(ctx, X - 4, Y - 30, "#3a2a30", 8, 1);
  } else if (id === "bench") {
    shadow(11);
    for (let i = 0; i < 20; i++) { const yy = Y - 7 + Math.round(i * 0.25); P(ctx, X - 10 + i, yy, i % 4 ? "#b07a48" : "#8a5a34", 1, 3); P(ctx, X - 10 + i, yy - 7, "#9a6a3e", 1, 2); }
    P(ctx, X - 9, Y - 5, "#5a3a24", 2, 6); P(ctx, X + 8, Y - 1, "#5a3a24", 2, 4);
  } else if (id === "crates") {
    shadow(12);
    const box = (bx, by, s) => { P(ctx, bx, by - s, "#c08a4a", s, s); P(ctx, bx, by - s, "#e0aa60", s, 2); P(ctx, bx, by - s, "#6a4228", 1, s); P(ctx, bx + s - 1, by - s, "#6a4228", 1, s); P(ctx, bx, by - 1, "#6a4228", s, 1); P(ctx, bx + 2, by - s + 4, "#8a5a30", s - 4, 1); };
    box(X - 11, Y, 12); box(X + 1, Y + 1, 10); box(X - 6, Y - 12, 9);
    P(ctx, X + 3, Y - 12, "#f0a030", 3, 3); P(ctx, X + 6, Y - 11, "#e05a3a", 3, 3);
  } else if (id === "pot") {
    shadow(5);
    P(ctx, X - 4, Y - 6, "#b85a3a", 8, 6); P(ctx, X - 5, Y - 7, "#d87a4a", 10, 2);
    P(ctx, X - 1, Y - 12, "#5f9a33", 1, 5); P(ctx, X - 3, Y - 14, "#ffd36b", 3, 3); P(ctx, X + 1, Y - 11, "#ff8aa0", 2, 2);
  }
}

// 光照：夜里整体压暗 + 路灯/窗户暖光；黄昏偏橙；清晨偏粉
export function drawLighting(ctx, RW, RH, L, t) {
  const { proj } = geometry(RW, RH);
  if (L.night > 0.05) { ctx.globalCompositeOperation = "source-atop"; ctx.globalAlpha = 0.38 * L.night; P(ctx, 0, 0, "#141838", RW, RH); ctx.globalCompositeOperation = "source-over"; }
  else if (L.dusk) { ctx.globalCompositeOperation = "source-atop"; ctx.globalAlpha = 0.14; P(ctx, 0, 0, L.sk.phase === "dusk" ? "#ff7a3a" : "#ff9ab0", RW, RH); ctx.globalCompositeOperation = "source-over"; }
  ctx.globalAlpha = 1;
  if (L.night > 0.3) {
    const br = REDUCED ? 0.9 : 0.85 + 0.15 * Math.sin(t / 9);
    const glow = (gx, gy, G, col) => { for (let y = -G; y <= G; y++) for (let x = -G; x <= G; x++) { const d = Math.hypot(x, y * 1.4); if (d < G && (x + y) % 2 === 0) { ctx.globalAlpha = 0.32 * L.night * br * (1 - d / G); P(ctx, gx + x, gy + y, col); } } ctx.globalAlpha = 1; };
    const [lx, ly] = proj(6.6, 1.3); glow(lx, ly - 33, 26, "#ffb347");
    const [wx, wy] = proj(0, 4.6); glow(wx, wy - 16, 14, "#ffc870");
  }
}

// ---------- 可交互的房间 ----------
export function mountRoom(host, p, { onOpenChat } = {}) {
  host.classList.add("room"); host.dataset.testid = "room";
  host.innerHTML = `<canvas class="room-px" aria-label="雾里集的小广场，olo 在这里溜达"></canvas>
    <button class="btn px-box room-open" data-testid="room-open-chat">✉ 打开聊天</button>`;
  const c = host.querySelector("canvas"), ctx = c.getContext("2d");
  host.querySelector(".room-open").addEventListener("click", () => onOpenChat?.());
  let RW = 200, RH = 160, K = 3, G = geometry(RW, RH);
  const resize = () => {
    const w = host.clientWidth || 360, h = host.clientHeight || 480;
    K = Math.max(2, Math.min(4, Math.floor(Math.min(w / 190, h / 170))));
    RW = Math.ceil(w / K); RH = Math.ceil(h / K); c.width = RW; c.height = RH; ctx.imageSmoothingEnabled = false;
    c.style.width = RW * K + "px"; c.style.height = RH * K + "px"; G = geometry(RW, RH);
  };
  let L = light(localHour());
  const relight = () => { L = light(localHour()); host.dataset.daypart = L.sk.phase; host.dataset.celestial = L.sp !== null && L.sk.sun > 0.15 ? "sun" : "moon"; };
  relight();
  const [sc, spr] = canvas(48, 44);
  const s = { state: "idle" };
  const D = { mode: "home", x: 3.2, y: 4.8, z: 0, vx: 0, vy: 0, vz: 0, sx: 1, sy: 1, ss: 0, face: "happy", goal: null, wait: 40, ph: 0, still: 0, last: [], react: 0, boingAt: 0 };
  host.dataset.drag = "home"; host.dataset.squash = ""; host.dataset.state = "idle";
  const now = () => performance.now();
  const setMode = (m) => { D.mode = m; host.dataset.drag = m; };
  const boing = (v) => { if (v > 1.4 && now() - D.boingAt > 140) { D.boingAt = now(); sfx("boing"); } };
  const B0 = 0.45, B1 = N - 0.45;
  const blocked = (x, y, pad = 0.35) => PROPS.some((q) => Math.hypot(x - q.x, y - q.y) < q.r + pad);
  const pickGoal = () => { for (let i = 0; i < 30; i++) { const x = 0.8 + Math.random() * (N - 1.6), y = 0.8 + Math.random() * (N - 1.6); if (!blocked(x, y, 0.6)) return [x, y]; } return [3.2, 4.8]; };
  const collide = (bounce) => {
    if (D.x < B0 || D.x > B1) { D.x = clamp(D.x, B0, B1); if (bounce) { boing(Math.abs(D.vx) * 9); D.vx *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vx) * 1.6); D.sAxis = "x"; } }
    if (D.y < B0 || D.y > B1) { D.y = clamp(D.y, B0, B1); if (bounce) { boing(Math.abs(D.vy) * 9); D.vy *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vy) * 1.6); D.sAxis = "x"; } }
    for (const q of PROPS) {
      const dx = D.x - q.x, dy = D.y - q.y, d = Math.hypot(dx, dy), R = q.r + 0.3;
      if (d < R && D.z < q.h) {
        const nx = dx / (d || 1), ny = dy / (d || 1); D.x = q.x + nx * R; D.y = q.y + ny * R;
        if (bounce) { const vn = D.vx * nx + D.vy * ny; if (vn < 0) { D.vx -= 1.7 * vn * nx; D.vy -= 1.7 * vn * ny; boing(-vn * 9); D.ss = Math.min(0.35, -vn * 1.6); D.sAxis = "x"; } }
      }
    }
  };
  const hitTest = (mx, my) => { const [X, Y] = G.proj(D.x, D.y, D.z); return mx > X - 11 && mx < X + 11 && my > Y - 26 && my < Y + 3; };
  const toRoom = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / K, (e.clientY - r.top) / K]; };

  const step = () => {
    if (D.mode === "home") {
      if (D.react > 0) D.react--;
      if (REDUCED) return;
      // 溜达：停一会儿 → 选个空地 → 一蹦一蹦走过去
      if (!D.goal) { if (--D.wait <= 0) D.goal = pickGoal(); }
      else {
        const dx = D.goal[0] - D.x, dy = D.goal[1] - D.y, d = Math.hypot(dx, dy), sp = p.form === "cloud" ? 0.018 : 0.028;
        if (d < sp) { D.goal = null; D.wait = 60 + Math.random() * 140; D.z = 0; D.ph = 0; }
        else { D.x += (dx / d) * sp; D.y += (dy / d) * sp; D.ph += 0.16; const hp = Math.abs(Math.sin(D.ph)); D.z = p.form === "buddy" ? hp * 4 : 0; D.sx = 1 + (hp < 0.15 ? 0.08 : -0.03); D.sy = 1 - (hp < 0.15 ? 0.08 : -0.05); collide(false); }
      }
      if (!D.goal) { D.sx += (1 - D.sx) * 0.3; D.sy += (1 - D.sy) * 0.3; if (D.z > 0) D.z = Math.max(0, D.z - 1); }
    } else if (D.mode === "held") {
      D.z += (14 - D.z) * 0.3;
      const sp = Math.hypot(D.vx, D.vy) * 10, k = Math.min(0.3, sp * 0.4), ax = Math.abs(D.vx - D.vy) > Math.abs(D.vx + D.vy) * 0.5;
      D.sx += ((ax ? 1 + k : 1 - k * 0.6) - D.sx) * 0.4; D.sy += ((ax ? 1 - k * 0.6 : 1 + k) - D.sy) * 0.4;
      D.vx *= 0.8; D.vy *= 0.8;
    } else if (D.mode === "fling") {
      D.vz -= 0.4; D.x += D.vx; D.y += D.vy; D.z += D.vz;
      collide(true);
      if (D.z <= 0) {
        const imp = -D.vz; D.z = 0;
        if (imp > 1.3) { boing(imp * 2); D.ss = Math.min(0.42, imp * 0.07); D.sAxis = "y"; D.vz = imp * 0.55; D.vx *= 0.8; D.vy *= 0.8; }
        else { D.vz = 0; D.vx *= 0.86; D.vy *= 0.86; }
      }
      D.ss *= 0.8;
      const air = D.z > 0 ? Math.min(0.2, Math.abs(D.vz) * 0.05) : 0, ax = D.sAxis === "x";
      D.sx = ax ? 1 - D.ss : 1 + D.ss - air * 0.5; D.sy = ax ? 1 + D.ss * 0.6 : 1 - D.ss + air;
      D.still = D.z === 0 && Math.hypot(D.vx, D.vy) < 0.006 && D.ss < 0.02 ? D.still + 1 : 0;
      if (D.still > 12) { setMode("home"); D.goal = null; D.wait = 50; D.react = 40; }
    }
    if ((Math.abs(D.sx - 1) > 0.04 || Math.abs(D.sy - 1) > 0.04) && !host.dataset.squash.includes(D.mode)) host.dataset.squash += " " + D.mode;
  };

  const render = (t = ticker.ft) => {
    drawBackdrop(ctx, RW, RH, L, t, false);
    // 深度排序：道具 + olo，按 wx+wy 从后往前画
    const items = PROPS.map((q) => ({ id: q.id, d: q.x + q.y, draw: () => { const [X, Y] = G.proj(q.x, q.y); drawProp(ctx, q.id, X, Y, L, t); } }));
    items.push({ id: "olo", d: D.x + D.y, draw: () => {
      const [X, Y] = G.proj(D.x, D.y, 0), air = clamp(D.z / 30, 0, 1), w = Math.round(9 * (1 - 0.5 * air));
      ctx.globalAlpha = 0.32 * (1 - air * 0.5); P(ctx, X - w, Y - 1, "#2a1810", w * 2, 2); P(ctx, X - w + 2, Y + 1, "#2a1810", w * 2 - 4, 1); ctx.globalAlpha = 1;
      const st = D.mode === "held" ? "held" : D.mode === "fling" ? "happy" : D.react > 0 ? "happy" : D.goal && s.state === "idle" ? "talking" : s.state;
      spr.clearRect(0, 0, 48, 44);
      drawOlo(spr, { form: p.form, color: p.color, hair: p.hair, eyes: p.eyes, cheeks: p.cheeks, state: st === "talking" && D.goal ? "idle" : st, t, ox: 8, oy: 8 });
      const [SX, SY] = G.proj(D.x, D.y, D.z);
      ctx.drawImage(sc, Math.round(SX - 24 * D.sx), Math.round(SY - 36 * D.sy), Math.round(48 * D.sx), Math.round(44 * D.sy));
      host.dataset.x = String(Math.round(SX * K)); host.dataset.y = String(Math.round(SY * K));
    } });
    items.sort((a, b) => a.d - b.d);
    host.dataset.order = items.map((i) => i.id).join(",");
    items.forEach((i) => i.draw());
    drawLighting(ctx, RW, RH, L, t);
  };

  // ---------- 点一下 / 抓起来扔 ----------
  c.addEventListener("pointerdown", (e) => {
    const [mx, my] = toRoom(e); if (!hitTest(mx, my)) return;
    e.preventDefault(); c.setPointerCapture?.(e.pointerId);
    D.down = { t: now(), x: e.clientX, y: e.clientY, moved: false };
    setMode("held"); host.dataset.squash = ""; D.goal = null; D.vx = D.vy = D.vz = 0;
    const [wx, wy] = G.unproj(mx, my + 10, 14); D.grab = [D.x - wx, D.y - wy]; D.last = [[now(), D.x, D.y]];
    sfx("select");
  });
  c.addEventListener("pointermove", (e) => {
    const [mx, my] = toRoom(e);
    c.style.cursor = D.mode === "held" ? "grabbing" : hitTest(mx, my) ? "grab" : "";
    if (D.mode !== "held") return;
    if (Math.hypot(e.clientX - D.down.x, e.clientY - D.down.y) > 6) D.down.moved = true;
    const [wx, wy] = G.unproj(mx, my + 10, 14), nx = clamp(wx + D.grab[0], B0, B1), ny = clamp(wy + D.grab[1], B0, B1);
    D.vx = D.vx * 0.5 + (nx - D.x) * 0.5; D.vy = D.vy * 0.5 + (ny - D.y) * 0.5; D.x = nx; D.y = ny;
    D.last.push([now(), D.x, D.y]); if (D.last.length > 6) D.last.shift();
  });
  const release = (e) => {
    if (D.mode !== "held") return;
    c.releasePointerCapture?.(e.pointerId);
    if (!D.down.moved && now() - D.down.t < 350) {
      // 点一下：开心地蹦一下、冒爱心、叫一声
      setMode("home"); D.z = 0; D.react = 45; sfx("happy"); host.dataset.taps = String(+(host.dataset.taps || 0) + 1);
      if (!REDUCED) { D.vz = 3.2; D.vx = D.vy = 0; D.ss = 0; setMode("fling"); D.react = 45; }
      return;
    }
    if (REDUCED) { D.z = 0; D.sx = D.sy = 1; collide(false); setMode("home"); return; }
    const a = D.last[0], b = D.last[D.last.length - 1], dt = Math.max(16, b[0] - a[0]);
    D.vx = clamp(((b[1] - a[1]) / dt) * 16, -0.45, 0.45); D.vy = clamp(((b[2] - a[2]) / dt) * 16, -0.45, 0.45);
    D.vz = 2.2 + Math.hypot(D.vx, D.vy) * 6; D.still = 0; D.ss = 0; setMode("fling");
  };
  c.addEventListener("pointerup", release); c.addEventListener("pointercancel", release);

  let raf = 0, alive = true;
  const loop = () => { if (!alive) return; raf = requestAnimationFrame(loop); step(); render(ticker.ft); };
  resize(); addEventListener("resize", resize);
  if (REDUCED) { render(); var iv2 = setInterval(() => { step(); render(); }, 200); } else loop();
  const iv = setInterval(relight, 60_000); addEventListener("olo:tz", relight);
  return {
    setState(st) { s.state = st; host.dataset.state = st; },
    stop() { alive = false; cancelAnimationFrame(raf); clearInterval(iv); clearInterval(iv2); removeEventListener("resize", resize); removeEventListener("olo:tz", relight); },
  };
}
