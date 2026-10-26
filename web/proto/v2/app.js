import { VS, FS } from './shader.js';
const FORMS = [
  { id: 'buddy', name: '月光薄荷', a: '#bfe4ff', b: '#8fe8c8' }, { id: 'cloud', name: '雾蓝', a: '#d6e2f7', b: '#8ea6d6' },
  { id: 'glow', name: '薰衣草', a: '#eadcff', b: '#a88be8' }, { id: 'bud', name: '薄荷', a: '#d6fbe6', b: '#62cf9c' },
  { id: 'dew', name: '浅水蓝', a: '#dcf6ff', b: '#70c2ee' }, { id: 'star', name: '晨光', a: '#fff3cf', b: '#ffb27f' },
  { id: 'peach', name: '桃粉', a: '#ffe1e8', b: '#f28eab' }, { id: 'acorn', name: '青柠', a: '#f2fbc0', b: '#a8d64a' },
  { id: 'moon', name: '银月', a: '#f6f7fc', b: '#a5aec8' }, { id: 'amber', name: '蜜金', a: '#ffe9b0', b: '#e09a3a' }];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// 天色关键帧：黄昏 → 夜 → 黎明 → 黄昏
const PAL = [
  { SKYT: '#6f7fd0', SKYM: '#c7a3d6', SKYH: '#ffcbb0', SUNC: '#ffcf93', MTN: '#6c5f9e', WATC: '#5a5a9c', SUNP: [.13, -.012, .034], NIGHT: .1 },
  { SKYT: '#0b1230', SKYM: '#1d2759', SKYH: '#4b4f8a', SUNC: '#cfdcff', MTN: '#151a3f', WATC: '#0e1536', SUNP: [-.1, .22, .018], NIGHT: 1 },
  { SKYT: '#93b8e6', SKYM: '#f0c4d3', SKYH: '#ffe3c2', SUNC: '#ffe9b8', MTN: '#9692c4', WATC: '#7d93c8', SUNP: [-.12, -.02, .03], NIGHT: 0 }];
const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const expo = (x) => { x = clamp(x); return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); };
function palAt(tod) { // tod 0..3 循环
  const i = Math.floor(tod) % 3, j = (i + 1) % 3, f = ease(tod - Math.floor(tod)), A = PAL[i], B = PAL[j], out = {};
  for (const k of ['SKYT', 'SKYM', 'SKYH', 'SUNC', 'MTN', 'WATC']) out[k] = hex(A[k]).map((v, n) => lerp(v, hex(B[k])[n], f));
  out.SUNP = A.SUNP.map((v, n) => lerp(v, B.SUNP[n], f)); out.NIGHT = lerp(A.NIGHT, B.NIGHT, f); return out;
}
class Spring { constructor(x = 0, k = 120, d = 14) { this.x = x; this.v = 0; this.t = x; this.k = k; this.d = d; }
  step(dt) { const a = this.k * (this.t - this.x) - this.d * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; } }

