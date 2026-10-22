// olo 像素引擎：程序化生成的原创像素角色（32×32），挤压拉伸 / 预备动作 / 嫩芽二级运动 / 待机小动作 / 情绪表情符号。
export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// 暖色调色板：每组 6 阶（描边 → 暗部 → 中间调 → 亮部 → 高光 → 灯芯暖光）
export const PALETTES = {
  sun: ["#5b2a12", "#c8641f", "#f0973a", "#ffc46b", "#fff0c8", "#fff7e0"],
  blush: ["#5a2230", "#c4545e", "#ee8a7e", "#ffbfa3", "#ffe9d6", "#fff4e8"],
  mint: ["#22403a", "#3f8a78", "#6cbfa0", "#a8e0bd", "#eefbe0", "#fff8dc"],
  sky: ["#2a3450", "#4f7fa0", "#7fb4c7", "#bfe0dc", "#f3fbf2", "#fff6e2"],
  lavender: ["#45203f", "#9a4f7c", "#cf82a0", "#f2b9c2", "#ffe8e6", "#fff3ea"],
};
const INK = "#2a140c", WHITE = "#fffaf0", CHEEK = "#ff7d7d", MOUTH = "#a8323e";
const STEM = "#4f7a2c", LEAF_D = "#5f9a33", LEAF_L = "#a6d65a", LEAF_H = "#e3f59a", BUD = "#ffd36b";
const SPARK = "#fff1b8", TEAR = "#9fe0f0", RIM = "#ffe2a8";

// ---------- 全局时钟：慢钟 10fps（场景），快钟 20fps（角色） ----------
const slow = new Set(), fast = new Set();
let tick = 0;
export const ticker = {
  add(fn) { slow.add(fn); fn(tick >> 1); return () => slow.delete(fn); },
  addFast(fn) { fast.add(fn); fn(tick / 2); return () => fast.delete(fn); },
  get t() { return tick >> 1; },
  get ft() { return tick / 2; },
};
const run = (set, v) => set.forEach((fn) => { try { fn(v); } catch (e) { console.error(e); } });
if (!REDUCED) setInterval(() => { tick++; run(fast, tick / 2); if (tick % 2 === 0) run(slow, tick >> 1); }, 50);

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export function canvas(w, h, cls = "") {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.className = "px-canvas " + cls;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}
export const P = (ctx, x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

// ---------- 缓动 ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

// 一次跳跃：预备下蹲 → 拉伸起跳 → 空中 → 落地压扁 → 回弹。返回 {y, sx, sy}
function hop(p, height = 4) {
  if (p < 0 || p >= 1) return { y: 0, sx: 1, sy: 1 };
  if (p < 0.22) { const k = Math.sin((p / 0.22) * Math.PI * 0.5); return { y: 0, sx: 1 + 0.16 * k, sy: 1 - 0.2 * k }; }
  if (p < 0.7) {
    const k = (p - 0.22) / 0.48, y = -height * 4 * k * (1 - k);
    const st = 1 - Math.abs(2 * k - 1);
    return { y, sx: 1 - 0.1 * (1 - st * 0.6), sy: 1 + 0.16 * (1 - st * 0.6) };
  }
  const k = (p - 0.7) / 0.3, d = Math.sin(k * Math.PI) * Math.exp(-k * 2);
  return { y: 0, sx: 1 + 0.2 * d, sy: 1 - 0.22 * d };
}

// ---------- 形体：返回半宽函数（v=0 底部 → 1 顶部） ----------
const FORMS = {
  // 小团子：竖着的蛋形豆子，短腿短手，大眼睛，头顶嫩芽，爱蹦
  buddy: { W: 19, H: 20, half(v) { const k = Math.max(0, 1 - Math.pow(Math.abs(2 * v - 1), 2.2)); return Math.pow(k, 1 / 2.2) * (1 - 0.32 * v * v * v) * (v < 0.12 ? 0.92 + v * 0.6 : 1); }, feet: true, arms: true, sprout: true, eyeY: 0.46, tip: 2, eyes: "big", gap: 4 },
  // 云朵：又扁又宽的软云，顶上三团棉，没有腿，贴着地面慢慢飘，眼睛半眯
  cloud: { W: 28, H: 12, half(v) { if (v > 0.6) return 0; const s = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v / 0.6 * 2 - 1), 4)), 1 / 4); return s; }, puffs: [[-0.55, 0.62, 0.3], [0.0, 0.86, 0.4], [0.52, 0.66, 0.32]], feet: false, arms: true, sprout: false, small: true, float: 2, eyeY: 0.36, tip: 0, eyes: "sleepy", gap: 6 },
  // 微光：一团倒水滴形的小火苗，没有手脚和嫩芽，顶上火尖会跳，眼睛是两个小亮点
  glow: { W: 15, H: 21, half(v) { if (v < 0.48) return Math.sqrt(Math.max(0, 1 - ((0.48 - v) / 0.48) ** 2)); const k = (v - 0.48) / 0.52; return Math.pow(Math.max(0, 1 - k), 1.5) * (1 - 0.08 * k); }, flame: true, float: 5, eyeY: 0.3, tip: 1, eyes: "dot", gap: 3 },
};

