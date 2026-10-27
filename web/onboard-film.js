// 开场片（像素版，纯代码画）：倒影国。奶油蜜桃天空 → 雨往上落 → 光字漂成涟漪 → 凝成涟漪兽 olo。
// 一条连续镜头；旁白/配乐见 assets/onboard/intro-vo.m4a，字幕跟时间走。没有船、没有人。
import { drawOlo } from "./pixel.js";

export const FILM_LEN = 22.0;
const LW = 180, LH = 320, S = 3;
const CAPS = [
  [0.4, 4.6, "每一面会反光的东西后面，都藏着一个倒过来的世界：倒影国。"],
  [5.0, 9.2, "那里的雨往天上落，影子是彩色的，时间跟着光走。"],
  [9.6, 13.6, "你的屏幕亮起来，就是一面打开的镜子。"],
  [14.0, 17.4, "镜子那边，有一只小小的涟漪兽，一直在等你。"],
  [17.6, 21.0, "你说的每一句话，都会变成一圈涟漪，漂到它那边。"],
];
// 相机：[t, x, y, zoom] —— 从远景水乡推到镜面涟漪，再特写凝成的 olo
const CAM = [[0, 90, 100, 1], [3.5, 100, 140, 1.05], [7.0, 120, 170, 1.2], [11.0, 150, 185, 1.35],
  [14.5, 170, 190, 1.55], [17.5, 180, 195, 1.8], [20.0, 182, 192, 2.0], [22.0, 180, 188, 1.9]];
