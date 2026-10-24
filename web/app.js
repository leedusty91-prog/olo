import { oloSprite, drawOlo, preloadOlo, canvas, P, ticker, REDUCED } from "./pixel.js";
import { paintScene } from "./sky-scene.js?v=20261024a";
import { BROWSER_TZ, bands, groundAt, localHour, setUserTz, skyAt, sunProgress } from "./skytime.js?v=20261023b";
import { bgFor, chatDark, scrimCss } from "./chat-bg.js?v=20261025a";
import { mountGarden } from "./garden.js";
import { mountStage } from "./stage.js?v=20261025c";
import { mountWorld } from "./world.js?v=20261025b";
import { shareLayout, shareBg, wrapShareText, SHARE_INK, SHARE_MUTED, SHARE_ACCENT, SHARE_PAPER, SHARE_PAPER_LINE, SHARE_SHADOW } from "./share-card.js?v=20261025b";
import { OB_BEATS, OB_WORDS, OB_FORMS, OB_GENDERS, seedMotes, stepMotes, doorOpen, irisRadius, walkPose, seedShards, stepShards, seedInk, stepInk, nameInkTargets, morphTrail, crackPhase } from "./onboard-fx.js?v=20261025c";
import { sfx, ambient, isMuted, setMuted } from "./audio.js";

const CFG = window.OLO_CONFIG || { apiBase: "", token: "" };
const root = document.getElementById("root");
const LS = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem("olo." + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem("olo." + k, JSON.stringify(v)),
};
const state = { token: CFG.token || LS.get("token", ""), profile: LS.get("profile", null), sessionId: LS.get("session", null), tab: "chat" };
const sleep = (ms) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const waitClick = (el) => new Promise((r) => el.addEventListener("click", r, { once: true }));
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

// ---------- 静音开关（全局，首个手势后才出声） ----------
const muteBtn = h(`<button class="mute px-box" data-testid="mute" aria-label="静音" aria-pressed="false">♪</button>`);
document.body.appendChild(muteBtn);
muteBtn.addEventListener("click", () => { setMuted(!isMuted()); if (!isMuted()) sfx("select"); });
setMuted(isMuted());

// 按下按钮时迸出几粒火花
addEventListener("pointerdown", (e) => {
  if (REDUCED || !e.target.closest?.("button, [role=button]")) return;
  for (let i = 0; i < 7; i++) {
    const el = document.createElement("i"); el.className = "ember";
    const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 40;
    el.style.left = e.clientX + "px"; el.style.top = e.clientY + "px";
    el.style.setProperty("--dx", `${Math.round(Math.cos(a) * d / 4) * 4}px`); el.style.setProperty("--dy", `${Math.round((Math.sin(a) * d - 30) / 4) * 4}px`);
    el.style.background = ["#ffd98a", "#ffb347", "#fff3dc", "#ff8a6a"][i % 4];
    document.body.appendChild(el); setTimeout(() => el.remove(), 1200);
  }
}, true);

