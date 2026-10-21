import { oloSVG, setOloState, moodOf } from "./olo.js";

const CFG = window.OLO_CONFIG || { apiBase: "", token: "" };
const root = document.getElementById("root");
const LS = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem("olo." + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem("olo." + k, JSON.stringify(v)),
};
const state = {
  token: CFG.token || LS.get("token", ""),
  profile: LS.get("profile", null), // {name, tone, form, color}
  sessionId: LS.get("session", null),
  tab: "chat",
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- API ----------
async function api(path, { method = "GET", body, accept } = {}) {
  const res = await fetch(CFG.apiBase + path, {
    method,
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(accept ? { Accept: accept } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    const err = new Error(detail || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return accept === "text/event-stream" ? res : res.json();
}

async function ensureSession() {
  if (state.sessionId) return state.sessionId;
  const s = await api("/v1/sessions", { method: "POST" });
  state.sessionId = s.id; LS.set("session", s.id);
  return s.id;
}

async function streamTurn(text, onDelta) {
  const sid = await ensureSession();
  const res = await api(`/v1/sessions/${sid}/turns`, {
    method: "POST", accept: "text/event-stream",
    body: { client_msg_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), text },
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = "message", data = "{}";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      const payload = JSON.parse(data);
      if (ev === "delta") await onDelta(payload.text || "");
      if (ev === "error") throw new Error(payload.message || "对话出错了");
    }
  }
}

// ---------- 背景：星点与雾 ----------
function paintSky() {
  const sky = document.getElementById("sky");
  for (let i = 0; i < 40; i++) {
    const s = document.createElement("i");
    s.className = "star";
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 70 + "%";
    s.style.animationDelay = Math.random() * 4 + "s";
    sky.appendChild(s);
  }
  for (let i = 0; i < 4; i++) {
    const m = document.createElement("b");
    m.className = "mist";
    m.style.top = 45 + i * 12 + "%";
    m.style.animationDuration = 26 + i * 8 + "s";
    m.style.animationDelay = -i * 5 + "s";
    sky.appendChild(m);
  }
}

// ---------- 场景切换 ----------
async function swap(node, cls = "scene") {
  const old = root.firstElementChild;
  if (old) { old.classList.add("leave"); await sleep(450); old.remove(); }
  node.classList.add(cls, "enter");
  root.appendChild(node);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove("enter")));
  return node;
}

async function typeText(el, text, speed = 45) {
  el.textContent = "";
  for (const ch of text) { el.textContent += ch; await sleep(speed); }
}

function waitClick(el) { return new Promise((r) => el.addEventListener("click", r, { once: true })); }

// ---------- 引导：讲故事 ----------
const BEATS = [
  { art: "words", text: "城市里，每一句没说出口的话，都不会真的消失。" },
  { art: "river", text: "它们化成很轻的雾，飘到一片叫「雾里集」的河湾，凝成一粒粒发光的灯籽。" },
  { art: "boat", text: "摆渡人芦婆婆撑着小船，从属于你的那片雾里，捞起了一粒灯籽。" },
  { art: "seed", text: "它顺着屏幕的光，找到了你。" },
];
const WORDS = ["好累啊", "其实我很想你", "今天被夸了", "没关系的", "睡不着", "我做到了", "算了", "谢谢你"];

function beatArt(kind) {
  if (kind === "words") return `<div class="art art-words">${WORDS.map((w, i) => `<span style="--i:${i}">${w}</span>`).join("")}</div>`;
  if (kind === "river") return `<div class="art art-river"><div class="water"></div>${Array.from({ length: 9 }, (_, i) => `<i class="lamp" style="--i:${i}"></i>`).join("")}</div>`;
  if (kind === "boat") return `<div class="art art-boat"><div class="water"></div><div class="boat"><div class="granny"></div><div class="hull"></div><i class="lamp held"></i></div></div>`;
  return `<div class="art art-seed"><i class="lamp falling"></i><div class="phone"><div class="screen"></div></div></div>`;
}

async function onboarding() {
  // 0. 标题
  const title = await swap(h(`
    <section class="ob ob-title">
      <h1 class="logo">olo</h1>
      <p class="tagline">一颗会听你说话的灯籽</p>
      <button class="btn primary pulse" data-testid="start">轻点，开始相遇</button>
      <button class="link skip" data-testid="skip-story">跳过故事</button>
    </section>`));
  const skip = await Promise.race([
    waitClick(title.querySelector("[data-testid=start]")).then(() => false),
    waitClick(title.querySelector("[data-testid=skip-story]")).then(() => true),
  ]);

  // 1-4. 故事
  if (!skip) {
    for (let i = 0; i < BEATS.length; i++) {
      const b = BEATS[i];
      const node = await swap(h(`
        <section class="ob ob-beat" data-beat="${i}">
          ${beatArt(b.art)}
          <p class="story" aria-live="polite"></p>
          <div class="dots">${BEATS.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</div>
          <button class="btn ghost next" data-testid="next">继续</button>
        </section>`));
      const p = node.querySelector(".story");
      const btn = node.querySelector(".next");
      let skipped = false;
      btn.addEventListener("click", () => { skipped = true; }, { once: true });
      await typeText(p, b.text, 40).then(() => {});
      if (skipped) p.textContent = b.text;
      if (!skipped) await waitClick(btn);
    }
  }

  // 5. 破壳
  const hello = await swap(h(`
    <section class="ob ob-hatch">
      <div class="hatch-stage"><div class="seed-shell"></div><div class="olo-wrap pop">${oloSVG({ size: 200, state: "happy" })}</div></div>
      <p class="story big">嗨……是你在叫我吗？</p>
      <button class="btn primary" data-testid="hello">是我</button>
    </section>`));
  await waitClick(hello.querySelector("[data-testid=hello]"));

  const pick = { name: "olo", form: "buddy", color: "mint", tone: "curious" };

  // 6. 起名
  const nameNode = await swap(h(`
    <section class="ob ob-form">
      <div class="olo-wrap mini">${oloSVG({ size: 120 })}</div>
      <h2>给我起个名字吧</h2>
      <p class="hint">芦婆婆说，被叫过名字的灯籽，会亮得更久。</p>
      <input class="field" data-testid="name" maxlength="12" placeholder="olo" autocomplete="off" />
      <button class="btn primary" data-testid="name-ok">就叫这个</button>
    </section>`));
  const input = nameNode.querySelector("input");
  input.focus();
  await new Promise((r) => {
    const go = () => { pick.name = input.value.trim() || "olo"; r(); };
    nameNode.querySelector("[data-testid=name-ok]").addEventListener("click", go, { once: true });
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  });

  // 7. 选样子
  const FORMS = [["buddy", "小团子", "圆滚滚、爱蹦跶"], ["cloud", "云朵", "软软的，慢悠悠"], ["glow", "微光", "一团小光，话很少"]];
  const COLORS = [["mint", "薄荷"], ["sky", "天蓝"], ["sun", "暖黄"], ["blush", "樱粉"], ["lavender", "薰衣草"]];
  const formNode = await swap(h(`
    <section class="ob ob-form">
      <h2>${esc(pick.name)} 想长成什么样子？</h2>
      <div class="olo-wrap preview">${oloSVG({ size: 170 })}</div>
      <div class="choices" role="radiogroup">${FORMS.map(([id, label, d]) => `
        <button class="choice ${id === pick.form ? "on" : ""}" data-form="${id}" data-testid="form-${id}"><b>${label}</b><small>${d}</small></button>`).join("")}</div>
      <div class="swatches">${COLORS.map(([id, label]) => `<button class="swatch sw-${id} ${id === pick.color ? "on" : ""}" data-color="${id}" title="${label}" aria-label="${label}"></button>`).join("")}</div>
      <button class="btn primary" data-testid="form-ok">就是这样</button>
    </section>`));
  const preview = formNode.querySelector(".preview");
  const redraw = () => { preview.innerHTML = oloSVG({ size: 170, form: pick.form, color: pick.color, state: "happy" }); };
  formNode.querySelectorAll("[data-form]").forEach((b) => b.addEventListener("click", () => {
    pick.form = b.dataset.form;
    formNode.querySelectorAll("[data-form]").forEach((x) => x.classList.toggle("on", x === b));
    redraw();
  }));
  formNode.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => {
    pick.color = b.dataset.color;
    formNode.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b));
    redraw();
  }));
  await waitClick(formNode.querySelector("[data-testid=form-ok]"));

  // 8. 选性子
  const TONES = [["curious", "好奇", "「然后呢？那个人说了什么？」"], ["calm", "安静", "「嗯。我在。慢慢说。」"], ["playful", "损友", "「哟，这雨下得有点大啊。」"]];
  const toneNode = await swap(h(`
    <section class="ob ob-form">
      <div class="olo-wrap mini">${oloSVG({ size: 110, form: pick.form, color: pick.color })}</div>
      <h2>你希望 ${esc(pick.name)} 怎么陪你？</h2>
      <div class="cards">${TONES.map(([id, label, quote]) => `
        <button class="card ${id === pick.tone ? "on" : ""}" data-tone="${id}" data-testid="tone-${id}"><b>${label}</b><span>${quote}</span></button>`).join("")}</div>
      <p class="error" hidden></p>
      <button class="btn primary" data-testid="tone-ok">开始聊天</button>
    </section>`));
  toneNode.querySelectorAll("[data-tone]").forEach((b) => b.addEventListener("click", () => {
    pick.tone = b.dataset.tone;
    toneNode.querySelectorAll("[data-tone]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  const err = toneNode.querySelector(".error");
  for (;;) {
    await waitClick(toneNode.querySelector("[data-testid=tone-ok]"));
    try {
      await api("/v1/onboarding", { method: "POST", body: pick });
      break;
    } catch (e) {
      err.hidden = false;
      err.textContent = e.status === 401 ? "连接密钥不对，请在右上角设置里填写 OLO_API_TOKEN。" : e.message;
      if (e.status === 401) await askToken();
    }
  }
  state.profile = pick; LS.set("profile", pick);

  // 9. 过场：灯籽长大
  const trans = await swap(h(`
    <section class="ob ob-transition">
      <div class="olo-wrap grow">${oloSVG({ size: 220, form: pick.form, color: pick.color, state: "happy" })}</div>
      <p class="story big">从今天起，你说的每一句话，<br/>都会变成我们花园里的一滴雨。</p>
    </section>`));
  trans.querySelector(".olo-wrap").classList.add("go");
  await sleep(2200);
  return main();
}

async function askToken() {
  const t = prompt("请输入 OLO_API_TOKEN（docker compose 演示默认 change-me-dev-token）", state.token || "");
  if (t !== null) { state.token = t.trim(); LS.set("token", state.token); }
}

// ---------- 主界面 ----------
async function main() {
  const p = state.profile;
  const shell = await swap(h(`
    <section class="app" data-testid="app">
      <header class="topbar">
        <div class="who"><div class="avatar" data-testid="avatar">${oloSVG({ size: 54, form: p.form, color: p.color })}</div>
          <div><b data-testid="olo-name">${esc(p.name)}</b><small class="status">在花园里等你</small></div></div>
        <button class="icon" data-testid="settings" title="设置" aria-label="设置">⚙</button>
      </header>
      <div class="view" data-view></div>
      <nav class="tabs">
        <button data-tab="chat" data-testid="tab-chat">聊天</button>
        <button data-tab="garden" data-testid="tab-garden">花园</button>
        <button data-tab="diary" data-testid="tab-diary">日记</button>
      </nav>
    </section>`), "screen");
  shell.querySelector("[data-testid=settings]").addEventListener("click", settings);
  shell.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show(state.tab);
}

function settings() {
  const dlg = h(`
    <dialog class="sheet">
      <h3>设置</h3>
      <label>API Token<input class="field" name="token" value="${esc(state.token)}" /></label>
      <div class="row">
        <button class="btn ghost" value="reset" data-testid="reset">重新相遇（清空本地状态）</button>
        <button class="btn primary" value="save">保存</button>
      </div>
    </dialog>`);
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.addEventListener("click", (e) => {
    const v = e.target.value;
    if (v === "save") { state.token = dlg.querySelector("input").value.trim(); LS.set("token", state.token); dlg.close(); }
    if (v === "reset") { ["profile", "session"].forEach((k) => localStorage.removeItem("olo." + k)); location.reload(); }
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());
}

async function show(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const view = document.querySelector("[data-view]");
  view.classList.add("fade");
  await sleep(160);
  view.innerHTML = "";
  view.classList.remove("fade");
  if (tab === "chat") return chatView(view);
  if (tab === "garden") return gardenView(view);
  return diaryView(view);
}

function avatarState(s) {
  setOloState(document.querySelector("[data-testid=avatar]"), s);
  setOloState(document.querySelector(".chat-hero"), s);
  const st = document.querySelector(".topbar .status");
  if (st) st.textContent = { talking: "正在说话…", thinking: "在想…", sad: "在认真听", happy: "嫩芽竖起来了", idle: "在花园里等你" }[s];
}

async function chatView(view) {
  const p = state.profile;
  view.innerHTML = `
    <div class="chat">
      <div class="chat-hero">${oloSVG({ size: 120, form: p.form, color: p.color })}</div>
      <ol class="msgs" data-testid="messages" aria-live="polite"></ol>
      <form class="composer" data-testid="composer">
        <input class="field" name="text" data-testid="chat-input" placeholder="跟 ${esc(p.name)} 说点什么…" autocomplete="off" maxlength="500" />
        <button class="btn primary send" data-testid="send" aria-label="发送">➤</button>
      </form>
      <div class="suggest">${["你是谁呀？", "今天加班好累", "我今天被夸了！"].map((s) => `<button type="button" class="chip">${s}</button>`).join("")}</div>
    </div>`;
  const list = view.querySelector(".msgs");
  const form = view.querySelector("form");
  const input = form.querySelector("input");
  const add = (role, text) => {
    const li = h(`<li class="msg ${role}"><span></span></li>`);
    li.querySelector("span").textContent = text;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
    return li.querySelector("span");
  };
  try {
    if (state.sessionId) {
      const { messages } = await api(`/v1/sessions/${state.sessionId}/messages?limit=30`);
      messages.forEach((m) => add(m.role, m.body));
    }
  } catch { state.sessionId = null; }
  if (!list.children.length) add("assistant", `我是 ${p.name}。你说的每一句话，都会变成我们花园里的一滴雨。今天想聊点什么？`);

  view.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { input.value = c.textContent; form.requestSubmit(); }));
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; input.value = ""; form.dataset.busy = "1"; form.querySelector(".send").disabled = true;
    add("user", text);
    rain(view);
    const mood = moodOf(text);
    avatarState("thinking");
    const span = add("assistant typing", "");
    let full = "";
    try {
      await streamTurn(text, async (piece) => {
        if (!full) { span.parentElement.classList.remove("typing"); avatarState("talking"); }
        for (const ch of piece) { full += ch; span.textContent = full; list.scrollTop = list.scrollHeight; await sleep(18); }
      });
      avatarState(mood === "idle" ? "happy" : mood);
      setTimeout(() => avatarState("idle"), 2600);
    } catch (err) {
      span.parentElement.classList.remove("typing");
      span.parentElement.classList.add("error");
      span.textContent = err.status === 401 ? "连接密钥不对，点右上角 ⚙ 设置。" : err.status === 429 ? "说得太快啦，歇一下再来。" : `没连上：${err.message}`;
      avatarState("sad");
    } finally { busy = false; delete form.dataset.busy; form.querySelector(".send").disabled = false; input.focus(); }
  });
  input.focus();
}

