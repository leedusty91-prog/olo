// olo 雨窗（原创实现，原生 WebGL2，零依赖）
// 三层：① 窗外像素场景（黄昏镜湖 + olo，2D 画布，最近邻放大保持像素锐利）
//       ② 玻璃上的水（CPU 模拟：静止小水珠 + 会合并、下滑、留下尾迹的大水滴，画成高度场）
//       ③ 雾气（大水滴滑过会擦出清晰的路径，之后慢慢重新起雾）
// 着色器根据高度场求法线，对每颗水滴做实时折射（像小透镜一样看到倒转、缩小的窗外景色）。
import { drawOlo, REDUCED } from "../../pixel.js";

const Q = new URLSearchParams(location.search);
const FORM = Q.get("form") || "buddy";
const SEED = +(Q.get("seed") || 0) || ((Math.random() * 1e9) | 0);
const WARM = +(Q.get("warm") || 6);            // 启动时预先模拟几秒，让玻璃一开始就是湿的
const FIXED_T = Q.has("t") ? +Q.get("t") : null; // 截图用：固定时间
const reduced = REDUCED || Q.has("reduced");
const hud = document.getElementById("hud");
if (Q.has("debug")) hud.hidden = false;

let s = SEED >>> 0 || 1;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const R = (a, b) => a + (b - a) * rnd();

const glc = document.getElementById("gl");
const gl = glc.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
if (!gl) { document.getElementById("fallback").style.display = "flex"; throw new Error("no webgl2"); }

