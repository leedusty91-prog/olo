// 引导动效：花粉 / 萤火、布局常量。网页 web/onboard-fx.js 与手机 apps/mobile/src/onboardFx.js 字节一致（pytest 盯着）。
// 纯数据 + 轻量数学，两端各自画粒子。

export const OB_SIZES = { titleScale: 8, hatchScale: 7, formScale: 6, panelMax: 480 };
export const OB_BEATS = [
  { who: "旁白", text: "城市里，每一句没说出口的话，都不会真的消失。", hour: 19.2, amb: "city" },
  { who: "旁白", text: "它们化成很轻的雾，飘到一片叫「雾里集」的河湾，凝成一粒粒发光的灯籽。", hour: 20.4, amb: "river" },
  { who: "芦婆婆", text: "「这一粒，是你那片雾里长出来的。我撑船送它过去。」", hour: 18.6, amb: "boat" },
  { who: "旁白", text: "它顺着屏幕的光，找到了你。", hour: 21.0, amb: "room" },
];
export const OB_WORDS = ["好累啊", "其实我很想你", "今天被夸了", "没关系的", "睡不着", "我做到了", "算了", "谢谢你"];
export const OB_FORMS = [["buddy", "麻薯", "软团子 · 爱蹦跶", "sun"], ["cloud", "云朵", "软软的 · 慢悠悠", "sky"], ["glow", "微光", "小火苗 · 话很少", "lavender"]];
export const OB_GENDERS = [["male", "男生", "日记里叫你「他」"], ["female", "女生", "日记里叫你「她」"], ["unspecified", "不想说", "日记里叫你「TA」"]];

/** 初始化花粉/萤火粒子。n 个；night 时偏暖黄。 */
export function seedMotes(n, W, H, night = false) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35, vy: -0.15 - Math.random() * 0.35,
      r: 1 + (Math.random() * 2) | 0, ph: Math.random() * Math.PI * 2,
      warm: night || Math.random() > 0.55,
    });
  }
  return out;
}

/** 推进一帧；返回更新后的数组（原地改）。reduced 时几乎不动。 */
export function stepMotes(motes, W, H, dt = 1, reduced = false) {
  if (reduced) return motes;
  for (const m of motes) {
    m.ph += 0.04 * dt;
    m.x += m.vx + Math.sin(m.ph) * 0.2;
    m.y += m.vy;
    if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; }
    if (m.x < -4) m.x = W + 4;
    if (m.x > W + 4) m.x = -4;
  }
  return motes;
}

/** 破壳弹跳曲线：t∈[0,1] → scale。squash-stretch。 */
export function hatchScale(t) {
  if (t < 0.35) return 0.15 + (t / 0.35) * 1.15; // 冲出来
  if (t < 0.55) return 1.3 - ((t - 0.35) / 0.2) * 0.45; // 压扁
  if (t < 0.75) return 0.85 + ((t - 0.55) / 0.2) * 0.25; // 回弹
  return 1 + Math.sin((t - 0.75) / 0.25 * Math.PI) * 0.04;
}