// 每种样子自己的色板（用户选的颜色只作点缀）
const CLOUD_PAL = ["#6b4a52", "#d9b9b0", "#f5e3d6", "#fff4ea", "#fffdf8", "#fffaf0"];
const GLOW_PAL = ["#2d2158", "#5a52b0", "#8d8ae0", "#c3c6f5", "#eef0ff", "#fff8d8"];
function formPal(form, pal) {
  if (form === "cloud") return CLOUD_PAL;
  if (form === "glow") return GLOW_PAL;
  return pal;
}

// 情绪符号（像素图案）
const EMOTES = {
  heart: [".x.x.", "xxxxx", "xxxxx", ".xxx.", "..x.."],
  note: ["..xx", "..x.", "..x.", "xxx.", "xx.."],
  drop: ["..x..", ".xxx.", "xxxxx", "xxxxx", ".xxx."],
  dots: ["x.x.x"],
  bang: ["x", "x", "x", ".", "x"],
  zz: ["xxx.", "..x.", ".x..", "xxx."],
  spark: ["..x..", "..x..", "xxxxx", "..x..", "..x.."],
};
function emote(ctx, name, x, y, c, outline = INK) {
  const g = EMOTES[name]; if (!g) return;
  for (let yy = 0; yy < g.length; yy++) for (let xx = 0; xx < g[yy].length; xx++) if (g[yy][xx] === "x") {
    P(ctx, x + xx, y + yy, c);
  }
  if (name === "heart") P(ctx, x + 1, y + 1, "#ffd6d6");
}

