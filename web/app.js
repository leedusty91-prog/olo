import { oloSprite, drawOlo, canvas, P, ticker, REDUCED } from "./pixel.js";
import { mountScene } from "./scenes.js";
import { mountGarden } from "./garden.js";
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
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    const err = new Error(detail || `请求失败 (${res.status})`); err.status = res.status; throw err;
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
  let buf = "";
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
      if (ev === "error") throw new Error(payload.message || "对话出错了");
    }
  }
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
  };
  resize(); addEventListener("resize", resize);
  // 12 级细分色带（从深梅到暖砖），台阶足够小不会出现硬条纹
  const stops = [[42, 20, 34], [64, 30, 44], [94, 46, 54], [118, 60, 58]];
  const bands = Array.from({ length: 14 }, (_, i) => { const k = i / 13 * (stops.length - 1), a = stops[Math.floor(k)], b = stops[Math.min(stops.length - 1, Math.floor(k) + 1)], f = k % 1; return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(",")})`; });
  ticker.add((t) => {
    const bh = c.height / bands.length;
    bands.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(0, Math.floor(i * bh), c.width, Math.ceil(bh)); });
    motes.forEach((m) => {
      if (!REDUCED) { m.y -= 0.06 * m.z; m.x += Math.sin((t + m.p) / 20) * 0.03; if (m.y < 0) { m.y = c.height; m.x = Math.random() * c.width; } }
      const tw = (t + m.p) % 40;
      ctx.fillStyle = m.z > 3 ? (tw < 3 ? "#fff3dc" : "#ffc46b") : tw < 2 ? "#ffe9c8" : m.z > 2 ? "#e08a6a" : "#8a4a52";
      ctx.globalAlpha = m.z > 3 ? 0.95 : 0.7;
      if (m.z > 3.6) { ctx.globalAlpha = 0.25; ctx.fillRect(Math.round(m.x - pointer.x * m.z * 3) - 1, Math.round(m.y - pointer.y * m.z * 2), 3, 1); ctx.fillRect(Math.round(m.x - pointer.x * m.z * 3), Math.round(m.y - pointer.y * m.z * 2) - 1, 1, 3); ctx.globalAlpha = 0.95; }
      ctx.fillRect(Math.round(m.x - pointer.x * m.z * 3), Math.round(m.y - pointer.y * m.z * 2), 1, 1);
    });
    ctx.globalAlpha = 1;
  });
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
  { who: "芦婆婆", text: "「这一粒，是你那片雾里长出来的。我撑船送它过去。」" },
  { who: "旁白", text: "它顺着屏幕的光，找到了你。" },
];
const WORDS = ["好累啊", "其实我很想你", "今天被夸了", "没关系的", "睡不着", "我做到了", "算了", "谢谢你"];

const BEAT_AMB = ["city", "river", "boat", "room"];
async function onboarding() {
  ambient("title");
  const title = await swap(h(`
    <section>
      <div class="title-olo"></div>
      <h1 class="logo">olo</h1>
      <p class="tagline">一颗会听你说话的灯籽</p>
      <button class="btn px-box blink-cta" data-testid="start">▶ 开始相遇</button>
      <button class="link" data-testid="skip-story">跳过故事</button>
    </section>`));
  title.querySelector(".title-olo").appendChild(oloSprite({ state: "happy", scale: 5 }));
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
      ambient(BEAT_AMB[i]);
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
  olo.style.opacity = "1"; olo.animate?.([{ transform: "scale(.2)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 420, easing: "steps(5)" });
  burst(stage, 22); shake(hello); sfx("happy");
  hello.querySelector("[data-testid=hello]").disabled = false;
  await waitClick(hello.querySelector("[data-testid=hello]"));

  const pick = { name: "olo", form: "buddy", color: "sun", tone: "curious" };
  ambient("title");

  // 起名
  const nameNode = await swap(h(`
    <section>
      <div class="panel px-box dark">
        <div class="mini"></div>
        <h2>给我起个名字吧</h2>
        <p class="hint">芦婆婆说，被叫过名字的灯籽，会亮得更久。</p>
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

  // 选样子
  const FORMS = [["buddy", "小团子", "圆豆子 · 爱蹦跶"], ["cloud", "云朵", "软软的 · 慢悠悠"], ["glow", "微光", "小火苗 · 话很少"]];
  const COLORS = [["sun", "琥珀"], ["blush", "蜜桃"], ["lavender", "玫瑰"], ["mint", "青瓷"], ["sky", "湖青"]];
  const formNode = await swap(h(`
    <section>
      <div class="panel px-box dark">
        <h2>${esc(pick.name)} 想长成什么样子？</h2>
        <div class="preview"></div>
        <div class="choices">${FORMS.map(([id, label, d]) => `<button class="choice px-box ${id === pick.form ? "on" : ""}" data-form="${id}" data-testid="form-${id}"><span class="ico"></span><b>${label}</b><small>${d}</small></button>`).join("")}</div>
        <div class="swatches">${COLORS.map(([id, label]) => `<button class="swatch sw-${id} ${id === pick.color ? "on" : ""}" data-color="${id}" title="${label}" aria-label="${label}"></button>`).join("")}</div>
        <button class="btn px-box" data-testid="form-ok">就是这样</button>
      </div>
    </section>`), { transition: "wipe" });
  const big = oloSprite({ state: "happy", scale: 6 });
  formNode.querySelector(".preview").appendChild(big);
  const icons = [...formNode.querySelectorAll("[data-form]")].map((b) => { const s = oloSprite({ form: b.dataset.form, scale: 2 }); b.querySelector(".ico").appendChild(s); return s; });
  const refresh = () => { big.olo.set({ form: pick.form, color: pick.color, state: "happy" }); icons.forEach((s) => s.olo.set({ color: pick.color })); burst(formNode.querySelector(".preview"), 10); };
  formNode.querySelectorAll("[data-form]").forEach((b) => b.addEventListener("click", () => { pick.form = b.dataset.form; formNode.querySelectorAll("[data-form]").forEach((x) => x.classList.toggle("on", x === b)); refresh(); }));
  formNode.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => { pick.color = b.dataset.color; formNode.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b)); refresh(); }));
  await waitClick(formNode.querySelector("[data-testid=form-ok]"));

  // 选性子
  const TONES = [["curious", "好奇", "「然后呢？」", "thinking"], ["calm", "安静", "「嗯，我在。」", "idle"], ["playful", "损友", "「哟，雨好大」", "happy"]];
  const toneNode = await swap(h(`
    <section>
      <div class="panel px-box dark">
        <div class="mini"></div>
        <h2>你希望 ${esc(pick.name)} 怎么陪你？</h2>
        <div class="cards">${TONES.map(([id, label, quote]) => `<button class="choice px-box ${id === pick.tone ? "on" : ""}" data-tone="${id}" data-testid="tone-${id}"><b>${label}</b><small>${quote}</small></button>`).join("")}</div>
        <p class="error" hidden></p>
        <button class="btn px-box blink-cta" data-testid="tone-ok">开始聊天 ▶</button>
      </div>
    </section>`), { transition: "wipe" });
  const tm = oloSprite({ form: pick.form, color: pick.color, state: "thinking", scale: 4 });
  toneNode.querySelector(".mini").appendChild(tm);
  toneNode.querySelectorAll("[data-tone]").forEach((b) => b.addEventListener("click", () => {
    pick.tone = b.dataset.tone; tm.olo.set({ state: TONES.find((x) => x[0] === pick.tone)[3] });
    toneNode.querySelectorAll("[data-tone]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  const err = toneNode.querySelector(".error");
  for (;;) {
    await waitClick(toneNode.querySelector("[data-testid=tone-ok]"));
    try { await api("/v1/onboarding", { method: "POST", body: pick }); break; }
    catch (e) {
      err.hidden = false; shake(toneNode.querySelector(".panel"));
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
  await sleep(1800);
  return main(true);
}

async function askToken() {
  const t = prompt("请输入 OLO_API_TOKEN（docker compose 演示默认 change-me-dev-token）", state.token || "");
  if (t !== null) { state.token = t.trim(); LS.set("token", state.token); }
}

// ---------- 主界面 ----------
let avatar, hero;
const STATUS = { talking: "正在说话…", thinking: "在想…", sad: "在认真听", happy: "嫩芽竖起来了", idle: "在花园里等你" };
let lastMood = "idle";
function setMood(s) {
  if (s !== lastMood) { if (s === "happy") sfx("happy"); else if (s === "sad") sfx("sad"); else if (s === "thinking") sfx("think"); lastMood = s; }
  avatar?.olo.set({ state: s }); hero?.setState(s);
  const st = document.querySelector(".topbar small"); if (st) st.textContent = STATUS[s];
}

async function main(fromOnboarding = false) {
  const p = state.profile;
  const shell = await swap(h(`
    <section class="app" data-testid="app">
      <header class="topbar px-box">
        <div class="who"><span data-testid="avatar"></span><div><b data-testid="olo-name">${esc(p.name)}</b><small>在花园里等你</small></div></div>
        <div class="actions"><button class="icon px-box" data-testid="settings" title="设置" aria-label="设置">⚙</button></div>
      </header>
      <div class="view" data-view></div>
      <nav class="tabs">
        <button class="px-box" data-tab="chat" data-testid="tab-chat"><span class="ico">✉</span>聊天</button>
        <button class="px-box" data-tab="garden" data-testid="tab-garden"><span class="ico">✿</span>花园</button>
        <button class="px-box" data-tab="diary" data-testid="tab-diary"><span class="ico">✎</span>日记</button>
      </nav>
    </section>`), { transition: fromOnboarding ? "wipe" : "drop" });
  shell.classList.remove("scene");
  shell.querySelector(".topbar .actions").prepend(muteBtn);
  avatar = oloSprite({ form: p.form, color: p.color, scale: 2 });
  shell.querySelector("[data-testid=avatar]").appendChild(avatar);
  shell.querySelector("[data-testid=settings]").addEventListener("click", settings);
  shell.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show(state.tab);
}

function settings() {
  const dlg = h(`
    <dialog class="sheet px-box">
      <h3>设置</h3>
      <label>API Token<input class="field px-box" value="${esc(state.token)}" /></label>
      <div class="row">
        <button class="btn ghost px-box" value="reset" data-testid="reset">重新相遇</button>
        <button class="btn px-box" value="save">保存</button>
      </div>
    </dialog>`);
  document.body.appendChild(dlg); dlg.showModal();
  dlg.addEventListener("click", (e) => {
    const v = e.target.value;
    if (v === "save") { state.token = dlg.querySelector("input").value.trim(); LS.set("token", state.token); dlg.close(); }
    if (v === "reset") { ["profile", "session"].forEach((k) => localStorage.removeItem("olo." + k)); location.reload(); }
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
}

let viewCleanup = null;
async function show(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const view = document.querySelector("[data-view]");
  if (view.firstElementChild) { view.classList.add("leaving"); await sleep(150); view.classList.remove("leaving"); }
  viewCleanup?.(); viewCleanup = null; hero = null;
  view.innerHTML = "";
  if (tab === "chat") return chatView(view);
  if (tab === "garden") return gardenView(view);
  return diaryView(view);
}

// 聊天顶部的小舞台：olo + 地面 + 雨滴 + 涟漪
function mountHero(host, p) {
  const HW = 96, HH = 40;
  const [c, ctx] = canvas(HW, HH);
  host.appendChild(c);
  const s = { state: "idle" }, drops = [];
  host.dataset.state = "idle";
  const draw = (t) => {
    const T = t | 0;
    ["#5a2a44", "#8a3a52", "#c25a55", "#e8875a"].forEach((col, i) => P(ctx, 0, i * 8, col, HW, 8));
    for (let i = 1; i < 4; i++) for (let x = i % 2; x < HW; x += 2) P(ctx, x, i * 8 - 1, ["#5a2a44", "#8a3a52", "#c25a55", "#e8875a"][i]);
    for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) { const d = Math.hypot(x, y); if (d < 8 && !(y > 2 && y % 2 === 0)) P(ctx, 74 + x, 30 + y, d < 5 ? "#fff3c8" : "#ffd27a"); }
    for (let x = 0; x < HW; x++) { const hh = 30 - Math.round(2 * Math.sin(x * 0.12) + Math.sin(x * 0.31)); P(ctx, x, hh, "#7a3a58", 1, 40 - hh); }
    for (let i = 0; i < 3; i++) { const cx = ((i * 41 + t * 0.15 * (i + 1)) % (HW + 30)) - 30; P(ctx, cx, 5 + i * 6, "#f2a07a", 22, 1); P(ctx, cx + 4, 4 + i * 6, "#ffc89a", 12, 1); }
    P(ctx, 0, 34, "#6a7a34", HW, 6); for (let x = 0; x < HW; x += 3) P(ctx, x, 33 + (x % 2), x % 6 ? "#a8b84a" : "#d8c860");
    [[10, 4], [80, 6], [88, 3], [18, 5]].forEach(([x, hgt], i) => { for (let k = 0; k < hgt; k++) P(ctx, x + (k === hgt - 1 ? ((T >> 4) + i) % 2 : 0), 33 - k, "#5f9a33"); P(ctx, x - 1, 33 - hgt, "#b8e05a", 3, 1); });
    for (let i = 0; i < 5; i++) { const fx = (i * 23 + Math.sin((t + i * 9) / 12) * 4 + 6) % HW, fy = 14 + ((i * 7) % 14) + Math.cos((t + i * 5) / 9) * 2; if ((T + i * 5) % 20 < 14) { P(ctx, fx, fy, "#fff1b8"); ctx.globalAlpha = 0.3; P(ctx, fx - 1, fy, "#fff1b8", 3, 1); P(ctx, fx, fy - 1, "#fff1b8", 1, 3); ctx.globalAlpha = 1; } }
    drawOlo(ctx, { form: p.form, color: p.color, state: s.state, t, ox: 32, oy: 6 });
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.y += 1.1;
      if (d.y > 33) { d.r = (d.r || 0) + 0.5; ctx.globalAlpha = 1 - d.r / 6; P(ctx, d.x - d.r, 34, "#ffe9c8", 1, 1); P(ctx, d.x + d.r, 34, "#ffe9c8", 1, 1); ctx.globalAlpha = 1; if (d.r > 5) drops.splice(i, 1); }
      else P(ctx, d.x, d.y, "#ffd9a8", 1, 2);
    }
  };
  const off = ticker.addFast(draw);
  return {
    setState(st) { s.state = st; host.dataset.state = st; draw(ticker.ft); },
    rain(n = 6) { if (REDUCED) return; for (let i = 0; i < n; i++) drops.push({ x: 8 + Math.random() * 80, y: -Math.random() * 20 }); },
    stop: off,
  };
}

const SAD = ["难过", "累", "烦", "哭", "焦虑", "压力", "孤独", "失眠", "崩溃", "委屈", "害怕", "不开心"];
const HAPPY = ["开心", "高兴", "太好了", "哈哈", "成功", "喜欢", "谢谢", "棒", "终于", "被夸"];
const moodOf = (t) => (SAD.some((w) => t.includes(w)) ? "sad" : HAPPY.some((w) => t.includes(w)) ? "happy" : "idle");

async function chatView(view) {
  const p = state.profile;
  view.innerHTML = `
    <div class="chat">
      <div class="chat-hero px-box" data-testid="hero"></div>
      <ol class="msgs" data-testid="messages" aria-live="polite"></ol>
      <div class="suggest">${["你是谁呀？", "今天加班好累", "我今天被夸了！"].map((s) => `<button type="button" class="chip px-box">${s}</button>`).join("")}</div>
      <form class="composer" data-testid="composer">
        <input class="field px-box" data-testid="chat-input" placeholder="跟 ${esc(p.name)} 说点什么…" autocomplete="off" maxlength="500" />
        <button class="btn px-box send" data-testid="send" aria-label="发送">▶</button>
      </form>
    </div>`;
  ambient("chat");
  hero = mountHero(view.querySelector(".chat-hero"), p);
  viewCleanup = hero.stop;
  const list = view.querySelector(".msgs"), form = view.querySelector("form"), input = form.querySelector("input");
  const add = (role, text) => {
    const li = h(`<li class="msg ${role}"><span class="px-box"></span></li>`);
    li.querySelector("span").textContent = text;
    list.appendChild(li); list.scrollTop = list.scrollHeight;
    return li.querySelector("span");
  };
  try {
    if (state.sessionId) { const { messages } = await api(`/v1/sessions/${state.sessionId}/messages?limit=30`); messages.forEach((m) => (m.role === "assistant" ? String(m.body).split(/\n\s*\n/).filter((x) => x.trim()) : [m.body]).forEach((b) => add(m.role, b))); }
  } catch { state.sessionId = null; }
  if (!list.children.length) add("assistant", `我是 ${p.name}。你说的每一句话，都会变成我们花园里的一滴雨。今天想聊点什么？`);
  view.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { input.value = c.textContent; form.requestSubmit(); }));
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; input.value = ""; form.dataset.busy = "1"; form.querySelector(".send").disabled = true;
    add("user", text); hero.rain(8); sfx("send");
    const mood = moodOf(text);
    setMood("thinking");
    let span = add("assistant typing", ""); span.parentElement.classList.add("typing");
    let full = "", cur = "", pipe = false, bubbles = 1;
    const newBubble = async () => {
      span.textContent = cur.trim();
      if (bubbles >= 4) { cur += "\n"; return; }
      bubbles++; cur = "";
      span = add("assistant typing", ""); span.parentElement.classList.add("typing"); setMood("thinking");
      await sleep(550 + Math.random() * 350);
      span.parentElement.classList.remove("typing"); setMood("talking"); sfx("receive");
    };
    try {
      await streamTurn(text, async (piece) => {
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
      if (!span.textContent) span.parentElement.remove();
      setMood(mood === "idle" ? "happy" : mood);
      setTimeout(() => { if (!busy) setMood("idle"); }, 2600);
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
  } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
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
        <div class="pages">${entries.map((e, i) => `
          <article class="notebook px-box page" style="--i:${i}"><time>${esc(e.entry_date)}</time>${i === 0 ? `<span class="stamp">新</span>` : ""}<h3>${esc(e.title)}</h3><p>${esc(e.body)}</p></article>`).join("") || `<p class="hint">还没有日记。聊几句之后再来吧。</p>`}</div>
      </div>`;
    sfx("page");
    const btn = view.querySelector("[data-testid=write-diary]");
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "✎ 正在写…";
      try { await api("/v1/notebook/generate", { method: "POST", body: state.sessionId ? { session_id: state.sessionId } : {} }); await render(); }
      catch (e) {
        const er = view.querySelector(".error"); er.hidden = false;
        if (e.status === 402) {
          er.innerHTML = `今天的免费额度用完啦。<button class="link" data-testid="activate">模拟开通会员</button>`;
          er.querySelector("button").addEventListener("click", async () => { await api("/v1/subscription/activate", { method: "POST", body: { plan: "monthly" } }); render(); });
        } else er.textContent = e.message;
        btn.disabled = false; btn.textContent = "✎ 再试一次";
      }
    });
  };
  try { await render(); } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------- 启动 ----------
document.fonts?.load('24px "FusionPixel"').finally(() => { if (state.profile) main(); else onboarding(); });