// ---------- API ----------
async function api(path, { method = "GET", body, accept } = {}) {
  const res = await fetch(CFG.apiBase + path, {
    method,
    headers: { Authorization: `Bearer ${state.token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(accept ? { Accept: accept } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "", code = "";
    try { const j = await res.json(); detail = j?.error?.message || ""; code = j?.error?.code || ""; } catch {}
    const err = new Error(detail || `请求失败 (${res.status})`); err.status = res.status; err.code = code; throw err;
  }
  return accept === "text/event-stream" ? res : res.json();
}
async function ensureSession() {
  if (state.sessionId) return state.sessionId;
  const s = await api("/v1/sessions", { method: "POST" });
  state.sessionId = s.id; LS.set("session", s.id); return s.id;
}
async function streamTurn(text, onDelta) {
  const sid = await ensureSession();
  const res = await api(`/v1/sessions/${sid}/turns`, { method: "POST", accept: "text/event-stream",
    body: { client_msg_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), text } });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", final = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = "message", data = "{}";
      for (const line of block.split("\n")) { if (line.startsWith("event:")) ev = line.slice(6).trim(); else if (line.startsWith("data:")) data = line.slice(5).trim(); }
      const payload = JSON.parse(data);
      if (ev === "delta") await onDelta(payload.text || "");
      if (ev === "done") final = payload;
      if (ev === "error") throw new Error(payload.message || "对话出错了");
    }
  }
  return final;
}

// ---------- 背景粒子（低分辨率画布 + 视差） ----------
const pointer = { x: 0, y: 0 };
addEventListener("pointermove", (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; });
(function background() {
  const c = document.getElementById("bg"), ctx = c.getContext("2d");
  let motes = [];
  const resize = () => {
    c.width = Math.ceil(innerWidth / 4); c.height = Math.ceil(innerHeight / 4); ctx.imageSmoothingEnabled = false;
    motes = Array.from({ length: Math.round(c.width * c.height / 140) }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, z: 1 + Math.random() * 3, p: Math.random() * 40 }));
    draw(ticker.t);
  };
  // 天色每分钟按用户本地时间重算一次；插画层（sky-scene.js，与手机端同一份代码）每 5 分钟或尺寸变化时重画进离屏画布，逐帧只做贴图和平移
  let sky = skyAt(localHour()), scene = null, layers = null, slot = -1, meteor = null;
  const toCanvas = (L) => { const o = document.createElement("canvas"); o.width = L.W; o.height = L.H; o.getContext("2d").putImageData(new ImageData(L.data, L.W, L.H), 0, 0); return o; };
  const build = () => {
    slot = Math.round(sky.hour * 12);
    scene = paintScene({ ...sky, hour: slot / 12 }, { W: c.width, H: c.height, date: new Date() });
    layers = { back: toCanvas(scene.back), front: toCanvas(scene.front), lights: scene.hasLights ? toCanvas(scene.lights) : null, far: toCanvas(scene.cloudsFar), near: toCanvas(scene.cloudsNear) };
  };
  const refresh = () => { sky = skyAt(localHour()); document.body.dataset.daypart = sky.phase; if (Math.round(sky.hour * 12) !== slot || !scene) build(); if (REDUCED) draw(0); };
  function draw(t) {
    const W = c.width, H = c.height;
    if (!scene || scene.W !== W || scene.H !== H) build();
    ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
    ctx.drawImage(layers.back, 0, 0);
    // 亮星眨眼（各自相位）
    scene.twinkles.forEach((s, i) => { const ph = ((t + i * 37) % 70) / 70, k = REDUCED ? 0.8 : ph < 0.12 ? 1 : 0.45 + 0.2 * Math.sin(t / 6 + i);
      ctx.globalAlpha = s.a * k; ctx.fillStyle = `rgb(${s.c.join(",")})`; ctx.fillRect(s.x, s.y, 1, 1);
      if (i % 3 === 0 && k > 0.9) { ctx.globalAlpha = s.a * 0.45; ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3); } });
    // 偶尔一颗流星（夜里）
    if (!REDUCED && sky.star > 0.7) {
      if (!meteor && Math.random() < 0.004) meteor = { x: W * (0.35 + Math.random() * 0.6), y: H * (0.03 + Math.random() * 0.25), t0: t };
      if (meteor) { const k = (t - meteor.t0) / 9; if (k > 1) meteor = null; else { for (let j = 0; j < 7; j++) { ctx.globalAlpha = (1 - j / 7) * (k < 0.8 ? 1 : (1 - k) * 5); ctx.fillStyle = j ? "#ffe9c8" : "#fff"; ctx.fillRect(Math.round(meteor.x - k * W * 0.25 + j * 2), Math.round(meteor.y + k * W * 0.12 - j), 1, 1); } } }
    }
    ctx.globalAlpha = 1;
    // 两层云：远的慢、近的快，加一点指针视差
    const cloud = (img, speed, par) => { const cw = img.width, off = ((REDUCED ? cw * 0.3 : t * speed) + pointer.x * par) % cw; const x = -Math.round(off < 0 ? off + cw : off); ctx.drawImage(img, x, 0); ctx.drawImage(img, x + cw, 0); };
    cloud(layers.far, 0.02, 2); cloud(layers.near, 0.045, 5);
    ctx.drawImage(layers.front, 0, 0);
    if (layers.lights) { ctx.globalAlpha = REDUCED ? 1 : 0.82 + 0.18 * Math.sin(t / 26); ctx.drawImage(layers.lights, 0, 0); ctx.globalAlpha = 1; }
    // 漂浮光点：夜里像萤火，白天是淡淡的花粉
    const night = sky.star;
    motes.forEach((m) => {
      if (!REDUCED) { m.y -= 0.06 * m.z; m.x += Math.sin((t + m.p) / 20) * 0.03; if (m.y < 0) { m.y = c.height; m.x = Math.random() * c.width; } }
      const tw = (t + m.p) % 40;
      ctx.fillStyle = night > 0.5 ? (m.z > 3 ? (tw < 3 ? "#fff3dc" : "#ffc46b") : tw < 2 ? "#ffe9c8" : m.z > 2 ? "#e08a6a" : "#8a4a52") : (m.z > 3 ? "#fff8e6" : m.z > 2 ? "#ffe2b0" : "#f4c890");
      ctx.globalAlpha = (m.z > 3 ? 0.95 : 0.7) * (night > 0.5 ? 1 : 0.6);
      if (m.z > 3.6) { ctx.globalAlpha *= 0.3; ctx.fillRect(Math.round(m.x - pointer.x * m.z * 3) - 1, Math.round(m.y - pointer.y * m.z * 2), 3, 1); ctx.fillRect(Math.round(m.x - pointer.x * m.z * 3), Math.round(m.y - pointer.y * m.z * 2) - 1, 1, 3); ctx.globalAlpha = 0.95; }
      ctx.fillRect(Math.round(m.x - pointer.x * m.z * 3), Math.round(m.y - pointer.y * m.z * 2), 1, 1);
    });
    ctx.globalAlpha = 1;
  }
  resize(); addEventListener("resize", resize);
  refresh(); setInterval(refresh, 60_000);
  addEventListener("olo:tz", refresh);
  ticker.add((t) => draw(t));
})();

// ---------- 像素擦除转场 ----------
const wipe = (() => {
  const c = document.getElementById("wipe"), ctx = c.getContext("2d");
  const B = 24;
  return async function run(mid) {
    sfx("whoosh");
    if (REDUCED) { await mid(); return; }
    c.width = innerWidth; c.height = innerHeight;
    const cols = Math.ceil(c.width / B), rows = Math.ceil(c.height / B);
    const cells = []; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push([x, y, x + y + Math.random() * 6]);
    cells.sort((a, b) => a[2] - b[2]);
    const steps = 8, per = Math.ceil(cells.length / steps);
    for (let s = 0; s < steps; s++) { cells.slice(s * per, (s + 1) * per).forEach(([x, y], k) => { ctx.fillStyle = s === steps - 1 || k % 3 ? "#2a1422" : "#ffb347"; ctx.fillRect(x * B, y * B, B, B); });
      if (s > 0) { ctx.fillStyle = "#2a1422"; cells.slice((s - 1) * per, s * per).forEach(([x, y]) => ctx.fillRect(x * B, y * B, B, B)); } await sleep(28); }
    await mid();
    ctx.fillStyle = "#2a1422"; ctx.fillRect(0, 0, c.width, c.height);
    for (let s = 0; s < steps; s++) { cells.slice(s * per, (s + 1) * per).forEach(([x, y]) => { ctx.clearRect(x * B, y * B, B, B); }); ctx.fillStyle = "#ffd98a"; cells.slice((s + 1) * per, (s + 1) * per + per / 3).forEach(([x, y]) => ctx.fillRect(x * B + B / 3, y * B + B / 3, B / 3, B / 3)); await sleep(28); }
    ctx.clearRect(0, 0, c.width, c.height);
  };
})();

async function doorTrans(mid) {
  sfx("whoosh");
  if (REDUCED) { await mid(); return; }
  const overlay = h(`<div class="ob-door" aria-hidden="true"><div class="leaf l"><i class="knob"></i></div><div class="leaf r"><i class="knob"></i></div></div>`);
  document.body.append(overlay);
  const L = overlay.querySelector(".l"), R = overlay.querySelector(".r");
  for (let i = 0; i <= 10; i++) {
    const d = doorOpen(i / 10);
    L.style.transform = `translateX(${d.left * 100}%)`; R.style.transform = `translateX(${d.right * 100}%)`;
    await sleep(28);
  }
  // close
  for (let i = 10; i >= 0; i--) {
    const d = doorOpen(i / 10);
    L.style.transform = `translateX(${d.left * 100}%)`; R.style.transform = `translateX(${d.right * 100}%)`;
    if (i === 5) await mid();
    await sleep(24);
  }
  // reopen onto new scene
  for (let i = 0; i <= 12; i++) {
    const d = doorOpen(i / 12);
    L.style.transform = `translateX(${d.left * 100}%)`; R.style.transform = `translateX(${d.right * 100}%)`;
    await sleep(26);
  }
  overlay.remove();
}
async function irisTrans(mid) {
  sfx("whoosh");
  if (REDUCED) { await mid(); return; }
  const c = document.getElementById("wipe"), ctx = c.getContext("2d");
  c.width = innerWidth; c.height = innerHeight;
  const cx = c.width / 2, cy = c.height * 0.45, maxR = Math.hypot(c.width, c.height);
  for (let i = 12; i >= 0; i--) {
    const r = irisRadius(i / 12) * maxR;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#2a1422"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    await sleep(22);
  }
  await mid();
  for (let i = 0; i <= 14; i++) {
    const r = irisRadius(i / 14) * maxR;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#2a1422"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    await sleep(22);
  }
  ctx.clearRect(0, 0, c.width, c.height);
}
async function swap(node, { transition = "drop" } = {}) {
  const put = async () => {
    cleanups.forEach((f) => f()); cleanups = [];
    node.style.pointerEvents = "none";
    root.replaceChildren(node);
    node.classList.add("scene", "enter");
    setTimeout(() => node.classList.remove("enter"), 900);
  };
  if (transition === "door" && root.firstElementChild) await doorTrans(put);
  else if (transition === "iris" && root.firstElementChild) await irisTrans(put);
  else if (transition === "wipe" && root.firstElementChild) await wipe(put);
  else await put();
  node.style.pointerEvents = "";
  return node;
}
async function typeText(el, text, speed = 45, stop = () => false) {
  el.textContent = "";
  let n = 0;
  for (const ch of text) { if (stop()) { el.textContent = text; return; } el.textContent += ch; if (n++ % 2 === 0 && ch.trim()) sfx("type"); await sleep(ch.match(/[，。！？、]/) ? speed * 4 : speed); }
}
function burst(host, n = 18) {
  if (REDUCED) return;
  const wrap = h(`<div class="burst"></div>`);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, d = 80 + Math.random() * 60;
    const p = document.createElement("i");
    p.style.setProperty("--dx", `${Math.round(Math.cos(a) * d / 4) * 4}px`); p.style.setProperty("--dy", `${Math.round(Math.sin(a) * d / 4) * 4}px`);
    p.style.background = ["#ffd98a", "#ffb347", "#ff8a6a", "#fff3dc", "#b8e05a"][i % 5];
    wrap.appendChild(p);
  }
  host.appendChild(wrap); setTimeout(() => wrap.remove(), 900);
}
function shake(el) { if (REDUCED) return; el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }


// ---------- 整屏引导 v2：门扉 / 虹膜 / 碎壳 / 墨点 / 拖影 ----------
function obBgName(hour) { return hour >= 19.5 || hour < 5 ? "bg-night" : hour < 8 ? "bg-dawn" : hour < 16.5 ? "bg-day" : "bg-dusk"; }
function mountObBg(host, hour = 17.6, src = null) {
  // 插画背景（与手机端同一套 hd 背景），上面飘一点暖光微粒
  const name = src || obBgName(hour);
  const media = name.endsWith(".mp4")
    ? `<video src="assets/bg/${name}" poster="assets/bg/${name.replace(".mp4", ".jpg")}" muted playsinline loop ${REDUCED ? "" : "autoplay"}></video>`
    : `<img src="assets/bg/${name}.jpg" alt="" />`;
  const wrap = h(`<div class="ob-bg ill" aria-hidden="true">${media}<div class="ob-motes"></div></div>`);
  host.prepend(wrap);
  const motesEl = wrap.querySelector(".ob-motes");
  const W = 200, H = 360, night = name.includes("night");
  const motes = seedMotes(REDUCED ? 0 : 16, W, H, night);
  motesEl.replaceChildren(...motes.map(() => document.createElement("i")));
  const off = ticker.add(() => {
    if (!motes.length) return;
    stepMotes(motes, W, H, 1, REDUCED);
    const nodes = motesEl.children;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i], n = nodes[i]; if (!n) continue;
      n.style.transform = `translate(${(m.x / W) * 100}vw, ${(m.y / H) * 100}vh)`;
      n.style.background = m.warm ? "#ffd98a" : "#fff6e0";
      n.style.opacity = String(0.35 + (Math.sin(m.ph) + 1) * 0.2);
      n.style.width = n.style.height = `${m.r * 2 + 1}px`;
    }
  });
  onLeave(off);
  return wrap;
}
const BEAT_MEDIA = ["bg-dusk", "bg-night", "idle.mp4", "room-night"];
function mountIllScene(frame, i) {
  const name = BEAT_MEDIA[i] || "bg-dusk";
  const el = name.endsWith(".mp4")
    ? h(`<video src="assets/bg/${name}" poster="assets/bg/${name.replace(".mp4", ".jpg")}" muted playsinline loop ${REDUCED ? "" : "autoplay"}></video>`)
    : h(`<img src="assets/bg/${name}.jpg" alt="" />`);
  frame.prepend(el);
  return () => { if (el.pause) el.pause(); };
}
function obSection(html, attrs = "") {
  return h(`<section class="ob-fs" ${attrs}>${html}</section>`);
}
function mountInkName(host, getName) {
  const layer = h(`<div class="ob-ink" aria-hidden="true"></div>`);
  host.append(layer);
  let inks = [], t0 = ticker.t;
  const rebuild = () => {
    const pts = nameInkTargets(getName(), innerWidth / 2, innerHeight * 0.28, 4);
    inks = seedInk(pts, REDUCED ? 0 : 50);
    layer.replaceChildren(...inks.map(() => document.createElement("i")));
    t0 = ticker.t;
  };
  rebuild();
  const off = ticker.add((T) => {
    const t = REDUCED ? 1 : Math.min(1, (T - t0) / 50);
    stepInk(inks, t);
    [...layer.children].forEach((n, i) => {
      const d = inks[i]; if (!d) return;
      n.style.transform = `translate(${d.x}px, ${d.y}px)`;
      n.style.opacity = String(0.55 + Math.sin(d.ph) * 0.2);
    });
  });
  onLeave(off);
  return { rebuild, layer };
}

// ---------- 引导 ----------
const BEATS = OB_BEATS;
const WORDS = OB_WORDS;
const BEAT_AMB = OB_BEATS.map((b) => b.amb);
async function onboarding() {
  root.classList.add("ob-full");
  ambient("title");

  // 1) 门扉紧闭 → 推开 → olo 走进雾里集
  const title = await swap(obSection(`
      <div class="ob-door" data-testid="door"><div class="leaf l"><i class="knob"></i></div><div class="leaf r"><i class="knob"></i></div></div>
      <div class="title-olo"></div>
      <div class="ob-cta">
        <h1 class="logo">olo</h1>
        <p class="tagline">一颗会听你说话的灯籽</p>
        <button class="btn px-box blink-cta" data-testid="start">▶ 推开这扇门</button>
        <button class="link" data-testid="skip-story">跳过故事</button>
      </div>`), { transition: "drop" });
  mountObBg(title, 17.8);
  // 先挂好点击监听：开门动画期间点「跳过故事」也要算数
  const skipChoice = Promise.race([
    waitClick(title.querySelector("[data-testid=start]")).then(() => false),
    waitClick(title.querySelector("[data-testid=skip-story]")).then(() => true),
  ]);
  const door = title.querySelector(".ob-door");
  const L = door.querySelector(".l"), R = door.querySelector(".r");
  // start closed
  L.style.transform = "translateX(0)"; R.style.transform = "translateX(0)";
  const titleOlo = oloSprite({ state: "idle", scale: 7 });
  title.querySelector(".title-olo").appendChild(titleOlo);
  title.querySelector(".title-olo").style.opacity = "0";
  // animate door opening on load
  if (!REDUCED) {
    for (let i = 0; i <= 16; i++) {
      const d = doorOpen(i / 16);
      L.style.transform = `translateX(${d.left * 100}%)`; R.style.transform = `translateX(${d.right * 100}%)`;
      await sleep(30);
    }
  } else { L.style.transform = "translateX(-100%)"; R.style.transform = "translateX(100%)"; }
  door.style.pointerEvents = "none";
  title.querySelector(".title-olo").style.opacity = "1";
  titleOlo.olo.set({ state: "happy" });
  const skip = await skipChoice;

  if (!skip) {
    for (let i = 0; i < BEATS.length; i++) {
      const b = BEATS[i];
      const node = await swap(obSection(`
          <div class="scene-frame" data-testid="scene">${i === 0 ? `<div class="scene-words">${WORDS.map((w, j) => `<span style="left:${6 + j * 11}%;animation-delay:${j * 0.75}s;bottom:${24 + (j % 3) * 9}%">${w}</span>`).join("")}</div>` : ""}</div>
          <div class="ob-veil"></div>
          <div class="beat-dots">${BEATS.map((_, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("")}</div>
          <div class="dialog px-box" data-testid="next" role="button" tabindex="0">
            <span class="who px-box">${b.who}</span><p class="story" aria-live="polite"></p><span class="caret">▼</span>
          </div>`, `data-beat="${i}"`), { transition: "iris" });
      ambient(BEAT_AMB[i]);
      const frame = node.querySelector(".scene-frame");
      const stop = mountIllScene(frame, i);
      onLeave(stop);
      frame.style.position = "absolute";
      // 慢推镜头
      if (!REDUCED) frame.animate?.([{ transform: "scale(1.08) translateX(-2%)" }, { transform: "scale(1) translateX(0)" }], { duration: 2800, easing: "linear", fill: "forwards" });
      const words = frame.querySelector(".scene-words"); if (words) { words.style.position = "absolute"; words.style.inset = "0"; frame.appendChild(words); }
      const dlg = node.querySelector(".dialog"), p = node.querySelector(".story");
      let skipped = false;
      dlg.addEventListener("click", () => { skipped = true; }, { once: true });
      await typeText(p, b.text, 36, () => skipped);
      if (!skipped) await waitClick(dlg); else await sleep(80);
    }
  }

  // 2) 空中碎壳：灯籽浮空 → 裂纹 → 碎片飞散 → olo 淡入
  const hello = await swap(obSection(`
      <div class="hatch-stage" data-testid="hatch"><div class="egg-wrap"></div><div class="shards"></div></div>
      <div class="dialog px-box"><span class="who px-box">???</span><p class="story">嗨……是你在叫我吗？</p></div>
      <button class="btn px-box" data-testid="hello" disabled style="position:absolute;left:50%;top:78%;transform:translate(-50%,-50%);z-index:4">是我！</button>`), { transition: "iris" });
  mountObBg(hello, 20.2);
  ambient("room");
  sfx("hatch");
  const stage = hello.querySelector(".hatch-stage");
  const eggWrap = stage.querySelector(".egg-wrap");
  const shardHost = stage.querySelector(".shards");
  const seedC = h(`<div class="seed-orb"></div>`); eggWrap.appendChild(seedC);
  const olo = oloSprite({ state: "happy", scale: 7 }); olo.style.opacity = "0"; olo.style.position = "absolute"; olo.style.left = "50%"; olo.style.top = "50%"; olo.style.transform = "translate(-50%,-50%)"; stage.appendChild(olo);
  let shards = [];
  const hatchStart = ticker.t;
  let shattered = false;
  const off = ticker.add((T) => {
    const raw = REDUCED ? 1 : Math.min(1, (T - hatchStart) / 70);
    const ph = crackPhase(raw);
    const wob = ph.crack && !REDUCED ? Math.sin(T * 1.7) * 3 : 0;
    seedC.style.opacity = String(ph.eggA > 0.05 ? ph.eggA : 0);
    seedC.style.transform = `translateX(${wob}px) scale(${1 + (ph.crack ? 0.08 : 0.03 * Math.sin(T / 6))})`;
    if (ph.shatter && !shattered) {
      shattered = true;
      shards = seedShards(REDUCED ? 0 : 22, 0, 0);
      shardHost.replaceChildren(...shards.map(() => { const n = document.createElement("i"); return n; }));
    }
    stepShards(shards, REDUCED);
    [...shardHost.children].forEach((n, i) => {
      const sh = shards[i]; if (!sh) { n.style.opacity = "0"; return; }
      n.style.transform = `translate(${sh.x * 8}px, ${sh.y * 8}px) rotate(${sh.rot}rad)`;
      n.style.width = `${sh.w * 3}px`; n.style.height = `${sh.h * 3}px`;
      n.style.background = ["#FFD27A", "#FFF6E8", "#FFB86B"][sh.tone];
      n.style.opacity = String(1 - sh.life / sh.max);
    });
    olo.style.opacity = String(ph.oloA);
    if (ph.showOlo) olo.style.transform = `translate(-50%, calc(-50% + ${ph.floatY}px))`;
  });
  onLeave(off);
  await sleep(REDUCED ? 300 : 2200);
  sfx("happy");
  hello.querySelector("[data-testid=hello]").disabled = false;
  await waitClick(hello.querySelector("[data-testid=hello]"));

  const pick = { name: "olo", form: "buddy", color: "sun" };
  ambient("title");

  // 3) 墨点写字起名
  const nameNode = await swap(obSection(`
      <div class="panel px-box dark">
        <div class="mini"></div>
        <h2>给我起个名字吧</h2>
        <p class="hint">渡灯翁说，被叫过名字的灯籽，会亮得更久。</p>
        <input class="field px-box" data-testid="name" maxlength="12" placeholder="olo" autocomplete="off" />
        <button class="btn px-box" data-testid="name-ok">就叫这个</button>
      </div>`), { transition: "iris" });
  mountObBg(nameNode, 17.4);
  const mini = oloSprite({ state: "idle", scale: 4 });
  nameNode.querySelector(".mini").appendChild(mini);
  const input = nameNode.querySelector("input");
  const ink = mountInkName(nameNode, () => input.value.trim() || "olo");
  input.addEventListener("input", () => { mini.olo.set({ state: input.value ? "talking" : "idle" }); ink.rebuild(); clearTimeout(input._t); input._t = setTimeout(() => mini.olo.set({ state: "happy" }), 400); });
  input.focus();
  await new Promise((r) => {
    const go = () => { pick.name = input.value.trim() || "olo"; r(); };
    nameNode.querySelector("[data-testid=name-ok]").addEventListener("click", go, { once: true });
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  });

  const nickNode = await swap(obSection(`
      <div class="panel px-box dark" data-testid="nickname-step">
        <div class="mini"></div>
        <h2>你想让 ${esc(pick.name)} 怎么称呼你？</h2>
        <p class="hint">可以不填，之后可以在 ⚙ 设置里改。</p>
        <input class="field px-box" maxlength="12" placeholder="你的昵称" data-testid="nickname-input" />
        <div class="row">
          <button class="btn ghost px-box" data-testid="nickname-skip">跳过</button>
          <button class="btn px-box" data-testid="nickname-ok">好</button>
        </div>
      </div>`), { transition: "iris" });
  mountObBg(nickNode, 18.2);
  nickNode.querySelector(".mini").appendChild(oloSprite({ state: "happy", scale: 4 }));
  const nickInput = nickNode.querySelector("input");
  nickInput.focus();
  await new Promise((r) => {
    const done = (keep) => { const v = nickInput.value.trim(); if (keep && v) pick.user_nickname = v; else delete pick.user_nickname; r(); };
    nickNode.querySelector("[data-testid=nickname-ok]").addEventListener("click", () => done(true), { once: true });
    nickNode.querySelector("[data-testid=nickname-skip]").addEventListener("click", () => done(false), { once: true });
    nickInput.addEventListener("keydown", (e) => e.key === "Enter" && done(true));
  });

  pick.user_gender = "unspecified";
  const genderNode = await swap(obSection(`
      <div class="panel px-box dark" data-testid="gender-step">
        <div class="mini"></div>
        <h2>${esc(pick.name)} 在日记里该怎么称呼你？</h2>
        <p class="hint">只用在 ${esc(pick.name)} 的日记里，之后可以在 ⚙ 设置里改。</p>
        <div class="cards">${OB_GENDERS.map(([id, label, d]) => `<button class="choice px-box ${id === pick.user_gender ? "on" : ""}" data-gender="${id}" data-testid="gender-${id}"><b>${label}</b><small>${d}</small></button>`).join("")}</div>
        <button class="btn px-box" data-testid="gender-ok">好</button>
      </div>`), { transition: "iris" });
  mountObBg(genderNode, 16.8);
  genderNode.querySelector(".mini").appendChild(oloSprite({ state: "thinking", scale: 4 }));
  genderNode.querySelectorAll("[data-gender]").forEach((b) => b.addEventListener("click", () => {
    pick.user_gender = b.dataset.gender; sfx("select");
    genderNode.querySelectorAll("[data-gender]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  await waitClick(genderNode.querySelector("[data-testid=gender-ok]"));

  // 4) 形态拖影轮播
  const FORM_COLOR = Object.fromEntries(OB_FORMS.map(([id, , , c]) => [id, c]));
  pick.color = FORM_COLOR[pick.form];
  const formNode = await swap(obSection(`
      <div class="preview" data-testid="form-preview"></div>
      <div class="panel px-box dark">
        <h2>${esc(pick.name)} 想长成什么样子？</h2>
        <div class="choices">${OB_FORMS.map(([id, label, d]) => `<button class="choice px-box ${id === pick.form ? "on" : ""}" data-form="${id}" data-testid="form-${id}"><span class="ico"></span><b>${label}</b><small>${d}</small></button>`).join("")}</div>
        <p class="error" hidden></p>
        <button class="btn px-box blink-cta" data-testid="form-ok">就是这样，开始聊天 ▶</button>
      </div>`), { transition: "iris" });
  mountObBg(formNode, 19.0);
  const preview = formNode.querySelector(".preview");
  const big = oloSprite({ state: "happy", scale: 7 });
  preview.appendChild(big);
  [...formNode.querySelectorAll("[data-form]")].forEach((b) => { const spr = oloSprite({ form: b.dataset.form, color: FORM_COLOR[b.dataset.form], scale: 2 }); b.querySelector(".ico").appendChild(spr); });
  let morphT = 0, morphDir = 1;
  const refresh = (dir = 1) => {
    pick.color = FORM_COLOR[pick.form];
    big.olo.set({ form: pick.form, color: pick.color, state: "happy" });
    morphDir = dir; morphT = 0;
    if (REDUCED) return;
    preview.querySelectorAll(".trail").forEach((n) => n.remove());
    const trails = morphTrail(0, dir);
    trails.slice(0, 2).forEach((tr) => {
      const ghost = oloSprite({ form: pick.form, color: pick.color, state: "happy", scale: 7 });
      ghost.classList.add("trail"); ghost.style.opacity = String(tr.a); ghost.style.transform = `translate(${tr.ox}px, ${tr.oy}px)`;
      preview.prepend(ghost);
    });
  };
  const morphOff = ticker.add(() => {
    if (REDUCED || morphT > 18) return;
    morphT++;
    const trails = morphTrail(morphT / 18, morphDir);
    const ghosts = [...preview.querySelectorAll(".trail")];
    ghosts.forEach((g, i) => { const tr = trails[i]; if (!tr) return; g.style.opacity = String(tr.a); g.style.transform = `translate(${tr.ox}px, ${tr.oy}px)`; });
    if (morphT === 18) ghosts.forEach((g) => g.remove());
  });
  onLeave(morphOff);
  formNode.querySelectorAll("[data-form]").forEach((b, idx) => b.addEventListener("click", () => {
    const prev = OB_FORMS.findIndex(([id]) => id === pick.form);
    pick.form = b.dataset.form; pick.color = FORM_COLOR[pick.form];
    formNode.querySelectorAll("[data-form]").forEach((x) => x.classList.toggle("on", x === b));
    refresh(idx >= prev ? 1 : -1); sfx("select");
  }));
  const err = formNode.querySelector(".error");
  for (;;) {
    await waitClick(formNode.querySelector("[data-testid=form-ok]"));
    try { await api("/v1/onboarding", { method: "POST", body: { ...pick, timezone: BROWSER_TZ || undefined } }); break; }
    catch (e) {
      err.hidden = false;
      err.textContent = e.status === 401 ? "连接密钥不对，请在设置里填写 OLO_API_TOKEN。" : e.message;
      sfx("error");
      if (e.status === 401) await askToken();
    }
  }
  state.profile = pick; LS.set("profile", pick);

  // 5) 暖色暗角收束进聊天
  const trans = await swap(obSection(`
      <div class="preview"></div>
      <div class="ob-vignette" data-testid="vignette"></div>
      <div class="dialog px-box"><span class="who px-box">${esc(pick.name)}</span><p class="story">从今天起，你说的每一句话，都会变成我们花园里的一滴雨。</p></div>`), { transition: "door" });
  mountObBg(trans, 17.6);
  const tb = oloSprite({ form: pick.form, color: pick.color, state: "happy", scale: 8 });
  trans.querySelector(".preview").appendChild(tb); sfx("grow");
  const vig = trans.querySelector(".ob-vignette");
  if (!REDUCED) {
    for (let i = 0; i <= 12; i++) { vig.style.opacity = String(i / 12 * 0.85); await sleep(40); }
    await sleep(400);
    for (let i = 12; i >= 0; i--) { vig.style.opacity = String(i / 12 * 0.85); await sleep(35); }
  } else await sleep(600);
  root.classList.remove("ob-full");
  return main(true);
}

async function askToken() {
  const t = prompt("请输入 OLO_API_TOKEN（docker compose 演示默认 change-me-dev-token）", state.token || "");
  if (t !== null) { state.token = t.trim(); LS.set("token", state.token); }
}

// ---------- 主界面 ----------
let avatar, hero, room;
const STATUS = { talking: "正在说话…", thinking: "在想…", sad: "在认真听", happy: "开心起来了", idle: "在花园里等你" };
let lastMood = "idle";
function setMood(s) {
  if (s !== lastMood) { if (s === "happy") sfx("happy"); else if (s === "sad") sfx("sad"); else if (s === "thinking") sfx("think"); lastMood = s; }
  avatar?.olo.set({ state: s }); hero?.setState(s); room?.setState(s);
  const st = document.querySelector(".topbar small"); if (st) st.textContent = STATUS[s];
}

// 把浏览器时区同步给服务器（变了才更新），背景用服务器存的用户时区
const LOOK_KEYS = ["hair", "eyes", "cheeks"];
const look = () => Object.fromEntries(LOOK_KEYS.filter((k) => state.profile?.[k]).map((k) => [k, state.profile[k]]));
function adoptLook(ap) {
  if (!ap || !state.profile) return;
  let changed = false;
  for (const k of ["form", ...LOOK_KEYS]) if (ap[k] && state.profile[k] !== ap[k]) { state.profile[k] = ap[k]; changed = true; }
  if (changed) { LS.set("profile", state.profile); dispatchEvent(new Event("olo:look")); }
}

async function syncTimezone() {
  try {
    const p = await api("/v1/persona");
    adoptLook(p.appearance);
    let tz = p.timezone;
    if (BROWSER_TZ && tz !== BROWSER_TZ) { const r = await api("/v1/persona", { method: "PUT", body: { timezone: BROWSER_TZ } }); tz = r.timezone || BROWSER_TZ; }
    setUserTz(tz); dispatchEvent(new Event("olo:tz"));
  } catch {}
}

async function main(fromOnboarding = false) {
  syncTimezone();
  const p = state.profile;
  const shell = await swap(h(`
    <section class="app" data-testid="app">
      <div class="charrow">
        <b class="hero-name" data-testid="olo-name">${esc(p.name)}</b>
        <button class="room-btn px-box" data-testid="room-toggle" aria-label="收起聊天，去小广场" aria-pressed="false">⌂</button>
        <button class="menu-btn px-box" data-testid="menu-btn" aria-label="菜单" aria-expanded="false" aria-controls="olo-menu">☰<i class="badge" data-testid="badge" hidden></i></button>
      </div>
      <div class="view" data-view></div>
      <div class="room-host world-host" data-testid="room"></div>
      <div class="menu-scrim" data-testid="menu-scrim" hidden></div>
      <nav class="menu-drawer px-box dark" id="olo-menu" data-testid="menu" hidden>
        <b class="menu-title">菜单</b>
        <button class="menu-item px-box" data-tab="chat" data-testid="tab-chat"><span class="ico">✉</span>聊天</button>
        <button class="menu-item px-box" data-tab="garden" data-testid="tab-garden"><span class="ico">✿</span>花园</button>
        <button class="menu-item px-box" data-tab="diary" data-testid="tab-diary"><span class="ico">✎</span>日记 · 心情</button>
        <button class="menu-item px-box" data-tab="book" data-testid="tab-book"><span class="ico">❖</span>故事</button>
        <button class="menu-item px-box" data-testid="shop-btn"><span class="ico">◆</span>商店 · 装扮</button>
        <button class="menu-item px-box" data-testid="profile-btn"><span class="ico">♥</span>olo 眼里的你</button>
        <button class="menu-item px-box" data-testid="settings"><span class="ico">⚙</span>设置</button>
        <div class="menu-row"><span>声音</span></div>
      </nav>
    </section>`), { transition: fromOnboarding ? "wipe" : "drop" });
  shell.classList.remove("scene");
  shell.querySelector(".menu-row").appendChild(muteBtn);
  hero?.stop(); hero = mountStage(p, shell);
  // 雾里集铺满整个屏幕：聊天时当背景（压暗、不抢点击），收起聊天（⌂）就能在里面玩
  const roomHost = shell.querySelector("[data-testid=room]"), rbtn = shell.querySelector("[data-testid=room-toggle]");
  room?.stop();
  room = mountWorld(roomHost, p, { api, onOpenChat: () => setRoom(false), debug: !!CFG.debug || !!window.__OLO_TEST_HOOKS__, lastUserText: () => [...document.querySelectorAll(".msg.user")].pop()?.textContent?.trim() || "" });
  room.setChat(true); room.setState(lastMood);
  chatScene?.stop(); chatScene = mountChatScene(roomHost);
  let roomOpen = false;
  const setRoom = (open) => {
    if (open === roomOpen) return; roomOpen = open;
    shell.dataset.mode = open ? "room" : "chat"; rbtn.setAttribute("aria-pressed", String(open)); sfx("whoosh");
    shell.querySelector("[data-view]").hidden = open; room.setChat(!open);
    if (open) hero.setHidden(true);
    else { hero.setHidden(state.tab !== "chat"); if (state.tab === "chat") shell.querySelector("[data-testid=chat-input]")?.focus(); }
  };
  shell.setRoom = setRoom;
  rbtn.addEventListener("click", () => setRoom(!roomOpen));
  shell.dataset.mode = "chat";
  const menu = shell.querySelector("[data-testid=menu]"), scrim = shell.querySelector("[data-testid=menu-scrim]"), mbtn = shell.querySelector("[data-testid=menu-btn]");
  const setMenu = (open) => { menu.hidden = scrim.hidden = !open; mbtn.setAttribute("aria-expanded", String(open)); if (open) { sfx("select"); menu.querySelector(".menu-item")?.focus(); } };
  mbtn.addEventListener("click", () => setMenu(menu.hidden));
  scrim.addEventListener("click", () => setMenu(false));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) setMenu(false); });
  shell.querySelector("[data-testid=settings]").addEventListener("click", () => { setMenu(false); settings(); });
  shell.querySelector("[data-testid=profile-btn]").addEventListener("click", () => { setMenu(false); profileSheet(); });
  shell.querySelector("[data-testid=shop-btn]").addEventListener("click", () => { setMenu(false); shopSheet(); });
  pollProactive();
  shell.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { setMenu(false); show(b.dataset.tab); }));
  show(state.tab);
}

// ── olo 主动来找你：未读角标 ───────────────────────────────
let proactiveTimer = null, unreadProactive = [];
async function pollProactive() {
  clearTimeout(proactiveTimer);
  try {
    const r = await api("/v1/proactive");
    const before = unreadProactive.length;
    unreadProactive = r.unread || [];
    const b = document.querySelector("[data-testid=badge]");
    if (b) { b.hidden = !unreadProactive.length; b.textContent = unreadProactive.length; }
    if (unreadProactive.length > before) { sfx("happy"); if (state.tab === "chat") show("chat"); }
  } catch {}
  proactiveTimer = setTimeout(pollProactive, 60_000);
}
async function markProactiveSeen() {
  if (!unreadProactive.length) return;
  try { await api("/v1/proactive/seen", { method: "POST" }); } catch {}
  setTimeout(() => { unreadProactive = []; const b = document.querySelector("[data-testid=badge]"); if (b) b.hidden = true; }, 2500);
}

// ── olo眼里的你 ───────────────────────────────────────────
function profileSheet() {
  const dlg = h(`
    <dialog class="sheet px-box profile-sheet" data-testid="profile-sheet">
      <h3>olo 眼里的你</h3>
      <div class="profile-olo"></div>
      <p class="profile-text" data-testid="profile-text">正在翻小本子…</p>
      <small class="profile-meta" data-testid="profile-meta"></small>
      <div class="row">
        <button class="btn ghost px-box" value="run" data-testid="consolidate">现在整理一次</button>
        <button class="btn px-box" value="close">好</button>
      </div>
    </dialog>`);
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelector(".profile-olo").appendChild(oloSprite({ form: state.profile.form, color: state.profile.color, state: "happy", scale: 3, ...look() }));
  const text = dlg.querySelector(".profile-text"), meta = dlg.querySelector(".profile-meta");
  const render = async () => {
    try {
      const r = await api("/v1/profile");
      text.textContent = r.profile || "我还在慢慢认识你。多聊几天，等夜里我把记下的事情理一理，就写给你看。";
      const when = r.updated_at ? new Date(r.updated_at).toLocaleString("zh-CN", { hour12: false }) : "";
      const st = r.last_run?.stats?.memories;
      meta.textContent = [when && `更新于 ${when}`, st && st.before != null && `整理了 ${st.before} 条记忆，合并 ${st.merged || 0} 处`].filter(Boolean).join(" · ");
    } catch { text.textContent = "现在连不上，等会儿再来看看。"; }
  };
  render();
  dlg.addEventListener("click", async (e) => {
    const v = e.target.value;
    if (v === "run") { e.target.disabled = true; e.target.textContent = "整理中…"; sfx("think"); try { await api("/v1/memory/consolidate", { method: "POST" }); } catch {} await render(); e.target.disabled = false; e.target.textContent = "现在整理一次"; }
    if (v === "close" || e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
}

// ── 商店 · 装扮（与手机端「我的」一致：代币、每日领取、按类购买、换装） ──────────
const KIND_LABEL = { form: "形态", hair: "发型", eyes: "眼睛", cheeks: "腮红", voice: "声音" };
// 发型/眼睛/腮红的旧像素装扮已下架（存档里的旧装扮按默认高清造型显示），以后作为插画版商店道具回来
const KIND_ORDER = ["form", "voice"];
const SHOP_ERR = { INSUFFICIENT_TOKENS: "代币不够，明天再来领一点吧", ALREADY_CLAIMED: "今天已经领过了", ALREADY_OWNED: "已经拥有啦", LOCKED: "这个还没解锁" };
function shopSheet() {
  const dlg = h(`
    <dialog class="sheet px-box shop-sheet" data-testid="shop-sheet">
      <div class="shop-head"><h3>商店 · 装扮</h3><b class="coin px-box" data-testid="shop-tokens">◆ …</b></div>
      <div class="shop-preview"></div>
      <div class="row shop-actions">
        <button class="btn px-box" value="claim" data-testid="shop-claim" disabled>每日领取</button>
        ${CFG.debug ? `<button class="btn ghost px-box" value="grant" data-testid="shop-debug-grant">调试 +100</button>` : ""}
      </div>
      <p class="shop-msg" data-testid="shop-msg" role="status"></p>
      <h4>装扮</h4><div class="shop-equip" data-testid="shop-equip"></div>
      <h4>商品</h4><div class="shop-items" data-testid="shop-items"></div>
      <small class="shop-note">用代币解锁外观；默认外观一直免费。发型、蝴蝶结等插画装扮之后上架。</small>
      <div class="row"><button class="btn px-box" value="close">好</button></div>
    </dialog>`);
  document.body.appendChild(dlg); dlg.showModal();
  const sprite = oloSprite({ form: state.profile.form, color: state.profile.color, state: "happy", scale: 3, ...look() });
  dlg.querySelector(".shop-preview").appendChild(sprite);
  const msg = dlg.querySelector(".shop-msg");
  let shop = null, persona = null, busy = false;
  const say = (t, bad = false) => { msg.textContent = t; msg.classList.toggle("bad", bad); if (bad) shake(msg); };
  const locked = (kind, value) => { const it = shop?.items.find((i) => i.kind === kind && i.value === value); return !!(it && !it.owned); };
  const render = () => {
    dlg.querySelector("[data-testid=shop-tokens]").textContent = `◆ ${shop?.tokens ?? 0}`;
    const claim = dlg.querySelector("[data-testid=shop-claim]");
    claim.disabled = !shop?.can_claim || busy;
    claim.textContent = shop?.can_claim ? `每日领取 +${shop.claim_amount}` : "今天已经领过了";
    const cur = persona?.appearance || {};
    dlg.querySelector(".shop-equip").innerHTML = KIND_ORDER.filter((k) => persona?.appearance_options?.[k]).map((k) => `
      <div class="shop-group"><span class="shop-label">${KIND_LABEL[k]}</span><div class="shop-chips">
      ${persona.appearance_options[k].map((o) => { const lk = locked(k, o.id), on = cur[k] === o.id;
        return `<button class="chip px-box${on ? " on" : ""}${lk ? " locked" : ""}" data-equip="${k}" data-value="${esc(o.id)}" data-testid="equip-${k}-${esc(o.id)}" ${lk ? 'aria-disabled="true"' : ""} aria-pressed="${on}">${esc(o.label)}${lk ? " 🔒" : ""}</button>`; }).join("")}
      </div></div>`).join("");
    dlg.querySelector(".shop-items").innerHTML = KIND_ORDER.map((k) => { const items = (shop?.items || []).filter((i) => i.kind === k); if (!items.length) return "";
      return `<div class="shop-group"><span class="shop-label">${KIND_LABEL[k]}</span><div class="shop-chips">
      ${items.map((i) => `<button class="item px-box${i.owned ? " owned" : ""}" data-buy="${esc(i.id)}" data-testid="buy-${esc(i.id)}" ${i.owned ? "disabled" : ""}>
        <span>${esc(i.name.replace(/ 发型$/, ""))}</span><small>${i.owned ? "已拥有" : i.base_price > i.price ? `◆ ${i.price}（原价 ${i.base_price}）` : `◆ ${i.price}`}</small></button>`).join("")}
      </div></div>`; }).join("");
  };
  const load = async () => {
    try { [shop, persona] = await Promise.all([api("/v1/shop"), api("/v1/persona")]); render(); }
    catch { say("现在连不上商店，等会儿再来。", true); }
  };
  const run = async (fn) => { if (busy) return; busy = true; try { await fn(); } catch (e) { say(SHOP_ERR[e.code] || e.message || "出了点问题", true); sfx("error"); } finally { busy = false; render(); } };
  load();
  dlg.addEventListener("click", (e) => {
    const t = e.target.closest("button") || e.target;
    if (t.value === "claim") return run(async () => { const r = await api("/v1/shop/claim", { method: "POST" }); shop = await api("/v1/shop"); say(`领到 ${r.claimed} 枚代币`); sfx("sparkle"); burst(dlg.querySelector(".shop-preview"), 12); });
    if (t.value === "grant") return run(async () => { await api("/v1/debug/grant-tokens", { method: "POST" }); shop = await api("/v1/shop"); say("调试：+100 代币"); sfx("sparkle"); });
    if (t.dataset?.buy) return run(async () => { await api("/v1/shop/buy", { method: "POST", body: { item_id: t.dataset.buy } }); shop = await api("/v1/shop");
      const it = shop.items.find((i) => i.id === t.dataset.buy); say(`解锁了「${it?.name.replace(/ 发型$/, "") || ""}」，去上面换上吧`); sfx("grow"); burst(dlg.querySelector(".shop-preview"), 20); });
    if (t.dataset?.equip) {
      const k = t.dataset.equip, v = t.dataset.value;
      if (locked(k, v)) { say("先在下面买下它，才能换上", true); sfx("error"); return; }
      return run(async () => { persona = await api("/v1/persona", { method: "PUT", body: { appearance: { [k]: v } } }); sfx("select");
        if (k === "form" || LOOK_KEYS.includes(k)) { state.profile[k] = v; LS.set("profile", state.profile); sprite.olo.set({ [k]: v, state: "happy" }); hero?.setState("happy"); burst(dlg.querySelector(".shop-preview"), 16); setTimeout(() => hero?.setState("idle"), 1200); }
        say(`换上了「${t.textContent.replace(" 🔒", "")}」`); });
    }
    if (t.value === "close" || e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
}

function settings() {
  const dlg = h(`
    <dialog class="sheet px-box">
      <h3>设置</h3>
      <label>API Token<input class="field px-box" value="${esc(state.token)}" /></label>
      <label>你的昵称<input class="field px-box" maxlength="12" placeholder="留空就只用代词" data-testid="settings-nickname" /></label>
      <label>日记里怎么称呼你<select class="field px-box" data-testid="settings-gender">
        <option value="unspecified">TA（不想说）</option><option value="male">他（男生）</option><option value="female">她（女生）</option>
      </select></label>
      <label class="check"><input type="checkbox" data-testid="settings-checkins" /> 让 olo 偶尔主动来找我<small>每天最多一次，23:00–08:00 不打扰</small></label>
      <div class="row">
        <button class="btn ghost px-box" value="reset" data-testid="reset">重新相遇</button>
        <button class="btn px-box" value="save">保存</button>
      </div>
    </dialog>`);
  document.body.appendChild(dlg); dlg.showModal();
  const gsel = dlg.querySelector("select"), cbox = dlg.querySelector("[data-testid=settings-checkins]");
  let checkins0 = null;
  api("/v1/proactive").then((r) => { checkins0 = !!r.enabled; cbox.checked = checkins0; }).catch(() => {});
  const nin = dlg.querySelector("[data-testid=settings-nickname]");
  let gender0 = null, nick0 = null;
  api("/v1/persona").then((p) => { gender0 = p.user_gender || "unspecified"; gsel.value = gender0; nick0 = p.user_nickname || ""; nin.value = nick0; }).catch(() => {});
  dlg.addEventListener("click", async (e) => {
    const v = e.target.value;
    if (e.target.tagName === "SELECT" || e.target.tagName === "OPTION" || e.target.tagName === "INPUT" || e.target.closest?.("label")) return;
    if (v === "save") {
      state.token = dlg.querySelector("input").value.trim(); LS.set("token", state.token);
      if (checkins0 !== null && cbox.checked !== checkins0) { try { await api("/v1/proactive", { method: "PUT", body: { enabled: cbox.checked } }); } catch {} }
      const persona = {};
      if (gender0 !== null && gsel.value !== gender0) persona.user_gender = gsel.value;
      if (nick0 !== null && nin.value.trim() !== nick0) persona.user_nickname = nin.value.trim();
      if (Object.keys(persona).length) { try { await api("/v1/persona", { method: "PUT", body: persona }); } catch {} }
      dlg.close();
    }
    if (v === "reset") { ["profile", "session"].forEach((k) => localStorage.removeItem("olo." + k)); location.reload(); }
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
}

// 聊天时铺满屏幕的雾里集高清插画（chat-bg.js 选图 + 压字薄纱，与手机端 ChatBackdrop 同一份数据）：
// 黎明 / 白天 / 黄昏 / 夜里四幅，每分钟按本地时间检查，换时段时两层淡入交叉；上面飘几粒光雨（减少动效时不飘）。收起聊天（⌂）时隐藏
let chatScene = null;
function mountChatScene(after) {
  const el = h(`<div class="chat-scene" data-testid="chat-scene" aria-hidden="true"><img class="cs-a" alt="" /><img class="cs-b" alt="" /><i class="cs-scrim"></i>${REDUCED ? "" : Array.from({ length: 14 }, (_, i) => `<b class="cs-mote" style="left:${(i * 137) % 100}%;animation-delay:-${(i * 2.3) % 20}s;animation-duration:${18 + (i % 5) * 4}s;--r:${2 + (i % 3)}px"></b>`).join("")}</div>`);
  after.insertAdjacentElement("afterend", el);
  const [A, B] = el.querySelectorAll("img"), scrim = el.querySelector(".cs-scrim");
  let key = "", front = A;
  const apply = () => {
    const k = bgFor(localHour()); if (k === key) return;
    const first = !key; key = k; el.dataset.dark = String(chatDark(k)); el.dataset.bg = k; scrim.style.background = scrimCss(k);
    const next = first ? A : (front === A ? B : A);
    next.src = `assets/bg/bg-${k}.jpg`;
    const show = () => { next.classList.add("on"); if (!first) front.classList.remove("on"); front = next; };
    next.complete ? show() : next.addEventListener("load", show, { once: true });
  };
  apply();
  const iv = setInterval(apply, 60000);
  return { stop() { clearInterval(iv); el.remove(); } };
}

let viewCleanup = null;
async function show(tab) {
  state.tab = tab; document.body.dataset.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const view = document.querySelector("[data-view]");
  if (view.firstElementChild) { view.classList.add("leaving"); await sleep(150); view.classList.remove("leaving"); }
  viewCleanup?.(); viewCleanup = null;
  view.innerHTML = "";
  hero?.setPlatforms(null); hero?.setHidden(tab !== "chat" || document.querySelector(".app")?.dataset.mode === "room"); room?.setPaused(tab !== "chat"); document.querySelector("[data-testid=room]")?.toggleAttribute("hidden", tab !== "chat");
  if (tab === "chat") return chatView(view);
  if (tab === "garden") return gardenView(view);
  if (tab === "book") return bookView(view);
  return diaryView(view);
}

const SAD = ["难过", "累", "烦", "哭", "焦虑", "压力", "孤独", "失眠", "崩溃", "委屈", "害怕", "不开心"];
const HAPPY = ["开心", "高兴", "太好了", "哈哈", "成功", "喜欢", "谢谢", "棒", "终于", "被夸"];
const moodOf = (t) => (SAD.some((w) => t.includes(w)) ? "sad" : HAPPY.some((w) => t.includes(w)) ? "happy" : "idle");

async function chatView(view) {
  const p = state.profile;
  view.innerHTML = `
    <div class="chat">
      <ol class="msgs" data-testid="messages" aria-live="polite"></ol>
      <form class="composer" data-testid="composer">
        <input class="field px-box" data-testid="chat-input" placeholder="跟 ${esc(p.name)} 说点什么…" autocomplete="off" maxlength="500" />
        <button class="btn px-box send" data-testid="send" aria-label="发送">▶</button>
      </form>
    </div>`;
  ambient("chat");
  const list = view.querySelector(".msgs"), form = view.querySelector("form"), input = form.querySelector("input");
  let busy = false; // 要在 setPlatforms 之前声明：olo 的 busy 回调挂上就会被调用，晚声明会抛 TDZ 错
  // olo 站的平台：看得见的气泡顶边 + 输入框顶边；文字区（所有气泡）是不能挡的；正在打字的气泡要离远点
  const spansIn = () => [...list.querySelectorAll(".msg > span")];
  hero?.setPlatforms(() => {
    if (!list.isConnected) return [];
    const lr = list.getBoundingClientRect(), cr = form.getBoundingClientRect(), out = [];
    spansIn().forEach((sp, i, all) => {
      const r = sp.getBoundingClientRect(); if (r.top < lr.top + 8 || r.top > lr.bottom - 8 || r.width < 8) return;
      out.push({ x0: r.left + 6, x1: r.right - 6, y: r.top, key: "bubble-" + i, end: i === all.length - 1 && !sp.parentElement.classList.contains("user") });
    });
    out.push({ x0: cr.left + 4, x1: cr.right - 4, y: cr.top, key: "composer" });
    return out;
  }, {
    blocks: () => { const lr = list.getBoundingClientRect(); return spansIn().map((sp) => sp.getBoundingClientRect()).filter((r) => r.bottom > lr.top && r.top < lr.bottom).concat([form.querySelector("input").getBoundingClientRect()]); },
    busy: () => { if (!busy) return null; const sp = [...list.querySelectorAll(".msg.assistant > span")].pop(); return sp ? sp.getBoundingClientRect() : null; },
  });
  if (CFG?.debug || window.__OLO_TEST_HOOKS__ || new URLSearchParams(location.search).has("debug")) window.__oloStage = hero;
  const add = (role, text) => {
    const li = h(`<li class="msg ${role}"><span class="px-box"></span></li>`);
    li.querySelector("span").textContent = text;
    list.appendChild(li); list.scrollTop = list.scrollHeight;
    return li.querySelector("span");
  };
  // 刷新后立刻显示本地缓存的历史，再用服务器的为准（避免空白一两秒）
  const bubblesOf = (m) => (m.role === "assistant" ? String(m.body).split(/\n\s*\n/).filter((x) => x.trim()) : [m.body]);
  const renderHistory = (messages, fresh = new Set()) => {
    list.innerHTML = "";
    messages.forEach((m) => bubblesOf(m).forEach((b) => { const el = add(m.role, b); if (m.role === "assistant" && fresh.has(m.body)) { el.parentElement.classList.add("proactive"); el.parentElement.dataset.testid = "proactive-msg"; } }));
  };
  const cached = LS.get("history", null);
  if (state.sessionId && cached?.sid === state.sessionId && Array.isArray(cached.messages)) renderHistory(cached.messages);
  if (state.sessionId) {
    try {
      const { messages } = await api(`/v1/sessions/${state.sessionId}/messages?limit=30`);
      renderHistory(messages, new Set(unreadProactive.map((u) => u.message)));
      LS.set("history", { sid: state.sessionId, messages: messages.map((m) => ({ role: m.role, body: m.body })) });
      markProactiveSeen();
    } catch (e) {
      // 只有会话确实不存在才换新会话；网络抖动时保留会话和缓存
      if (e.status === 404) { state.sessionId = null; LS.set("session", null); LS.set("history", null); list.innerHTML = ""; }
    }
  }
  if (!list.children.length) add("assistant", `我是 ${p.name}。你说的每一句话，都会变成我们花园里的一滴雨。今天想聊点什么？`);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; input.value = ""; form.dataset.busy = "1"; form.querySelector(".send").disabled = true;
    add("user", text); hero.rain(8); hero.nudge?.(); sfx("send");
    const mood = moodOf(text);
    setMood("thinking");
    let span = add("assistant typing", ""); span.parentElement.classList.add("typing");
    let full = "", cur = "", pipe = false, bubbles = 1;
    const mine = [span];
    const newBubble = async () => {
      span.textContent = cur.trim();
      if (bubbles >= 4) { cur += "\n"; return; }
      bubbles++; cur = "";
      span = add("assistant typing", ""); mine.push(span); span.parentElement.classList.add("typing"); setMood("thinking");
      await sleep(550 + Math.random() * 350);
      span.parentElement.classList.remove("typing"); setMood("talking"); sfx("receive");
    };
    try {
      const done = await streamTurn(text, async (piece) => {
        if (!full) { span.parentElement.classList.remove("typing"); setMood("talking"); sfx("receive"); }
        for (const ch of piece) {
          full += ch;
          if (ch === "|") { if (pipe) { pipe = false; await newBubble(); } else pipe = true; continue; }
          if (pipe) { cur += "|"; pipe = false; }
          if (!cur.trim() && !ch.trim()) continue;
          if (ch === "\n" && /\n\s*$/.test(cur)) { await newBubble(); continue; }
          cur += ch; span.textContent = cur; if (full.length % 3 === 0) sfx("tick"); list.scrollTop = list.scrollHeight; await sleep(22);
        }
      });
      if (pipe) cur += "|";
      span.textContent = cur.trim();
      if (!span.textContent) { span.parentElement.remove(); mine.pop(); }
      // 以服务端切好的 segments 为准，补齐流式阶段没切开的气泡
      const segs = (done && done.segments) || [];
      if (segs.length) {
        // 服务端整理过的版本为准（问号数量、括号动作、气泡数都已校正）
        while (mine.length > segs.length) mine.pop().parentElement.remove();
        mine.forEach((sp, i) => { if (sp.textContent !== segs[i]) sp.textContent = segs[i]; });
        for (const seg of segs.slice(mine.length)) {
          const sp = add("assistant typing", ""); sp.parentElement.classList.add("typing"); mine.push(sp);
          await sleep(500); sp.parentElement.classList.remove("typing"); sp.textContent = seg; sfx("receive");
        }
      }
      setMood(mood === "idle" ? "happy" : mood);
      setTimeout(() => { if (!busy) setMood("idle"); }, 2600);
      const h0 = LS.get("history", null), prev = h0?.sid === state.sessionId ? h0.messages : [];
      LS.set("history", { sid: state.sessionId, messages: [...prev, { role: "user", body: text }, { role: "assistant", body: mine.map((x) => x.textContent).join("\n\n") }].slice(-30) });
    } catch (err) {
      span.parentElement.classList.remove("typing"); span.parentElement.classList.add("error");
      span.textContent = err.status === 401 ? "连接密钥不对，点右上角 ⚙ 设置。" : err.status === 429 ? "说得太快啦，歇一下再来。" : `没连上：${err.message}`;
      setMood("sad"); sfx("error");
    } finally { busy = false; delete form.dataset.busy; form.querySelector(".send").disabled = false; input.focus(); }
  });
  input.focus();
}

async function gardenView(view) {
  ambient("garden");
  view.innerHTML = `<div class="garden"><p class="hint">花园正在醒来…</p></div>`;
  try {
    const g = await api("/v1/garden");
    const seen = LS.get("seenDrops", 0);
    view.innerHTML = `
      <div class="garden" data-testid="garden">
        <h2>${esc(state.profile.name)} 的花园 · <span data-testid="stage">${esc(g.stage || "")}</span></h2>
        <div class="garden-frame px-box"></div>
        <div class="meter px-box"><i></i></div>
        <p class="stats">第 ${g.level}/${g.max_level} 阶段 · 雨滴 ${g.messages} · 日记 ${g.entries} · 花 ${g.insights} · 来过 ${g.days} 天</p>
        <ul class="milestones">${g.milestones.map((m) => `<li class="${m.reached ? "on" : ""}">${m.reached ? "★" : "☆"} ${esc(m.label)}</li>`).join("")}</ul>
        <h2>解锁的小故事</h2>
        <div class="lore">${(g.lore || []).map((l, i) => `<article class="px-box" style="--i:${i}"><b>✦ ${esc(l.title)}</b><p>${esc(l.body)}</p></article>`).join("") || `<p class="hint">多聊几句，故事会慢慢冒出来。</p>`}</div>
      </div>`;
    viewCleanup = mountGarden(view.querySelector(".garden-frame"), g, state.profile, { rain: g.messages > seen });
    setTimeout(() => sfx("grow"), 250); if (g.messages > seen) setTimeout(() => sfx("rain"), 900);
    LS.set("seenDrops", g.messages);
    requestAnimationFrame(() => { view.querySelector(".meter i").style.width = `${g.growth}%`; });
    api("/v1/olo/chapters").then((b) => {
      if (b.unlocked <= LS.get("seenChapters", 0) || !view.querySelector("[data-testid=garden]")) return;
      const last = b.chapters[b.unlocked - 1];
      const tip = h(`<button class="chapter-hint px-box" data-testid="chapter-hint">✦ 雾里集新的一章：${esc(last.title)} →</button>`);
      tip.addEventListener("click", () => show("book"));
      view.querySelector("h2").after(tip); sfx("grow");
    }).catch(() => {});
  } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// 日记正文按段落渲染；单独成段的「原话」用引用样式
function diaryBody(body) {
  return String(body || "").split(/\n\s*\n/).filter((p) => p.trim()).map((p) => {
    const t = p.trim();
    return /^「[^」]+」$/.test(t) ? `<blockquote class="quote" data-testid="diary-quote">${esc(t)}</blockquote>` : `<p>${esc(t)}</p>`;
  }).join("");
}

async function diaryView(view) {
  ambient("diary");
  view.innerHTML = `<div class="diary"><p class="hint">翻开日记本…</p></div>`;
  const render = async () => {
    const { entries } = await api("/v1/notebook");
    view.innerHTML = `
      <div class="diary" data-testid="diary">
        <div class="diary-head"><h2>${esc(state.profile.name)} 的日记</h2>
          <button class="btn px-box" data-testid="write-diary">✎ 写今天的日记</button></div>
        <p class="error" hidden></p>
        <div class="mood px-box dark" data-testid="mood"><b>最近 14 天的心情</b><canvas></canvas><small class="mood-legend">☀ 亮 · ☁ 平 · ☂ 沉</small></div>
        <div class="cards" data-testid="cards" hidden></div>
        <div class="pages">${entries.map((e, i) => `
          <article class="notebook px-box page" style="--i:${i}"><time>${esc(e.entry_date)}</time>${i === 0 ? `<span class="stamp">新</span>` : ""}<h3>${esc(e.title)}</h3>${diaryBody(e.body)}<button class="link share-btn" data-share="${i}" data-testid="share-diary" aria-label="分享这篇日记">⇪ 分享</button></article>`).join("") || `<p class="hint">还没有日记。聊几句之后再来吧。</p>`}</div>
      </div>`;
    sfx("page");
    view.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => { const e = entries[+b.dataset.share]; openShare({ kind: "diary", title: e.title, text: e.body.replace(/[#*_>`]/g, ""), when: e.entry_date }); }));
    api("/v1/postcards?limit=12").then(({ postcards }) => {
      const box = view.querySelector("[data-testid=cards]"); if (!box || !postcards.length) return;
      box.hidden = false;
      box.innerHTML = `<b>明信片 · olo 出门带回来的</b><div class="card-row">${postcards.map((c, i) => `<article class="pcard px-box"><small>${esc(c.place_name || c.place)} · ${esc(cnDate(c.created_at))}</small><h4>${esc(c.title)}</h4><p>${esc(c.story)}</p><button class="link share-btn" data-card="${i}" data-testid="share-postcard">⇪ 分享</button></article>`).join("")}</div>`;
      box.querySelectorAll("[data-card]").forEach((b) => b.addEventListener("click", () => { const c = postcards[+b.dataset.card]; openShare({ kind: "postcard", title: c.title, text: c.story, when: c.created_at }); }));
    }).catch(() => {});
    api("/v1/mood?days=14").then((m) => drawMood(view.querySelector("[data-testid=mood] canvas"), m.days)).catch(() => {});
    const btn = view.querySelector("[data-testid=write-diary]");
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "✎ 正在写…";
      try { await api("/v1/notebook/generate", { method: "POST", body: state.sessionId ? { session_id: state.sessionId } : {} }); await render(); }
      catch (e) {
        const er = view.querySelector(".error"); er.hidden = false;
        if (e.status === 402) {
          er.innerHTML = `今天的免费额度用完啦。<button class="link" data-testid="activate">模拟开通会员</button>`;
          er.querySelector("button").addEventListener("click", async () => { try { await api("/v1/subscription/activate", { method: "POST", body: { plan: "monthly" } }); render(); } catch (e2) { er.textContent = e2.status === 403 ? "olo+ 还没上线，明天额度会自动恢复。" : e2.message; } });
        } else er.textContent = e.message;
        btn.disabled = false; btn.textContent = "✎ 再试一次";
      }
    });
  };
  try { await render(); } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------- 分享卡片：明信片 / 日记 → 插画风 PNG（四种尺寸，排版来自共享的 share-card.js） ----------
