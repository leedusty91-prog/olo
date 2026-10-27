import { Olo, FORMS, ease, expo, clamp, lerp, H } from './app.js';
const q = new URLSearchParams(location.search);
const pixel = q.get('look') === 'pixel'; if (pixel) document.body.classList.add('pixel');
const O = new Olo(document.getElementById('c'), { pixel, tod: +(q.get('tod') ?? .05) }); window.__m = O;
if (q.get('noadapt')) O.noAdapt = true;
const $ = (id) => document.getElementById(id);
const screens = { intro: $('intro'), home: $('home'), forms: $('forms') };
let screen = null;
const FRAMES = { home: [0, .06, 1, 0], forms: [0, .0, 2.3, 0] };
function camTo([x, y, z, r], snap) { const c = O.cam; [c.x.t, c.y.t, c.z.t, c.r.t] = [x, y, z, r]; if (snap) for (const k in c) { c[k].x = c[k].t; c[k].v = 0; } }
function go(name, from) {
  if (screen === name) return; const prev = screen; screen = name;
  for (const k in screens) screens[k].classList.toggle('on', k === name);
  if (prev) { const [x, y] = from || [innerWidth / 2, innerHeight * .4]; const W = innerWidth, Hh = innerHeight;
    O.wipe = [(x - W / 2) / Hh, -(y - Hh / 2) / Hh, .001]; O.wipeStart = O.t; }
  if (name === 'home') { camTo(FRAMES.home); O.autoSleep = true; O.todSpeed = 1 / 60; }
  if (name === 'forms') { camTo([O.oloPos[0], O.oloPos[1] + .03, 1.75, 0]); O.setMood('curious', 1.2); O.autoSleep = false; }
}
// ---------- 首页交互 ----------
const inp = $('in'), moodtxt = $('moodtxt');
const MOODTXT = { happy: '开心地晃了晃', curious: '凑过来看你打字', sleepy: '有点困了', sad: '有点难过', none: '在发呆' };
let lastKey = 0;
inp.addEventListener('input', () => {
  O.idle = 0; O.mood[2].t = 0; if (O.t - lastKey > .09) { lastKey = O.t;
    O.ripple((Math.random() - .5) * .3, H - .3 - Math.random() * .08, .35); }
  O.setMood('curious', 2.5); const [bx, by] = O.toWorld(innerWidth / 2, innerHeight - 40); O.gazeTarget = [bx * .5, by]; O._gt = O.t + 2.5;
});
$('bar').addEventListener('submit', (e) => { e.preventDefault(); send(inp.value.trim()); inp.value = ''; });
function send(text) {
  if (!text) return; O.idle = 0;
  const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text; $('bubbles').appendChild(b);
  const r0 = $('bar').getBoundingClientRect(); const bw = Math.min(b.offsetWidth, innerWidth * .7);
  const sx = r0.right - bw - 8, sy = r0.top - 56; const [hx, hy] = O.toScreen(O.oloPos[0] + .02, H);
  b.style.left = sx + 'px'; b.style.top = sy + 'px';
  const dx = hx - sx - bw / 2, dy = hy - sy;
  const anim = b.animate([
    { transform: 'translate(0,24px) scale(.8)', opacity: 0, filter: 'blur(4px)' },
    { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'blur(0)', offset: .18 },
    { transform: `translate(${dx * .35}px,${dy * .45}px) scale(.85) rotate(-2deg)`, opacity: 1, filter: 'blur(0)', offset: .55 },
    { transform: `translate(${dx}px,${dy}px) scale(.12)`, opacity: 0, filter: 'blur(6px)' }],
    { duration: 1700, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
  O.gazeTarget = O.toWorld(sx + bw / 2, sy); O.setMood('curious', 2);
  O.after(.7, () => { O.gazeTarget = O.toWorld(hx, hy); O._gt = O.t + 3; });
  anim.onfinish = () => {
    b.remove(); const w0 = O.toWorld(hx, hy); O.ripple(w0[0], H - .003, 1.3);
    // 光点从镜面飘到 olo
    const st = O.t; const tick = () => { const k = clamp((O.t - st) / .7); const [ox, oy] = O.oloPos;
      O.mote = [lerp(w0[0], ox, ease(k)), lerp(H + .005, oy + .07, ease(k)) + Math.sin(k * Math.PI) * .05, Math.sin(k * Math.PI) + .01];
      if (k < 1) O.after(0, tick); else { O.mote = [0, 0, 0]; react(text); } }; tick();
  };
}
function react(text) {
  O.gazeTarget = null;
  if (/难过|难受|累|哭|烦|sad|tired/i.test(text)) { O.setMood('sad', 3.5); O.sq.v -= 2; }
  else { O.setMood('happy', 2.4); O.hop(1); O.after(.65, () => O.hop(.6)); }
}
// 触摸：点水 = 涟漪；点 olo = 戳一下
O.c.addEventListener('pointerdown', (e) => {
  const w = O.toWorld(e.clientX, e.clientY); const [ox, oy] = O.oloPos; O.idle = 0; O.mood[2].t = 0;
  if (Math.hypot(w[0] - ox, w[1] - (oy + .08)) < .1) { O.sq.v -= 7; O.poke.v += 6; O.setMood('happy', 1.5); O.after(.12, () => O.hop(.7)); return; }
  if (w[1] < H) O.ripple(w[0], w[1], 1.1);
  O.gazeTarget = w; O._gt = O.t + 1.8; O.setMood('curious', 1);
});
O.c.addEventListener('pointermove', (e) => { if (screen !== 'intro' && e.pointerType === 'mouse') { O.gazeTarget = O.toWorld(e.clientX, e.clientY); O._gt = O.t + 1.5; } });
// ---------- 形态 ----------
const chips = $('chips');
FORMS.forEach((f, i) => { const c = document.createElement('button'); c.className = 'chip' + (i ? '' : ' sel'); c.style.cssText += `background:none;border:0;color:#fff;transition-delay:${i * 45}ms`;
  c.innerHTML = `<b style="background:linear-gradient(160deg,${f.a},${f.b})"></b>${f.name}`;
  c.onclick = () => { chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('sel')); c.classList.add('sel'); $('fname').textContent = f.name;
    O.setForm(f); O.sq.v -= 3; O.setMood('happy', 1.4); O.ripple(O.oloPos[0], H - .004, .8); };
  chips.appendChild(c); });
$('toForms').onclick = (e) => go('forms', [e.clientX, e.clientY]);
$('back').onclick = (e) => go('home', [e.clientX, e.clientY]);
// ---------- 开场（约 32 秒，镜头脚本） ----------
const SHOTS = [[1.5, 5.6, '夜里，有一面很安静的水。'], [6.4, 10.8, '你说的话落进去，会漂到哪里呢？'],
  [11.6, 16.6, '水面上什么也没有。\n可倒影里，好像有谁在看你。'], [17.4, 22.4, '……还是说，\n你才是那个倒影？'], [23.2, 27.8, '镜子那边，有一只涟漪兽，\n在等你说话。']];
const cap = $('cap'); let capIdx = -1;
function showCap(i) { if (i === capIdx) return; capIdx = i; cap.className = 'cap hide';
  O.after(capIdx < 0 ? 0 : .45, () => { if (i < 0) { cap.innerHTML = ''; return; } cap.innerHTML = [...SHOTS[i][2]].map((ch, k) => ch === '\n' ? '<br>' : `<span style="transition-delay:${k * 45}ms">${ch}</span>`).join('');
    O.after(.04, () => (cap.className = 'cap show')); }); }
let introT = +(q.get('t') ?? 0), introOn = false; const fired = new Set();
const once = (k, f) => { if (!fired.has(k)) { fired.add(k); f(); } };
function introFrame(dt) {
  if (!introOn) return; introT += dt; const t = introT; const c = O.cam;
  // 天色：夜 → 黎明前
  O.tod = 1 + .35 * ease((t - 17) / 9); O.todSpeed = 0;
  O.fade = ease(t / 2.5);
  let x = 0, y, z, r = 0;
  if (t < 6) { y = lerp(H - .16, H - .12, ease(t / 6)); z = 3.2; x = lerp(.05, 0, ease(t / 6)); }          // S1 贴近水面
  else if (t < 11.5) { const k = ease((t - 6) / 5.5); y = lerp(H - .12, H - .02, k); z = lerp(3.2, 1.5, k); }   // S2 抬镜：倒影里出现 olo
  else if (t < 17.2) { const k = ease((t - 11.5) / 5.7); y = lerp(H - .02, H - .1, k); z = lerp(1.5, 2.6, k); }  // S3 推近倒影
  else if (t < 22.5) { const k = ease((t - 17.2) / 5.3); y = lerp(H - .1, H - .06, k); z = lerp(2.6, 1.15, k) + Math.sin(k * Math.PI) * -.35; r = Math.PI * k; } // S4 翻滚互换
  else { const k = expo((t - 22.5) / 4); y = lerp(H - .06, .06, k); z = lerp(1.15, 1, k); r = Math.PI * (1 - k); }  // S5 回正落位
  c.x.x = x; c.y.x = y; c.z.x = z; c.r.x = r; for (const k in c) { c[k].t = c[k].x; c[k].v = 0; }
  // olo：开场前段只存在于倒影；翻滚时“真身”浮现
  O.refl = ease((t - 7.5) / 3);
  O.up = t < 22.5 ? 0 : ease((t - 22.5) / 1.2);
  if (t > 22.5) once('flash', () => { O.wipe = [0, 0, .001]; O.wipeStart = O.t; });
  once('m', () => { O.autoSleep = false; O.setMood('sleepy'); });
  if (t > 3.3) once('drop', () => O.ripple(.02, H - .14, 1.4));
  if (t > 4.6) once('drop2', () => O.ripple(-.04, H - .1, .8));
  if (t > 9) once('wake', () => O.setMood('none'));
  if (t > 12.8) once('look', () => { O.gazeTarget = [0, H - .4]; O.setMood('curious', 4); });
  if (t > 15.4) once('blink', () => { O.blinkT = 0; });
  if (t > 24.2) once('happy', () => { O.gazeTarget = null; O.setMood('happy', 3); O.hop(1); });
  if (t > 25.1) once('hop2', () => O.hop(.7));
  // 环境风
  O.wind = .4 * Math.max(0, Math.sin((t - 17) * .6)) * (t > 17 && t < 23 ? 1 : 0);
  const i = SHOTS.findIndex(([a, b]) => t >= a && t < b); showCap(i);
  if (t > 28.3) { $('title').classList.add('show'); $('sub').classList.add('show'); }
  if (t > 30) $('begin').classList.add('show');
}
function endIntro(e) { introOn = false; showCap(-1); O.fade = 1; O.up = 1; O.refl = 1; O.tod = 1.6; O.todSpeed = 1 / 60;
  O.cam.r.t = 0; go('home', e && [e.clientX, e.clientY]); }
$('begin').onclick = endIntro; $('skip').onclick = endIntro;
// ---------- 调试 / 演示 ----------
if (q.get('debug')) { const d = $('dbg'); d.classList.add('on');
  for (const m of ['happy', 'curious', 'sleepy', 'sad', 'none']) { const b = document.createElement('button'); b.textContent = m; b.onclick = () => O.setMood(m, 4); d.appendChild(b); } }
let lastMood = '';
const hud = $('hud'); let hudT = 0;
O.start((dt) => {
  introFrame(dt);
  if (O._gt && O.t > O._gt) { O._gt = 0; O.gazeTarget = null; }
  if (O.wipe[2] > 0) { O.wipe[2] = clamp((O.t - O.wipeStart) / 1.1); if (O.wipe[2] >= 1) O.wipe[2] = 0; }
  const names = ['happy', 'curious', 'sleepy', 'sad']; let mi = -1, mv = .5; O.mood.forEach((m, i) => { if (m.x > mv) { mv = m.x; mi = i; } });
  const mt = MOODTXT[names[mi] || 'none']; if (mt !== lastMood) { lastMood = mt; moodtxt.textContent = mt; }
  if ((hudT += dt) > .5) { hudT = 0; if (q.get('hud')) hud.textContent = `${O.fps().toFixed(0)} fps · ${O.c.width}×${O.c.height}`; }
});
const start = q.get('screen') || 'intro';
if (start === 'intro') { introOn = true; go('intro'); O.fade = 0; } else { O.tod = +(q.get('tod') ?? .05); camTo(FRAMES.home, true); go(start); if (start === 'forms') camTo([0, H + .004 + .03, 1.75, 0], true); }
if (q.get('mood')) { O.autoSleep = false; O.setMood(q.get('mood'), 1e9); if (q.get('gaze')) O.gazeTarget = [+q.get('gaze'), .2]; }
// 自动演示（录屏用）
if (q.get('demo') === 'home') {
  const typ = async (s) => { for (let i = 1; i <= s.length; i++) { inp.value = s.slice(0, i); inp.dispatchEvent(new Event('input')); await new Promise((r) => O.after(.17, r)); } };
  const wait = (ms) => new Promise((r) => O.after(ms / 1000, r));
  (async () => { await wait(1200); const tap = (x, y) => O.c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y }));
    tap(innerWidth * .3, innerHeight * .72); await wait(1100); tap(innerWidth * .75, innerHeight * .8); await wait(1200);
    await typ('今天看到一只很胖的鸭子'); await wait(300); $('bar').requestSubmit(); await wait(3600);
    const [px, py] = O.toScreen(O.oloPos[0], O.oloPos[1] + .07); tap(px, py); await wait(2200);
    await typ('有点累了'); await wait(300); $('bar').requestSubmit(); })();
}
if (q.get('demo') === 'forms') { const wait = (ms) => new Promise((r) => O.after(ms / 1000, r));
  (async () => { await wait(1000); $('toForms').click(); for (const i of [6, 2, 9, 3]) { await wait(1900); chips.children[i].click(); chips.children[i].scrollIntoView({ inline: 'center' }); } await wait(1800); $('back').click(); })(); }
