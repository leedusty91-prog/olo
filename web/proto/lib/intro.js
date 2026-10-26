// 30 秒开场：「是你在看倒影，还是倒影在看你？」 时间轴驱动，可点击跳过；?t=秒 可直接跳到某一刻。
import { Mirror } from './mirror.js';
import { FORMS } from './forms.js';
const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
const SHOTS = [
  [0.5, 5.5, '夜里，有一面很安静的水。'],
  [6, 11, '你说的话落下去，会漂到哪里？'],
  [11.5, 17, '水面上什么也没有。可倒影里，好像有谁在看你。'],
  [17.5, 23, '……还是说，你才是那个倒影？'],
  [23.5, 28.5, '镜子那边，有一只涟漪兽，在等你说话。'],
];
export function intro({ pixel = 1 } = {}) {
  if (pixel > 1) document.body.classList.add('pixel');
  const q = new URLSearchParams(location.search);
  const m = new Mirror(document.querySelector('canvas'), { pixel, night: 1 }); window.__m = m;
  m.setForm(FORMS[0]); m.s.FLIP = 0; m.s.SHOW = 0; m.s.UP = 0;
  const cap = document.querySelector('.cap'), title = document.querySelector('.title'), hud = document.querySelector('.hud');
  let off = +(q.get('t') || 0); const fired = new Set();
  m.t0 -= off * 1000;
  addEventListener('pointerdown', () => { m.t0 -= 6000; });
  m.loop((t) => {
    // 1 落字涟漪
    if (t > 7 && !fired.has(1)) { fired.add(1); m.ripple(.5, .25, 1.5); }
    if (t > 8.5 && !fired.has(2)) { fired.add(2); m.ripple(.42, .2, 1); }
    // 2 倒影中浮现 olo（此时只在水里）
    m.s.SHOW = ease((t - 11) / 4);
    m.s.NIGHT = 1 - .55 * ease((t - 17) / 6);
    // 3 镜面翻转：上下世界互换（参照倒开的 F1）
    m.s.FLIP = ease((t - 17.5) / 3.5);
    // 4 olo 弹一下，涟漪回传
    m.s.MOOD = t > 24 && t < 26 ? 1 : 0;
    if (t > 24.5 && !fired.has(3)) { fired.add(3); m.ripple(.5, .3, 1.6); }
    const s = SHOTS.find(([a, b]) => t >= a && t < b);
    cap.textContent = s ? s[2] : cap.textContent; cap.style.opacity = s ? 1 : 0;
    title.style.opacity = t > 28.5 ? 1 : 0;
    hud.textContent = `${t.toFixed(1)}s · ${m.fps().toFixed(0)} fps`;
  });
}