function rain(view) {
  const drop = document.createElement("i");
  drop.className = "drop";
  drop.style.left = 40 + Math.random() * 20 + "%";
  view.appendChild(drop);
  setTimeout(() => drop.remove(), 1200);
}

const STAGE_ART = (level) => {
  const plants = [];
  const spots = [[18, 0], [34, 1], [50, 2], [66, 3], [82, 4], [26, 5], [74, 6], [58, 7]];
  const count = [0, 2, 4, 6, 8][level - 1] ?? 0;
  spots.slice(0, count).forEach(([x, i]) => {
    const flower = level >= 4 && i % 2 === 0;
    plants.push(`<g class="plant" style="--d:${i * 0.12}s" transform="translate(${x * 3.2} 150)">
      <path d="M0 0 C0 -14 2 -22 0 -${26 + (i % 3) * 8}" stroke="#4fae7c" stroke-width="3" fill="none"/>
      <path d="M0 -12 c-10 -2 -14 -10 -10 -14 c6 0 10 6 10 14z" fill="#7fd6a6"/>
      ${flower ? `<circle cy="-${28 + (i % 3) * 8}" r="7" fill="${["#ffb3c7", "#ffd98a", "#c9b6ff"][i % 3]}"/><circle cy="-${28 + (i % 3) * 8}" r="2.5" fill="#fff6c9"/>` : ""}
    </g>`);
  });
  const flies = level >= 5 ? Array.from({ length: 7 }, (_, i) => `<circle class="firefly" style="--d:${i * 0.4}s" cx="${30 + i * 40}" cy="${60 + (i % 3) * 20}" r="2.5" fill="#fff3a0"/>`).join("") : "";
  const lamp = level >= 3 ? `<g transform="translate(160 92)"><rect x="-2" y="0" width="4" height="58" fill="#6b5b4a"/><circle class="lamp-glow" cy="-4" r="9" fill="#ffe69a"/></g>` : "";
  return `<svg class="garden-art" viewBox="0 0 320 170" preserveAspectRatio="xMidYMax meet">
    <ellipse cx="160" cy="160" rx="150" ry="18" fill="#3e6b4f"/>
    <ellipse cx="160" cy="156" rx="140" ry="12" fill="#5c8f62"/>
    ${lamp}${plants.join("")}${flies}
  </svg>`;
};

async function gardenView(view) {
  view.innerHTML = `<div class="garden loading">花园正在醒来…</div>`;
  try {
    const g = await api("/v1/garden");
    view.innerHTML = `
      <div class="garden" data-testid="garden">
        <h2>${esc(state.profile.name)} 的花园 · <span data-testid="stage">${esc(g.stage || "")}</span></h2>
        <div class="garden-stage">${STAGE_ART(g.level)}</div>
        <div class="meter"><i style="width:${g.growth}%"></i></div>
        <p class="hint">第 ${g.level} / ${g.max_level} 阶段 · 雨滴 ${g.messages} · 日记 ${g.entries} · 花 ${g.insights} · 来过 ${g.days} 天</p>
        <ul class="milestones">${g.milestones.map((m) => `<li class="${m.reached ? "on" : ""}">${m.reached ? "✦" : "·"} ${esc(m.label)}</li>`).join("")}</ul>
        <h3>解锁的小故事</h3>
        <div class="lore">${(g.lore || []).map((l, i) => `<article style="--i:${i}"><b>${esc(l.title)}</b><p>${esc(l.body)}</p></article>`).join("") || `<p class="hint">多聊几句，故事会慢慢冒出来。</p>`}</div>
      </div>`;
  } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

async function diaryView(view) {
  view.innerHTML = `<div class="diary loading">翻开日记本…</div>`;
  const render = async () => {
    const { entries } = await api("/v1/notebook");
    view.innerHTML = `
      <div class="diary" data-testid="diary">
        <div class="diary-head"><h2>${esc(state.profile.name)} 的日记</h2>
          <button class="btn primary" data-testid="write-diary">让 ${esc(state.profile.name)} 写今天的日记</button></div>
        <p class="error" hidden></p>
        <div class="pages">${entries.map((e, i) => `
          <article class="page" style="--i:${i}"><time>${esc(e.entry_date)}</time><h3>${esc(e.title)}</h3><p>${esc(e.body)}</p></article>`).join("") || `<p class="hint">还没有日记。聊几句之后再来吧。</p>`}</div>
      </div>`;
    const btn = view.querySelector("[data-testid=write-diary]");
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "正在写…";
      try {
        await api("/v1/notebook/generate", { method: "POST", body: state.sessionId ? { session_id: state.sessionId } : {} });
        await render();
      } catch (e) {
        const er = view.querySelector(".error");
        er.hidden = false;
        if (e.status === 402) {
          er.innerHTML = `今天的免费额度用完啦。<button class="link" data-testid="activate">模拟开通会员</button>`;
          er.querySelector("button").addEventListener("click", async () => { await api("/v1/subscription/activate", { method: "POST", body: { plan: "monthly" } }); render(); });
        } else er.textContent = e.message;
        btn.disabled = false; btn.textContent = "再试一次";
      }
    });
  };
  try { await render(); } catch (e) { view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------- 启动 ----------
paintSky();
if (state.profile) main(); else onboarding();