// ---------------- ① 窗外像素场景 ----------------
const scene = document.createElement("canvas"), sx = scene.getContext("2d");
const bg = document.createElement("canvas"), bx = bg.getContext("2d");
const spr = document.createElement("canvas"); spr.width = spr.height = 32;
const spx = spr.getContext("2d");
let PW = 0, PH = 0;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerpC = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
// 黄昏镜湖色带（原创配色，延续 olo 倒影国的粉彩）
const SKY = ["#2a2d5c", "#3d3f7a", "#5b5594", "#8a6ea6", "#c48fae", "#eeb0a8", "#ffd3a6"].map(hex);
function bandColor(k, x, y) {
  const f = Math.min(0.9999, Math.max(0, k)) * (SKY.length - 1);
  const i = Math.floor(f), fr = f - i;
  const d = (BAYER[(x & 3) + (y & 3) * 4] + 0.5) / 16;   // 有序抖动：色带之间是像素颗粒过渡
  return SKY[fr > d ? Math.min(i + 1, SKY.length - 1) : i];
}
function buildBackground() {
  bg.width = PW; bg.height = PH;
  const img = bx.createImageData(PW, PH), D = img.data;
  const hz = Math.round(PH * 0.62);                       // 地平线
  const put = (x, y, c) => { const o = (y * PW + x) * 4; D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255; };
  for (let y = 0; y < hz; y++) for (let x = 0; x < PW; x++) put(x, y, bandColor(y / hz, x, y));
  // 湖面：天空的镜像，偏暗偏蓝
  for (let y = hz; y < PH; y++) for (let x = 0; x < PW; x++) {
    const my = hz - (y - hz) * 1.15;
    const c = bandColor(Math.max(0, my) / hz, x, y);
    put(x, y, lerpC(c, [40, 48, 100], 0.28 + 0.4 * (y - hz) / (PH - hz)));
  }
  bx.putImageData(img, 0, 0);
  // 远山（两层剪影）
  const hill = (col, amp, base, f, ph) => {
    bx.fillStyle = col;
    for (let x = 0; x < PW; x++) {
      const h = Math.round(base + amp * (Math.sin(x * f + ph) * 0.6 + Math.sin(x * f * 2.7 + ph * 2) * 0.4));
      bx.fillRect(x, hz - h, 1, h);
      bx.globalAlpha = 0.35; bx.fillRect(x, hz, 1, Math.round(h * 0.8)); bx.globalAlpha = 1; // 倒影
    }
  };
  hill("#6a5c97", PH * 0.03, PH * 0.06, 0.05, 1.3);
  hill("#4a4780", PH * 0.025, PH * 0.03, 0.09, 4.1);
  // 月亮 + 倒影
  const mx = Math.round(PW * 0.72), my = Math.round(PH * 0.2), mr = Math.max(4, Math.round(PW * 0.055));
  for (let y = -mr; y <= mr; y++) for (let x = -mr; x <= mr; x++) {
    const d = x * x + y * y;
    if (d <= mr * mr) { bx.fillStyle = d > (mr - 1) * (mr - 1) ? "#ffe7c0" : "#fff6e0"; bx.fillRect(mx + x, my + y, 1, 1); }
    else if (d <= (mr + 2) * (mr + 2) && (x + y) & 1) { bx.fillStyle = "#ffd3a655"; bx.fillRect(mx + x, my + y, 1, 1); }
  }
  // 星星
  for (let i = 0; i < PW * 0.25; i++) {
    const x = (rnd() * PW) | 0, y = (rnd() * hz * 0.45) | 0;
    bx.fillStyle = rnd() < 0.3 ? "#fff6e0" : "#c9c4f0"; bx.fillRect(x, y, 1, 1);
  }
  // 近岸：一条浅色沙洲给 olo 站
  const sy = Math.round(PH * 0.76);
  bx.fillStyle = "#3b3a73"; bx.fillRect(0, sy + 1, PW, 2);
  for (let x = 0; x < PW; x++) {
    const w = Math.round(PW * 0.28 * (1 - Math.pow((x - PW / 2) / (PW * 0.3), 2)));
    if (w > 0) { bx.fillStyle = "#8f86c4"; bx.fillRect(x, sy, 1, 1); bx.fillStyle = "#6d66a8"; bx.fillRect(x, sy + 1, 1, 1); }
  }
  // 芦苇
  bx.fillStyle = "#2c2d5e";
  for (let i = 0; i < 9; i++) {
    const x = Math.round(i < 5 ? R(1, PW * 0.18) : R(PW * 0.82, PW - 2)), h = Math.round(R(PH * 0.05, PH * 0.11));
    bx.fillRect(x, PH * 0.8 - h, 1, h);
    if (rnd() < 0.6) bx.fillRect(x, PH * 0.8 - h - 2, 1, 2);
  }
  return { hz, sy, mx, my, mr };
}
let G;
function drawScene(t) {
  sx.drawImage(bg, 0, 0);
  // 湖面闪光：几条随时间移动的短横线（月光的碎影）
  for (let i = 0; i < 14; i++) {
    const y = G.hz + 2 + ((i * 7) % Math.max(4, PH - G.hz - 4));
    const len = 2 + (i % 4);
    const x = Math.round(G.mx - 6 + Math.sin(t * 0.06 + i * 1.7) * (3 + (y - G.hz) * 0.15));
    sx.fillStyle = i % 3 ? "#ffe7c066" : "#fff6e0aa";
    sx.fillRect(x, y, len, 1);
  }
  // olo（生产版像素角色，带全部待机动画）
  spx.clearRect(0, 0, 32, 32);
  drawOlo(spx, { form: FORM, state: "idle", t });
  const ox = Math.round(PW / 2 - 16), oy = G.sy - 28;
  sx.drawImage(spr, ox, oy);
  // 湖中倒影：上下翻转、半透明、隔行抖动
  sx.save(); sx.globalAlpha = 0.38; sx.translate(ox, G.sy * 2 + 4); sx.scale(1, -1);
  for (let y = 0; y < 28; y += 1) { const w = Math.round(Math.sin(t * 0.08 + y * 0.9) * 0.8); sx.drawImage(spr, 0, y, 32, 1, w, y, 32, 1); }
  sx.restore();
}