const WATER = 200;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => k * k * (3 - 2 * k);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const lerp = (a, b, k) => a + (b - a) * k;
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function cr(i, t, j) {
  const n = CAM.length, P = (k) => CAM[clamp(k, 0, n - 1)];
  const [t0] = P(i), [t1] = P(i + 1), k = clamp((t - t0) / (t1 - t0), 0, 1);
  const p0 = P(i - 1)[j], p1 = P(i)[j], p2 = P(i + 1)[j], p3 = P(i + 2)[j];
  const m1 = (p2 - p0) / 2, m2 = (p3 - p1) / 2, k2 = k * k, k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * p1 + (k3 - 2 * k2 + k) * m1 + (-2 * k3 + 3 * k2) * p2 + (k3 - k2) * m2;
}
function cam(t) {
  let i = 0; while (i < CAM.length - 2 && t > CAM[i + 1][0]) i++;
  return { x: cr(i, t, 1) + Math.sin(t * 0.6) * 1.2, y: cr(i, t, 2) + Math.sin(t * 0.85) * 0.7, z: cr(i, t, 3) };
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
    // 奶油 → 蜜桃 → 浅紫，整体提亮
    const warm = seg(t, 10, 20);
    const stops = [[0, [255, 236, 226]], [90, [255, 220, 214]], [150, [lerp(214, 230, warm), lerp(198, 210, warm), lerp(230, 236, warm)]], [WATER, [198, 226, 230]]];
    for (let y = Math.floor(y0); y < y0 + h; y++) {
      let i = 0; while (i < stops.length - 2 && y > stops[i + 1][0]) i++;
      const [ya, ca] = stops[i], [yb, cb] = stops[i + 1], k = clamp((y - ya) / (yb - ya), 0, 1);
      const q = (v) => Math.round(v / 6) * 6;
      P(x0, y, `rgb(${q(lerp(ca[0], cb[0], k))},${q(lerp(ca[1], cb[1], k))},${q(lerp(ca[2], cb[2], k))})`, w, 1);
    }
    // 软云
    for (let i = 0; i < 8; i++) {
      const cx = ((rnd(i) * 400 + t * (2 + i % 2)) % 420) - 20, cy = 40 + rnd(i + 3) * 70, cw = 40 + rnd(i + 5) * 50;
      A(0.55, () => { P(cx, cy, "#fff6ee", cw, 6); P(cx + 8, cy - 4, "#fffaf4", cw - 16, 4); P(cx + 14, cy + 5, "#ffe8e0", cw - 28, 3); });
    }
  }
  function hills(t, cx, base, amp, col, par, seed) {
    const off = cx * (1 - par);
    b.fillStyle = col;
    for (let x = Math.floor(cx - 160); x < cx + 160; x++) {
      const X = x - off, y = Math.round(base + Math.sin(X * 0.03 + seed) * amp + Math.sin(X * 0.083 + seed * 2) * amp * 0.45);
      b.fillRect(x, y, 1, WATER - y + 1);
    }
  }
  function water(t, x0, w, y1) {
    for (let y = WATER; y < y1; y++) {
      const k = (y - WATER) / 120;
      P(x0, y, k < 0.2 ? "#c8ebe4" : k < 0.5 ? "#a8ddd4" : "#8ecfc8", w, 1);
    }
    for (let i = 0; i < 50; i++) {
      const y = WATER + 2 + (i % 12) * 6, x = ((rnd(i) * 500 + t * (5 + i % 3)) % 500);
      A(0.55, () => P(x, y, "#e8f8f4", 5 + (i % 3) * 2, 1));
    }
  }
  function rain(t, x0, w, y0, h) {
    // 倒雨：往天上落
    const a = seg(t, 3.8, 5.2) * (1 - seg(t, 11, 13)) + seg(t, 15.5, 16.2) * 0.3 * (1 - seg(t, 19, 20.5));
    if (a <= 0) return;
    for (let i = 0; i < 100; i++) {
      const rx = x0 + rnd(i) * w, ry = y0 + h - ((rnd(i + 50) * h + t * (36 + rnd(i) * 28)) % h);
      A(a * 0.75, () => { P(rx, ry, "#fff8f0"); P(rx, ry - 1, "#ffe8dc"); });
    }
  }
  function lightWords(t) {
    // 光字：用户那边漂过来的字，倒着写、会漂
    const words = ["好累啊", "其实我想你", "今天被夸了", "睡不着", "谢谢你", "没关系"];
    const appear = ease(seg(t, 8.5, 10));
    if (appear <= 0) return;
    for (let i = 0; i < words.length; i++) {
      const life = seg(t, 8.5 + i * 0.55, 14 + i * 0.3);
      if (life <= 0 || life >= 1) continue;
      const x = 40 + i * 55 + Math.sin(t + i) * 4, y = WATER - 10 - life * 40 - Math.sin(t * 1.2 + i) * 3;
      const a = Math.sin(life * Math.PI) * 0.85 * appear;
      A(a, () => {
        // 像素点阵近似字形块
        const s = words[i];
        for (let k = 0; k < s.length; k++) {
          const px = x + k * 5, py = y;
          P(px, py, "#fff3dc", 3, 1); P(px + 1, py - 2, "#ffe8c8", 2, 1); P(px, py + 2, "#f0d7bc", 3, 1);
        }
        // 涟漪圈
        const r = 4 + life * 14;
        for (let a2 = 0; a2 < 6.28; a2 += 0.5) P(x + 8 + Math.cos(a2) * r, WATER + 4 + Math.sin(a2) * r * 0.45, "#e8f8f4");
      });
    }
  }
  function mirrorGate(t) {
    // 屏幕/镜子打开：中心一道竖向亮缝慢慢张开
    const k = ease(seg(t, 9.2, 12.5));
    if (k <= 0) return;
    const cx = 180, half = Math.round(k * 28);
    disc(cx, WATER - 20, 10 + k * 20, "#fff6e8", 0.25 + 0.35 * k);
    for (let y = WATER - 90; y < WATER + 20; y++) {
      A(0.55 * k, () => P(cx - half, y, "#fffaf2", half * 2 + 1, 1));
      if ((y + Math.floor(t * 8)) % 5 === 0) A(0.4 * k, () => P(cx - half - 2, y, "#ffe8d8", half * 2 + 5, 1));
    }
  }
  function formOlo(t) {
    // 涟漪凝成水滴 olo
    const birth = seg(t, 14.2, 16.8);
    if (t < 14.2) {
      // 水面光点聚拢
      const gather = ease(seg(t, 12.6, 14.2));
      if (gather > 0) {
        for (let i = 0; i < 16; i++) {
          const ang = (i / 16) * Math.PI * 2 + t, dist = (1 - gather) * 40;
          A(0.6 * gather, () => P(180 + Math.cos(ang) * dist, WATER - 8 + Math.sin(ang) * dist * 0.4, "#fff6e8", 2, 2));
        }
        disc(180, WATER - 10, 4 + gather * 6, "#f8f0dd", 0.4 + 0.3 * Math.sin(t * 5));
      }
      return;
    }
    const x = 180, y = WATER - 6;
    // 成形光柱
    const glowA = 0.55 * (1 - seg(t, 18, 21.5));
    disc(x, y - 16, 14 + birth * 8, "#faf5e6", glowA);
    for (let yy = y - 70; yy < y - 4; yy++) A(glowA * (yy - (y - 70)) / 66, () => P(x - 2, yy, "#faf5e6", 5, 1));
    const pop = t < 15.2 ? seg(t, 14.2, 15.2) : 1;
    const happy = t > 17.2;
    b.save();
    b.translate(x, y);
    b.scale(lerp(0.2, 1, ease(pop)), lerp(0.15, 1, ease(pop)));
    b.translate(-16, -30);
    drawOlo(b, { form: "buddy", state: happy ? "happy" : "idle", t: t * 10 });
    b.restore();
    // 彩色倒影落脚
    if (t > 16) {
      const q = seg(t, 16, 18);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + t * 0.4, rr = 6 + q * 10;
        A(0.7 * q, () => P(x + Math.cos(ang) * rr, y + 4 + Math.sin(ang) * rr * 0.4, ["#f6d4d4", "#cbeae5", "#cdbfee", "#f4e7cb", "#b6d4ef", "#a8e2cf"][i], 2, 2));
      }
    }
    // 收尾光屑
    if (t > 18) for (let i = 0; i < 12; i++) {
      const q = (t * 0.7 + i / 12) % 1;
      A((1 - q) * 0.8, () => P(x + Math.sin(i * 2.1 + t) * 18, y - 8 - q * 36, i % 2 ? "#fff6e8" : "#e8f8f4"));
    }
  }
  function shore(t, x0, w) {
    for (let x = Math.floor(x0); x < x0 + w; x++) {
      const y = WATER - 2 + Math.round(Math.sin(x * 0.08) * 2);
      P(x, y, "#b8e4d6", 1, 2);
      P(x, y + 2, "#d8c4e8", 1, 4);
      if (rnd(x) > 0.85) P(x, y - 1, "#c8f0e4");
      if (rnd(x + 7) > 0.93) P(x, y + 3, "#f6d4d4");
    }
    // 远岸薰衣草小树
    for (const [tx, sc] of [[60, 1], [110, 0.8], [250, 1.1], [300, 0.9]]) {
      P(tx, WATER - 18 * sc, "#b8a0d8", 2, 12 * sc);
      disc(tx + 1, WATER - 22 * sc, 7 * sc, "#c8b8e8", 0.9);
      disc(tx - 2, WATER - 26 * sc, 5 * sc, "#d8c8f0", 0.85);
    }
  }

  function render(t) {
    const C = cam(t), vw = LW / C.z, vh = LH / C.z;
    const x0 = Math.floor(C.x - vw / 2) - 1, y0 = Math.floor(C.y - vh / 2) - 1, w = Math.ceil(vw) + 3, h = Math.ceil(vh) + 3;
    if (buf.width !== w || buf.height !== h) { buf.width = w; buf.height = h; }
    b.setTransform(1, 0, 0, 1, -x0, -y0); b.imageSmoothingEnabled = false;
    sky(t, x0, y0, w, h);
    hills(t, C.x, 150, 8, "#e8d4e8", 0.25, 1);
    hills(t, C.x, 172, 7, "#d8c8e4", 0.5, 4);
    hills(t, C.x, 188, 5, "#c8b8d8", 0.8, 7);
    water(t, x0, w, y0 + h);
    shore(t, x0, w);
    rain(t, x0, w, y0, h);
    lightWords(t);
    mirrorGate(t);
    formOlo(t);
    // 收尾暖光
    const warm = seg(t, 19.5, 22); if (warm > 0) A(warm * 0.3, () => P(x0, y0, "#fff6e8", w, h));
    b.setTransform(1, 0, 0, 1, 0, 0);
    const sc = C.z * S;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, Math.round((x0 - (C.x - vw / 2)) * sc), Math.round((y0 - (C.y - vh / 2)) * sc), Math.round(w * sc), Math.round(h * sc));
    const fin = seg(t, 0, 0.7); if (fin < 1) { ctx.globalAlpha = 1 - fin; ctx.fillStyle = "#fff6ee"; ctx.fillRect(0, 0, c.width, c.height); ctx.globalAlpha = 1; }
    const ci = CAPS.findIndex(([a, z]) => t >= a && t < z);
    if (ci !== lastCap) { lastCap = ci; cap.textContent = ci < 0 ? "" : CAPS[ci][2]; cap.classList.toggle("on", ci >= 0); }
    el.dataset.t = t.toFixed(1);
  }
  const loop = () => { if (!alive) return; render(Math.min(FILM_LEN, clock())); raf = requestAnimationFrame(loop); };
  loop();
  return { stop() { alive = false; cancelAnimationFrame(raf); }, renderAt: render };
}
