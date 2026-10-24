// 引导动效 v2：门扉开合 / 虹膜 / 空中碎壳 / 墨点写字 / 形态拖影。
// 网页 web/onboard-fx.js 与手机 apps/mobile/src/onboardFx.js 字节一致（pytest 盯着）。
// 纯数据 + 轻量数学，两端各自渲染。不再使用 squash-stretch / 底部弹板曲线。

export const OB_SIZES = { titleScale: 7, hatchScale: 6, formScale: 6, panelMax: 520 };
export const OB_BEATS = [
  { who: "旁白", text: "城市里，每一句没说出口的话，都不会真的消失。", hour: 19.2, amb: "city" },
  { who: "旁白", text: "它们化成很轻的雾，飘到一片叫「雾里集」的河湾，凝成一粒粒发光的灯籽。", hour: 20.4, amb: "river" },
  { who: "芦婆婆", text: "「这一粒，是你那片雾里长出来的。我撑船送它过去。」", hour: 18.6, amb: "boat" },
  { who: "旁白", text: "它顺着屏幕的光，找到了你。", hour: 21.0, amb: "room" },
];
export const OB_WORDS = ["好累啊", "其实我很想你", "今天被夸了", "没关系的", "睡不着", "我做到了", "算了", "谢谢你"];
export const OB_FORMS = [["buddy", "麻薯", "软团子 · 爱蹦跶", "sun"], ["cloud", "云朵", "软软的 · 慢悠悠", "sky"], ["glow", "微光", "小火苗 · 话很少", "lavender"]];
export const OB_GENDERS = [["male", "男生", "日记里叫你「他」"], ["female", "女生", "日记里叫你「她」"], ["unspecified", "不想说", "日记里叫你「TA」"]];


/** 雾气微粒（门后氛围用，比旧版花粉更少、更慢）。 */
export function seedMotes(n, W, H, night = false) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25, vy: -0.08 - Math.random() * 0.2,
      r: 1 + (Math.random() * 2) | 0, ph: Math.random() * Math.PI * 2,
      warm: night || Math.random() > 0.5,
    });
  }
  return out;
}
export function stepMotes(motes, W, H, dt = 1, reduced = false) {
  if (reduced) return motes;
  for (const m of motes) {
    m.ph += 0.03 * dt;
    m.x += m.vx + Math.sin(m.ph) * 0.15;
    m.y += m.vy;
    if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; }
    if (m.x < -4) m.x = W + 4;
    if (m.x > W + 4) m.x = -4;
  }
  return motes;
}

/** 门扉开合：t∈[0,1] → {left,right} 各扇水平位移比例（0=关，1=全开）。 */
export function doorOpen(t) {
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
  return { left: -e, right: e, gap: e };
}

/** 虹膜开孔：t∈[0,1] → 半径比例（相对短边）。 */
export function irisRadius(t) {
  const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  return e * 1.15;
}

/** 走路摆动：t 帧 → {x 进度 0..1, bob, lean}。 */
export function walkPose(t, duration = 48) {
  const p = Math.min(1, Math.max(0, t / duration));
  const bob = Math.sin(p * Math.PI * 6) * (1 - p * 0.4);
  const lean = Math.sin(p * Math.PI * 3) * 0.08;
  return { x: p, bob, lean };
}

/** 空中碎壳：生成 n 片碎片初值。 */
export function seedShards(n, cx, cy) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = 1.2 + Math.random() * 2.4;
    out.push({
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.35,
      life: 0, max: 28 + ((Math.random() * 18) | 0),
      w: 2 + ((Math.random() * 3) | 0), h: 3 + ((Math.random() * 4) | 0),
      tone: i % 3,
    });
  }
  return out;
}

/** 推进碎片；gravity 下弧线飞散。reduced 时立刻清空。 */
export function stepShards(shards, reduced = false) {
  if (reduced) { shards.length = 0; return shards; }
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.life++; s.x += s.vx; s.y += s.vy; s.vy += 0.12; s.rot += s.spin;
    if (s.life > s.max) shards.splice(i, 1);
  }
  return shards;
}

