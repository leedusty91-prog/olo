// 聊天模式的 olo：不再关在小框里，而是住在全屏覆盖层上——在各条气泡顶边、输入框边上换着待，
// 不挡文字、不总守着最新一条；可以抓起来扔到屏幕任何地方，撞墙/落到气泡顶上会挤压回弹，停稳后蹦回最新气泡。
// 覆盖层本身 pointer-events: none，只有角色身体那一小块能点到，不挡阅读和点按。
import { drawOlo, canvas, ticker, REDUCED } from "./pixel.js";
import { sfx } from "./audio.js";
import { localHour, skyAt, sunProgress } from "./skytime.js?v=20261026e";

const SW = 48, SH = 44, FOOT = 36;                    // 离屏画布：角色画在 (8,8)，脚底在 y≈36

export function mountStage(p, parent = document.body) {
  const S = () => (innerWidth < 520 ? 4 : 4);   // 主页角色放大：手机、桌面都是 4 倍（原来 2 / 3），整数倍保持像素锐利
  const layer = document.createElement("div");
  layer.className = "olo-stage"; layer.setAttribute("aria-hidden", "true");
  const actor = document.createElement("div");
  actor.className = "olo-actor"; actor.dataset.testid = "hero";
  const [c, ctx] = canvas(SW, SH, "olo-actor-px");
  const hit = document.createElement("div"); hit.className = "olo-hit"; hit.dataset.testid = "hero-hit";
  const zz = document.createElement("span"); zz.className = "olo-zz"; zz.textContent = "z z"; zz.hidden = true;
  actor.append(c, hit, zz); layer.appendChild(actor); parent.appendChild(layer);
  const s = { state: "idle" };
  actor.dataset.state = "idle"; actor.dataset.drag = "home"; actor.dataset.squash = ""; actor.dataset.perch = ""; actor.dataset.pose = "";
  const relight = () => { const hr = localHour(), sk = skyAt(hr), sp = sunProgress(hr); actor.dataset.daypart = sk.phase; actor.dataset.celestial = sp !== null && sk.sun > 0.15 ? "sun" : "moon"; };
  relight();

  // 平台：由聊天视图提供（看得见的气泡顶边 + 输入框顶边）；没有就站在屏幕底部
  // 选落脚点：带权重随机，不总是最新一条；脚下踩边，身体不能挡住任何气泡的文字、不靠近正在打字的气泡；
  // 站定后待一会儿（8–20 秒）再换地方，同一条边上走过去，换边就蹦过去；闲久了会坐下 / 打盹。
  let platformsFn = () => [], blocksFn = () => [], busyFn = () => null;
  const ground = () => ({ x0: 0, x1: innerWidth, y: innerHeight - 4, key: "floor" });
  const plats = () => { const l = platformsFn(); return l.length ? l : [ground()]; };
  const foot = () => { const k = S(); return { w: 22 * k, h: 26 * k }; };
  const rectOf = (x, y) => { const { w, h } = foot(); return { l: x - w / 2, r: x + w / 2, t: y - h, b: y - 2 }; };
  const hits = (a, b, pad = 0) => a.l < b.right + pad && a.r > b.left - pad && a.t < b.bottom + pad && a.b > b.top - pad;
  const clear = (x, y) => {
    const R = rectOf(x, y); if (R.l < 4 || R.r > innerWidth - 4 || R.t < 52) return false;
    if (blocksFn().some((b) => hits(R, b, 2))) return false;
    const busy = busyFn(); return !(busy && hits(R, busy, 24));
  };
  const posOf = (sp, l = plats()) => { const q = l.find((z) => z.key === sp.key); return q ? [q.x0 + sp.f * (q.x1 - q.x0), q.y, q] : null; };
  let spot = null, dwellUntil = 0, perchLog = [];
  function candidates() {
    const l = plats(), out = [], { w } = foot(), busy = busyFn(), last = l.filter((q) => q.key.startsWith("bubble-")).pop();
    for (const q of l) {
      const span = q.x1 - q.x0; if (span < w) continue;
      const fs = [0.12, 0.3, 0.5, 0.7, 0.88].filter((f) => !(q.end && f > 0.75) && clear(q.x0 + f * span, q.y));  // 不站在回复文字的末端
      for (const f of fs) {
        const x = q.x0 + f * span;
        let wt = q.key === "composer" ? 0.9 : q.key === "floor" ? 0.6 : 1;
        if (q === last) wt *= busy ? 0.4 : 1.3;          // 最新一条：常去，但不总去
        if (spot && spot.key === q.key && Math.abs(spot.f - f) < 0.1) wt *= 0.05;  // 别原地重选
        if (spot && D.x) wt *= 1 / (1 + Math.hypot(x - D.x, q.y - D.y) / 700);
        if (busy && Math.abs(q.y - busy.top) < 260) wt *= 1.4;   // 打字时凑近一点
        out.push({ key: q.key, f, wt: wt / fs.length });   // 每块平台总权重相同，长气泡不占便宜
      }
    }
    return out;
  }
  function pickSpot() {
    const c = candidates();
    if (!c.length) return { key: plats().slice(-1)[0].key, f: 0.85 };
    let r = Math.random() * c.reduce((a, b) => a + b.wt, 0);
    for (const z of c) if ((r -= z.wt) <= 0) return z;
    return c[c.length - 1];
  }
  const dwell = () => (dwellUntil = now() + 8000 + Math.random() * 12000);
  const spotOk = () => { if (!spot) return false; const p0 = posOf(spot); return !!p0 && clear(p0[0], p0[1]); };
  function moveTo(sp, why) {
    const prev = spot; spot = sp; dwell(); setPose("");
    perchLog.push(sp.key); if (perchLog.length > 30) perchLog.shift();
    actor.dataset.perch = sp.key; actor.dataset.why = why || "";
    if (D.mode !== "home" && D.mode !== "walk") return;
    if (prev && prev.key === sp.key && !REDUCED) { setMode("walk"); return; }
    startHop("happy");
  }
  const setPose = (v) => { actor.dataset.pose = v; zz.hidden = v !== "sleep"; };
  const D = { mode: "home", x: 0, y: 0, vx: 0, vy: 0, sx: 1, sy: 1, ss: 0, sAxis: "y", face: "held", still: 0, last: [], raf: 0, boingAt: 0, hop: null, key: "", hidden: false };
  const now = () => performance.now();
  const setMode = (m) => { D.mode = m; actor.dataset.drag = m; };
  const boing = (v) => { if (v > 4 && now() - D.boingAt > 140) { D.boingAt = now(); sfx("boing"); } };

  const draw = (t = ticker.ft) => {
    ctx.clearRect(0, 0, SW, SH);
    const st = D.mode === "home" ? s.state : D.mode === "hop" ? (s.state === "idle" ? "happy" : s.state) : D.face;
    drawOlo(ctx, { form: p.form, color: p.color, hair: p.hair, eyes: p.eyes, cheeks: p.cheeks, state: actor.dataset.pose === "sleep" && D.mode === "home" && st === "idle" ? "sleep" : st, t, ox: 8, oy: 8 });
  };
  const place = () => {
    const k = S();
    actor.style.width = SW * k + "px"; actor.style.height = SH * k + "px";
    actor.style.transform = `translate(${Math.round(D.x - (SW / 2) * k)}px, ${Math.round(D.y - FOOT * k)}px)`;
    c.style.transform = `scale(${D.sx.toFixed(3)}, ${D.sy.toFixed(3)})`;
    c.style.transformOrigin = `50% ${(FOOT / SH) * 100}%`;
    if ((Math.abs(D.sx - 1) > 0.04 || Math.abs(D.sy - 1) > 0.04) && !actor.dataset.squash.includes(D.mode)) actor.dataset.squash += " " + D.mode;
  };
  const target = () => { if (!spotOk()) { if (!spot || D.mode === "home" || D.mode === "walk" || !posOf(spot)) { const was = spot; spot = pickSpot(); actor.dataset.perch = spot.key; if (was && D.mode === "home") { dwell(); startHop("happy"); } } } const p0 = posOf(spot) || [innerWidth - 60, innerHeight - 4]; return [p0[0], p0[1], spot.key]; };
  const startHop = (face) => {
    const [tx, ty] = target();
    if (REDUCED) { D.x = tx; D.y = ty; D.sx = D.sy = 1; setMode("home"); return; }
    D.hop = { t0: now(), x0: D.x, y0: D.y, dur: Math.min(0.9, 0.35 + Math.hypot(tx - D.x, ty - D.y) / 900) };
    D.face = face || "happy"; setMode(D.mode === "fling" || D.mode === "return" ? "return" : "hop");
  };

  const frame = () => {
    D.raf = requestAnimationFrame(frame);
    if (D.hidden) return;
    const [tx, ty, key] = target();
    if (D.mode === "home") {
      D.x = tx; D.y = ty; D.sx += ((actor.dataset.pose === "sit" ? 1.06 : 1) - D.sx) * 0.3; D.sy += ((actor.dataset.pose === "sit" ? 0.92 : 1) - D.sy) * 0.3;
      if (!REDUCED && now() > dwellUntil) {
        if (s.state === "idle" && !actor.dataset.pose && Math.random() < 0.3) { setPose(Math.random() < 0.5 ? "sit" : "sleep"); dwell(); draw(); }
        else moveTo(pickSpot(), "wander");
      }
    } else if (D.mode === "walk") {
      const dx = tx - D.x, st = Math.min(Math.abs(dx), 1.3 * S() / 3 * 2);
      D.x += Math.sign(dx) * st; D.y = ty - Math.abs(Math.sin(now() / 90)) * 3; D.dir = Math.sign(dx);
      if (Math.abs(dx) < 1) { D.x = tx; D.y = ty; setMode("home"); }
    } else if (D.mode === "held") {
      const sp = Math.hypot(D.vx, D.vy), k = Math.min(0.32, sp * 0.02), ax = Math.abs(D.vx) > Math.abs(D.vy);
      D.sx += ((ax ? 1 + k : 1 - k * 0.6) - D.sx) * 0.4; D.sy += ((ax ? 1 - k * 0.6 : 1 + k) - D.sy) * 0.4;
      D.vx *= 0.8; D.vy *= 0.8;
    } else if (D.mode === "fling") {
      const k = S(), G = 0.38 * k, half = 10 * k, py = D.y;
      D.vy += G; D.x += D.vx; D.y += D.vy; D.vx *= 0.99;
      if (D.x < half || D.x > innerWidth - half) { D.x = Math.max(half, Math.min(innerWidth - half, D.x)); boing(Math.abs(D.vx)); D.vx *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vx) * 0.03); D.sAxis = "x"; }
      if (D.y < 24 * k) { D.y = 24 * k; D.vy = Math.abs(D.vy) * 0.5; }
      // 落到某个平台（气泡顶 / 输入框顶 / 屏幕底）上
      const land = D.vy > 0 && plats().concat([ground()]).find((q) => py <= q.y + 0.5 && D.y >= q.y && D.x >= q.x0 - 4 && D.x <= q.x1 + 4);
      if (land) {
        const imp = D.vy; D.y = land.y;
        if (imp > 2.6 * k) { boing(imp); D.ss = Math.min(0.4, imp * 0.035); D.sAxis = "y"; D.vy = -imp * 0.58; D.vx *= 0.85; }
        else { D.vy = 0; D.vx *= 0.85; D.on = land; }
      } else if (D.on && D.vy === 0) {
        if (D.x < D.on.x0 - 4 || D.x > D.on.x1 + 4) D.on = null; else D.y = D.on.y;   // 从气泡边上滑下去就继续掉
        if (D.on) D.vy = 0;
      }
      if (D.vy !== 0) D.on = null;
      D.ss *= 0.8;
      const sp = Math.hypot(D.vx, D.vy), kk = D.on ? 0 : Math.min(0.22, sp * 0.015), ax = D.sAxis === "x";
      D.sx = ax ? 1 - D.ss : 1 + D.ss - kk * 0.5; D.sy = ax ? 1 + D.ss * 0.6 : 1 - D.ss + kk;
      D.still = D.on && Math.abs(D.vx) < 0.4 && D.ss < 0.02 ? D.still + 1 : 0;
      if (D.still > 14) {
        if (D.on && D.on.x1 - D.on.x0 > 1 && clear(D.x, D.on.y)) { spot = { key: D.on.key, f: (D.x - D.on.x0) / (D.on.x1 - D.on.x0) }; actor.dataset.perch = spot.key; dwell(); setMode("home"); }
        else { spot = pickSpot(); actor.dataset.perch = spot.key; dwell(); startHop("happy"); }
      }
    } else if (D.mode === "hop" || D.mode === "return") {
      // 一条抛物线蹦到目标（目标随滚动实时更新）
      const H = D.hop, p01 = Math.min(1, (now() - H.t0) / 1000 / H.dur), e = 1 - (1 - p01) ** 2;
      const lift = 30 * S() / 3 + Math.abs(tx - H.x0) * 0.12 + Math.max(0, H.y0 - ty) * 0.3;
      D.x = H.x0 + (tx - H.x0) * e; D.y = H.y0 + (ty - H.y0) * p01 - Math.sin(Math.PI * p01) * lift;
      const st = p01 < 0.12 ? 1 - p01 / 0.12 : p01 > 0.88 ? (p01 - 0.88) / 0.12 : 0;
      D.sx = 1 + 0.14 * st - (p01 > 0.12 && p01 < 0.88 ? 0.06 : 0); D.sy = 1 - 0.16 * st + (p01 > 0.12 && p01 < 0.88 ? 0.1 : 0);
      if (p01 >= 1) { D.x = tx; D.y = ty; D.sx = 1.12; D.sy = 0.88; setMode("home"); draw(); }
    }
    place();
  };
  // 待机 / 说话动画在 20fps 快钟上画；移动时 rAF 只改位置
  const offT = ticker.addFast((t) => draw(t));
  D.raf = requestAnimationFrame(frame);
  if (REDUCED) setInterval(() => !D.hidden && frame(), 250);

  // ---------- 抓、拖、甩 ----------
  hit.addEventListener("pointerdown", (e) => {
    e.preventDefault(); hit.setPointerCapture?.(e.pointerId);
    setMode("held"); D.face = "held"; actor.dataset.squash = ""; D.grab = [D.x - e.clientX, D.y - e.clientY]; D.last = [[now(), e.clientX, e.clientY]]; D.vx = D.vy = 0; D.on = null;
    sfx("select"); draw();
  });
  hit.addEventListener("pointermove", (e) => {
    if (D.mode !== "held") return;
    const k = S(), nx = Math.max(10 * k, Math.min(innerWidth - 10 * k, e.clientX + D.grab[0])), ny = Math.max(24 * k, Math.min(innerHeight - 4, e.clientY + D.grab[1]));
    D.vx = D.vx * 0.5 + (nx - D.x) * 0.5; D.vy = D.vy * 0.5 + (ny - D.y) * 0.5; D.x = nx; D.y = ny;
    D.last.push([now(), e.clientX, e.clientY]); if (D.last.length > 6) D.last.shift();
    if (REDUCED) place();
  });
  const release = (e) => {
    if (D.mode !== "held") return;
    hit.releasePointerCapture?.(e.pointerId);
    if (REDUCED) { spot = pickSpot(); actor.dataset.perch = spot.key; const [tx, ty] = target(); D.x = tx; D.y = ty; D.sx = D.sy = 1; setMode("home"); place(); draw(); return; }
    const a = D.last[0], b = D.last[D.last.length - 1], dt = Math.max(16, b[0] - a[0]);
    D.vx = Math.max(-34, Math.min(34, ((b[1] - a[1]) / dt) * 16)); D.vy = Math.max(-34, Math.min(34, ((b[2] - a[2]) / dt) * 16));
    D.face = "happy"; D.still = 0; D.ss = 0; setMode("fling");
  };
  hit.addEventListener("pointerup", release); hit.addEventListener("pointercancel", release);

  const iv = setInterval(relight, 60_000);
  addEventListener("olo:tz", relight);
  return {
    el: actor,
    setPlatforms(fn, { blocks, busy } = {}) { platformsFn = fn || (() => []); blocksFn = blocks || (() => []); busyFn = busy || (() => null); if (!fn) spot = null; },
    candidates: () => candidates(),
    repick() { moveTo(pickSpot(), "debug"); return spot; },
    nudge() { if (REDUCED || D.mode !== "home") return; if (Math.random() < 0.5) moveTo(pickSpot(), "news"); },  // 有新消息：可能挪近一点，也可能不动
    perchLog: () => perchLog.slice(),
    rect: () => rectOf(D.x, D.y),
    setState(st) { s.state = st; actor.dataset.state = st; if (st !== "idle" && actor.dataset.pose) setPose(""); draw(); },
    setHidden(v) { D.hidden = v; layer.hidden = v; if (!v) { const [tx, ty] = target(); D.x = tx; D.y = ty; setMode("home"); place(); } },
    rain() { if (D.mode === "home" && !REDUCED) { D.sx = 1.18; D.sy = 0.84; } },  // 发消息时被逗得一缩
    stop() { offT(); clearInterval(iv); removeEventListener("olo:tz", relight); cancelAnimationFrame(D.raf); layer.remove(); },
  };
}
