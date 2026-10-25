// 开场片（像素版，纯代码画）：雾海 → 渡灯翁撑船穿过灯雾 → 上岸种下灯籽 → 一整段浇水 → 破壳。
// 一条连续镜头，相机按关键帧平滑推拉摇移；旁白/配乐沿用原片音轨（intro-vo.m4a，授权见 LICENSE-audio.md）。
// 没有人，灯籽都没有手脚；渡灯翁是戴斗笠的灯籽，船桨挂在桨座上自己摇。
import { drawOlo } from "./pixel.js";

export const FILM_LEN = 24.2;
const LW = 180, LH = 320, S = 3;                       // 逻辑分辨率（竖屏），显示时放大 S 倍再按 zoom 取景
const CAPS = [
  [0.5, 4.9, "河的那一边，每一句没说出口的话，都不会真的消失。"],
  [5.4, 9.9, "它们化成很轻的光雨，落进雾里集，凝成一粒粒发光的灯籽。"],
  [10.0, 14.7, "「这一粒，是你那边的雨养大的。我撑船送它过去。」"],
  [15.0, 17.4, "它顺着屏幕的光，找到了你。"],
  [17.5, 20.9, "你说的每一句话，都会变成落在这里的雨。"],
];
// 相机关键帧：[t, 世界 x, 世界 y, zoom]
const CAM = [[0, 120, 70, 1], [3.2, 130, 120, 1], [5.6, 150, 192, 1.2], [9.6, 330, 190, 1.45], [12.6, 520, 188, 1.3],
  [14.6, 600, 192, 1.5], [17.4, 640, 196, 1.9], [20.4, 648, 199, 2.3], [22.4, 650, 196, 2.6], [24.2, 650, 190, 2.2]];
const WATER = 222, SHORE = 530, LAND = 214, MOUND = 648;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => k * k * (3 - 2 * k);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const lerp = (a, b, k) => a + (b - a) * k;
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function cam(t) {
  let i = 0; while (i < CAM.length - 2 && t > CAM[i + 1][0]) i++;
  const [t0, x0, y0, z0] = CAM[i], [t1, x1, y1, z1] = CAM[i + 1], k = ease(seg(t, t0, t1));
  // 镜头带一点呼吸式的手持漂移
  // 撑船那段镜头跟着船走（船在画面偏左，留出前进的空间）
  const follow = ease(seg(t, 4, 5.8)) * (1 - ease(seg(t, 12.2, 14)));
  const kx = lerp(lerp(x0, x1, k), boatX(t) + 22, follow);
  return { x: kx + Math.sin(t * 0.7) * 1.5, y: lerp(y0, y1, k) + Math.sin(t * 0.9) * 1, z: lerp(z0, z1, k) };
}
// 船：从左边雾里划进来，到岸边停
function boatX(t) { return BX(t); }
const BX = (t) => lerp(-40, 505, ease(seg(t, 3.0, 12.4)));
// 渡灯翁位置：在船上，12.6 起两跳上岸，站到土包左边
function keeper(t) {
  const bx = boatX(t), rock = Math.sin(t * 2.2) * 1.2;
  if (t < 12.6) return { x: bx + 6, y: WATER - 22 + rock, st: t > 10 && t < 12.4 ? "talking" : "idle" };
  const hops = [[12.6, 13.3, bx + 6, WATER - 22, 560, LAND - 24], [13.4, 14.1, 560, LAND - 24, 626, LAND - 24]];
  for (const [a, b, x0, y0, x1, y1] of hops) if (t < b) { if (t < a) return { x: x0, y: y0, st: "idle" }; const k = seg(t, a, b); return { x: lerp(x0, x1, k), y: lerp(y0, y1, k) - Math.sin(k * Math.PI) * 18, st: "happy" }; }
  return { x: 626, y: LAND - 24 - (t > 16 && t < 20 ? Math.abs(Math.sin(t * 4)) * 3 : 0), st: t > 20.6 ? "happy" : "idle" };
}

