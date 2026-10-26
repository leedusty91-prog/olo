// 引导动效层：视差像素远景 + 雾 + 涟漪兽粒子 + 开场拨雾 + 结尾庆祝。纯 canvas，一层全屏，减少动效时整层不动。
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PX = 4;
const rnd = (a, b) => a + Math.random() * (b - a);

export function mountOnboardFx() {
  const c = document.createElement("canvas");
  c.className = "ob-fx"; c.dataset.testid = "ob-fx"; c.setAttribute("aria-hidden", "true");
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  let W = 0, H = 0, raf = 0, last = performance.now(), t = 0, alive = true;
  let mx = 0, my = 0, tmx = 0, tmy = 0;          // 视差跟随鼠标
  let fogOpen = REDUCED ? 1 : 0, fogTarget = 0;  // 0=雾合着 1=雾散开
  let mood = 0;                                   // 0..1 天色从夜到暖
  const seeds = [], sparks = [], stars = [];
  const resize = () => {
    W = Math.ceil(innerWidth / PX); H = Math.ceil(innerHeight / PX);
    c.width = W; c.height = H;
    stars.length = 0; for (let i = 0; i < 90; i++) stars.push([Math.random() * W, Math.random() * H * 0.6, Math.random() * 6.28]);
  };
  resize(); addEventListener("resize", resize);
  const onMove = (e) => { tmx = (e.clientX / innerWidth - 0.5) * 2; tmy = (e.clientY / innerHeight - 0.5) * 2; };
  addEventListener("pointermove", onMove);
  for (let i = 0; i < 40; i++) seeds.push({ x: Math.random() * W, y: Math.random() * H, v: rnd(2, 7), ph: Math.random() * 6.28, z: rnd(0.3, 1) });

  const hills = (base, amp, freq, par, col, seed) => {
    ctx.fillStyle = col;
    const off = mx * par * 10;
    for (let x = 0; x < W; x++) {
      const y = Math.round(base + Math.sin((x + off) * freq + seed) * amp + Math.sin((x + off) * freq * 2.7 + seed * 3) * amp * 0.4 + my * par * 4);
      ctx.fillRect(x, y, 1, H - y);
    }
  };
  const mix = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;

  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
    fogOpen += (fogTarget - fogOpen) * Math.min(1, dt * 1.6);
    // 天（倒影国：薰衣草 → 蜜桃 → 奶油，低对比）
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix([150, 146, 206], [176, 170, 226], mood)); g.addColorStop(0.7, mix([214, 184, 208], [246, 200, 186], mood)); g.addColorStop(1, mix([250, 222, 206], [255, 232, 200], mood));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const s of stars) { const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + s[2])); ctx.fillStyle = `rgba(255,240,210,${a * (1 - mood * 0.7)})`; ctx.fillRect(Math.round(s[0] - mx * 2), Math.round(s[1]), 1, 1); }
    // 月 / 灯
    ctx.fillStyle = "#f8f0dd"; const mxp = Math.round(W * 0.78 - mx * 3), myp = Math.round(H * 0.2 - my * 2);
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 25) ctx.fillRect(mxp + x, myp + y, 1, 1);
    // 视差山丘（远→近）
    hills(H * 0.62, 6, 0.03, 0.4, mix([176, 166, 214], [190, 178, 222], mood), 1);
    hills(H * 0.72, 5, 0.05, 1, mix([150, 196, 190], [164, 208, 196], mood), 4);
    hills(H * 0.84, 4, 0.08, 2, mix([120, 168, 170], [134, 182, 176], mood), 9);
    // 涟漪兽
    for (const p of seeds) {
      p.y -= p.v * p.z * dt; p.x += Math.sin(t * 0.8 + p.ph) * 4 * dt; if (p.y < -2) { p.y = H + 2; p.x = Math.random() * W; }
      const fl = 0.5 + 0.5 * Math.sin(t * 3 + p.ph), x = Math.round(p.x - mx * p.z * 6), y = Math.round(p.y - my * p.z * 3);
      ctx.fillStyle = `rgba(255,200,110,${0.25 * fl})`; ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = `rgba(255,236,170,${0.6 + 0.4 * fl})`; ctx.fillRect(x, y, 1, 1);
    }
    // 庆祝火花
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.vy += 40 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = s.col; ctx.globalAlpha = Math.min(1, s.life * 2); ctx.fillRect(Math.round(s.x), Math.round(s.y), s.r, s.r); ctx.globalAlpha = 1;
    }
    // 雾带：从中间向两侧拨开
    const fogA = 1 - fogOpen;
    for (let band = 0; band < 7; band++) {
      const y0 = Math.round(H * (0.15 + band * 0.12) + Math.sin(t * 0.5 + band) * 2), hh = Math.round(H * 0.16);
      const shift = fogOpen * W * 0.6, drift = ((t * (6 + band * 2) + band * 37) % 40);
      ctx.fillStyle = `rgba(240,226,214,${0.10 + fogA * 0.75})`;
      for (let x = -40; x < W + 40; x += 8) {
        const left = x + drift < W / 2, dx = left ? -shift : shift, bump = Math.round(Math.sin((x + band * 13) * 0.2) * 3);
        ctx.fillRect(Math.round(x + drift + dx), y0 + bump, 9, hh - bump * 2);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  if (REDUCED) { requestAnimationFrame((n) => { last = n; frame(n); cancelAnimationFrame(raf); }); }
  else raf = requestAnimationFrame(frame);

  const burstAt = (cx, cy, n, cols) => { for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), sp = rnd(20, 70); sparks.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: rnd(0.8, 1.8), r: Math.random() < 0.3 ? 2 : 1, col: cols[i % cols.length] }); } };
  const COLS = ["#f6ebd4", "#f1ddc0", "#f4d3cb", "#fbf6ec", "#c0eddf", "#d6e9f6"];
  return {
    parting: () => { fogTarget = 1; },
    setMood: (m) => { mood = m; },
    sparkle: (x, y, n = 30) => { if (!REDUCED) burstAt(x / PX, y / PX, n, COLS); },
    finale: async () => {
      if (REDUCED) return;
      mood = 1;
      for (let k = 0; k < 6; k++) { burstAt(rnd(W * 0.15, W * 0.85), rnd(H * 0.15, H * 0.5), 46, COLS); await new Promise((r) => setTimeout(r, 220)); }
    },
    stop: () => { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", onMove); c.classList.add("out"); setTimeout(() => c.remove(), 700); },
  };
}

// 打字机：逐字弹入（每个字一个 span，带小跳），返回 Promise
export function typeIn(el, text) {
  el.textContent = "";
  if (REDUCED) { el.textContent = text; return; }
  [...text].forEach((ch, i) => { const s = document.createElement("span"); s.className = "tw"; s.style.animationDelay = `${i * 38}ms`; s.textContent = ch; el.appendChild(s); });
}

// 按钮微交互：按下时像素涟漪
export function juice(root) {
  if (REDUCED) return;
  root.querySelectorAll(".btn, .choice").forEach((b) => b.addEventListener("pointerdown", (e) => {
    const r = b.getBoundingClientRect(), d = document.createElement("i");
    d.className = "ripple"; d.style.left = `${e.clientX - r.left}px`; d.style.top = `${e.clientY - r.top}px`;
    b.appendChild(d); setTimeout(() => d.remove(), 500);
  }));
}