// ---------------- ② 玻璃上的水 ----------------
const wet = document.createElement("canvas"), wx = wet.getContext("2d");
const beads = document.createElement("canvas"), bdx = beads.getContext("2d");
const fog = document.createElement("canvas"), fx = fog.getContext("2d");
let W = 0, H = 0, SS = 0.5, U = 1;   // CSS 尺寸、模拟分辨率比例、尺寸单位
const FS = 1 / 8;                     // 雾层分辨率
let dropSprite;                       // 预渲染的水滴高度轮廓（半球）
function makeDropSprite() {
  const n = 64, c = document.createElement("canvas"); c.width = c.height = n;
  const x = c.getContext("2d"), img = x.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = (i + 0.5) / n * 2 - 1, dy = (j + 0.5) / n * 2 - 1, d = dx * dx + dy * dy;
    const h = d < 1 ? Math.sqrt(1 - d) : 0;
    const o = (j * n + i) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = h * 255;
  }
  x.putImageData(img, 0, 0); return c;
}
const drops = [];
function stamp(ctx, x, y, r, sy = 1) {   // sy>1：下滑时略微拉长
  ctx.drawImage(dropSprite, (x - r) * SS, (y - r * sy) * SS, 2 * r * SS, 2 * r * sy * SS);
}
function addBead(x, y, r) { stamp(bdx, x, y, r); }
function spawnDrop(y) {
  drops.push({ x: R(0, W), y: y ?? R(0, H * 0.9), r: R(3.5, 9) * U, vy: 0, vx: 0, wob: R(0, 6.28), sl: 0, ty: 0, k: R(0.6, 1.4) });
}
function resetWater() {
  drops.length = 0;
  bdx.clearRect(0, 0, beads.width, beads.height);
  const nb = Math.round(W * H / 260);
  for (let i = 0; i < nb; i++) addBead(R(0, W), R(0, H), Math.pow(rnd(), 3) * 2.4 * U + 0.6 * U);
  for (let i = 0; i < Math.round(W * H / 5200); i++) spawnDrop();
  fx.fillStyle = "#fff"; fx.fillRect(0, 0, fog.width, fog.height);
}
function step(dt) {
  // 毛毛雨：持续落下新的小水珠和偶尔的大水滴
  const area = W * H / 1e5;
  for (let i = 0; i < area * 14 * dt; i++) if (rnd() < 0.9) addBead(R(0, W), R(0, H), Math.pow(rnd(), 3) * 2.2 * U + 0.6 * U);
  if (rnd() < area * 1.3 * dt && drops.length < 140) spawnDrop();
  const g = 520 * U;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    const heavy = d.r > 7.5 * U;
    if (!heavy && d.vy === 0) { if (rnd() < dt * 0.04) d.r += 0.4 * U; continue; }   // 粘在玻璃上
    // 重力 vs 玻璃阻力：越大越快，走走停停
    const target = g * (d.r / (10 * U)) * 0.12 * d.k;
    d.vy += (target - d.vy) * Math.min(1, dt * 3) + R(-1, 1) * 40 * U * dt;
    if (rnd() < dt * 0.6) d.vy *= 0.2;                 // 偶尔被卡住一下
    d.vy = Math.max(d.vy, 4 * U);
    d.wob += dt * 2;
    d.vx = Math.sin(d.wob * d.k) * 6 * U + R(-1, 1) * 8 * U;
    const ox = d.x, oy = d.y;
    d.x += d.vx * dt; d.y += d.vy * dt;
    // 擦掉路径上的小水珠，并把它们并入自己
    bdx.globalCompositeOperation = "destination-out";
    stamp(bdx, d.x, d.y, d.r * 0.92, 1.1);
    bdx.globalCompositeOperation = "source-over";
    // 在雾层上擦出清晰的路径
    fx.globalCompositeOperation = "destination-out";
    fx.beginPath(); fx.arc(d.x * FS, d.y * FS, d.r * 0.85 * FS + 0.4, 0, 7); fx.fill();
    fx.globalCompositeOperation = "source-over";
    // 尾迹：每走一段距离留下一颗小水珠，自己略微变小
    d.ty += Math.hypot(d.x - ox, d.y - oy);
    if (d.ty > d.r * 0.9) {
      d.ty = 0;
      if (rnd() < 0.75) { const br = d.r * R(0.16, 0.32); addBead(d.x + R(-0.3, 0.3) * d.r, d.y - d.r * 1.3, br); d.r = Math.sqrt(Math.max(1, d.r * d.r - br * br * 0.5)); }
    }
    d.r = Math.max(d.r, 0); d.sl = Math.min(1, d.vy / (60 * U));
    if (d.r < 3 * U) { drops.splice(i, 1); continue; }
    // 合并：碰到的水滴被吸收（面积守恒）
    for (let j = drops.length - 1; j >= 0; j--) {
      if (j === i) continue;
      const e = drops[j], dist = Math.hypot(e.x - d.x, e.y - d.y);
      if (dist < (d.r + e.r) * 0.8) {
        d.r = Math.min(22 * U, Math.sqrt(d.r * d.r + e.r * e.r));
        drops.splice(j, 1); if (j < i) i--;
      }
    }
    if (d.y - d.r > H) drops.splice(i, 1);
  }
  for (const d of drops) if (d.r > 7.5 * U && d.vy === 0) d.vy = 1;
  // 雾慢慢回来
  fx.globalAlpha = Math.min(1, dt * 0.08); fx.fillStyle = "#fff"; fx.fillRect(0, 0, fog.width, fog.height); fx.globalAlpha = 1;
}
function drawWet() {
  wx.clearRect(0, 0, wet.width, wet.height);
  wx.drawImage(beads, 0, 0);
  for (const d of drops) {
    stamp(wx, d.x, d.y, d.r, 1 + d.sl * 0.18);
    if (d.sl > 0.2) stamp(wx, d.x, d.y - d.r * 0.9, d.r * 0.55, 1.2);   // 下滑时上方拖出的颈部，和本体融成一颗泪滴
  }
}