const H = -0.06;
export class Olo {
  constructor(canvas, opts = {}) {
    this.c = canvas; this.pixel = opts.pixel ? 3 : 1; this.scale = 1;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.u = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (o[k] = gl.getUniformLocation(pr, k))) });
    this.rp = new Float32Array(40).fill(-99); this.ri = 0;
    this.t = 0; this.last = performance.now(); this.frames = [];
    // 镜头
    this.cam = { x: new Spring(0, 30, 11), y: new Spring(.06, 30, 11), z: new Spring(1, 30, 11), r: new Spring(0, 30, 11) };
    // 角色
    this.ox = new Spring(0, 60, 10); this.hy = 0; this.vy = 0; this.sq = new Spring(0, 260, 9); this.tip = new Spring(0, 70, 5);
    this.lean = new Spring(0, 50, 9); this.gx = new Spring(0, 160, 18); this.gy = new Spring(0, 160, 18);
    this.mood = [0, 0, 0, 0].map(() => new Spring(0, 40, 12)); this.blinkT = 2; this.blink = 0; this.poke = new Spring(0, 80, 10);
    this.gazeTarget = null; this.lookT = 0; this.idle = 0;
    this.form = FORMS[0]; this.form2 = FORMS[0]; this.fill = 1; this.fillT = -1;
    this.up = 1; this.refl = 1; this.fade = 1; this.wipe = [0, 0, 0]; this.mote = [0, 0, 0]; this.tod = opts.tod ?? .05; this.todSpeed = 1 / 60; this.wind = 0;
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() { const d = Math.min(devicePixelRatio || 1, 1.5) * this.scale / this.pixel;
    this.c.width = Math.round(this.c.clientWidth * d); this.c.height = Math.round(this.c.clientHeight * d); this.gl.viewport(0, 0, this.c.width, this.c.height); }
  // 世界坐标 <-> 屏幕像素（CSS）
  toWorld(px, py) { const W = this.c.clientWidth, Hh = this.c.clientHeight; let x = (px - W / 2) / Hh, y = -(py - Hh / 2) / Hh;
    const r = this.cam.r.x, z = this.cam.z.x, c = Math.cos(r), s = Math.sin(r); return [(c * x - s * y) / z + this.cam.x.x, (s * x + c * y) / z + this.cam.y.x]; }
  toScreen(wx, wy) { const W = this.c.clientWidth, Hh = this.c.clientHeight; const z = this.cam.z.x, r = -this.cam.r.x, c = Math.cos(r), s = Math.sin(r);
    let x = (wx - this.cam.x.x) * z, y = (wy - this.cam.y.x) * z; [x, y] = [c * x - s * y, s * x + c * y]; return [x * Hh + W / 2, -y * Hh + Hh / 2]; }
  ripple(x, y, k = 1) { this.rp.set([x, y, this.t, k], (this.ri++ % 10) * 4); }
  setMood(name, hold = 0) { const i = ['happy', 'curious', 'sleepy', 'sad'].indexOf(name); this.mood.forEach((m, j) => (m.t = j === i ? 1 : 0)); this.moodHold = hold; this.idle = 0; }
  hop(power = 1) { if (this.hy < .002) { this.vy = .55 * power; this.sq.v -= 6 * power; } }
  setForm(f) { this.form = this.blendForm(); this.form2 = f; this.fill = 0; this.fillT = this.t; }
  blendForm() { return this.form2; }
  get oloPos() { return [this.ox.x, H + .004 + this.hy + .006 * Math.sin(this.t * 1.4)]; }
  update(dt) {
    this.t += dt; this.tod = (this.tod + dt * this.todSpeed) % 3; this.idle += dt;
    // 跳跃/重力
    if (this.hy > 0 || this.vy > 0) { this.vy -= 2.4 * dt; this.hy += this.vy * dt; if (this.hy <= 0) { this.hy = 0; this.sq.v += 8 * Math.min(1, -this.vy * 1.5); this.vy = 0; this.ripple(this.ox.x, H - .004, .9); } }
    // 拉伸挤压：呼吸 + 速度 + 弹簧
    this.sq.t = 0; this.sq.step(dt);
    const breathe = .028 * Math.sin(this.t * (1.7 - .7 * this.mood[2].x)) * (1 + this.mood[2].x);
    const s = clamp(this.sq.x + this.vy * .35 + breathe - .12 * this.mood[3].x, -.35, .45);
    this.sx = 1 - s * .55; this.sy = 1 + s;
    // 视线：目标 / 随机扫视
    this.lookT -= dt;
    if (this.gazeTarget) { const [ox, oy] = this.oloPos; const dx = this.gazeTarget[0] - ox, dy = this.gazeTarget[1] - (oy + .09); const l = Math.hypot(dx, dy) + .05;
      this.gx.t = clamp(dx / l * 1.1, -1, 1); this.gy.t = clamp(dy / l * 1.1, -1, 1); }
    else if (this.lookT < 0) { this.lookT = 1.5 + Math.random() * 2.5; this.gx.t = (Math.random() - .5) * 1.2; this.gy.t = (Math.random() - .5) * .6; }
    this.gx.step(dt); this.gy.step(dt);
    this.lean.t = this.gx.x * .35 * (1 - this.mood[2].x) + this.mood[1].x * .25 * Math.sign(this.gx.x || 1); this.lean.step(dt);
    this.tip.t = -this.ox.v * 3 - this.lean.x * .8 + this.vy * .0; this.tip.step(dt); this.ox.step(dt);
    // 眨眼（偶尔连眨）
    this.blinkT -= dt; if (this.blinkT < 0) { this.blinkStart = this.t; this.blinkT = Math.random() < .2 ? .28 : 2.2 + Math.random() * 3; }
    const bt = this.t - (this.blinkStart ?? -9); this.blink = bt < .07 ? bt / .07 : bt < .2 ? 1 - (bt - .07) / .13 : 0;
    // 情绪自动回落
    if (this.moodHold > 0) { this.moodHold -= dt; if (this.moodHold <= 0) this.setMood('none'); }
    if (this.idle > 25 && this.autoSleep !== false) this.mood[2].t = 1;
    this.mood.forEach((m) => { m.step(dt); m.x = clamp(m.x, 0, 1); });
    this.poke.t = 0; this.poke.step(dt);
    if (this.fillT >= 0) { this.fill = clamp((this.t - this.fillT) / 1.1); if (this.fill >= 1) { this.form = this.form2; this.fillT = -1; } }
    for (const k in this.cam) this.cam[k].step(dt);
    // 鱼偶尔冒泡
    if (Math.random() < dt * .12) { const i = Math.random() < .5 ? 0 : 1, t = this.t * .06 + i * 2.7; this.ripple(Math.sin(t) * .2, H - .2 - .1 * Math.sin(t * .7 + i), .45); }
  }
  draw() {
    const { gl, u } = this; const P = palAt(this.tod);
    gl.uniform2f(u.R, this.c.width, this.c.height); gl.uniform1f(u.T, this.t);
    gl.uniform4f(u.CAM, this.cam.x.x, this.cam.y.x, this.cam.z.x, this.cam.r.x);
    for (const k of ['SKYT', 'SKYM', 'SKYH', 'SUNC', 'MTN', 'WATC']) gl.uniform3fv(u[k], P[k]);
    gl.uniform3fv(u.SUNP, P.SUNP); gl.uniform1f(u.NIGHT, P.NIGHT);
    gl.uniform4fv(u.RP, this.rp);
    const [ox, oy] = this.oloPos; gl.uniform4f(u.OLO, ox, oy, this.sx, this.sy);
    gl.uniform1f(u.LEAN, this.lean.x); gl.uniform1f(u.TIP, this.tip.x); gl.uniform1f(u.BLINK, this.blink);
    gl.uniform2f(u.GAZE, this.gx.x, this.gy.x); gl.uniform4f(u.MOOD, ...this.mood.map((m) => m.x));
    gl.uniform3fv(u.CA, hex(this.form.a)); gl.uniform3fv(u.CB, hex(this.form.b)); gl.uniform3fv(u.CA2, hex(this.form2.a)); gl.uniform3fv(u.CB2, hex(this.form2.b));
    gl.uniform1f(u.FILL, this.fillT >= 0 ? ease(this.fill) : 1);
    gl.uniform1f(u.UP, this.up); gl.uniform1f(u.REFL, this.refl); gl.uniform1f(u.FADE, this.fade); gl.uniform1f(u.PIX, this.pixel > 1 ? 1 : 0);
    gl.uniform1f(u.WIND, this.wind); gl.uniform3fv(u.MOTE, this.mote); gl.uniform3fv(u.WIPE, this.wipe); gl.uniform1f(u.POKE, this.poke.x);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  fps() { const f = this.frames; return f.length < 2 ? 0 : (f.length - 1) * 1000 / (f[f.length - 1] - f[0]); }
  after(sec, fn) { (this.timers ||= []).push([this.t + sec, fn]); }
  advance(dt, cb) { cb && cb(dt, this.t); this.update(dt);
    if (this.timers) { const due = this.timers.filter((x) => x[0] <= this.t); this.timers = this.timers.filter((x) => x[0] > this.t); due.forEach((x) => x[1]()); }
    this.draw(); }
  start(cb) { if (new URLSearchParams(location.search).get('capture')) { window.__advance = (dt) => { this.advance(dt, cb);
        for (const a of document.getAnimations()) { if (a.playState !== 'paused') a.pause(); a.currentTime = (a.currentTime || 0) + dt * 1000; } }; return; }
    const go = (now) => { const dt = Math.min(.05, (now - this.last) / 1000); this.last = now; this.advance(dt, cb);
      this.frames.push(now); if (this.frames.length > 90) this.frames.shift();
      // 自适应分辨率
      if (this.frames.length === 90 && this.fps() < 45 && this.scale > .6 && !this.noAdapt) { this.scale -= .15; this.resize(); this.frames.length = 0; }
      requestAnimationFrame(go); }; requestAnimationFrame(go); }
}
export { FORMS, ease, expo, clamp, lerp, H };