const SHARE_LABEL = { "1x1": "1:1", "4x5": "4:5", "9x16": "9:16", "16x9": "16:9" };
const SHARE_FONT_STACK = `"LXGW WenKai Lite", "LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif`;
const cnDate = (iso) => { const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
const shareImgs = {};
function shareImg(src, onload) {
  let im = shareImgs[src];
  if (!im) { im = shareImgs[src] = new Image(); im.src = src; }
  if (!im.complete && onload) im.addEventListener("load", onload, { once: true });
  return im.complete && im.naturalWidth ? im : null;
}
function coverDraw(x, im, W, H) {
  const s = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * s, hh = im.naturalHeight * s;
  x.drawImage(im, (W - w) / 2, (H - hh) / 2, w, hh);
}
function roundRect(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
/** 画分享卡。图片还没加载完时先画渐变底，加载好后调用 onReady 重画 */
export function renderShareCard({ kind, title, text, when, size }, onReady) {
  const d = new Date(when.length <= 10 ? when + "T12:00:00" : when);
  const hour = kind === "postcard" ? d.getHours() + d.getMinutes() / 60 : 17.6; // 日记：傍晚最暖的那一刻
  const L = shareLayout(size), W = L.W, H = L.H, P = L.panel;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const bg = shareImg(`assets/share/${shareBg(hour)}.jpg`, onReady);
  if (bg) coverDraw(x, bg, W, H);
  else { const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#F7C9A8"); g.addColorStop(1, "#FBEFE6"); x.fillStyle = g; x.fillRect(0, 0, W, H); }
  // 奶油圆角纸片 + 柔和投影
  x.save(); x.shadowColor = SHARE_SHADOW; x.shadowBlur = 36; x.shadowOffsetY = 10; roundRect(x, P.x, P.y, P.w, P.h, P.r); x.fillStyle = SHARE_PAPER; x.fill(); x.restore();
  // 灯籽立绘（当前样子）
  const p = state.profile || {}, form = p.form || "buddy";
  const spr = shareImg(`assets/forms/${form}.png`, onReady);
  if (spr) x.drawImage(spr, L.sprite.x, L.sprite.y, L.sprite.size, L.sprite.size);
  // 字：霞鹜文楷（本机有就用），否则楷体
  x.textBaseline = "top";
  x.font = `${L.title.fs}px ${SHARE_FONT_STACK}`; x.fillStyle = SHARE_ACCENT;
  x.fillText(wrapShareText(title, L.body.cols - 5, 1)[0] || "", L.title.x, L.title.y);
  x.font = `${L.date.fs}px ${SHARE_FONT_STACK}`; x.fillStyle = SHARE_MUTED; x.textAlign = "right";
  x.fillText(cnDate(when), L.date.x, L.date.y); x.textAlign = "left";
  x.font = `${L.body.fs}px ${SHARE_FONT_STACK}`;
  wrapShareText(text, L.body.cols, L.body.maxLines).forEach((ln, i) => {
    const y = L.body.y + i * L.body.lineH;
    x.fillStyle = SHARE_PAPER_LINE; x.fillRect(L.body.x, y + L.body.lineH - 6, P.w - (L.body.x - P.x) * 2, 2);
    x.fillStyle = SHARE_INK; x.fillText(ln, L.body.x, y);
  });
  x.font = `${L.mark.fs}px ${SHARE_FONT_STACK}`; x.fillStyle = SHARE_MUTED; x.globalAlpha = 0.7; x.textAlign = "right"; x.fillText("olo", L.mark.x, L.mark.y);
  x.globalAlpha = 1; x.textAlign = "left";
  return c;
}
function openShare(card) {
  const dlg = h(`<div class="share-dlg" data-testid="share-dlg" role="dialog" aria-label="分享卡片"><div class="share-box px-box">
    <div class="share-sizes">${Object.keys(SHARE_LABEL).map((k, i) => `<button class="btn px-box${i ? "" : " on"}" data-size="${k}">${SHARE_LABEL[k]}</button>`).join("")}</div>
    <div class="share-prev"></div>
    <div class="share-act"><button class="btn px-box" data-testid="share-download">⤓ 存成图片</button><button class="btn px-box" data-close>关掉</button></div></div></div>`);
  let size = "1x1", cur = null;
  // 霞鹜文楷网页字体（OFL，子集仅用于网页投放）：加载好后重画一次
  document.fonts?.load(`48px "LXGW WenKai Lite"`, (card.title || "") + (card.text || "")).then(() => cur && draw()).catch(() => {});
  const draw = () => { cur = renderShareCard({ ...card, size }, () => draw()); cur.dataset.size = size; const pv = dlg.querySelector(".share-prev"); pv.replaceChildren(cur); };
  dlg.querySelectorAll("[data-size]").forEach((b) => b.addEventListener("click", () => { size = b.dataset.size; dlg.querySelectorAll("[data-size]").forEach((o) => o.classList.toggle("on", o === b)); draw(); }));
  dlg.querySelector("[data-close]").addEventListener("click", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.remove(); });
  const onKey = (e) => { if (e.key === "Escape") dlg.remove(); };
  addEventListener("keydown", onKey); new MutationObserver((_, o) => { if (!dlg.isConnected) { removeEventListener("keydown", onKey); o.disconnect(); } }).observe(document.body, { childList: true });
  dlg.querySelector("[data-testid=share-download]").addEventListener("click", () => cur.toBlob((b) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `olo-${card.kind}-${size}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png"));
  document.body.append(dlg); draw(); sfx("page");
}

// 像素心情曲线：14 格，-1..1 映射到 0..H，没聊的日子留空
function drawMood(c, days) {
  if (!c) return;
  const W = 112, H = 36, S = 4; c.width = W; c.height = H; c.style.width = `${W * S}px`; c.style.maxWidth = "100%"; c.dataset.points = days.filter((d) => d.mood !== null).length;
  const x = c.getContext("2d"); x.imageSmoothingEnabled = false;
  x.fillStyle = "#3a1c26"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#5a2c34"; for (let i = 0; i < W; i += 2) x.fillRect(i, H / 2, 1, 1);
  const step = (W - 8) / (days.length - 1), y = (m) => Math.round(H - 5 - ((m + 1) / 2) * (H - 10));
  const pts = days.map((d, i) => d.mood === null ? null : [Math.round(4 + i * step), y(d.mood), d.mood]);
  let prev = null; const line = (a, b) => { // Bresenham, 1px
    let [x0, y0] = a, [x1, y1] = b; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { x.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  };
  x.fillStyle = "#ffd98a"; pts.forEach((p) => { if (p && prev) line(prev, p); if (p) prev = p; });
  pts.forEach((p, i) => {
    if (!p) { x.fillStyle = "#74393a"; x.fillRect(Math.round(4 + i * step) - 1, H - 3, 2, 2); return; }
    x.fillStyle = p[2] > 0.2 ? "#ffb347" : p[2] < -0.2 ? "#4fa89a" : "#f0b8a0"; x.fillRect(p[0] - 1, p[1] - 1, 3, 3);
    x.fillStyle = "#2a140c"; x.fillRect(p[0], p[1], 1, 1);
  });
}

// 故事书：雾里集的章节，没解锁的笼在雾里
async function bookView(view) {
  ambient("diary");
  view.innerHTML = `<div class="book"><p class="hint">雾慢慢散开…</p></div>`;
  try {
    const b = await api("/v1/olo/chapters");
    LS.set("seenChapters", b.unlocked);
    view.innerHTML = `
      <div class="book" data-testid="book">
        <h2>雾里集 · ${esc(state.profile.name)} 的故事</h2>
        <p class="stats">已展开 ${b.unlocked}/${b.total} 章 · olo 讲过 ${b.canon_count} 件自己的事</p>
        ${b.chapters.map((c, i) => c.unlocked ? `
          <article class="chapter px-box page" style="--i:${i}" data-testid="chapter">
            <small>第 ${i + 1} 章 · ${esc(c.place)}</small><h3>${esc(c.title)}</h3>${diaryBody(c.narration)}</article>` : `
          <article class="chapter fogged px-box dark" style="--i:${i}" data-testid="chapter-locked">
            <small>第 ${i + 1} 章 · ${esc(c.place)}</small><h3>？？？</h3><p>${esc(c.hint)}</p><i class="fog"></i></article>`).join("")}
      </div>`;
    sfx("page");
  } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------- 启动 ----------
preloadOlo();
document.fonts?.load('18px "LXGW WenKai Lite"', "olo灯籽").finally(() => { if (state.profile) main(); else onboarding(); });