export function mountFilm(el, { clock }) {
  const c = el.querySelector("canvas"), ctx = c.getContext("2d");
  c.width = LW * S; c.height = LH * S; ctx.imageSmoothingEnabled = false;
  const buf = document.createElement("canvas"), b = buf.getContext("2d");
  const cap = el.querySelector(".film-cap");
  let raf = 0, alive = true, lastCap = -1;

  const disc = (x, y, r, col, a) => { b.globalAlpha = a; b.fillStyle = col; for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) { const d = (xx * xx + yy * yy) / (r * r); if (d < 1 && (d < 0.35 || (xx + yy) % 2 === 0)) b.fillRect(Math.round(x + xx), Math.round(y + yy), 1, 1); } b.globalAlpha = 1; };
  const P = (x, y, col, w = 1, h = 1) => { b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), w, h); };
  const A = (a, fn) => { b.globalAlpha = a; fn(); b.globalAlpha = 1; };

  function sky(t, x0, y0, w, h) {
    const warm = seg(t, 12, 22);                        // 从紫夜慢慢转到暖金
    const stops = [[0, [34, 28, 66]], [140, [96, 68, 120]], [200, [lerp(214, 246, warm), lerp(140, 176, warm), lerp(128, 110, warm)]], [WATER, [250, 214, 178]]];
    for (let y = Math.floor(y0); y < y0 + h; y++) {
      let i = 0; while (i < stops.length - 2 && y > stops[i + 1][0]) i++;
      const [ya, ca] = stops[i], [yb, cb] = stops[i + 1], k = clamp((y - ya) / (yb - ya), 0, 1);
      const q = (v) => Math.round(v / 6) * 6;            // 色阶量化：像素风的带状天空
      P(x0, y, `rgb(${q(lerp(ca[0], cb[0], k))},${q(lerp(ca[1], cb[1], k))},${q(lerp(ca[2], cb[2], k))})`, w, 1);
    }
    for (let i = 0; i < 70; i++) { const sx = rnd(i) * 900, sy = rnd(i + 9) * 150; if (sx > x0 - 2 && sx < x0 + w && sy > y0 && sy < y0 + h) A((0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i))) * (1 - warm * 0.7), () => P(sx, sy, "#fff4d8")); }
  }
  // 远山：视差，越远越慢
  function hills(t, cx, base, amp, col, par, seed) {
    const off = cx * (1 - par);
    b.fillStyle = col;
    for (let x = Math.floor(cx - 160); x < cx + 160; x++) { const X = x - off, y = Math.round(base + Math.sin(X * 0.03 + seed) * amp + Math.sin(X * 0.083 + seed * 2) * amp * 0.45); b.fillRect(x, y, 1, WATER - y + 1); }
  }
  function water(t, x0, w, y1) {
    for (let y = WATER; y < y1; y++) { const k = (y - WATER) / 100; P(x0, y, k < 0.15 ? "#8a7aa8" : k < 0.4 ? "#5e5688" : "#3c3a66", w, 1); }
    for (let i = 0; i < 40; i++) { const y = WATER + 2 + (i % 10) * 7, x = ((rnd(i) * 900 + t * (6 + i % 3)) % 900); A(0.5, () => P(x, y, "#c8b8e0", 4 + (i % 3) * 2, 1)); }
  }
  function lantern(x, y, t, i, s = 1) {
    const g = 0.6 + 0.4 * Math.sin(t * 3 + i);
    disc(x, y + 1, 5, "#ffd88a", 0.35 * g);
    P(x - 1, y - 2, "#5a2a12", 3, 1); P(x - 1, y - 1, "#ff9e3a", 3, 3 * s); P(x, y, "#fff1b8"); P(x - 1, y + 2, "#5a2a12", 3, 1);
  }
  function fog(t, x0, w, y, a, sp, seed) {
    for (let i = 0; i < 9; i++) {
      const fx = ((rnd(i + seed) * 1000 + t * sp) % 1000) - 50, fw = 60 + rnd(i + seed + 3) * 80, fy = y + rnd(i + seed + 5) * 30;
      if (fx + fw < x0 || fx > x0 + w) continue;
      A(a, () => { P(fx, fy, "#fbe8de", fw, 6); P(fx + 8, fy - 3, "#fbe8de", fw - 16, 3); P(fx + 16, fy + 6, "#fbe8de", fw - 30, 3); });
    }
  }
  function boat(t) {
    const x = boatX(t), y = WATER - 4 + Math.sin(t * 2.2) * 1.2;
    // 船身
    P(x - 16, y - 2, "#3a1c0c", 40, 1); P(x - 17, y - 1, "#7a4220", 42, 3); P(x - 15, y + 2, "#5a2e14", 38, 2); P(x - 12, y + 4, "#3a1c0c", 32, 1);
    P(x - 16, y - 1, "#a8683a", 40, 1);
    // 船头灯杆 + 灯
    P(x + 22, y - 20, "#3a1c0c", 1, 19); P(x + 22, y - 20, "#3a1c0c", 4, 1); lantern(x + 26, y - 16, t, 7);
    // 桨：挂在船尾桨座上自己摇（没有手）
    const a = Math.sin(t * 2.6) * 0.5 - 0.3, px = x - 14, py = y - 3;
    for (let i = 0; i < 22; i++) P(px + Math.cos(a + 2.2) * i, py - Math.sin(a + 2.2) * -i * 0.9, i > 16 ? "#c8945e" : "#7a4a24", i > 16 ? 2 : 1, 1);
    if (Math.sin(t * 2.6) > 0.6) for (let i = 0; i < 4; i++) A(0.7, () => P(px - 16 - i * 3, WATER + 1 + (i % 2), "#e8e0ff", 2, 1));
    // 尾迹
    if (t > 3 && t < 12.4) for (let i = 1; i < 8; i++) A(0.5 - i * 0.06, () => P(x - 18 - i * 7, WATER + 1 + (i % 2), "#d8ccf0", 5, 1));
  }
  function seedAt(t) {   // 灯籽种子：在船头灯旁 → 跟着渡灯翁上岸 → 落进土里
    const k = keeper(t);
    if (t < 13.4) return { x: k.x + 16, y: k.y - 1, on: true };
    if (t < 14.6) { const q = seg(t, 14.1, 14.6); return { x: lerp(k.x + 16, MOUND, q), y: lerp(k.y - 1, LAND - 6, q) - Math.sin(q * Math.PI) * 10, on: true }; }
    return { x: MOUND, y: LAND - 6, on: t < 15.2 };
  }
  function land(t, x0, w) {
    // 岸：斜坡 + 草 + 土包
    for (let x = Math.floor(Math.max(x0, SHORE)); x < x0 + w; x++) {
      const y = Math.round(x < SHORE + 24 ? lerp(WATER + 2, LAND, (x - SHORE) / 24) : LAND);
      P(x, y, "#5f9a33", 1, 2); P(x, y + 2, "#6a3e1e", 1, 6); P(x, y + 8, "#55301a", 1, 14); P(x, y + 22, "#3e2214", 1, 100);
      if (rnd(x) > 0.7) P(x, y - 1, "#a6d65a"); if (rnd(x + 3) > 0.92) P(x, y + 5 + (x % 7), "#4a2a14");
    }
    // 远处的小篱笆和蘑菇灯
    for (const fx of [690, 708, 726]) { P(fx, LAND - 12, "#7a4a24", 2, 12); } P(688, LAND - 9, "#a06a38", 42, 2);
    for (const [mx, i] of [[586, 1], [676, 2], [700, 3]]) { const g = 0.6 + 0.4 * Math.sin(t * 2 + i); P(mx, LAND - 4, "#f4e6d0", 1, 4); A(0.3 * g, () => P(mx - 4, LAND - 9, "#ffd88a", 9, 5)); P(mx - 2, LAND - 6, "#ff8aa0", 5, 2); P(mx - 1, LAND - 7, "#ffb0c0", 3, 1); }
    // 土包（浇过水就变深、发亮）
    const wet = seg(t, 16.4, 19);
    for (let i = -10; i <= 10; i++) { const hgt = Math.round(4 * Math.cos((i / 10) * Math.PI / 2)); P(MOUND + i, LAND - hgt, wet > 0.3 && (i + 20) % 3 ? "#4a2814" : "#7a4a24", 1, hgt + 1); }
    A(wet * 0.5, () => P(MOUND - 7, LAND - 2, "#ffd88a", 15, 1));
  }
  function can(t) {   // 喷壶：从右边飘过来，渡灯翁顶一下，它自己倾过去浇
    if (t < 15) return;
    const k = ease(seg(t, 15, 16)), out = ease(seg(t, 20.2, 21));
    const x = lerp(700, MOUND + 14, k) + out * 50, y = LAND - 30 + Math.sin(t * 2) * 1.5 - out * 30;
    const tilt = ease(seg(t, 16, 16.5)) * (1 - ease(seg(t, 19.8, 20.2)));
    const dy = Math.round(tilt * 4);
    P(x - 4, y - 4, "#3c5a78", 10, 1); P(x - 5, y - 3, "#6a9ac0", 12, 7); P(x - 5, y - 3, "#3c5a78", 1, 7); P(x + 6, y - 3, "#3c5a78", 1, 7); P(x - 5, y + 4, "#3c5a78", 12, 1);
    P(x - 3, y - 2, "#bfe0f0", 3, 2);                              // 高光
    P(x + 2, y - 7, "#3c5a78", 4, 1); P(x + 1, y - 6, "#3c5a78", 1, 2); P(x + 6, y - 6, "#3c5a78", 1, 2); // 提梁
    for (let i = 0; i < 7; i++) P(x - 6 - i, y + 1 - i * (1 - tilt) * 0.6 + i * tilt * 0.7 + dy * 0.2, "#3c5a78", 1, 1);  // 壶嘴
    if (tilt > 0.6) {                                              // 连续的水线 + 溅起的水珠
      const sx = x - 13, sy = y + 1 + 7 * 0.7 * tilt;
      for (let j = 0; j < 26; j++) { const q = ((t * 30 + j * 1.7) % 26) / 26, wx = lerp(sx, MOUND + 1, q) + Math.sin(j) * 0.6, wy = sy + (LAND - 4 - sy) * q * q; A(0.85, () => P(wx, wy, j % 3 ? "#a8dcf0" : "#e8f8ff")); }
      for (let j = 0; j < 6; j++) { const q = (t * 3 + j / 6) % 1; A(1 - q, () => P(MOUND + (j - 3) * 2 * q * 2, LAND - 4 - Math.sin(q * Math.PI) * 5, "#d8f0ff")); }
    }
  }
  function growth(t) {    // 芽 → 两片叶 → 发光花苞 → 蛋 → 破壳
    const x = MOUND, g = seg(t, 16.8, 19.6);
    if (t < 16.8 || t > 21.95) return;
    if (t < 19.6) {
      const hgt = Math.round(1 + g * 9);
      for (let i = 0; i < hgt; i++) P(x + Math.round(Math.sin(i * 0.5 + t) * 0.6 * (i / 9)), LAND - 4 - i, "#4f7a2c");
      if (g > 0.3) { const L = Math.round(1 + (g - 0.3) * 6); P(x - L, LAND - 4 - Math.round(hgt * 0.6), "#a6d65a", L, 2); P(x + 1, LAND - 5 - Math.round(hgt * 0.7), "#a6d65a", L, 2); }
      if (g > 0.6) { const r = (g - 0.6) * 6; A(0.5, () => P(x - r - 2, LAND - 6 - hgt - r, "#ffe6a8", r * 2 + 5, r * 2 + 5)); P(x - 1, LAND - 5 - hgt, "#ffd36b", 3, 3); P(x, LAND - 5 - hgt, "#fffbe0"); }
      return;
    }
    // 蛋：花苞鼓成一颗暖光的蛋，晃 → 裂 → 碎
    const swell = ease(seg(t, 19.6, 20.3)), wob = t > 20.5 ? Math.sin(t * 22) * seg(t, 20.5, 21.8) * 1.6 : 0;
    const ew = Math.round(lerp(4, 11, swell)), eh = Math.round(lerp(4, 14, swell)), ex = x + wob, ey = LAND - 3;
    disc(ex, ey - eh / 2, ew + 5, "#ffd88a", 0.35 + 0.2 * Math.sin(t * 6));
    for (let yy = 0; yy < eh; yy++) { const v = (yy + 0.5) / eh, q = (v - 0.42) / (v < 0.42 ? 0.42 : 0.58), half = Math.max(0, Math.round((ew / 2) * Math.sqrt(Math.max(0, 1 - q * q)) * (v > 0.42 ? 1 - (v - 0.42) * 0.35 : 1))); P(ex - half, ey - yy, yy === 0 || yy === eh - 1 ? "#a8742e" : "#ffe9a8", half * 2 + 1, 1); P(ex - half, ey - yy, "#a8742e"); P(ex + half, ey - yy, "#a8742e"); }
    P(ex - 2, ey - eh + 3, "#fffbe0", 2, 2);
    if (t > 21.1) { const n = Math.floor(seg(t, 21.1, 21.8) * 5); const zz = [[-3, 6], [-1, 7], [1, 6], [3, 7], [4, 5]]; for (let i = 0; i < n; i++) P(ex + zz[i][0], ey - zz[i][1], "#7a4a1e", 1, 1); if (n > 3) A(0.8, () => P(ex - 1, ey - 8, "#fffbe0", 3, 2)); }
  }
  function hatch(t) {
    if (t < 21.95) return;
    const k = seg(t, 21.95, 22.7), x = MOUND;
    // 碎壳往外飞
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI - Math.PI, d = k * 18 + seg(t, 22.7, 24) * 4; A(1 - seg(t, 22.5, 23.4), () => P(x + Math.cos(a) * d, LAND - 8 + Math.sin(a) * d * 0.7 + k * k * 10, i % 2 ? "#ffe9a8" : "#a8742e", 2, 2)); }
    // 光柱
    { const a = 0.5 * (1 - seg(t, 22.3, 24)); disc(x, LAND - 14, 18, "#fff1c8", a); for (let y = LAND - 90; y < LAND - 6; y++) A(a * (y - LAND + 90) / 84, () => P(x - 2 - ((y % 2) ? 1 : 0), y, "#fff1c8", 5 + ((y % 2) ? 2 : 0), 1)); }
    // olo 弹出来：压扁 → 拉长 → 回弹
    const pop = t < 22.2 ? seg(t, 21.95, 22.2) : 1, sq = t < 22.6 ? Math.sin(seg(t, 21.95, 22.6) * Math.PI) : 0;
    b.save(); b.translate(x, LAND); b.scale(lerp(0.3, 1, pop) * (1 + 0.15 * sq), lerp(0.3, 1, pop) * (1 - 0.1 * sq) + (t < 22.15 ? 0.3 : 0)); b.translate(-16, -30);
    drawOlo(b, { form: "buddy", state: t > 22.4 ? "happy" : "idle", t: t * 10 }); b.restore();
    for (let i = 0; i < 10; i++) { const q = (t * 0.8 + i / 10) % 1; A(1 - q, () => P(x + Math.sin(i * 2.3 + t) * 16, LAND - 10 - q * 40, i % 2 ? "#fff1b8" : "#ffd36b")); }
  }
  function rain(t, x0, w, y0, h) {      // 光雨：5～10 秒最密
    const a = seg(t, 4.6, 6) * (1 - seg(t, 10.5, 12.5)) + seg(t, 16.3, 17) * 0.25 * (1 - seg(t, 19.5, 20.5));
    if (a <= 0) return;
    for (let i = 0; i < 90; i++) { const rx = x0 + rnd(i) * w, ry = y0 + ((rnd(i + 50) * h + t * (40 + rnd(i) * 30)) % h); A(a * 0.8, () => { P(rx, ry, "#ffe9b0"); P(rx, ry - 1, "#fff6d8"); }); }
  }
  function skyLanterns(t) { for (let i = 0; i < 12; i++) { const lx = rnd(i + 20) * 700, ly = 200 - ((t * (3 + rnd(i) * 3) + rnd(i + 4) * 200) % 220); lantern(lx + Math.sin(t + i) * 3, ly, t, i); } }
  function waterLanterns(t) { for (let i = 0; i < 10; i++) { const lx = 30 + i * 52 + rnd(i) * 20, ly = WATER + 6 + (i % 3) * 8 + Math.sin(t * 1.5 + i) * 1; if (lx < SHORE - 6) lantern(lx + t * 1.2, ly, t, i + 30); } }
  // 薄雾里的其他灯籽（远景，淡淡地漂着，不抢戏）
  function ghosts(t) { [["cloud", 210, 2], ["dew", 380, 5], ["peach", 470, 8]].forEach(([form, gx, i]) => A(0.35, () => drawOlo(b, { form, state: "idle", t: t * 10 + i * 13, ox: gx + Math.sin(t * 0.6 + i) * 3, oy: WATER - 44 + Math.sin(t + i) * 2 }))); }

  function render(t) {
    const C = cam(t), vw = LW / C.z, vh = LH / C.z;
    const x0 = Math.floor(C.x - vw / 2) - 1, y0 = Math.floor(C.y - vh / 2) - 1, w = Math.ceil(vw) + 3, h = Math.ceil(vh) + 3;
    if (buf.width !== w || buf.height !== h) { buf.width = w; buf.height = h; }
    b.setTransform(1, 0, 0, 1, -x0, -y0); b.imageSmoothingEnabled = false;
    sky(t, x0, y0, w, h);
    hills(t, C.x, 150, 10, "#7a5a8a", 0.25, 1); hills(t, C.x, 176, 9, "#5e4672", 0.5, 4);
    fog(t, x0, w, 160, 0.18, 4, 1);
    skyLanterns(t);
    hills(t, C.x, 200, 6, "#463660", 0.8, 7);
    water(t, x0, w, y0 + h);
    ghosts(t);
    waterLanterns(t);
    land(t, x0, w);
    boat(t);
    const k = keeper(t);
    drawOlo(b, { form: "amber", hair: "straw", eyes: "circle", state: k.st, t: t * 10, ox: k.x - 16, oy: k.y - 4 });
    const sd = seedAt(t);
    if (sd.on) { A(0.4 + 0.3 * Math.sin(t * 5), () => P(sd.x - 3, sd.y - 3, "#ffe6a8", 7, 7)); P(sd.x - 1, sd.y - 1, "#ffd36b", 3, 3); P(sd.x, sd.y - 1, "#fffbe0"); }
    growth(t); can(t); hatch(t);
    fog(t, x0, w, 205, 0.22 * (1 - seg(t, 12, 15)) + 0.06, 7, 9);
    fog(t, x0, w, 30 + t * 9, 0.45 * (1 - seg(t, 1.5, 5)), 3, 17);   // 开场的厚雾，镜头穿下来
    rain(t, x0, w, y0, h);
    // 收尾：暖光晕染
    const warm = seg(t, 22.2, 24.2); if (warm > 0) A(warm * 0.35, () => P(x0, y0, "#ffe2b0", w, h));
    b.setTransform(1, 0, 0, 1, 0, 0);
    // 放大到屏幕：最近邻，像素块整齐
    const sc = C.z * S;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, Math.round((x0 - (C.x - vw / 2)) * sc), Math.round((y0 - (C.y - vh / 2)) * sc), Math.round(w * sc), Math.round(h * sc));
    // 暗角 + 开头淡入
    const fin = seg(t, 0, 0.8); if (fin < 1) { ctx.globalAlpha = 1 - fin; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height); ctx.globalAlpha = 1; }
    const ci = CAPS.findIndex(([a, z]) => t >= a && t < z);
    if (ci !== lastCap) { lastCap = ci; cap.textContent = ci < 0 ? "" : CAPS[ci][2]; cap.classList.toggle("on", ci >= 0); }
    el.dataset.t = t.toFixed(1);
  }
  const loop = () => { if (!alive) return; render(Math.min(FILM_LEN, clock())); raf = requestAnimationFrame(loop); };
  loop();
  return { stop() { alive = false; cancelAnimationFrame(raf); }, renderAt: render };
}