// ---------------- ③ WebGL 合成 ----------------
const VS = `#version 300 es
in vec2 p; out vec2 v; void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0,1); }`;
const FSH = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uScene, uWet, uFog;
uniform vec2 uWetPx;     // 1/水层像素尺寸
uniform float uTime, uAspect;
float H(vec2 uv){ return texture(uWet, uv).a; }
vec3 sceneAt(vec2 uv, float lod){ return textureLod(uScene, clamp(uv, 0.001, 0.999), lod).rgb; }
void main(){
  vec2 uv = vec2(v.x, 1.0 - v.y);
  float h = H(uv);
  vec2 e = uWetPx * 1.5;
  vec2 grad = vec2(H(uv + vec2(e.x,0)) - H(uv - vec2(e.x,0)), H(uv + vec2(0,e.y)) - H(uv - vec2(0,e.y)));
  vec3 n = normalize(vec3(-grad * 3.0, 0.35));
  float mask = smoothstep(0.10, 0.24, h);
  // 雾：越靠边越浓，中间留出能看清 olo 的区域
  vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(0.25, 0.75, length(c));
  float fogA = texture(uFog, uv).r * (0.32 + 0.5 * vig);
  vec3 sharp = sceneAt(uv, 0.0);
  vec3 blur = sceneAt(uv + vec2(0.0, 0.004), 2.6) * 0.92 + vec3(0.05, 0.055, 0.09);
  vec3 glass = mix(sharp, blur, fogA);
  // 水滴里：像小透镜一样折射（倒转 + 缩小），用清晰的像素图
  vec2 off = -n.xy * (0.05 + 0.10 * h) * vec2(1.0/uAspect, 1.0) * 1.6;
  vec3 inside = sceneAt(uv + off, 0.0);
  inside = inside * 1.12 + 0.02;
  // 水滴边缘变暗（厚的玻璃边吃光），上方高光，下方焦散亮斑
  float rim = pow(1.0 - n.z, 1.6);
  inside *= 1.0 - rim * 0.32;
  vec3 L = normalize(vec3(-0.45, -0.6, 0.65));
  float spec = pow(max(dot(reflect(-L, n), vec3(0,0,1)), 0.0), 40.0);
  inside += spec * vec3(1.0, 0.96, 0.9) * 0.9;
  float caus = smoothstep(0.3, 0.9, h) * smoothstep(0.0, 0.25, n.y) * 0.18;
  inside += caus * vec3(1.0, 0.85, 0.75);
  // 水滴下方的一点阴影，让水滴“贴”在玻璃上
  float sh = smoothstep(0.1, 0.3, H(uv - vec2(0.0, uWetPx.y * 3.0))) * (1.0 - mask);
  glass *= 1.0 - sh * 0.18;
  vec3 col = mix(glass, inside, mask);
  // 室内一侧极淡的暖光反射 + 轻微暗角
  col += vec3(0.03, 0.02, 0.01) * (1.0 - uv.y);
  col *= 1.0 - 0.25 * vig * vig;
  o = vec4(pow(col, vec3(1.0)), 1.0);
}`;
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FSH)); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const un = (k) => gl.getUniformLocation(prog, k);
function tex(unit, name, mag, min) {
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(un(name), unit); return t;
}
const tScene = tex(0, "uScene", gl.NEAREST, gl.LINEAR_MIPMAP_LINEAR);   // 放大用最近邻 → 像素保持锐利
const tWet = tex(1, "uWet", gl.LINEAR, gl.LINEAR);
const tFog = tex(2, "uFog", gl.LINEAR, gl.LINEAR);
function upload(unit, t, src, mip) {
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
}

// ---------------- 尺寸 / 自适应分辨率 ----------------
let quality = 1;            // 0.5–1，按帧时间自动调整
const DPR_CAP = 2;
function applyRes() {
  const dpr = Math.min(devicePixelRatio || 1, DPR_CAP) * quality;
  glc.width = Math.round(W * dpr); glc.height = Math.round(H * dpr);
  gl.viewport(0, 0, glc.width, glc.height);
}
function resize() {
  W = innerWidth; H = innerHeight; U = Math.max(0.8, Math.min(W, H) / 420);
  SS = Math.min(0.75, 640 / Math.max(W, H));
  wet.width = beads.width = Math.round(W * SS); wet.height = beads.height = Math.round(H * SS);
  fog.width = Math.ceil(W * FS); fog.height = Math.ceil(H * FS);
  const ps = Math.max(3, Math.round(H / 170));     // 每个像素格的 CSS 尺寸
  PW = Math.ceil(W / ps); PH = Math.ceil(H / ps);
  scene.width = PW; scene.height = PH; sx.imageSmoothingEnabled = false;
  G = buildBackground();
  applyRes(); resetWater();
  gl.uniform2f(un("uWetPx"), 1 / wet.width, 1 / wet.height);
  gl.uniform1f(un("uAspect"), W / H);
}

// ---------------- 主循环 ----------------
let last = performance.now(), simT = 0, lastSceneT = -1, running = true, avg = 16, frames = 0, fpsT = 0, fps = 0, adaptT = 0;
function render(now) {
  const t10 = FIXED_T != null ? FIXED_T * 10 : now / 100;   // drawOlo 用 0.1 秒为单位
  const st = Math.floor(t10 * 2);                            // 角色 20fps 更新即可
  if (st !== lastSceneT) { lastSceneT = st; drawScene(t10); upload(0, tScene, scene, true); }
  drawWet(); upload(1, tWet, wet, false); upload(2, tFog, fog, false);
  gl.uniform1f(un("uTime"), now / 1000);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function frame(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!reduced && FIXED_T == null) { step(dt); simT += dt; }
  render(now);
  // 自适应分辨率：连续偏慢就降，富余就升
  avg = avg * 0.92 + dt * 1000 * 0.08; adaptT += dt;
  if (adaptT > 1) {
    adaptT = 0;
    const q0 = quality;
    if (avg > 19 && quality > 0.5) quality = Math.max(0.5, quality - 0.15);
    else if (avg < 14 && quality < 1) quality = Math.min(1, quality + 0.1);
    if (q0 !== quality) applyRes();
  }
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; if (!hud.hidden) hud.textContent = `fps ${fps.toFixed(0)}  q ${quality.toFixed(2)}  drops ${drops.length}  ${glc.width}×${glc.height}`; }
  if (reduced) return;                      // 减少动态：只画静止的一帧
  requestAnimationFrame(frame);
}

dropSprite = makeDropSprite();
resize();
for (let i = 0; i < WARM * 30; i++) step(1 / 30);     // 预热
addEventListener("resize", () => { resize(); for (let i = 0; i < 90; i++) step(1 / 30); if (reduced) render(performance.now()); });
document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
  if (running) { last = performance.now(); requestAnimationFrame(frame); }
});
// 点一下玻璃：在指尖处落下一颗大水滴
glc.addEventListener("pointerdown", (e) => { if (reduced) return; drops.push({ x: e.clientX, y: e.clientY, r: 11 * U, vy: 1, vx: 0, wob: 0, sl: 0, ty: 0, k: 1 }); });
// 截图/测试钩子
window.__rain = { step: (n = 1) => { for (let i = 0; i < n; i++) step(1 / 60); render(performance.now()); }, drops };
requestAnimationFrame(frame);