/** 墨点写字：把目标字位拆成 ink 粒子，t∈[0,1] 时从散落收束到字形。 */
export function seedInk(targetPts, scatter = 40) {
  return targetPts.map((p, i) => ({
    tx: p.x, ty: p.y,
    x: p.x + (Math.random() - 0.5) * scatter * 2,
    y: p.y + (Math.random() - 0.5) * scatter * 2,
    ph: Math.random() * Math.PI * 2,
    delay: (i % 7) * 0.02,
  }));
}

/** ink 收束：t 全局进度。 */
export function stepInk(inks, t) {
  for (const d of inks) {
    const k = Math.min(1, Math.max(0, (t - d.delay) / 0.55));
    const e = 1 - Math.pow(1 - k, 3);
    d.x = d.x + (d.tx - d.x) * (0.18 + e * 0.5);
    d.y = d.y + (d.ty - d.y) * (0.18 + e * 0.5);
    d.ph += 0.08;
  }
  return inks;
}

/** 简易点阵：把 ASCII 字母映射成 5×5 点（用于 olo 水印式墨字预览）。 */
const GLYPH5 = {
  o: ["01110", "10001", "10001", "10001", "01110"],
  l: ["10000", "10000", "10000", "10000", "11111"],
  a: ["01110", "10001", "11111", "10001", "10001"],
  b: ["11110", "10001", "11110", "10001", "11110"],
  c: ["01111", "10000", "10000", "10000", "01111"],
  d: ["11110", "10001", "10001", "10001", "11110"],
  e: ["11111", "10000", "11110", "10000", "11111"],
  n: ["10001", "11001", "10101", "10011", "10001"],
  m: ["10001", "11011", "10101", "10001", "10001"],
  i: ["11111", "00100", "00100", "00100", "11111"],
  u: ["10001", "10001", "10001", "10001", "01110"],
  g: ["01111", "10000", "10111", "10001", "01110"],
  h: ["10001", "10001", "11111", "10001", "10001"],
  s: ["01111", "10000", "01110", "00001", "11110"],
  y: ["10001", "10001", "01110", "00100", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000"],
};

/** 把短 ASCII 名变成目标点列（中文名退回用等距点云）。 */
export function nameInkTargets(name, cx, cy, scale = 3) {
  const s = String(name || "olo").toLowerCase().slice(0, 8);
  const pts = [];
  const chars = [...s];
  const totalW = chars.length * 6 * scale;
  let x0 = cx - totalW / 2;
  for (const ch of chars) {
    const g = GLYPH5[ch];
    if (g) {
      g.forEach((row, y) => [...row].forEach((b, x) => { if (b === "1") pts.push({ x: x0 + x * scale, y: cy + y * scale }); }));
    } else {
      // 非 ASCII：一朵小墨团
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        pts.push({ x: x0 + 2.5 * scale + Math.cos(a) * 2 * scale, y: cy + 2 * scale + Math.sin(a) * 2 * scale });
      }
    }
    x0 += 6 * scale;
  }
  return pts;
}

/** 形态拖影：给出 trail 偏移（用于轮播残影）。t 切换进度 0..1。 */
export function morphTrail(t, dir = 1) {
  const e = Math.min(1, Math.max(0, t));
  return [
    { ox: dir * (1 - e) * -48, oy: Math.sin(e * Math.PI) * -6, a: 0.35 * (1 - e) },
    { ox: dir * (1 - e) * -24, oy: Math.sin(e * Math.PI) * -3, a: 0.55 * (1 - e) },
    { ox: 0, oy: 0, a: 0.4 + e * 0.6 },
  ];
}

/** 破壳阶段：t∈[0,1] → {crack, showOlo, floatY}。空中破裂，无落地挤压。 */
export function crackPhase(t) {
  const c = Math.min(1, Math.max(0, t));
  return {
    crack: c > 0.25,
    shatter: c > 0.4,
    showOlo: c > 0.45,
    oloA: c < 0.45 ? 0 : Math.min(1, (c - 0.45) / 0.25),
    floatY: Math.sin(c * Math.PI * 2) * 4,
    eggA: c < 0.4 ? 1 : Math.max(0, 1 - (c - 0.4) / 0.2),
  };
}