// 状态 → 姿态参数（s 为秒）
function pose(state, s, form) {
  const o = { y: 0, sx: 1, sy: 1, lean: 0, look: [0, 0], blink: false, eyes: "open", mouth: "smile", arms: [0, 0], sprout: 0, emote: null, emoteP: 0, sweat: false, tear: -1, spin: 0 };
  const breathe = Math.sin((s / 2.6) * Math.PI * 2);
  o.sy = 1 + 0.035 * breathe; o.sx = 1 - 0.03 * breathe;
  // 眨眼：约 3.4 秒一次，偶尔连眨
  const bp = s % 3.4, bk = Math.floor(s / 3.4);
  o.blink = bp < 0.12 || (hash(bk) > 0.7 && bp > 0.24 && bp < 0.34);
  if (state === "happy") {
    const p = (s % 0.9) / 0.9, h = hop(p, form === "glow" ? 3 : 5);
    Object.assign(o, { y: h.y, sx: h.sx, sy: h.sy, eyes: "joy", mouth: "open", arms: [-1, -1], blink: false });
    o.emote = "heart"; o.emoteP = (s % 1.8) / 1.8;
  } else if (state === "talking") {
    const k = Math.abs(Math.sin(s * Math.PI * 3.2));
    o.y = -Math.round(k); o.sy += 0.05 * k; o.sx -= 0.04 * k;
    o.mouth = ["o", "open", "small", "open"][Math.floor(s * 8) % 4];
    o.arms = [Math.floor(s * 3) % 2 ? -1 : 0, Math.floor(s * 3) % 2 ? 0 : -1];
  } else if (state === "sad") {
    o.sy = 0.92 + 0.02 * breathe; o.sx = 1.06; o.lean = Math.sin(s * 1.3) * 0.6;
    o.eyes = "sad"; o.mouth = "frown"; o.sprout = 1; o.arms = [1, 1]; o.blink = false;
    o.tear = (s % 1.6) / 1.6; o.emote = "drop"; o.emoteP = (s % 2.4) / 2.4;
  } else if (state === "thinking") {
    o.lean = 1.2 + Math.sin(s * 1.6) * 0.3; o.look = [1, -1]; o.mouth = "flat"; o.arms = [0, -1];
    o.emote = "dots"; o.emoteP = (s % 1.5) / 1.5; o.sprout = -0.5;
  } else {
    // 待机小动作：每 7 秒一段，前 2.4 秒表演
    const seg = Math.floor(s / 7), ph = s % 7, v = Math.floor(hash(seg + 17) * 5);
    if (ph < 2.4) {
      if (v === 1) { o.look = [ph < 0.8 ? -1 : ph < 1.6 ? 1 : 0, 0]; }
      else if (v === 2) { const h = hop(ph / 0.8, 3); if (ph < 0.8) Object.assign(o, { y: h.y, sx: h.sx, sy: h.sy }); o.emote = ph > 0.5 ? "spark" : null; o.emoteP = (ph - 0.5) / 1.9; }
      else if (v === 3) { o.spin = ph / 2.4; o.eyes = ph > 0.3 && ph < 2 ? "joy" : "open"; }
      else if (v === 4) { o.lean = Math.sin(ph * Math.PI * 1.6) * 1; o.emote = "note"; o.emoteP = ph / 2.4; o.eyes = "joy"; o.mouth = "small"; }
    } else if (ph > 5.2 && ph < 6.4 && hash(seg + 99) > 0.6) {
      // 打个哈欠
      const k = smooth(5.2, 5.6, ph) * (1 - smooth(6, 6.4, ph));
      o.sy += 0.08 * k; o.sx -= 0.05 * k; o.mouth = k > 0.4 ? "yawn" : "smile"; o.eyes = k > 0.4 ? "shut" : o.eyes;
      o.emote = k > 0.2 ? "zz" : null; o.emoteP = (ph - 5.2) / 1.2;
    }
  }
  if (form === "cloud") {
    // 慢：大幅慢呼吸 + 左右轻晃 + 贴地漂浮；开心时不蹦，而是鼓起来晃一晃
    const slowB = Math.sin((s / 4.2) * Math.PI * 2);
    o.sx = (state === "happy" ? 1.1 + 0.06 * Math.sin(s * 5) : 1 + 0.06 * slowB) * (o.sx / Math.max(0.5, o.sx));
    o.sy = state === "happy" ? 0.94 - 0.05 * Math.sin(s * 5) : 1 - 0.05 * slowB;
    if (state === "happy" || state === "idle") o.y = Math.sin(s * 1.1) * 1.2 - 2;
    if (state !== "sad" && state !== "thinking") o.lean = Math.sin(s * 0.7) * 1.4;
    if (o.eyes === "open") o.eyes = "sleepy";
  } else if (form === "glow") {
    // 火苗：一直轻轻闪；悬空上下浮；开心时火苗窜高
    const fl = Math.sin(s * 9) * 0.5 + Math.sin(s * 13.7) * 0.35;
    o.lean += fl * 1.1;
    o.sx = 1 + 0.05 * Math.sin(s * 11);
    o.sy = (state === "happy" ? 1.18 + 0.06 * Math.sin(s * 8) : state === "sad" ? 0.82 : 1 + 0.05 * Math.sin(s * 7));
    o.y = (state === "happy" ? Math.sin(s * 3) * 2 : Math.sin(s * 2.1) * 1.6) - 4;
    if (o.eyes === "open") o.eyes = "dot";
    o.arms = [0, 0];
  } else if (state === "idle") {
    // 小团子：待机时也会时不时原地小蹦一下
    const p = (s % 2.6) / 2.6;
    if (p > 0.8) { const h = hop((p - 0.8) / 0.2, 2); o.y += h.y; o.sx *= h.sx; o.sy *= h.sy; }
  }
  return o;
}

