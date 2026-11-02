// 首页原型：镜子后的 olo + 水面；打字/点击 -> 涟漪，说的话作为气泡漂过去。
import { Mirror } from './mirror.js';
import { FORMS } from './forms.js';
export function home({ pixel = 1 } = {}) {
  const q = new URLSearchParams(location.search);
  if (pixel > 1) document.body.classList.add('pixel');
  const m = new Mirror(document.querySelector('canvas'), { pixel, night: +(q.get('night') ?? .35) });
  window.__m = m;
  const fs = document.querySelector('.forms');
  FORMS.forEach((f) => { const b = document.createElement('b'); b.style.background = `linear-gradient(${f.a},${f.b})`;
    b.title = f.name; b.onclick = () => m.setForm(f); fs.appendChild(b); });
  m.setForm(FORMS.find((f) => f.id === q.get('form')) || FORMS[0]);
  const inp = document.querySelector('input'), hud = document.querySelector('.hud');
  let last = 0;
  inp.addEventListener('input', () => { const t = m.now(); if (t - last > .12) { m.ripple(.3 + Math.random() * .4, .12 + Math.random() * .15, .6); last = t; } });
  const send = () => {
    const v = inp.value.trim(); if (!v) return; inp.value = '';
    m.ripple(.5, .2, 1.4);
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = v; b.style.bottom = '90px'; document.body.appendChild(b);
    requestAnimationFrame(() => { b.style.transform = 'translate(-50%,-38vh) scale(.6)'; b.style.opacity = '0'; });
    setTimeout(() => { b.remove(); m.s.MOOD = 1; m.ripple(.5, .42, 1); setTimeout(() => (m.s.MOOD = 0), 900); }, 2200);
  };
  document.querySelector('button').onclick = send;
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && send());
  addEventListener('pointerdown', (e) => { if (e.target.tagName === 'CANVAS') m.ripple(e.clientX / innerWidth, 1 - e.clientY / innerHeight, 1); });
  const gpu = 'gpu' in navigator ? 'WebGPU可用' : '无WebGPU';
  m.loop(() => { hud.textContent = `${m.fps().toFixed(0)} fps · ${m.c.width}×${m.c.height} · WebGL2 · ${gpu}`; });
  // 演示脚本：?demo=1 自动打字
  if (q.get('demo')) { const txt = '今天好累啊'; let i = 0; const tick = () => { if (i <= txt.length) { inp.value = txt.slice(0, i++); inp.dispatchEvent(new Event('input')); setTimeout(tick, 260); } else setTimeout(send, 400); }; setTimeout(tick, 800); }
}
