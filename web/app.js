import { oloSprite, drawOlo, canvas, P, ticker, REDUCED } from "./pixel.js";
import { paintScene } from "./sky-scene.js?v=20261024a";
import { BROWSER_TZ, bands, groundAt, localHour, setUserTz, skyAt, sunProgress } from "./skytime.js?v=20261023b";
import { paintChatScene } from "./chat-bg.js?v=20261024d";
import { mountScene } from "./scenes.js";
import { mountGarden } from "./garden.js";
import { mountStage } from "./stage.js?v=20261023p";
import { mountWorld } from "./world.js?v=20261025b";
import { openDiaryClip } from "./diary-clip.js?v=20261025a";
import { sfx, ambient, isMuted, setMuted } from "./audio.js";
import { mountOnboardFx, typeIn, juice } from "./onboard-fx.js?v=20261024e";
let obFx = null;

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

async function swap(node, { transition = "drop" } = {}) {
  const put = async () => {
    cleanups.forEach((f) => f()); cleanups = [];
    node.style.pointerEvents = "none";
    root.replaceChildren(node);
    node.classList.add("scene", "enter");
    setTimeout(() => node.classList.remove("enter"), 800);
  };
  if (transition === "wipe" && root.firstElementChild) await wipe(put); else await put();
  node.style.pointerEvents = "";
  if (obFx) { juice(node); node.querySelectorAll(".panel h2").forEach((t) => typeIn(t, t.textContent)); }
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

// ---------- 引导 ----------
const BEATS = [
  { who: "旁白", text: "城市里，每一句没说出口的话，都不会真的消失。" },
  { who: "旁白", text: "它们化成很轻的雾，飘到一片叫「雾里集」的河湾，凝成一粒粒发光的灯籽。" },
  { who: "渡灯翁", text: "「这一粒，是你那片雾里长出来的。我撑船送它过去。」" },
  { who: "旁白", text: "它顺着屏幕的光，找到了你。" },
];
const WORDS = ["好累啊", "其实我很想你", "今天被夸了", "没关系的", "睡不着", "我做到了", "算了", "谢谢你"];

const BEAT_AMB = ["city", "river", "boat", "room"];
async function onboarding() {
  ambient("title");
  obFx = mountOnboardFx(); document.body.classList.add("ob");
  const title = await swap(h(`
    <section>
      <div class="title-olo"></div>
      <h1 class="logo">olo</h1>
      <p class="tagline">一颗会听你说话的灯籽</p>
      <button class="btn px-box blink-cta" data-testid="start">▶ 开始相遇</button>
      <button class="link" data-testid="skip-story">跳过故事</button>
    </section>`));
  title.querySelector(".title-olo").appendChild(oloSprite({ state: "happy", scale: 5 }));
  const logo = title.querySelector(".logo"); logo.innerHTML = [...logo.textContent].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join("");
  title.classList.add("fog-intro"); setTimeout(() => obFx?.parting(), REDUCED ? 0 : 350);
  const skip = await Promise.race([
    waitClick(title.querySelector("[data-testid=start]")).then(() => false),
    waitClick(title.querySelector("[data-testid=skip-story]")).then(() => true),
  ]);

  if (!skip) {
    for (let i = 0; i < BEATS.length; i++) {
      const b = BEATS[i];
      const node = await swap(h(`
        <section class="ob-beat" data-beat="${i}">
          <div class="scene-frame px-box" data-testid="scene">${i === 0 ? `<div class="scene-words">${WORDS.map((w, j) => `<span style="left:${6 + j * 11}%;animation-delay:${j * 0.75}s;bottom:${24 + (j % 3) * 9}%">${w}</span>`).join("")}</div>` : ""}</div>
          <div class="beat-dots">${BEATS.map((_, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("")}</div>
          <div class="dialog px-box" data-testid="next" role="button" tabindex="0">
            <span class="who px-box">${b.who}</span><p class="story" aria-live="polite"></p><span class="caret">▼</span>
          </div>
        </section>`), { transition: "wipe" });
      ambient(BEAT_AMB[i]); obFx?.setMood(i / (BEATS.length + 2));
      const frame = node.querySelector(".scene-frame");
      const stop = await mountScene(frame, i);
      onLeave(stop);
      frame.style.position = "relative";
      const words = frame.querySelector(".scene-words"); if (words) { words.style.position = "absolute"; words.style.inset = "0"; frame.appendChild(words); }
      const dlg = node.querySelector(".dialog"), p = node.querySelector(".story");
      let skipped = false;
      dlg.addEventListener("click", () => { skipped = true; }, { once: true });
      await typeText(p, b.text, 42, () => skipped);
      if (!skipped) await waitClick(dlg); else await sleep(120);
    }
  }

  // 破壳
  const hello = await swap(h(`
    <section>
      <div class="hatch-stage" data-testid="hatch"></div>
      <div class="dialog px-box"><span class="who px-box">???</span><p class="story">嗨……是你在叫我吗？</p></div>
      <button class="btn px-box" data-testid="hello" disabled>是我！</button>
    </section>`), { transition: "wipe" });
  ambient("room");
  sfx("hatch");
  const stage = hello.querySelector(".hatch-stage");
  const [seedC, sctx] = canvas(32, 32); seedC.style.width = seedC.style.height = "192px"; stage.appendChild(seedC);
  const olo = oloSprite({ state: "happy", scale: 6 }); olo.style.opacity = "0"; stage.appendChild(olo);
  const seedStart = ticker.t;
  const off = ticker.add((T) => {
    const t = REDUCED ? 99 : T - seedStart;
    sctx.clearRect(0, 0, 32, 32);
    if (t > 14) return;
    const wob = t < 12 ? [0, 1, 0, -1][t % 4] : 0;
    for (let y = -6; y <= 6; y++) for (let x = -5; x <= 5; x++) { const d = (x / 5) ** 2 + (y / 6.5) ** 2; if (d <= 1) P(sctx, 16 + x + wob, 18 + y, d > 0.75 ? "#b36b1e" : y < -2 && x < 0 ? "#fff6d8" : "#ffc455"); }
    if (t > 6) { P(sctx, 14 + wob, 14, "#4f3510"); P(sctx, 15 + wob, 15, "#4f3510"); P(sctx, 16 + wob, 14, "#4f3510"); P(sctx, 17 + wob, 15, "#4f3510"); }
    if (t > 10) { P(sctx, 13 + wob, 17, "#4f3510"); P(sctx, 18 + wob, 18, "#4f3510"); P(sctx, 19 + wob, 17, "#4f3510"); }
  });
  onLeave(off);
  await sleep(1500);
  olo.style.opacity = "1"; obFx?.setMood(0.6);
  if (!REDUCED) {
    // 破壳：挤压-拉伸 + 蛋壳碎片四散
    olo.animate?.([{ transform: "translateY(40px) scale(.2, .2)" }, { transform: "translateY(10px) scale(1.4, .6)", offset: .3 }, { transform: "translateY(-46px) scale(.75, 1.35)", offset: .55 }, { transform: "translateY(0) scale(1.3, .72)", offset: .78 }, { transform: "scale(.92, 1.1)", offset: .9 }, { transform: "scale(1)" }], { duration: 900, easing: "cubic-bezier(.3,1.4,.5,1)" });
    for (let k = 0; k < 10; k++) { const sh = document.createElement("i"); sh.className = "shard"; sh.style.setProperty("--dx", `${Math.round((Math.random() - .5) * 360)}px`); sh.style.setProperty("--dy", `${Math.round(-60 - Math.random() * 160)}px`); sh.style.setProperty("--r", `${Math.round((Math.random() - .5) * 720)}deg`); stage.appendChild(sh); setTimeout(() => sh.remove(), 1200); }
    const r = stage.getBoundingClientRect(); obFx?.sparkle(r.left + r.width / 2, r.top + r.height / 2, 60);
  }
  burst(stage, 22); shake(hello); sfx("happy");
  hello.querySelector("[data-testid=hello]").disabled = false;
  await waitClick(hello.querySelector("[data-testid=hello]"));

  const pick = { name: "olo", form: "buddy", color: "sun" };
  ambient("title");

  // 起名
  const nameNode = await swap(h(`
    <section>
      <div class="panel px-box dark">
        <div class="mini"></div>
        <h2>给我起个名字吧</h2>
        <p class="hint">渡灯翁说，被叫过名字的灯籽，会亮得更久。</p>
        <input class="field px-box" data-testid="name" maxlength="12" placeholder="olo" autocomplete="off" />
        <button class="btn px-box" data-testid="name-ok">就叫这个</button>
      </div>
    </section>`), { transition: "wipe" });
  const mini = oloSprite({ state: "idle", scale: 4 });
  nameNode.querySelector(".mini").appendChild(mini);
  const input = nameNode.querySelector("input");
  input.addEventListener("input", () => { mini.olo.set({ state: input.value ? "talking" : "idle" }); clearTimeout(input._t); input._t = setTimeout(() => mini.olo.set({ state: "happy" }), 400); });
  input.focus();
  await new Promise((r) => {
    const go = () => { pick.name = input.value.trim() || "olo"; r(); };
    nameNode.querySelector("[data-testid=name-ok]").addEventListener("click", go, { once: true });
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  });

  // 问昵称（可以跳过）
  const nickNode = await swap(h(`
    <section>
      <div class="panel px-box dark" data-testid="nickname-step">
        <div class="mini"></div>
        <h2>你想让 ${esc(pick.name)} 怎么称呼你？</h2>
        <p class="hint">可以不填，之后可以在 ⚙ 设置里改。</p>
        <input class="field px-box" maxlength="12" placeholder="你的昵称" data-testid="nickname-input" />
        <div class="row">
          <button class="btn ghost px-box" data-testid="nickname-skip">跳过</button>
          <button class="btn px-box" data-testid="nickname-ok">好</button>
        </div>
      </div>
    </section>`), { transition: "wipe" });
  nickNode.querySelector(".mini").appendChild(oloSprite({ state: "happy", scale: 4 }));
  const nickInput = nickNode.querySelector("input");
  nickInput.focus();
  await new Promise((r) => {
    const done = (keep) => { const v = nickInput.value.trim(); if (keep && v) pick.user_nickname = v; else delete pick.user_nickname; r(); };
    nickNode.querySelector("[data-testid=nickname-ok]").addEventListener("click", () => done(true), { once: true });
    nickNode.querySelector("[data-testid=nickname-skip]").addEventListener("click", () => done(false), { once: true });
    nickInput.addEventListener("keydown", (e) => e.key === "Enter" && done(true));
  });

  // 选性别（只用于日记里怎么称呼你，可以不说）
  const GENDERS = [["male", "男生", "日记里叫你「他」"], ["female", "女生", "日记里叫你「她」"], ["unspecified", "不想说", "日记里叫你「TA」"]];
  pick.user_gender = "unspecified";
  const genderNode = await swap(h(`
    <section>
      <div class="panel px-box dark" data-testid="gender-step">
        <div class="mini"></div>
        <h2>${esc(pick.name)} 在日记里该怎么称呼你？</h2>
        <p class="hint">只用在 ${esc(pick.name)} 的日记里，之后可以在 ⚙ 设置里改。</p>
        <div class="cards">${GENDERS.map(([id, label, d]) => `<button class="choice px-box ${id === pick.user_gender ? "on" : ""}" data-gender="${id}" data-testid="gender-${id}"><b>${label}</b><small>${d}</small></button>`).join("")}</div>
        <button class="btn px-box" data-testid="gender-ok">好</button>
      </div>
    </section>`), { transition: "wipe" });
  genderNode.querySelector(".mini").appendChild(oloSprite({ state: "thinking", scale: 4 }));
  genderNode.querySelectorAll("[data-gender]").forEach((b) => b.addEventListener("click", () => {
    pick.user_gender = b.dataset.gender; sfx("select");
    genderNode.querySelectorAll("[data-gender]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  await waitClick(genderNode.querySelector("[data-testid=gender-ok]"));

  // 选样子
  const FORMS = [["buddy", "麻薯", "软团子 · 爱蹦跶"], ["cloud", "云朵", "软软的 · 慢悠悠"], ["glow", "微光", "小火苗 · 话很少"]];
  // 每种形态用自己固定的默认配色，不再让用户选颜色
  const FORM_COLOR = { buddy: "sun", cloud: "sky", glow: "lavender" };
  pick.color = FORM_COLOR[pick.form];
  const formNode = await swap(h(`
    <section>
      <div class="panel px-box dark">
        <h2>${esc(pick.name)} 想长成什么样子？</h2>
        <div class="preview"></div>
        <div class="choices">${FORMS.map(([id, label, d]) => `<button class="choice px-box ${id === pick.form ? "on" : ""}" data-form="${id}" data-testid="form-${id}"><span class="ico"></span><b>${label}</b><small>${d}</small></button>`).join("")}</div>
        <p class="error" hidden></p>
        <button class="btn px-box blink-cta" data-testid="form-ok">就是这样，开始聊天 ▶</button>
      </div>
    </section>`), { transition: "wipe" });
  const big = oloSprite({ state: "happy", scale: 6 });
  formNode.querySelector(".preview").appendChild(big);
  const icons = [...formNode.querySelectorAll("[data-form]")].map((b) => { const s = oloSprite({ form: b.dataset.form, color: FORM_COLOR[b.dataset.form], scale: 2 }); b.querySelector(".ico").appendChild(s); return s; });
  const refresh = () => { big.olo.set({ form: pick.form, color: pick.color, state: "happy" }); burst(formNode.querySelector(".preview"), 10); };
  formNode.querySelectorAll("[data-form]").forEach((b) => b.addEventListener("click", () => { pick.form = b.dataset.form; pick.color = FORM_COLOR[pick.form]; formNode.querySelectorAll("[data-form]").forEach((x) => x.classList.toggle("on", x === b)); refresh(); }));
  // 性格不再让用户选：olo 就是它自己（默认人设）
  const err = formNode.querySelector(".error");
  for (;;) {
    await waitClick(formNode.querySelector("[data-testid=form-ok]"));
    try { await api("/v1/onboarding", { method: "POST", body: { ...pick, timezone: BROWSER_TZ || undefined } }); break; }
    catch (e) {
      err.hidden = false; shake(formNode.querySelector(".panel"));
      err.textContent = e.status === 401 ? "连接密钥不对，请在设置里填写 OLO_API_TOKEN。" : e.message;
      sfx("error");
      if (e.status === 401) await askToken();
    }
  }
  state.profile = pick; LS.set("profile", pick);

  const trans = await swap(h(`
    <section>
      <div class="preview"></div>
      <div class="dialog px-box"><span class="who px-box">${esc(pick.name)}</span><p class="story">从今天起，你说的每一句话，都会变成我们花园里的一滴雨。</p></div>
    </section>`), { transition: "wipe" });
  const tb = oloSprite({ form: pick.form, color: pick.color, state: "happy", scale: 7 });
  trans.querySelector(".preview").appendChild(tb); burst(trans.querySelector(".preview"), 24); sfx("grow");
  trans.classList.add("finale");
  await obFx?.finale();
  await sleep(1200);
  obFx?.stop(); obFx = null; document.body.classList.remove("ob");
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
const KIND_ORDER = ["form", "hair", "eyes", "cheeks", "voice"];
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
      <small class="shop-note">用代币解锁外观；默认外观一直免费。微光形态的脸颊装扮会画成两道淡淡的光痕。</small>
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

// 聊天时铺满屏幕的暖色像素风景（chat-bg.js，与手机端聊天面板同一份画法）：按本地时间每 5 分钟重画，
// 夜里萤火、白天花粉慢慢飘；收起聊天（⌂）进雾里集时隐藏
let chatScene = null;
function mountChatScene(after) {
  const cv = document.createElement("canvas"); cv.className = "chat-scene"; cv.dataset.testid = "chat-scene"; cv.setAttribute("aria-hidden", "true");
  after.insertAdjacentElement("afterend", cv);
  const ctx = cv.getContext("2d"); let built = null, key = "", raf = 0, last = 0;
  const build = () => {
    const W = Math.ceil(innerWidth / 4), H = Math.ceil(innerHeight / 4), slot = Math.round(localHour() * 12), k = `${W}x${H}@${slot}`;
    if (k === key) return; key = k; cv.width = W; cv.height = H;
    const colW = Math.min(560, innerWidth) / 4, c0 = Math.round((W - colW) / 2);
    const r = paintChatScene(skyAt(slot / 12), { W, H, paintScene, date: new Date(), col: [c0, Math.round(c0 + colW)] });
    built = { img: new ImageData(r.data, W, H), motes: r.motes, dark: r.dark }; cv.dataset.dark = String(r.dark); draw(0);
  };
  const draw = (t) => {
    ctx.putImageData(built.img, 0, 0);
    built.motes.forEach((m, i) => {
      const p = REDUCED ? 0.5 : (Math.sin(t / 1700 + i * 1.7) + 1) / 2, s = built.dark && i % 3 === 0 ? 2 : 1;
      ctx.globalAlpha = m.a * (0.2 + 0.8 * p); ctx.fillStyle = `rgb(${m.c.join(",")})`;
      ctx.fillRect(Math.round(m.x + (REDUCED ? 0 : Math.sin(t / 2300 + i) * 3)), Math.round(m.y - (REDUCED ? 0 : p * 5)), s, s);
    });
    ctx.globalAlpha = 1;
  };
  const tick = (t) => { raf = requestAnimationFrame(tick); if (t - last < 120) return; last = t; build(); draw(t); };
  build(); if (!REDUCED) raf = requestAnimationFrame(tick);
  const onResize = () => { build(); }; addEventListener("resize", onResize);
  const iv = setInterval(build, 60000);
  return { stop() { cancelAnimationFrame(raf); clearInterval(iv); removeEventListener("resize", onResize); cv.remove(); } };
}

let viewCleanup = null;
async function show(tab) {
  state.tab = tab;
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
  let busy = false; // 要在 setPlatforms 之前声明，否则 TDZ
  // olo 站的平台：看得见的气泡顶边 + 输入框顶边；文字区（所有气泡）是不能挡的；正在打字的气泡要离远点
  const spansIn = () => [...list.querySelectorAll(".msg > span")];
  // 最新一组气泡（同一轮 olo 连发的多条算一组）：只在整组最上面留 olo 的站位，组内不拆开
  const groupTop = () => { let li = list.lastElementChild; if (!li) return null; const role = li.classList.contains("user") ? "user" : "assistant"; while (li.previousElementSibling && li.previousElementSibling.classList.contains(role) && role === "assistant") li = li.previousElementSibling; return li; };
  const markPerch = () => { const top = groupTop(); list.querySelectorAll(".perch-top").forEach((x) => x !== top && x.classList.remove("perch-top")); top?.classList.add("perch-top"); };
  new MutationObserver(markPerch).observe(list, { childList: true });
  hero?.setPlatforms(() => {
    if (!list.isConnected) return [];
    const lr = list.getBoundingClientRect(), cr = form.getBoundingClientRect(), out = [];
    spansIn().forEach((sp, i, all) => {
      const r = sp.getBoundingClientRect(); if (r.top < lr.top + 8 || r.top > lr.bottom - 8 || r.width < 8) return;
      out.push({ x0: r.left + 6, x1: r.right - 6, y: r.top, key: "bubble-" + i, end: sp.parentElement.classList.contains("perch-top") && !sp.parentElement.classList.contains("user") });
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
        <div class="pages">${entries.map((e, i) => `
          <article class="notebook px-box page" style="--i:${i}"><time>${esc(e.entry_date)}</time>${i === 0 ? `<span class="stamp">新</span>` : ""}<h3>${esc(e.title)}</h3>${diaryBody(e.body)}<button class="link clip-btn" data-clip="${i}" data-testid="diary-clip-btn">▶ 看成小短片</button></article>`).join("") || `<p class="hint">还没有日记。聊几句之后再来吧。</p>`}</div>
      </div>`;
    sfx("page");
    api("/v1/mood?days=14").then((m) => drawMood(view.querySelector("[data-testid=mood] canvas"), m.days)).catch(() => {});
    view.querySelectorAll("[data-clip]").forEach((b) => b.addEventListener("click", () => openDiaryClip(entries[+b.dataset.clip], { form: state.profile.form, color: state.profile.color, ...look() }, state.profile.name, { sfx })));
    const btn = view.querySelector("[data-testid=write-diary]");
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "✎ 正在写…";
      try { await api("/v1/notebook/generate", { method: "POST", body: state.sessionId ? { session_id: state.sessionId } : {} }); await render(); }
      catch (e) {
        const er = view.querySelector(".error"); er.hidden = false;
        if (e.status === 402) {
          er.innerHTML = `今天的免费额度用完啦。<button class="link" data-testid="activate">模拟开通会员</button>`;
          er.querySelector("button").addEventListener("click", async () => { try { await api("/v1/subscription/activate", { method: "POST", body: { plan: "monthly" } }); render(); } catch (e2) { er.textContent = e2.status === 403 ? "olo+ 即将开放，敬请期待 ✨ 今天的额度明天会自动恢复。" : e2.message; } });
        } else er.textContent = e.message;
        btn.disabled = false; btn.textContent = "✎ 再试一次";
      }
    });
  };
  try { await render(); } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
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
// 相遇只走一次 —— 记在账号上（/v1/persona.onboarded），不是记在这台浏览器里
async function boot() {
  if (!state.profile && state.token) {
    try {
      const p = await api("/v1/persona");
      if (p.onboarded) { state.profile = { name: p.name, form: p.appearance?.form || "buddy", tone: p.tone }; LS.set("profile", state.profile); }
    } catch { /* 连不上/密钥不对：照常走相遇仪式 */ }
  }
  if (state.profile) main(); else onboarding();
}
document.fonts?.load('24px "FusionPixel"').finally(boot);