// ---------- 绘制一帧 ----------
// t：以 0.1 秒为单位（可为小数）
export function drawOlo(ctx, { form = "buddy", color = "sun", state = "idle", t = 0, ox = 0, oy = 0 }) {
  const userPal = PALETTES[color] || PALETTES.sun;
  const F = FORMS[form] || FORMS.buddy;
  const pal = formPal(form, userPal);
  const s = REDUCED ? 0.5 : t / 10;
  const o = pose(state, s, form);
  const base = 28;                                   // 脚底
  const W = F.W * o.sx, H = F.H * o.sy;
  const cx = 16, top = base - H + o.y;
  const rows = Math.ceil(H) + 1;

  // 影子（离地越高越小）
  const air = clamp(-o.y / 6, 0, 1);
  const sw = Math.round((F.W * (F.flame ? 0.5 : F.float ? 0.75 : 0.85)) * (1 - 0.4 * air) * o.sx);
  ctx.globalAlpha = 0.3 - air * 0.12; P(ctx, ox + cx - sw / 2, oy + base + 1, "#3a1a10", sw, 1); P(ctx, ox + cx - sw / 2 + 2, oy + base + 2, "#3a1a10", Math.max(0, sw - 4), 1); ctx.globalAlpha = 1;

  // 微光：冷色光晕 + 往上飘的火星
  if (F.flame) {
    const gy = base - H * 0.35 + o.y;
    for (let y = -11; y <= 10; y++) for (let x = -11; x <= 11; x++) {
      const r = (x / 11) ** 2 + (y / 11) ** 2;
      if (r < 1 && r > 0.45 && (x + y + Math.floor(s * 4)) % 2 === 0) { ctx.globalAlpha = 0.35 * (1 - r); P(ctx, ox + cx + x, oy + gy + y, pal[4]); }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5; i++) { const k = ((s * 0.9 + i / 5) % 1); ctx.globalAlpha = 1 - k; P(ctx, ox + cx + Math.sin((s + i) * 2.3) * 4, oy + base - H + o.y - k * 7, i % 2 ? pal[4] : userPal[3]); }
    ctx.globalAlpha = 1;
  }

  // 身体遮罩
  const inside = (x, y) => {
    const vp = base + o.y - (y + 0.5), v = vp / H;
    const xx = x + 0.5 - cx - o.lean * clamp(v, 0, 1);
    if (v >= 0 && v <= 1 && Math.abs(xx) <= F.half(v) * W / 2) return true;
    if (F.puffs) for (const [px, py, r] of F.puffs) { const dx = xx - px * W / 2, dy = vp - py * H, R = r * W / 2; if (vp >= 0 && dx * dx + dy * dy < R * R) return true; }
    return false;
  };
  const y0 = Math.floor(top - 6), y1 = base + 1;
  const mask = [];
  for (let y = y0; y <= y1; y++) for (let x = 0; x < 32; x++) if (inside(x, y)) mask.push([x, y]);
  const has = new Set(mask.map(([x, y]) => x + y * 64));
  const In = (x, y) => has.has(x + y * 64);

  // 小脚
  if (F.feet) {
    const fy = base - (o.y < -0.5 ? 1 : 0) + Math.round(o.y);
    for (const fx of [cx - 5, cx + 3]) { P(ctx, ox + fx - 1 + (o.y < -0.5 ? (fx < cx ? 1 : -1) : 0), oy + fy, pal[0], 4, 1); P(ctx, ox + fx + (o.y < -0.5 ? (fx < cx ? 1 : -1) : 0), oy + fy, pal[1], 2, 1); }
  }
  // 小手（身体两侧的小圆块）
  if (F.arms) {
    const ay = base + o.y - H * 0.42;
    [[-1, o.arms[0]], [1, o.arms[1]]].forEach(([side, up]) => {
      const hw = F.half(0.42) * W / 2;
      const ax = cx + side * (hw + 0.5) + o.lean * 0.42, yy = ay + up * 3;
      if (F.small) { P(ctx, ox + ax - 1, oy + yy, pal[0], 2, 2); P(ctx, ox + ax - (side < 0 ? 0 : 1), oy + yy, pal[3], 1, 1); }
      else { P(ctx, ox + ax - 1, oy + yy - 1, pal[0], 3, 3); P(ctx, ox + ax, oy + yy, side < 0 ? pal[3] : pal[2], 1, 1); }
    });
  }

  // 身体：描边 + 顶光明暗 + 抖动过渡 + 右侧暖色轮廓光 + 腹部灯芯
  for (const [x, y] of mask) {
    const edge = !In(x - 1, y) || !In(x + 1, y) || !In(x, y - 1) || !In(x, y + 1);
    let c;
    if (edge) c = pal[0];
    else {
      const nx = (x + 0.5 - cx) / (W / 2), ny = (y + 0.5 - (top + H / 2)) / (H / 2);
      const L = -nx * 0.55 - ny * 0.85;               // 左上暖光
      const d = (x + y) % 2 === 0;
      const band = (v, th) => Math.abs(v - th) < 0.07 && d;
      c = L > 0.62 ? pal[4] : L > 0.05 ? pal[3] : L > -0.6 ? pal[2] : pal[1];
      if (band(L, 0.62)) c = pal[3]; else if (band(L, 0.05)) c = pal[2]; else if (band(L, -0.6)) c = pal[1];
      if (F.puffs) {                                             // 云朵：棉团之间的褶线
        const vp = base + o.y - (y + 0.5), xx = x + 0.5 - cx - o.lean * clamp(vp / H, 0, 1);
        F.puffs.forEach(([px, py, r], i) => { if (i === 1) return; const R = r * W / 2, dd = Math.hypot(xx - px * W / 2, vp - py * H); if (dd > R - 1 && dd < R && vp > py * H - 1 && Math.abs(xx) < W * 0.32) c = pal[1]; });
      }
      if (F.flame) {                                             // 火苗：下半部亮芯，越往上越淡
        const vp = (base + o.y - (y + 0.5)) / H, cxo = Math.abs(x + 0.5 - cx - o.lean * vp);
        const core = (cxo / 3.6) ** 2 + ((vp - 0.26) / 0.26) ** 2;
        c = core < 0.45 ? pal[5] : core < 1 ? pal[4] : vp > 0.7 ? pal[2] : pal[3];
        if (vp > 0.6 && (x + y + Math.floor(s * 8)) % 3 === 0) c = pal[2];
      }
      if (!In(x, y + 1)) c = F.flame ? pal[3] : pal[1];          // 底部暗边
      if (!F.flame && (!In(x + 1, y) || !In(x + 1, y - 1))) { if (nx > 0.2 && ny < 0.3 && ny > -0.7) c = form === "cloud" ? userPal[3] : RIM; }  // 右侧暖色轮廓光
      // 灯芯：腹部一团柔光，随呼吸明灭
    }
    P(ctx, ox + x, oy + y, c);
  }
  // 高光
  const hx = cx - W * 0.26 + o.lean * 0.8, hy = top + H * 0.2;
  if (!F.flame) { P(ctx, ox + hx, oy + hy, WHITE, 2, 1); P(ctx, ox + hx - 1, oy + hy + 1, WHITE, 1, 2); }

  const heart = 0.55 + 0.45 * Math.sin(s * 2.2);
  if (F.sprout) {
  // 嫩芽：茎随速度滞后摆动（二级运动），叶片可旋转
  const vel = (pose(state, s - 0.06, form).y - o.y) / 0.06;        // 向上为正
  let ang = clamp(-vel * 0.05, -0.9, 0.9) + Math.sin(s * 1.9) * 0.15 + o.lean * 0.18;
  if (o.sprout > 0) ang = 1.25 + Math.sin(s * 1.2) * 0.1;
  const stemLen = F.small ? 3 : 4;
  let sx = cx + o.lean, sy = top + (F.tip ? 0.5 : 1);
  for (let i = 0; i < stemLen; i++) {
    const a = ang * (i / stemLen);
    sx += Math.sin(a); sy -= Math.cos(a);
    P(ctx, ox + sx - 0.5, oy + sy, i < 1 ? pal[0] : STEM);
  }
  // 两片叶子
  const spin = o.spin ? Math.sin(o.spin * Math.PI * 4) * 1.2 : 0;
  const leaf = (dir, len, wid, col, hi) => {
    const a = ang + dir * (o.sprout > 0 ? 0.6 : 1.15) + (o.sprout < 0 ? -0.6 : 0) + spin * dir;
    const ux = Math.sin(a), uy = -Math.cos(a);
    for (let yy = -7; yy <= 7; yy++) for (let xx = -7; xx <= 7; xx++) {
      const u = xx * ux + yy * uy, w = -xx * uy + yy * ux;
      const k = u / len; if (k < 0 || k > 1) continue;
      const half = wid * Math.sin(k * Math.PI) * (1 - 0.25 * k);
      if (Math.abs(w) <= half) P(ctx, ox + sx + xx - 0.5, oy + sy + yy, Math.abs(w) <= half - 1 ? (w * dir < 0 ? hi : col) : LEAF_D);
    }
  };
  leaf(-1, F.small ? 4.2 : 5.6, 1.7, LEAF_L, LEAF_H);
  leaf(1, F.small ? 3.6 : 5, 1.5, LEAF_L, LEAF_H);
  // 嫩芽顶端的小灯苞：灯籽的光
  P(ctx, ox + sx - 0.5, oy + sy - 1, heart > 0.75 ? "#fffbe0" : BUD);

  }
  // 脸
  const ey = Math.round(top + H * (1 - F.eyeY) - 2), lean = o.lean * F.eyeY;
  const gap = F.gap;
  const lx = Math.round(cx - gap - 2 + lean + o.look[0]), rx = Math.round(cx + gap - 1 + lean + o.look[0]);
  const eyY = ey + o.look[1];
  for (const ex of [lx, rx]) {
    if (o.eyes === "joy") { P(ctx, ox + ex, oy + eyY + 2, INK); P(ctx, ox + ex + 1, oy + eyY + 1, INK, 1, 1); P(ctx, ox + ex + 2, oy + eyY + 2, INK); }
    else if (o.eyes === "shut" || o.blink) { P(ctx, ox + ex, oy + eyY + 2, F.flame ? pal[0] : INK, 3, 1); }
    else if (o.eyes === "sleepy") { P(ctx, ox + ex, oy + eyY + 2, INK, 3, 1); P(ctx, ox + ex, oy + eyY + 3, INK, 3, 1); P(ctx, ox + ex + 1, oy + eyY + 3, "#6b4a52", 1, 1); P(ctx, ox + ex - (ex === lx ? 1 : -3), oy + eyY + 1, INK, 1, 1); }
    else if (o.eyes === "dot") { P(ctx, ox + ex + 1, oy + eyY, pal[0], 2, 3); P(ctx, ox + ex + 1, oy + eyY, "#ffffff", 1, 1); }
    else if (o.eyes === "sad") {
      P(ctx, ox + ex, oy + eyY + 1, INK, 3, 3); P(ctx, ox + ex + (ex === lx ? 0 : 1), oy + eyY + 1, WHITE, 2, 1);
      P(ctx, ox + ex + (ex === lx ? -1 : 2), oy + eyY - 1, INK, 2, 1); P(ctx, ox + ex + (ex === lx ? 1 : 0), oy + eyY - 2, INK, 2, 1);
    } else {
      P(ctx, ox + ex, oy + eyY, INK, 3, 4); P(ctx, ox + ex + (o.look[0] > 0 ? 1 : 0), oy + eyY, WHITE, 2, 1); P(ctx, ox + ex + 2 - (o.look[0] > 0 ? 0 : 0), oy + eyY + 2, WHITE, 1, 1);
    }
  }
  // 腮红
  ctx.globalAlpha = o.eyes === "joy" ? 0.95 : 0.7;
  if (form === "cloud") { P(ctx, ox + lx - 2, oy + ey + 4, userPal[2], 2, 1); P(ctx, ox + rx + 3, oy + ey + 4, userPal[2], 2, 1); }
  else if (!F.flame) { P(ctx, ox + lx - 2, oy + ey + 4, CHEEK, 2, 1); P(ctx, ox + rx + 3, oy + ey + 4, CHEEK, 2, 1); }
  ctx.globalAlpha = 1;
  // 嘴
  const mx = Math.round(cx - 1 + lean + o.look[0] * 0.5), my = ey + 4;
  if (F.flame && !["open", "o", "yawn"].includes(o.mouth)) o.mouth = "none";
  switch (o.mouth) {
    case "none": break;
    case "open": P(ctx, ox + mx - 1, oy + my, INK, 4, 1); P(ctx, ox + mx - 1, oy + my + 1, INK); P(ctx, ox + mx + 2, oy + my + 1, INK); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); P(ctx, ox + mx, oy + my + 2, INK, 2, 1); break;
    case "o": P(ctx, ox + mx, oy + my, INK, 2, 1); P(ctx, ox + mx - 1, oy + my + 1, INK); P(ctx, ox + mx + 2, oy + my + 1, INK); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); P(ctx, ox + mx, oy + my + 2, INK, 2, 1); break;
    case "small": P(ctx, ox + mx, oy + my, INK, 2, 1); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); break;
    case "yawn": P(ctx, ox + mx - 1, oy + my, INK, 4, 3); P(ctx, ox + mx, oy + my + 1, MOUTH, 2, 1); break;
    case "frown": P(ctx, ox + mx, oy + my, INK, 2, 1); P(ctx, ox + mx - 1, oy + my + 1, INK); P(ctx, ox + mx + 2, oy + my + 1, INK); break;
    case "flat": P(ctx, ox + mx + 1, oy + my, INK, 2, 1); break;
    default: P(ctx, ox + mx - 1, oy + my, INK); P(ctx, ox + mx, oy + my + 1, INK, 2, 1); P(ctx, ox + mx + 2, oy + my, INK);
  }
  // 眼泪
  if (o.tear >= 0) { const k = o.tear; ctx.globalAlpha = 1 - k * 0.8; P(ctx, ox + lx, oy + ey + 4 + k * 6, TEAR, 1, 2); ctx.globalAlpha = 1; }

  // 情绪符号：从右上方飘起
  if (o.emote && o.emoteP >= 0 && o.emoteP <= 1) {
    const k = o.emoteP, pop = k < 0.15 ? k / 0.15 : 1;
    const ex = Math.round(cx + W / 2 - 1 + (o.emote === "dots" ? 0 : Math.sin(k * 6) * 1)), eyy = Math.round(top - 2 - k * 5);
    ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    const col = { heart: "#ff6b7a", note: "#fff0c8", drop: TEAR, dots: "#fff0c8", bang: "#ffd36b", zz: "#fff0c8", spark: SPARK }[o.emote];
    if (o.emote === "dots") { const n = Math.min(3, Math.floor(k * 4) + 1); for (let i = 0; i < n; i++) P(ctx, ox + cx + W / 2 - 3 + i * 2, oy + top - 1, col); }
    else if (pop > 0.5) emote(ctx, o.emote, ox + Math.min(26, ex), oy + Math.max(0, eyy - 4), col);
    ctx.globalAlpha = 1;
  }
  // 开心：周围闪光
  if (state === "happy") [[3, 9], [27, 12], [5, 20]].forEach(([x, y], i) => {
    const k = (s * 2 + i * 0.37) % 1; if (k < 0.5) { P(ctx, ox + x, oy + y - 1, SPARK); P(ctx, ox + x - 1, oy + y, SPARK, 3, 1); P(ctx, ox + x, oy + y + 1, SPARK); } else if (k < 0.7) P(ctx, ox + x, oy + y, WHITE);
  });
}

// ---------- 可挂载的 olo 精灵 ----------
export function oloSprite({ form = "buddy", color = "sun", state = "idle", scale = 4, cls = "" } = {}) {
  const [c, ctx] = canvas(32, 32, "olo-sprite " + cls);
  c.style.width = c.style.height = 32 * scale + "px";
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", "olo");
  const s = { form, color, state };
  const phase = Math.random() * 50;
  const sync = () => { c.dataset.oloForm = s.form; c.dataset.state = s.state; c.dataset.color = s.color; };
  const draw = (t) => { ctx.clearRect(0, 0, 32, 32); drawOlo(ctx, { ...s, t: t + phase }); };
  sync();
  const off = ticker.addFast(draw);
  const obs = new MutationObserver(() => { if (!c.isConnected) { off(); obs.disconnect(); } });
  requestAnimationFrame(() => obs.observe(document.body, { childList: true, subtree: true }));
  c.olo = {
    set(next) { Object.assign(s, next); sync(); draw(ticker.ft); },
    get: () => ({ ...s }),
    draw: (target, x, y, t) => drawOlo(target, { ...s, t, ox: x, oy: y }),
  };
  return c;
}
