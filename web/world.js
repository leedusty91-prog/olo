// 雾里集：铺满整个屏幕的 2.5D 像素世界（全部程序绘制、原创）。
// 四个地方：小广场（集市）/ olo 的小屋 / 林间湖 / 屋顶；走到边上的出口、进门、爬梯子或点「地图」就能过去。
// 天色随用户本地时间；天气（晴/雨/雪/雾）按日期播种，可点 HUD 切换；鸽子、猫、鸭子、青蛙、蝴蝶、萤火虫在场景里过日子。
// 玩法：点地面让 olo 走过去；点物件 → 走过去玩；抓起 olo / 球 / 包子 / 松果扔出去；浇花（隔天长高）；钓鱼；捡贝壳蘑菇换代币；彩蛋会掉出雾里集的传说。
import { drawOlo, ticker, REDUCED, P } from "./pixel.js";
import { sfx, ambient } from "./audio.js";
import { localHour, skyAt } from "./skytime.js?v=20261023b";
import { TW, TH, ART, CRITTER, tileSprite, glowSprite, hash2, drawPlant } from "./world-art.js";
import { SCENES, SCENE_ORDER, LORE, dailyFinds } from "./world-scenes.js?v=20261023w";
import { livingScene, windowLit } from "./world-living.js?v=20261024a";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const now = () => performance.now();
const HW = TW / 2, HH = TH / 2;
const PART = { dawn: "清晨", day: "白天", dusk: "傍晚", night: "夜里" };
const WEATHERS = ["clear", "rain", "snow", "fog"];
const WICON = { clear: "☀", rain: "☂", snow: "❄", fog: "≋" };
const WNAME = { clear: "晴", rain: "下雨", snow: "下雪", fog: "起雾" };
const MOOD = { idle: "在溜达", happy: "开心得蹦蹦跳", sad: "有点低落，慢慢走", thinking: "在想事情", talking: "在哼小曲", listening: "竖着耳朵" };
const FILL = ["韭菜鸡蛋", "南瓜", "红豆", "雾菇", "桂花糖", "萝卜丝"];
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function weatherFor(d = new Date()) {
  const q = new URLSearchParams(location.search).get("weather");
  if (WEATHERS.includes(q)) return q;
  const h = hash2(d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(), Math.floor(d.getHours() / 6), 5);
  const m = d.getMonth(); // 冬天才下雪
  return h < 0.5 ? "clear" : h < 0.7 ? "fog" : h < 0.88 || !(m <= 1 || m === 11) ? (h < 0.88 ? "rain" : "clear") : "snow";
}
export function daypart(hr) { const s = skyAt(hr); return { phase: s.phase, night: clamp(s.star, 0, 1), sun: s.sun, lamp: s.lamp }; }

// 每个动作：多久、说什么、olo 的表情
const ACT = {
  well: { dur: 150, doing: "趴在井边往下看", st: "thinking", say: ["井里有星星在眨眼。", "喂——（回声：喂——）", "井水好凉，像早上的雾。"] },
  tree: { dur: 120, doing: "摇小树", st: "happy", say: ["花瓣下雨啦！", "树说：痒。"] },
  lamp: { dur: 110, doing: "踮脚够路灯", st: "happy", say: ["啪嗒。"] },
  bench: { dur: 260, doing: "坐着打盹", st: "idle", say: ["坐一会儿，脚不酸了。", "这儿晒太阳最舒服。"], night: ["嘘……星星在数羊。"] },
  crates: { dur: 480, doing: "躲在木箱后面", st: "idle", say: ["你没找到我～"] },
  water: { dur: 150, doing: "给小花浇水", st: "happy" },
  stall: { dur: 120, doing: "跟蘑菇婶买包子", st: "happy" },
  lore: { dur: 140, doing: "在读东西", st: "thinking" },
  boat: { dur: 160, doing: "朝芦婆婆挥手", st: "happy", say: ["芦婆婆——！", "船上的灯，和我一样亮吗？"] },
  bed: { dur: 420, doing: "在小床上睡觉", st: "idle", say: ["呼……醒啦。做了个好长的梦。"] },
  stove: { dur: 200, doing: "在炉子边烤小饼", st: "thinking" },
  window: { dur: 120, doing: "趴在窗边看外面", st: "thinking" },
  frame: { dur: 110, doing: "看墙上的相框", st: "thinking", say: ["这是我们第一次见面那天。", "相框有点歪，我扶一下。"] },
  music: { dur: 300, doing: "跟着八音盒跳舞", st: "happy", say: ["转圈圈～", "这首歌叫《雾里的灯》。"] },
  table: { dur: 120, doing: "看桌上的纸条", st: "thinking" },
  swing: { dur: 360, doing: "在荡秋千", st: "happy", say: ["再高一点！", "风从耳朵边上跑过去了！"] },
  fish: { dur: 9999, doing: "在码头钓鱼", st: "thinking" },
  rock: { dur: 100, doing: "翻石头", st: "thinking", say: ["石头下面有只小螃蟹，它朝我挥钳子。", "只有一条很害羞的蚯蚓。", "凉凉的，下面藏着一个小水洼。"] },
  ring: { dur: 120, doing: "蹲在蘑菇圈旁边", st: "thinking" },
  telescope: { dur: 160, doing: "用望远镜看天", st: "thinking" },
  chimney: { dur: 90, doing: "凑到烟囱边", st: "sad", say: ["咳咳！烟跑进鼻子里了。"] },
  chime: { dur: 90, doing: "碰风铃", st: "happy", say: ["叮铃～", "风铃在说悄悄话。"] },
  stargaze: { dur: 360, doing: "躺着看星星", st: "idle" },
  door: { dur: 1, doing: "出门" },
  come: { dur: 80, doing: "跑到你跟前", st: "happy", say: ["来啦！", "叫我？"] },
  kick: { dur: 30, doing: "踢球", st: "happy" },
  eat: { dur: 90, doing: "吃东西", st: "happy", say: ["好香！", "啊呜——", "还是热的！"] },
  pet: { dur: 150, doing: "摸小猫", st: "happy", say: ["呼噜呼噜……", "它的毛好软。"] },
  pick: { dur: 30, doing: "捡东西", st: "happy" },
  toss: { dur: 30, doing: "扔松果", st: "happy", say: ["接住——！"] },
};

export function mountWorld(host, p, { api, onOpenChat, debug = false, lastUserText } = {}) {
  host.classList.add("world"); host.dataset.testid ||= "world";
  host.innerHTML = `<div class="world-stage"><canvas class="world-px" role="img" aria-label="雾里集：olo 生活的小镇，铺满整个屏幕"></canvas><div class="world-spots" role="group" aria-label="这里可以玩的东西"></div></div>
    <div class="world-fade" aria-hidden="true"></div>
    <div class="room-hud world-hud" data-testid="room-hud">
      <b class="room-place" data-testid="world-place"></b>
      <span class="room-clock" data-testid="room-clock"></span>
      <button type="button" class="world-chip" data-testid="world-weather" aria-label="换个天气"></button>
      <span class="world-tokens" data-testid="world-tokens" aria-label="代币">◆ 0</span>
      <span class="room-doing" data-testid="room-doing"></span>
    </div>
    <div class="room-bubble world-bubble px-box" data-testid="room-bubble" aria-hidden="true" hidden></div>
    <p class="sr-only" aria-live="polite" data-testid="room-live"></p>
    <div class="world-map" data-testid="world-map" hidden role="group" aria-label="地图：去别的地方">
      ${SCENE_ORDER.map((id) => `<button type="button" class="world-chip" data-to="${id}" data-testid="travel-${id}">${SCENES[id].name}</button>`).join("")}
    </div>
    <div class="world-dock">
      <button type="button" class="world-chip" data-testid="world-map-btn" aria-expanded="false">⌖ 地图</button>
      <button type="button" class="world-chip room-call" data-testid="room-call">♪ 叫它过来</button>
      ${onOpenChat ? `<button type="button" class="world-chip room-open" data-testid="room-open-chat">✉ 聊天</button>` : ""}
    </div>
`;
  const $ = (s) => host.querySelector(s);
  const cv = $("canvas"), stageEl = $(".world-stage"), ctx = cv.getContext("2d");
  const bubble = $(".world-bubble"), live = $("[data-testid=room-live]"), placeEl = $("[data-testid=world-place]"), clockEl = $(".room-clock"), doingEl = $(".room-doing");
  const wBtn = $("[data-testid=world-weather]"), tokEl = $("[data-testid=world-tokens]"), mapEl = $(".world-map"), mapBtn = $("[data-testid=world-map-btn]"), spotsEl = $(".world-spots");
  const name = () => String(p.name || "olo").slice(0, 24);
  // 角色贴图（每帧重画到小画布上，换装扮/表情立刻生效）
  const spr = document.createElement("canvas"); spr.width = 48; spr.height = 44; const sctx = spr.getContext("2d");
  const s = { state: "idle" };

  // ---------- 持久状态 ----------
  const SKEY = "olo.world";
  let S = (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } })();
  S.plants ||= {}; S.lore ??= 0; S.eggs ||= {}; S.taps ||= {}; S.day ||= dayKey(); S.scene ||= "plaza";
  let tokens = 0, found = new Set(), saveT = 0;
  const save = (remote = true) => {
    try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch {}
    if (!remote || !api) return; clearTimeout(saveT);
    saveT = setTimeout(() => api("/v1/world/state", { method: "PUT", body: { state: S } }).catch(() => {}), 1500);
  };
  const grow = (days) => { // 浇过水的花，每过一天长一格
    for (const pl of Object.values(S.plants)) if (pl.watered && pl.watered < dayKey()) { if (pl.stage < 4) pl.stage += Math.min(days, 1); pl.watered = ""; }
  };
  const rollDay = () => { const d = dayKey(); if (S.day !== d) { grow(1); S.day = d; S.fishToday = 0; S.bunsToday = 0; S.flies = 0; S.stars = 0; save(); } };
  rollDay();
  const plant = (id) => (S.plants[id] ||= { stage: 0, watered: "" });

  // ---------- 场景 ----------
  let RW = 0, RH = 0, K = 3;
  let sc = SCENES[S.scene] || SCENES.plaza, objs = [], items = [], crit = [], finds = [], parts = [], flakes = [];
  const cam = { x: 0, y: 0 };
  const D = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dir: 1, mode: "idle", task: null, goal: null, t: 0, sx: 1, sy: 1, hop: 0, react: 0, idleT: 120, grab: [0, 0], last: [], hidden: false, down: null, stuck: 0 };
  let weather = weatherFor(), fade = 0, fadeTo = null, chat = false, paused = false, L = daypart(localHour()), shooting = null, bite = null, seek = null;
  let tick = 0, frameMs = 0, mapOpen = false, nightOv = null;
  // 活的雾里集：用户自己的数据（聊天天数、心情、明信片、日记）→ 窗灯、灯笼颜色、小摊、行人（world-living.js，与手机端同一份）
  let living = livingScene(null);
  const LIVING_STALLS = [[12.1, 2.7, "#4a8ac8"], [1.9, 10.5, "#e8a35a"], [9.2, 10.4, "#8a6ae0"], [4.4, 7.4, "#5aa868"], [11.2, 5.8, "#ff8ab0"], [5.6, 2.9, "#c8a44a"]];
  const WALKER_COLS = [["#c8604e", "#f4d0a8"], ["#4a6ea0", "#e8c09a"], ["#8a6ae0", "#f4d0a8"], ["#5aa868", "#d8a880"], ["#e8a35a", "#f4d0a8"], ["#a8323e", "#e8c09a"], ["#6a8a9a", "#f4d0a8"], ["#d88ab0", "#d8a880"]];
  function addLiving() {
    if (sc.id !== "plaza") return;
    objs = objs.filter((o) => !o.living);
    LIVING_STALLS.slice(0, living.stalls).forEach(([x, y, col], k) => objs.push({ living: true, type: "stall", x, y, o: { col, buns: k % 2 ? 0 : 1, steam: k === 0 }, shake: 0, on: false }));
  }
  function setLiving(summary) {
    living = livingScene(summary); addLiving();
    host.dataset.living = `${living.lit},${living.tone},${living.stalls},${living.walkers}`;
  }

  const W2S = (x, y, z = 0) => [Math.round((x - y) * HW - cam.x + RW / 2), Math.round((x + y) * HH - z - cam.y + RH / 2)];
  const S2W = (sx, sy) => { const a = (sx - RW / 2 + cam.x) / HW, b = (sy - RH / 2 + cam.y) / HH; return [(a + b) / 2, (b - a) / 2]; };
  const inMap = (x, y) => x >= 0 && y >= 0 && x < sc.W && y < sc.H;
  const tileAt = (x, y) => (inMap(x, y) ? sc.floor(Math.floor(x), Math.floor(y)) : sc.fill(Math.floor(x), Math.floor(y)));
  const walkable = (x, y, self) => {
    if (x < 0.25 || y < 0.25 || x > sc.W - 0.25 || y > sc.H - 0.25) return false;
    if (!sc.walk(tileAt(x, y))) return false;
    for (const o of objs) if (o.r && o !== self && Math.hypot(o.x - x, o.y - y) < o.r) return false;
    return true;
  };
  const horizon = () => (sc.indoor ? 0 : Math.round(RH * sc.horizon));

  function load(id, at) {
    sc = SCENES[id]; S.scene = id;
    objs = sc.objs.map((o) => ({ ...o, o: { ...(o.o || {}) }, shake: 0, on: false }));
    items = sc.items.map(([kind, x, y]) => ({ kind, x, y, z: 0, vx: 0, vy: 0, vz: 0, held: false }));
    crit = sc.critters.map(([kind, x, y, o = {}], k) => ({ kind, x, y, z: kind === "butterfly" ? 10 : kind === "firefly" ? 8 : 0, hx: x, hy: y, dir: 1, seed: hash2(k, x * 10 | 0, 9), t: 0, vx: 0, vy: 0, ...o, sleep: !!o.sleeper, fly: 0, follow: 0 }));
    finds = dailyFinds(dayKey()).filter((f) => f.scene === id && !found.has(f.id));
    parts = [];
    const [ax, ay] = at || sc.spawn; Object.assign(D, { x: ax, y: ay, z: 0, vx: 0, vy: 0, vz: 0, mode: "idle", task: null, goal: null });
    spotsEl.innerHTML = objs.filter((o) => o.act).map((o) => `<button type="button" data-spot="${o.id}" data-testid="spot-${o.id}">${o.label}</button>`).join("");
    for (const b of spotsEl.querySelectorAll("button")) b.addEventListener("click", (e) => { if (e.detail === 0 || now() - lastTapAt > 400) goObj(objs.find((o) => o.id === b.dataset.spot)); });
    placeSpots();
    placeEl.textContent = `雾里集 · ${sc.name}`; host.dataset.scene = id; addLiving();
    snapCam(); if (!chat) ambient(sc.amb); save(false);
  }
  function travel(to, at) {
    if (!SCENES[to]) return;
    if (fadeTo) { if (!fadeTo.done) Object.assign(fadeTo, { to, at }); else fadeTo.next = [to, at]; return; }
    mapOpen = false; mapEl.hidden = true; mapBtn.setAttribute("aria-expanded", "false");
    sfx("whoosh"); fadeTo = { to, at, k: REDUCED ? 1 : 0 };
    if (REDUCED) { load(to, at); fadeTo = null; arrive(); }
  }
  function arrive() {
    const n = name(), part = L.phase;
    const lines = {
      plaza: [`广场上${part === "night" ? "只剩灯笼还醒着" : "好热闹"}。`, "鸽子们又来抢面包屑了。"],
      house: ["到家啦。", "屋里暖暖的，有炉子的味道。"],
      lake: ["湖面亮晶晶的。", "嘘——小鸭子在睡觉吗？"],
      roof: [part === "night" ? "星星好多！" : "风好大，帽子要飞了（我没有帽子）。", `${n} 最喜欢屋顶。`],
    };
    say(pick(lines[sc.id] || ["到啦。"]), 140);
  }

  // ---------- 说话气泡 ----------
  let bubbleT = 0;
  function say(text, frames = 130) {
    bubble.textContent = text; bubble.hidden = chat || D.hidden; bubbleT = frames; live.textContent = text;
  }
  const doing = (t) => { doingEl.textContent = `${name()} ${t}`; };

  // ---------- 代币 ----------
  async function award(id, kind, sx, sy) {
    if (found.has(id)) return false; found.add(id);
    float(sx, sy, "…");
    if (!api) { float(sx, sy, "+1◆"); return true; }
    try {
      const r = await api("/v1/world/find", { method: "POST", body: { find_id: id, kind } });
      tokens = r.tokens ?? tokens; tokEl.textContent = `◆ ${tokens}`; host.dataset.tokens = String(tokens);
      if (r.granted) { float(sx, sy, `+${r.amount}◆`); sfx("sparkle"); } else if (r.status === "capped") say("今天的代币领满啦，明天再来～", 120);
    } catch {}
    return true;
  }
  const float = (sx, sy, text) => parts.push({ kind: "text", sx, sy, text, life: 70, max: 70 });
  const egg = (key, kind = "egg") => { if (S.eggs[key]) return false; S.eggs[key] = dayKey(); save(); const [X, Y] = W2S(D.x, D.y, 30); award(`egg-${key}`, kind, X, Y); return true; };
  const nextLore = () => { const k = S.lore % LORE.length; S.lore++; host.dataset.lore = String(Math.min(S.lore, LORE.length)); save(); return `（第 ${k + 1}/${LORE.length} 条）${LORE[k]}`; };

  // ---------- 行走与任务 ----------
  function approach(o) {
    if (o.stand) return o.stand;
    const r = (o.r || 0.2) + 0.5;
    let a = Math.atan2(D.y - o.y, D.x - o.x);
    for (let k = 0; k < 16; k++) {
      const aa = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8), x = o.x + Math.cos(aa) * r, y = o.y + Math.sin(aa) * r;
      if (walkable(x, y)) return [x, y];
    }
    return [clamp(o.x, 0.5, sc.W - 0.5), clamp(o.y + r, 0.5, sc.H - 0.5)];
  }
  function walkTo(x, y, task = null) {
    if (D.mode === "held" || D.mode === "fling") return;
    endTask(false);
    D.goal = [x, y]; D.task = task; D.stuck = 0; setMode("walk");
    host.dataset.spot = task?.obj?.id || task?.act || "";
    if (REDUCED) { if (walkable(x, y)) { D.x = x; D.y = y; } arrived(); }
  }
  function goObj(o) {
    if (!o) return;
    if (seek && o.id === "crates") { foundHider(); return; }
    if (o.act === "door" && o.to && !o.walk) { const [x, y] = approach(o); walkTo(x, y, { act: "door", obj: o }); return; }
    const [x, y] = o.act === "fish" ? [8.9, 6.6] : o.act === "swing" ? [o.x, o.y + 0.25] : o.act === "bench" && o.type === "cushion" ? [o.x, o.y] : approach(o);
    walkTo(x, y, { act: o.act, obj: o });
  }
  function arrived() {
    D.goal = null;
    if (!D.task) { setMode("idle"); return; }
    const { act, obj } = D.task, A = ACT[act] || { dur: 60 };
    if (obj) D.dir = obj.x - obj.y >= D.x - D.y ? 1 : -1;
    D.task.t = 0; D.task.dur = A.dur; setMode("act"); host.dataset.act = act;
    if (A.doing) doing(A.doing);
    startAct(act, obj);
  }
  function endTask(sayEnd = true) {
    const T = D.task; if (!T) return;
    D.task = null; host.dataset.act = ""; D.z = 0; bite = null;
    if (T.obj?.type === "swing") T.obj.o.ang = 0;
    if (sayEnd && T.end) say(T.end, 130);
    if (D.mode === "act") setMode("idle");
    doing(MOOD[s.state] || MOOD.idle);
  }
  const setMode = (m) => { D.mode = m; host.dataset.drag = m === "idle" ? "home" : m; };

  // 各种动作开始时发生的事
  function startAct(act, o) {
    const A = ACT[act], T = D.task, night = L.night > 0.5, [OX, OY] = W2S(D.x, D.y, 26);
    const line = (night && A.night ? pick(A.night) : A.say ? pick(A.say) : null);
    switch (act) {
      case "door": endTask(false); travel(o.to, o.at); return;
      case "well": {
        S.taps.well = (S.taps.well || 0) + 1; sfx("think");
        if (S.taps.well >= 5 && egg("well")) say("井底……有一封泡软的信？上面写着：『谢谢你一直听我说话。』", 260);
        else say(line, 150); break;
      }
      case "tree": o.shake = 60; sfx("boing"); for (let k = 0; k < 14; k++) parts.push({ kind: "petal", x: o.x + Math.random() - 0.5, y: o.y + Math.random() - 0.5, z: 30 + Math.random() * 16, vz: -0.15, life: 120 + k * 4, col: o.o.fruit || "#ff8ab0" });
        { const id = `${dayKey()}:plaza:treeleaf`; if (!found.has(id)) finds.push({ id, kind: "leaf", scene: "plaza", x: o.x + 0.8, y: o.y + 0.5, drop: 40 }); }
        say(line, 120); break;
      case "lamp": o.on = !o.on; sfx("press"); say(o.on ? (night ? "亮一点，给晚归的人照路。" : "白天也亮一会儿，给它打打气。") : night ? "嘘，让它歇一下。" : "白天它在打盹，不吵它。", 120); break;
      case "bench": D.z = o.type === "cushion" ? 2 : 6; say(line, 150); if (night) T.zzz = true; break;
      case "crates": seek = { t: 0 }; D.x = o.x - 0.5; D.y = o.y - 0.6; say("（躲好了……来找我呀）", 120); break;
      case "water": {
        const pl = plant(o.plant), d = dayKey();
        if (pl.stage >= 4) { pl.stage = 1; pl.watered = ""; save(); const [X, Y] = W2S(o.x, o.y, 24); award(`${d}:bloom:${o.plant}`, "bloom", X, Y); say("开花啦！摘一朵送给你，种子再种回去。", 170); sfx("grow"); break; }
        if (pl.watered === d) { say(pick(["今天已经喝饱啦。", "再浇就要淹到了！", "明天再来看它。"]), 120); T.dur = 50; break; }
        pl.watered = d; save(); sfx("rain");
        for (let k = 0; k < 12; k++) parts.push({ kind: "drop", x: o.x + (Math.random() - 0.5) * 0.4, y: o.y + (Math.random() - 0.5) * 0.4, z: 26 + k * 2, vz: -1.2, life: 40 });
        say(pl.stage === 0 ? "种下一颗灯籽……明天会冒芽。" : pl.stage === 3 ? "花苞鼓鼓的，明天就开！" : "喝吧喝吧，明天会长高一点。", 150); break;
      }
      case "stall": {
        sfx("happy");
        if ((S.bunsToday || 0) >= 5) { say("蘑菇婶：今天卖完啦，明天赶早～", 140); break; }
        S.bunsToday = (S.bunsToday || 0) + 1; save(false);
        items.push({ kind: "bun", x: o.x - 0.2, y: o.y - 1.2, z: 22, vx: (D.x - o.x) * 0.02, vy: (D.y - o.y + 1.2) * 0.02, vz: 1.4, held: false, warm: 1 });
        say(`蘑菇婶：今天是${pick(FILL)}馅的！`, 150); break;
      }
      case "lore": say(nextLore(), 320); sfx("page"); break;
      case "boat": {
        S.taps.boat = (S.taps.boat || 0) + 1;
        if (weather === "fog" && S.taps.boat >= 3 && egg("boat")) say("芦婆婆：雾天还来送我的孩子……给，这是从雾里捞的星星。", 240);
        else say(line, 150); break;
      }
      case "bed": T.zzz = true; say("晚安……（呼）", 120); D.x = o.x + 0.1; D.y = o.y - 0.2; D.z = 8; break;
      case "stove": o.on = true; sfx("whoosh"); say("烤个小饼给你。", 120); break;
      case "window": say(weather === "rain" ? "雨点在窗户上赛跑，左边那颗赢了。" : weather === "snow" ? "外面白白的，像撒了糖。" : weather === "fog" ? "雾把对面的屋子藏起来了。" : night ? "窗外的灯笼一盏一盏亮着。" : "太阳晒到窗台上了。", 160); break;
      case "frame": S.taps.frame = (S.taps.frame || 0) + 1;
        if (S.taps.frame >= 3 && egg("photo")) say("照片背面写着：『给第一个跟我说话的人。』", 240); else say(line, 140); break;
      case "music": o.on = true; sfx("title"); say(line, 160); break;
      case "table": say(`桌上有张纸条：『今天也辛苦了。——${name()}』`, 170); break;
      case "swing": D.x = o.x; D.y = o.y + 0.05; T.amp = 0.5; say("坐稳啦！", 90); break;
      case "fish": T.phase = "wait"; T.wait = 120 + Math.random() * 200; D.dir = 1; say("嘘……鱼要来了。点一下屏幕收竿。", 150); break;
      case "rock": say(line, 140); break;
      case "ring": if (night) { if (egg("ring")) say("蘑菇们……刚刚交换了位置！" + LORE[10], 260); else say("蘑菇们假装没动过。", 140); } else say("白天它们在睡觉。晚上再来看看？", 140); break;
      case "telescope": {
        if (!night) { say("白天只能看见云，云长得像一只包子。", 140); break; }
        S.taps.scope = (S.taps.scope || 0) + 1; T.stars = true;
        if (S.taps.scope >= 3 && egg("moon")) say("月亮上……有人在朝这边挥手？", 220); else say(pick(["那颗最亮的是灯籽星。", "我看见一只星星做的猫。", LORE[7]]), 200);
        break;
      }
      case "chimney": for (let k = 0; k < 8; k++) parts.push({ kind: "smoke", x: o.x, y: o.y, z: 34 + k * 3, vz: 0.3, life: 80 + k * 6 }); say(line, 120); break;
      case "chime": sfx("sparkle"); say(weather === "rain" ? "下雨天它最安静，它在听。" : line, 120); o.shake = 40; break;
      case "stargaze": D.z = 2; say(night ? "躺下来，天就变成一整块了。" : "等天黑，这里能看到流星。", 150); T.stars = night; break;
      case "come": say(line, 100); D.hop = 1; break;
      case "kick": { const b = T.item; if (b) { const dx = b.x - D.x, dy = b.y - D.y, d = Math.hypot(dx, dy) || 1, f = T.power || 0.22; b.vx = dx / d * f; b.vy = dy / d * f; b.vz = 2.6; sfx("boing"); host.dataset.kicks = String(+(host.dataset.kicks || 0) + 1); } say(pick(["射门！", "嘿！", "球飞啦——"]), 90); break; }
      case "eat": { const b = T.item; if (b) items.splice(items.indexOf(b), 1); for (let k = 0; k < 3; k++) parts.push({ kind: "heart", sx: OX - 8 + k * 8, sy: OY - 4, life: 40 }); say(line, 120); sfx("happy"); host.dataset.fed = String(+(host.dataset.fed || 0) + 1); break; }
      case "pet": { const c = T.crit; if (c) { c.sleep = false; c.follow = 600; } for (let k = 0; k < 3; k++) parts.push({ kind: "heart", sx: OX - 8 + k * 8, sy: OY - 4, life: 50 }); say(line, 140); sfx("happy"); break; }
      case "pick": { const f = T.find; if (f) { finds.splice(finds.indexOf(f), 1); award(f.id, f.kind, OX, OY); say({ shell: "一枚粉粉的贝壳！", mushroom: "雾菇！晚上会发光的那种。", leaf: "一片会变色的叶子。", star: "星星石，摸起来是温的。" }[f.kind] || "捡到啦！", 120); } break; }
      case "toss": { const b = T.item; if (b) { const a = Math.random() * Math.PI * 2; b.x = D.x; b.y = D.y; b.z = 20; b.vx = Math.cos(a) * 0.12; b.vy = Math.sin(a) * 0.12; b.vz = 3; } say(pick(ACT.toss.say), 80); break; }
    }
  }
  // 动作进行中（每帧）
  function tickAct() {
    const T = D.task, o = T.obj; T.t++;
    if (T.act === "swing" && o) { o.o.ang = Math.sin(T.t * 0.06) * T.amp; D.z = 8 + Math.abs(o.o.ang) * 6; }
    if (T.act === "music" && T.t % 14 === 0) { const [X, Y] = W2S(o.x, o.y, 16); parts.push({ kind: "note", sx: X + (Math.random() - 0.5) * 14, sy: Y, life: 60 }); D.hop = 1; }
    if (T.act === "stove" && T.t === T.dur - 1) { o.on = false; items.push({ kind: "bun", x: o.x - 0.3, y: o.y + 0.8, z: 16, vx: 0, vy: 0.05, vz: 1.5, held: false, warm: 1 }); T.end = "小饼烤好啦，抓给你！"; }
    if (T.zzz && T.t % 40 === 0) { const [X, Y] = W2S(D.x, D.y, D.z + 30); parts.push({ kind: "z", sx: X + 6, sy: Y, life: 60 }); }
    if (T.act === "fish") {
      if (T.phase === "wait" && --T.wait <= 0) { T.phase = "bite"; T.bt = 75; bite = T; sfx("tick"); say("！！", 75); }
      else if (T.phase === "bite" && --T.bt <= 0) { T.phase = "wait"; T.wait = 140 + Math.random() * 200; bite = null; say(pick(["跑掉啦……", "鱼咬了一口饵就溜了。", "差一点点！"]), 110); T.miss = (T.miss || 0) + 1; if (T.miss >= 3) { T.end = "今天鱼不饿，下次再来。"; endTask(); } }
      return;
    }
    if (T.t >= T.dur) { if (!T.end && ACT[T.act]?.say && ["bed", "crates"].includes(T.act)) T.end = pick(ACT[T.act].say); if (T.act === "crates") { seek = null; D.x = o.x - 0.2; D.y = o.y + 1; } if (o?.type === "musicbox") o.on = false; endTask(); }
  }
  function reel() {
    const T = bite; bite = null; T.phase = "wait"; T.wait = 160 + Math.random() * 200;
    const n = S.fishToday = (S.fishToday || 0) + 1; save(false); sfx("happy");
    parts.push({ kind: "fishjump", x: 9.8, y: 6.8, z: 0, vz: 3.6, life: 50 });
    const [X, Y] = W2S(D.x, D.y, 34);
    if (n <= 3) { award(`${dayKey()}:lake:fish-${n}`, "fish", X, Y); say(pick(["钓到一条小鱼！", "是条银肚皮的！", "哇，在甩尾巴！"]) + "（看一眼就放回去啦）", 150); }
    else say("今天钓够啦，放它回家。", 130);
    host.dataset.fish = String(n);
  }
  function foundHider() { if (!seek) return; seek = null; const o = objs.find((q) => q.id === "crates"); D.x = o.x - 0.2; D.y = o.y + 1; D.hop = 1; sfx("happy"); D.task.end = null; endTask(false); say("哇！被你找到了！", 130); }

  // ---------- 输入 ----------
  const toPx = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * RW, (e.clientY - r.top) / r.height * RH]; };
  const oloHit = (mx, my) => { const [X, Y] = W2S(D.x, D.y, D.z); return !D.hidden && Math.abs(mx - X) < 11 && my > Y - 30 && my < Y + 3; };
  const itemHit = (mx, my) => items.find((b) => { const [X, Y] = W2S(b.x, b.y, b.z); return Math.abs(mx - X) < 7 && Math.abs(my - Y + 3) < 7; });
  const critHit = (mx, my) => crit.find((c) => { const [X, Y] = W2S(c.x, c.y, c.z); return Math.abs(mx - X) < 8 && Math.abs(my - Y + 4) < 8; });
  const findHit = (mx, my) => finds.find((f) => { const [X, Y] = W2S(f.x, f.y, f.drop || 0); return Math.abs(mx - X) < 8 && Math.abs(my - Y + 2) < 8; });
  const objHit = (mx, my) => { let best = null; for (const o of objs) { if (!o.act || !o.hit) continue; const [X, Y] = W2S(o.x, o.y), [w, h] = o.hit, y0 = Y - (o.hitY || 0); if (Math.abs(mx - X) < w / 2 && my < y0 + 4 && my > y0 - h) if (!best || o.x + o.y > best.x + best.y) best = o; } return best; };
  let grabbed = null, d0 = null;
  stageEl.addEventListener("pointerdown", (e) => {
    if (chat || fadeTo) return;
    const [mx, my] = toPx(e);
    if (bite) { reel(); return; }
    if (shooting && Math.hypot(mx - shooting.x, my - shooting.y) < 26) { catchStar(); return; }
    const it = itemHit(mx, my);
    const target = oloHit(mx, my) ? { kind: "olo" } : it ? { kind: "item", it } : null;
    D.down = { x: e.clientX, y: e.clientY, mx, my, t: now(), moved: false, target, spot: e.target.dataset?.spot };   // 按在去处按钮上：拖得动就照常拖；只是点一下——点中物件（包子/球）照旧算点物件，点中 olo 就去那个地方
    if (target) stageEl.setPointerCapture?.(e.pointerId);
    if (target?.kind === "olo" && D.task?.act !== "swing" && D.mode !== "fling") { // 按住 olo 就提起来（不动就算点一下）
      d0 = { task: D.task?.act, x: D.x, y: D.y, z: D.z }; D.task = null; host.dataset.act = ""; seek = null; grabbed = D; D.last = []; setMode("held"); D.down.target = null;
    }
  });
  stageEl.addEventListener("pointermove", (e) => {
    const [mx, my] = toPx(e);
    if (!D.down) { stageEl.style.cursor = oloHit(mx, my) || itemHit(mx, my) ? "grab" : objHit(mx, my) || critHit(mx, my) || findHit(mx, my) ? "pointer" : ""; return; }
    if (Math.hypot(e.clientX - D.down.x, e.clientY - D.down.y) > 6 && D.down.target && !D.down.moved) {
      D.down.moved = true; const T = D.down.target;
      if (T.kind === "olo") { endTask(false); seek = null; grabbed = D; setMode("held"); sfx("press"); say(pick(["哇——放我下来！", "飞咯！", "嘿嘿，痒！"]), 90); }
      else { grabbed = T.it; T.it.held = true; sfx("press"); }
      grabbed.last = [];
    }
    if (!grabbed) return;
    if (grabbed === D && !D.down.moved) { if (Math.hypot(e.clientX - D.down.x, e.clientY - D.down.y) <= 6) return; D.down.moved = true; sfx("press"); say(pick(["哇——放我下来！", "飞咯！", "嘿嘿，痒！"]), 90); }
    const [wx, wy] = S2W(mx, my + 12), nx = clamp(wx, 0.3, sc.W - 0.3), ny = clamp(wy, 0.3, sc.H - 0.3);
    grabbed.x = nx; grabbed.y = ny; grabbed.z = 14; grabbed.last.push([now(), nx, ny]); if (grabbed.last.length > 6) grabbed.last.shift();
    stageEl.style.cursor = "grabbing";
  });
  const release = (e) => {
    const d = D.down; D.down = null; if (!d) return;
    stageEl.releasePointerCapture?.(e.pointerId);
    if (grabbed === D && !d.moved) { // 只是点了一下 olo
      grabbed = null; Object.assign(D, { x: d0.x, y: d0.y, z: 0 }); setMode("idle");
      if (d.spot) { lastTapAt = now(); host.dataset.taps = String(+(host.dataset.taps || 0) + 1); goObj(objs.find((o) => o.id === d.spot)); return; }
      if (d0.task === "bed" || d0.task === "bench" || d0.task === "stargaze") { say("唔……醒啦！", 100); doing(MOOD[s.state] || MOOD.idle); return; }
      tap(d.mx, d.my); return;
    }
    if (grabbed) {
      const g = grabbed; grabbed = null;
      const a = g.last[0], b = g.last[g.last.length - 1];
      if (a && b && !REDUCED) { const dt = Math.max(16, b[0] - a[0]); g.vx = clamp((b[1] - a[1]) / dt * 16, -0.4, 0.4); g.vy = clamp((b[2] - a[2]) / dt * 16, -0.4, 0.4); g.vz = 2 + Math.hypot(g.vx, g.vy) * 6; }
      else { g.vx = g.vy = 0; g.vz = 0; g.z = REDUCED ? 0 : g.z; }
      if (g === D) { setMode("fling"); host.dataset.squash = "fling"; D.thrown = true; host.dataset.throws = String(+(host.dataset.throws || 0) + 1); }
      else { g.held = false; g.thrown = true; if (g.kind === "bun" && Math.hypot(g.x - D.x, g.y - D.y) < 0.9 && D.mode !== "fling") { D.task = { act: "eat", item: g, t: 0, dur: 90 }; setMode("act"); startAct("eat"); doing(ACT.eat.doing); } }
      return;
    }
    if (d.spot && !d.moved && d.target?.kind !== "item") { lastTapAt = now(); host.dataset.taps = String(+(host.dataset.taps || 0) + 1); goObj(objs.find((o) => o.id === d.spot)); return; }
    tap(d.mx, d.my);
  };
  stageEl.addEventListener("pointerup", release); stageEl.addEventListener("pointercancel", release);
  let lastTapAt = 0;
  function tap(mx, my) {
    lastTapAt = now();
    host.dataset.taps = String(+(host.dataset.taps || 0) + 1);
    if (oloHit(mx, my)) { // 戳 olo：蹦一下、冒爱心
      if (D.task?.act === "swing") { D.task.amp = Math.min(1, D.task.amp + 0.2); say("再高一点！", 80); return; }
      const [X, Y] = W2S(D.x, D.y, D.z); sfx("happy"); D.hop = 1; D.react = 45;
      for (let k = 0; k < 3; k++) parts.push({ kind: "heart", sx: X - 8 + k * 8, sy: Y - 30, life: 40 });
      S.taps.olo = (S.taps.olo || 0) + 1;
      say(S.taps.olo % 20 === 0 && egg("tickle") ? "被戳了二十下！奖励你一个秘密：我怕痒。" : pick(["嘿嘿。", "痒！", "再戳一下？", "找我呀？", `${name()} 在这儿！`]), 110); return;
    }
    const it = itemHit(mx, my);
    if (it) { const [x, y] = [it.x + (D.x < it.x ? -0.5 : 0.5), it.y]; walkTo(x, y, { act: it.kind === "ball" ? "kick" : it.kind === "bun" ? "eat" : "toss", item: it }); return; }
    const f = findHit(mx, my);
    if (f) { walkTo(f.x - 0.3, f.y + 0.2, { act: "pick", find: f }); return; }
    const c = critHit(mx, my);
    if (c) { critTap(c); return; }
    const o = objHit(mx, my);
    if (o) { goObj(o); return; }
    const [wx, wy] = S2W(mx, my);
    if (!inMap(wx, wy)) { // 点到地图外：看看是不是在出口方向
      for (const ex of sc.exits) if (Math.hypot(wx - (ex.x0 + ex.x1) / 2, wy - (ex.y0 + ex.y1) / 2) < 4) { walkTo(clamp(wx, 0.3, sc.W - 0.3), clamp(wy, 0.3, sc.H - 0.3)); return; }
      say(pick(["那边雾太浓了，过不去。", "雾里集的边边，走不出去哦。"]), 100); return;
    }
    if (!walkable(wx, wy)) { say(sc.walk(tileAt(wx, wy)) ? "那边被挡住了。" : pick(["我不会游泳……", "水太凉啦。"]), 90); parts.push({ kind: "ring", x: wx, y: wy, life: 30 }); return; }
    parts.push({ kind: "ring", x: wx, y: wy, life: 30 }); sfx("tick");
    walkTo(wx, wy);
  }
  function critTap(c) {
    const [X, Y] = W2S(c.x, c.y, c.z);
    if (c.kind === "pigeon") { scare(c); say("咕咕咕！它们飞走了。", 90); return; }
    if (c.kind === "cat") { if (c.sleep) { c.sleep = false; c.t = 0; say("喵……（伸了个懒腰）", 110); parts.push({ kind: "text", sx: X, sy: Y - 12, text: "喵", life: 50, max: 50 }); setTimeout(() => (c.sleep = !!c.sleeper), 6000); return; } walkTo(c.x - 0.6, c.y + 0.2, { act: "pet", crit: c }); c.stay = 300; return; }
    if (c.kind === "npc") { goObj(objs.find((o) => o.act === "stall")); return; }
    if (c.kind === "duck") { c.vx = (Math.random() - 0.5) * 0.08; c.vy = (Math.random() - 0.5) * 0.08; parts.push({ kind: "text", sx: X, sy: Y - 10, text: "嘎！", life: 50, max: 50 }); sfx("tick"); return; }
    if (c.kind === "frog") { c.vz = 3; c.vx = (Math.random() - 0.5) * 0.1; c.vy = (Math.random() - 0.5) * 0.1; parts.push({ kind: "text", sx: X, sy: Y - 10, text: "呱", life: 50, max: 50 }); sfx("boing"); return; }
    if (c.kind === "butterfly") { c.vx = (Math.random() - 0.5) * 0.12; c.vy = -0.05; say("抓不到～", 80); D.hop = 1; return; }
    if (c.kind === "firefly") {
      if (L.night < 0.4) return;
      const n = S.flies = (S.flies || 0) + 1; save(false); c.flash = 40;
      if (n <= 3) award(`${dayKey()}:lake:star-${n}`, "star", X, Y);
      say(n <= 3 ? "捧住一只萤火虫，它留下一点光就飞走了。" : "萤火虫在手心里眨眼睛。", 120); sfx("sparkle"); return;
    }
  }
  function scare(c) { c.fly = 160 + Math.random() * 120; const a = Math.random() * Math.PI * 2; c.vx = Math.cos(a) * 0.06; c.vy = Math.sin(a) * 0.06; sfx("whoosh"); }
  function catchStar() {
    const n = S.stars = (S.stars || 0) + 1; save(false); const sh = shooting; shooting = null;
    if (n <= 3) award(`${dayKey()}:sky:star-${n}`, "star", sh.x, sh.y);
    say(n <= 3 ? "接住一颗流星！许个愿吧。" : "又一颗！今天许的愿够多啦。", 140); sfx("sparkle");
  }

  // ---------- 每帧逻辑 ----------
  function stepPhys(b, bounce, isOlo) {
    b.vz -= 0.35; b.z += b.vz;
    let nx = b.x + b.vx, ny = b.y + b.vy;
    const wall = isOlo || b.kind !== "ball" ? !walkable(nx, ny) && sc.walk(tileAt(nx, ny)) : false;
    if (nx < 0.3 || nx > sc.W - 0.3 || wall) { b.vx = -b.vx * bounce; nx = b.x; }
    if (ny < 0.3 || ny > sc.H - 0.3 || (!walkable(b.x, ny) && sc.walk(tileAt(b.x, ny)) && (isOlo || b.kind !== "ball"))) { b.vy = -b.vy * bounce; ny = b.y; }
    if (b.kind === "ball") for (const o of objs) if (o.r && Math.hypot(o.x - nx, o.y - ny) < o.r && b.z < 20) { const a = Math.atan2(ny - o.y, nx - o.x), sp = Math.hypot(b.vx, b.vy) * bounce; b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; nx = b.x; ny = b.y; sfx("tick"); }
    b.x = nx; b.y = ny;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.2) { b.vz = -b.vz * bounce; if (isOlo) { D.sx = 1.25; D.sy = 0.75; sfx("boing"); } }
      else { b.vz = 0; b.vx *= 0.86; b.vy *= 0.86; }
      if (!sc.walk(tileAt(b.x, b.y)) && b.vz === 0) return "water";
      if (Math.abs(b.vx) + Math.abs(b.vy) < 0.004 && b.vz === 0) return "rest";
    }
    return null;
  }
  function step() {
    tick++; rollDayMaybe();
    if (fadeTo) { fadeTo.k += 0.06; if (fadeTo.k >= 1 && !fadeTo.done) { fadeTo.done = true; load(fadeTo.to, fadeTo.at); arrive(); } if (fadeTo.k >= 2) { const n = fadeTo.next; fadeTo = null; if (n) travel(...n); } }
    // olo
    if (D.mode === "walk" && D.goal) {
      const [gx, gy] = D.goal, dx = gx - D.x, dy = gy - D.y, d = Math.hypot(dx, dy), sp = s.state === "sad" ? 0.03 : 0.05;
      if (d < sp) { D.x = gx; D.y = gy; arrived(); }
      else {
        let moved = false, base = Math.atan2(dy, dx);
        for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) { const nx = D.x + Math.cos(base + off) * sp, ny = D.y + Math.sin(base + off) * sp; if (walkable(nx, ny)) { D.x = nx; D.y = ny; moved = true; break; } }
        if (!moved || ++D.stuck > 900) { D.goal = null; if (D.task && (d < 1.4 || D.task.act === "door")) arrived(); else { endTask(false); setMode("idle"); say("过不去～", 70); } }
        D.dir = dx - dy >= 0 ? 1 : -1; D.hop += 0.12;
      }
    } else if (D.mode === "act" && D.task) tickAct();
    else if (D.mode === "fling") {
      const r = stepPhys(D, 0.45, true);
      if (r === "water") { sfx("rain"); say("噗通！……我爬上来了。", 110); const [x, y] = nearestDry(D.x, D.y); D.x = x; D.y = y; D.vx = D.vy = 0; setMode("idle"); }
      else if (r === "rest") { setMode("idle"); if (D.thrown) say(pick(["再来一次！", "晕乎乎……", "我会飞！"]), 100); D.thrown = false; }
    } else if (D.mode === "idle" && !chat && !REDUCED) {
      if (--D.idleT <= 0) idleThink();
    }
    // 出口
    if (D.mode === "walk" || D.mode === "idle") for (const ex of sc.exits) if (D.x >= ex.x0 && D.x <= ex.x1 && D.y >= ex.y0 && D.y <= ex.y1) { travel(ex.to, ex.at); break; }
    if (D.mode !== "walk" && D.hop > 0 && D.hop < 1.01 && D.mode !== "act") D.hop = D.hop >= 1 ? 1.001 : 0;
    D.sx += (1 - D.sx) * 0.2; D.sy += (1 - D.sy) * 0.2; if (D.react > 0) D.react--;
    // 物品
    for (const b of [...items]) {
      if (b.held) continue;
      if (b.vz || b.z > 0 || Math.abs(b.vx) + Math.abs(b.vy) > 0.004) {
        const r = stepPhys(b, b.kind === "ball" ? 0.72 : 0.3, false);
        if (b.kind === "ball" && b.z < 10 && D.mode !== "held" && Math.hypot(b.x - D.x, b.y - D.y) < 0.45 && b.thrown) { b.thrown = false; D.sx = 0.8; D.sy = 1.2; say("哎哟！", 70); sfx("boing"); }
        if (r === "water") {
          const duck = crit.find((c) => c.kind === "duck" && Math.hypot(c.x - b.x, c.y - b.y) < 3);
          if (b.kind === "bun" && duck) { items.splice(items.indexOf(b), 1); duck.gx = b.x; duck.gy = b.y; say("鸭子游过来把包子吃掉了！", 120); }
          else { const [x, y] = nearestDry(b.x, b.y); b.x = x; b.y = y; b.vx = b.vy = 0; say(b.kind === "ball" ? "球漂回岸边了。" : "捞上来了。", 90); }
        }
      }
    }
    // 小动物
    for (const c of crit) stepCrit(c);
    // 收集物掉落
    for (const f of finds) if (f.drop > 0) f.drop = Math.max(0, f.drop - 1.5);
    // 粒子
    for (const q of parts) { q.life--; if (q.vz !== undefined) { q.z += q.vz; if (q.kind === "fishjump") q.vz -= 0.18; if (q.kind === "petal") q.x += Math.sin(q.life * 0.1) * 0.01; if (q.z < 0) q.life = 0; } if (q.sy !== undefined && q.kind !== "text") q.sy -= 0.4; if (q.kind === "text") q.sy -= 0.3; }
    parts = parts.filter((q) => q.life > 0);
    for (const o of objs) if (o.shake > 0) o.shake--;
    // 流星（夜里、户外）
    if (!sc.indoor && L.night > 0.6 && !REDUCED && !shooting && Math.random() < (D.task?.stars ? 0.012 : 0.002)) shooting = { x: Math.random() * RW * 0.8 + RW * 0.1, y: Math.random() * horizon() * 0.6 + 6, vx: -2.2, vy: 1.1, life: 70 };
    if (shooting) { shooting.x += shooting.vx; shooting.y += shooting.vy; if (--shooting.life <= 0) shooting = null; }
    if (bubbleT > 0 && --bubbleT === 0) bubble.hidden = true;
    stepWeather();
    // 镜头跟着 olo
    const [tx, ty] = camTarget(); cam.x += (tx - cam.x) * 0.08; cam.y += (ty - cam.y) * 0.08;
  }
  function nearestDry(x, y) { for (let r = 0.5; r < 8; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) { const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r; if (walkable(nx, ny)) return [nx, ny]; } return sc.spawn; }
  function stepCrit(c) {
    c.t++;
    const night = L.night > 0.5;
    if (c.kind === "pigeon") {
      if (c.fly > 0) { c.fly--; c.z = Math.min(40, c.z + 1); c.x += c.vx; c.y += c.vy; if (c.fly === 0 || !inMap(c.x, c.y)) { c.fly = 0; c.x = clamp(c.x, 2, sc.W - 2); c.y = clamp(c.y, 2, sc.H - 3); } }
      else if (c.z > 0) c.z = Math.max(0, c.z - 1);
      else {
        if (Math.hypot(D.x - c.x, D.y - c.y) < 1.2 && D.mode === "walk" || items.some((b) => b.kind === "ball" && Math.hypot(b.x - c.x, b.y - c.y) < 1 && (b.vx || b.vy))) scare(c);
        else if (c.t % 90 === 0 && !REDUCED) { const nx = c.x + (Math.random() - 0.5) * 0.8, ny = c.y + (Math.random() - 0.5) * 0.8; if (walkable(nx, ny)) { c.dir = nx > c.x ? 1 : -1; c.gx = nx; c.gy = ny; } }
        if (c.gx !== undefined) { c.x += (c.gx - c.x) * 0.05; c.y += (c.gy - c.y) * 0.05; }
        c.peck = (c.t + c.seed * 50) % 60 < 8;
      }
      return;
    }
    if (c.kind === "cat") {
      if (c.sleep || REDUCED) return;
      if (c.follow > 0) { c.follow--; const d = Math.hypot(D.x - c.x, D.y - c.y); if (d > 1) { c.x += (D.x - c.x) / d * 0.035; c.y += (D.y - c.y) / d * 0.035; c.dir = D.x - c.x > 0 ? 1 : -1; c.walking = true; } else c.walking = false; return; }
      if (c.stay > 0) { c.stay--; return; }
      if (c.t % 240 === 0) { const nx = c.hx + (Math.random() - 0.5) * 4, ny = c.hy + (Math.random() - 0.5) * 3; if (walkable(nx, ny)) { c.gx = nx; c.gy = ny; } }
      if (c.gx !== undefined) { const dx = c.gx - c.x, dy = c.gy - c.y, d = Math.hypot(dx, dy); c.walking = d > 0.1; if (c.walking) { c.x += dx / d * 0.02; c.y += dy / d * 0.02; c.dir = dx > 0 ? 1 : -1; } }
      return;
    }
    if (c.kind === "duck") {
      if (REDUCED) return;
      if (c.gx !== undefined) { const dx = c.gx - c.x, dy = c.gy - c.y, d = Math.hypot(dx, dy); if (d > 0.1) { c.x += dx / d * 0.02; c.y += dy / d * 0.02; c.dir = dx - dy > 0 ? 1 : -1; } else c.gx = undefined; }
      else if (c.t % 200 === 0) { const nx = c.x + (Math.random() - 0.5) * 3, ny = c.y + (Math.random() - 0.5) * 3; if (inMap(nx, ny) && !sc.walk(tileAt(nx, ny))) { c.gx = nx; c.gy = ny; } }
      c.x += c.vx; c.y += c.vy; c.vx *= 0.95; c.vy *= 0.95; if (sc.walk(tileAt(c.x, c.y))) { c.x -= c.vx * 3; c.y -= c.vy * 3; c.gx = c.hx; c.gy = c.hy; }
      return;
    }
    if (c.kind === "frog") {
      if (c.vz || c.z > 0) { c.vz -= 0.3; c.z = Math.max(0, c.z + c.vz); c.x += c.vx; c.y += c.vy; if (c.z === 0) { c.vz = 0; c.vx = c.vy = 0; if (!walkable(c.x, c.y)) { c.x = c.hx; c.y = c.hy; } } }
      else if (!REDUCED && c.t % 300 === 0) { c.vz = 2.4; c.vx = (Math.random() - 0.5) * 0.06; c.vy = (Math.random() - 0.5) * 0.06; }
      return;
    }
    if (c.kind === "butterfly") {
      c.hide = night || weather === "rain"; if (REDUCED) return;
      c.x += c.vx + Math.sin(c.t * 0.03 + c.seed * 9) * 0.015; c.y += c.vy + Math.cos(c.t * 0.027 + c.seed * 5) * 0.012; c.vx *= 0.97; c.vy *= 0.97;
      c.z = 10 + Math.sin(c.t * 0.07) * 4; c.x = clamp(c.x, 0.5, sc.W - 0.5); c.y = clamp(c.y, 0.5, sc.H - 0.5);
      return;
    }
    if (c.kind === "firefly") {
      c.hide = L.night < 0.4 || weather === "rain"; if (c.flash > 0) c.flash--; if (REDUCED) return;
      c.x = c.hx + Math.sin(c.t * 0.011 + c.seed * 20) * 1.4; c.y = c.hy + Math.cos(c.t * 0.013 + c.seed * 11) * 1.1; c.z = 8 + Math.sin(c.t * 0.05 + c.seed) * 5;
    }
  }
  // 闲着的时候自己找事做 / 说句话
  function idleThink() {
    D.idleT = 260 + Math.random() * 400;
    const r = Math.random(), n = name();
    if (r < 0.3) {
      const lines = [
        weather === "rain" ? "下雨了，雨点打在头上咚咚的。" : weather === "snow" ? "雪花落在鼻子上，化掉了。" : weather === "fog" ? "雾好浓，像泡在牛奶里。" : L.night > 0.5 ? "夜里的雾里集，好安静。" : "今天的风是甜的。",
        `${n} 在等你一起玩。`, "要不要去别的地方看看？点「地图」。", "地上好像有亮亮的东西……",
      ];
      const lu = lastUserText?.(); if (lu && Math.random() < 0.4) lines.push(`刚才你说「${lu.slice(0, 12)}${lu.length > 12 ? "…" : ""}」，我还在想呢。`);
      say(pick(lines), 160); return;
    }
    const ball = items.find((b) => b.kind === "ball");
    if (r < 0.45 && ball) { walkTo(ball.x + (D.x < ball.x ? -0.5 : 0.5), ball.y, { act: "kick", item: ball, power: 0.12 }); return; }
    const bun = items.find((b) => b.kind === "bun");
    if (bun && r < 0.7) { walkTo(bun.x - 0.4, bun.y, { act: "eat", item: bun }); return; }
    for (let k = 0; k < 10; k++) { const x = D.x + (Math.random() - 0.5) * 5, y = D.y + (Math.random() - 0.5) * 5; if (walkable(x, y) && !sc.exits.some((e) => x > e.x0 - 1 && x < e.x1 + 1 && y > e.y0 - 1 && y < e.y1 + 1)) { walkTo(x, y); return; } }
  }
  let lastDay = dayKey();
  function rollDayMaybe() { if (tick % 600) return; const d = dayKey(); if (d !== lastDay) { lastDay = d; rollDay(); load(sc.id, [D.x, D.y]); } if (tick % 1800 === 0) relight(); }

  // ---------- 天气 ----------
  function stepWeather() {
    const n = weather === "rain" ? (REDUCED ? 30 : 140) : weather === "snow" ? (REDUCED ? 30 : 110) : 0;
    while (flakes.length < n) flakes.push({ x: Math.random() * RW, y: Math.random() * RH, v: 0.6 + Math.random(), s: Math.random() });
    if (flakes.length > n) flakes.length = n;
    if (REDUCED) return;
    for (const f of flakes) {
      if (weather === "rain") { f.y += 4 + f.v * 2; f.x -= 0.8; } else { f.y += 0.3 + f.v * 0.3; f.x += Math.sin((tick + f.s * 500) * 0.02) * 0.3; }
      if (f.y > RH || f.x < 0) { if (weather === "rain" && Math.random() < 0.3 && f.y > horizon()) parts.push({ kind: "splash", sx: f.x, sy: Math.min(RH - 1, f.y), life: 8 }); f.y = -4; f.x = Math.random() * (RW + 40); }
    }
  }
  function setWeather(w) { weather = w; host.dataset.weather = w; wBtn.textContent = `${WICON[w]} ${WNAME[w]}`; flakes = []; if (sc.id === "plaza" && w === "snow" && !objs.some((o) => o.type === "snowman")) objs.push({ id: "snowman", type: "snowman", x: 4.2, y: 6.8, r: 0.4, hit: [14, 20], act: "chime", label: "雪人" }); }
  wBtn.addEventListener("click", () => { setWeather(WEATHERS[(WEATHERS.indexOf(weather) + 1) % WEATHERS.length]); say({ clear: "天晴了！", rain: "下雨啦，快躲雨～", snow: "下雪了！可以堆雪人！", fog: "雾来了，雾里集名副其实。" }[weather], 110); sfx(weather === "rain" ? "rain" : "select"); });

  // ---------- 镜头 ----------
  function camTarget() {
    const tx = (D.x - D.y) * HW, ty = (D.x + D.y) * HH - 14;
    const minX = -sc.H * HW, maxX = sc.W * HW, maxY = (sc.W + sc.H) * HH, hz = horizon();
    let cx = maxX - minX + 40 < RW ? (minX + maxX) / 2 : clamp(tx, minX + RW / 2 - 20, maxX - RW / 2 + 20);
    const top = RH / 2 - hz - (sc.indoor ? 58 : 26), bot = maxY - RH / 2 + 26;
    let cy = bot <= top ? (top + bot) / 2 : clamp(ty, top, bot);
    return [cx, cy];
  }
  const snapCam = () => { const [x, y] = camTarget(); cam.x = x; cam.y = y; };

  // ---------- 画 ----------
  const staticCache = new Map();
  const STATIC = new Set(["well", "bench", "crates", "board", "ladder", "sign", "dock", "rock", "shelf", "bed", "table", "frame", "rooftile", "pine", "cushion", "flowers", "door", "telescope", "chimney", "window", "lamp", "mushroom", "snowman", "stove"]);
  function drawArt(type, X, Y, t, o) {
    const fn = ART[type]; if (!fn) return;
    if (STATIC.has(type) && !(type === "chimney" || type === "window") ) {
      const key = type + JSON.stringify(o || {});
      let c = staticCache.get(key);
      if (!c) { c = document.createElement("canvas"); c.width = 120; c.height = 120; fn(c.getContext("2d"), 60, 100, 0, o); staticCache.set(key, c); }
      ctx.drawImage(c, X - 60, Y - 100); return;
    }
    fn(ctx, X, Y, t, o);
  }
  function relight() { L = nightOv !== null ? { ...daypart(localHour()), night: nightOv, phase: nightOv > 0.5 ? "night" : "day" } : daypart(localHour()); host.dataset.daypart = L.phase; clockEl.textContent = `${PART[L.phase] || ""} ${new Date().toTimeString().slice(0, 5)}`; }

  function render() {
    const t0 = now(), t = REDUCED ? 0 : ticker.ft ?? tick;
    ctx.clearRect(0, 0, RW, RH);
    const hz = horizon(), night = L.night;
    if (sc.indoor) drawWalls(); else drawHorizon(hz, t);
    // 地砖：屏幕里能看到的都铺上（地图外用填充地形，没有边框）
    const cs = [[0, hz - 8], [RW, hz - 8], [0, RH + 16], [RW, RH + 16]].map(([x, y]) => S2W(x, y));
    const i0 = Math.floor(Math.min(...cs.map((c) => c[0]))) - 1, i1 = Math.ceil(Math.max(...cs.map((c) => c[0]))) + 1;
    const j0 = Math.floor(Math.min(...cs.map((c) => c[1]))) - 1, j1 = Math.ceil(Math.max(...cs.map((c) => c[1]))) + 1;
    const draws = [], fr = REDUCED ? 0 : (t / 14 | 0) % 4;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [X, Y] = W2S(i, j); if (X < -TW || X > RW + TW || Y > RH + 2 || Y + TH < hz - 2) continue;
      const inside = i >= 0 && j >= 0 && i < sc.W && j < sc.H, type = inside ? sc.floor(i, j) : sc.fill(i, j);
      if (type === "void" || (sc.indoor && (i < 0 || j < 0))) continue;
      const water = type === "water" || type === "deep";
      ctx.drawImage(tileSprite(type, (hash2(i, j, 1) * 4) | 0, water ? (fr + ((i + j) & 3)) % 4 : 0, i, j), X - HW, Y);
      if (!inside && sc.deco) { const h = hash2(i, j, 11), d = sc.deco(i, j, h); if (d && !(d.type === "pine" && (i >= sc.W || j >= sc.H) && i + j > 4)) draws.push({ d: i + j + 1, f: () => { const [X2, Y2] = W2S(i + 0.5, j + 0.5); drawArt(d.type, X2, Y2, t, d.o); } }); }
    }
    if (weather === "snow") { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = "rgba(240,246,255,0.32)"; ctx.fillRect(0, hz, RW, RH); ctx.globalCompositeOperation = "source-over"; }
    if (weather === "rain" && !sc.indoor) for (let k = 0; k < 6; k++) { const px = 1 + hash2(k, 3) * (sc.W - 2), py = 1 + hash2(k, 4) * (sc.H - 2); if (sc.walk(tileAt(px, py))) { const [X, Y] = W2S(px, py); ART.puddle(ctx, X, Y, t); } }
    // 物件
    for (const o of objs) {
      if (o.type === "void") { if (o.act === "ring") draws.push({ d: o.x + o.y, f: () => drawRing(o, t) }); continue; }
      draws.push({ d: o.x + o.y + (o.type === "door" || o.type === "window" || o.type === "frame" || o.type === "ladder" && o.y < 1 ? -3 : 0), id: o.id, f: () => {
        let [X, Y] = W2S(o.x, o.y);
        if (o.type === "boat") { X += REDUCED ? 0 : Math.round(Math.sin(t * 0.006) * 46); Y += REDUCED ? 0 : Math.round(Math.sin(t * 0.05)); }
        if (o.shake > 0) X += Math.round(Math.sin(o.shake * 0.9) * 2);
        const oo = { ...o.o, on: o.on || (o.type === "lamp" && night > 0.5), lit: night > 0.4, shake: o.shake, snow: weather === "snow", glow: night > 0.5, stage: o.plant ? plant(o.plant).stage : undefined };
        if (o.type === "pot") { ART.pot(ctx, X, Y, t, oo); drawPlant(ctx, X, Y - 8, plant(o.plant).stage, t, o.o.flower); if (plant(o.plant).watered === dayKey()) P(ctx, X + 5, Y - 14, "#8ac8ff", 2, 2); }
        else drawArt(o.type, X, Y, t, oo);
      } });
    }
    if (sc.id === "plaza") draws.push({ d: 2.2, f: () => drawGarland(t) });
    if (sc.id === "plaza") for (let k = 0; k < living.walkers; k++) {
      // 行人：沿着广场后街和前街来回走（确定性轨迹，减少动效时站着不动）
      const row = k % 2 ? 1.3 : 10.9, span = 12, sp = 0.004 + (k % 3) * 0.0012, ph = (k * 0.37) % 1;
      let u = REDUCED ? ph : (t * sp + ph) % 2; const dir = u < 1 ? 1 : -1; if (u >= 1) u = 2 - u;
      const x = 1 + u * span, y = row + (k % 3) * 0.25;
      draws.push({ d: x + y, f: () => { const [X, Y] = W2S(x, y); drawWalker(X, Y, k, dir, t); } });
    }
    for (const b of items) draws.push({ d: b.x + b.y, f: () => { const [X, Y] = W2S(b.x, b.y); shadow(X, Y, b.z); ART[b.kind](ctx, X, Y - Math.round(b.z), t); } });
    for (const f of finds) draws.push({ d: f.x + f.y, f: () => { const [X, Y] = W2S(f.x, f.y, f.drop || 0); const tw = REDUCED ? 0 : Math.sin(t * 0.1 + f.x) > 0.7; if (f.kind === "leaf") { P(ctx, X - 2, Y - 3, "#e8a35a", 4, 2); P(ctx, X - 1, Y - 4, "#ffd36b", 2, 1); } else ART[f.kind]?.(ctx, X, Y, t, { glow: night > 0.5 }); if (tw) P(ctx, X + 3, Y - 6, "#fff8d0"); } });
    for (const c of crit) if (!c.hide) draws.push({ d: c.x + c.y + (c.z > 20 ? 2 : 0), f: () => { const [X, Y] = W2S(c.x, c.y); if (c.kind !== "firefly" && c.kind !== "butterfly") shadow(X, Y, c.z); CRITTER[c.kind](ctx, X, Y, t, c); } });
    draws.push({ d: D.x + D.y + (D.task?.act === "bed" || D.task?.act === "bench" ? 0.6 : 0) - (seek ? 0.4 : 0), id: "olo", f: D.hidden || chat ? () => {} : drawPlayer });
    draws.sort((a, b) => a.d - b.d);
    for (const q of draws) q.f();
    if (tick % 15 === 1 || REDUCED) host.dataset.order = draws.filter((q) => q.id).map((q) => q.id).join(",");
    // 光影：夜里整体压暗，灯和萤火虫加亮
    const dim = sc.indoor ? night * 0.28 : night * 0.55 + (weather === "rain" ? 0.12 : 0) + (weather === "fog" ? 0.04 : 0);
    if (dim > 0.02) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = sc.indoor ? `rgba(40,20,30,${dim})` : `rgba(18,20,58,${dim})`; ctx.fillRect(0, 0, RW, RH); ctx.globalCompositeOperation = "source-over"; }
    if (L.phase === "dusk" || L.phase === "dawn") { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = "rgba(255,140,80,0.1)"; ctx.fillRect(0, 0, RW, RH); ctx.globalCompositeOperation = "source-over"; }
    ctx.globalCompositeOperation = "lighter";
    const glow = (X, Y, r, col, a = 1) => { ctx.globalAlpha = a; const g = glowSprite(r, col); ctx.drawImage(g, X - r, Y - r); ctx.globalAlpha = 1; };
    const lampOn = night > 0.35;
    for (const o of objs) { if (!o.light) continue; const on = o.type === "lamp" ? o.on || lampOn : o.on || (sc.indoor && night > 0.3 && o.type === "stove"); if (!on) continue; const [X, Y] = W2S(o.x, o.y); glow(X + o.light[0], Y + o.light[1], o.light[2], o.light[3], 0.55); }
    if (sc.id === "plaza" && lampOn) GARLAND.forEach(([x, y], k) => { const [X, Y] = W2S(x, y, 28); glow(X, Y + 3, 9, living.lanterns[k % living.lanterns.length], 0.5 * night * living.lanternGlow); });
    if (sc.id === "plaza" && night > 0.4) { const d = objs.find((o) => o.id === "door"); const [X, Y] = W2S(d.x, d.y); glow(X, Y - 26, 18, "#ffd98a", 0.4); }
    if (sc.indoor) { const w = objs.find((o) => o.type === "window"); if (w) { const [X, Y] = W2S(w.x, w.y); glow(X, Y - 26, 24, night > 0.5 ? "#8ab0ff" : "#fff4c8", 0.35); } }
    for (const c of crit) if (c.kind === "firefly" && !c.hide) { const [X, Y] = W2S(c.x, c.y, c.z); glow(X, Y, c.flash ? 12 : 6, "#e8ff8a", (c.flash ? 0.9 : 0.6) * (REDUCED ? 1 : 0.6 + 0.4 * Math.sin(t * 0.2 + c.seed * 20))); }
    for (const f of finds) if (f.kind === "mushroom" && night > 0.5) { const [X, Y] = W2S(f.x, f.y); glow(X, Y - 4, 7, "#8ae8ff", 0.5); }
    if (p.form === "glow" || night > 0.5) { const [X, Y] = W2S(D.x, D.y, D.z); if (!D.hidden && !chat) glow(X, Y - 16, 16, "#fff0b0", 0.25 + night * 0.15); }
    ctx.globalCompositeOperation = "source-over";
    // 粒子（屏幕空间）
    for (const q of parts) drawPart(q, t);
    if (shooting) { for (let k = 0; k < 10; k++) P(ctx, shooting.x - shooting.vx * k * 1.5, shooting.y - shooting.vy * k * 1.5, k < 2 ? "#ffffff" : `rgba(255,240,200,${1 - k / 10})`, 2, 1); }
    if (bite) { const [X, Y] = W2S(D.x, D.y, 40); P(ctx, X - 1, Y - 8, "#ff6f96", 2, 6); P(ctx, X - 1, Y, "#ff6f96", 2, 2); }
    drawWeather(hz, t);
    // 镜头外的出口提示
    for (const ex of sc.exits) { const [X, Y] = W2S(clamp((ex.x0 + ex.x1) / 2, 0, sc.W), clamp((ex.y0 + ex.y1) / 2, 0, sc.H)); const b = REDUCED ? 0 : Math.round(Math.sin(t * 0.1) * 2); const dir = ex.x0 > sc.W / 2 ? 1 : -1; for (let k = 0; k < 4; k++) P(ctx, X + dir * (b + k), Y - 14 - k + (dir > 0 ? 0 : 0), "#fff4e0", 1, 1 + k * 2 > 7 ? 1 : 1 + k * 2); }
    if (fadeTo) { const a = fadeTo.k < 1 ? fadeTo.k : 2 - fadeTo.k; ctx.fillStyle = `rgba(20,12,30,${clamp(a, 0, 1)})`; ctx.fillRect(0, 0, RW, RH); }
    // 给测试/无障碍用的位置信息
    const [X, Y] = W2S(D.x, D.y, D.z), r = cv.getBoundingClientRect();
    host.dataset.x = String(Math.round(X / RW * r.width)); host.dataset.y = String(Math.round(Y / RH * r.height));
    if (bubbleT > 0) { bubble.style.left = `${clamp(X / RW * r.width, 90, r.width - 90)}px`; bubble.style.top = `${Math.max(56, Y / RH * r.height - 30 * K - 8)}px`; }
    if (tick % 10 === 0) placeSpots(r);
    frameMs = frameMs * 0.95 + (now() - t0) * 0.05; host.dataset.ms = frameMs.toFixed(2);
  }
  function placeSpots(r = cv.getBoundingClientRect()) {
    const k = r.width / RW || K;
    for (const b of spotsEl.children) {
      const o = objs.find((q) => q.id === b.dataset.spot); if (!o?.hit) continue;
      const [X, Y] = W2S(o.x, o.y), [w, h] = o.hit, y0 = Y - (o.hitY || 0);
      b.style.cssText = `left:${(X - w / 2) * k}px;top:${(y0 - h) * k}px;width:${w * k}px;height:${(h + 4) * k}px`;
    }
  }
  function shadow(X, Y, z) { const w = Math.max(4, 10 - z / 4); ctx.fillStyle = "rgba(20,10,30,0.28)"; ctx.fillRect(X - w / 2, Y - 1, w, 2); ctx.fillRect(X - w / 2 + 1, Y - 2, w - 2, 1); }
  function drawPlayer() {
    const T = D.task, st = D.mode === "held" ? "held" : D.react > 0 ? "happy" : T ? ACT[T.act]?.st || s.state : s.state;
    sctx.clearRect(0, 0, 48, 44);
    drawOlo(sctx, { form: p.form, color: p.color, hair: p.hair, eyes: p.eyes, cheeks: p.cheeks, state: st, t: REDUCED ? 0 : tick, ox: 8, oy: 8 });
    const [X, Y] = W2S(D.x, D.y);
    shadow(X, Y, D.z);
    const hopZ = D.mode === "walk" && !REDUCED ? Math.abs(Math.sin(D.hop * 1.6)) * 3 : D.hop > 0 && D.hop <= 1.001 && !REDUCED ? 0 : 0;
    const w = Math.round(32 * D.sx), h = Math.round(29 * D.sy), z = Math.round(D.z + hopZ + (D.react > 20 && !REDUCED ? Math.sin((45 - D.react) / 25 * Math.PI) * 8 : 0));
    ctx.save(); ctx.translate(X, Y - z);
    if (D.dir < 0) ctx.scale(-1, 1);
    if (T?.zzz && T.act === "bed") ctx.rotate(-Math.PI / 2 * 0.9);
    ctx.drawImage(spr, -w / 2, -h * (36 / 44) - 0, w, h);
    ctx.restore();
    if (seek) { ctx.globalAlpha = 0.6; P(ctx, X - 2, Y - z - 26, "#fff4e0", 4, 1); ctx.globalAlpha = 1; }
    if (T?.act === "fish") { const [BX, BY] = W2S(9.9, 6.9); ctx.strokeStyle = "#f4e8d8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X + 10, Y - 24); ctx.lineTo(BX, BY - (bite ? 0 : 1)); ctx.stroke(); P(ctx, X + 6, Y - 22, "#8a5a34", 1, 1); P(ctx, X + 7, Y - 23, "#8a5a34", 1, 1); P(ctx, X + 8, Y - 24, "#8a5a34", 2, 1); P(ctx, BX - 1, BY - 2 + (bite && tick % 10 < 5 ? 2 : 0), "#ff6f96", 3, 2); }
  }
  function drawWalker(X, Y, k, dir, t) {
    const [body, skin] = WALKER_COLS[k % WALKER_COLS.length], step = REDUCED ? 0 : ((t / 6) | 0) % 2;
    shadow(X, Y, 0);
    P(ctx, X - 2, Y - 3, "#3a2a30", 1, 3 - step); P(ctx, X + 1, Y - 3, "#3a2a30", 1, 2 + step);
    P(ctx, X - 3, Y - 10, "#2a1422", 7, 8); P(ctx, X - 2, Y - 9, body, 5, 6);
    P(ctx, X - 2, Y - 15, "#2a1422", 5, 6); P(ctx, X - 1, Y - 14, skin, 3, 4); P(ctx, X + (dir > 0 ? 1 : -1), Y - 13, "#2a1422", 1, 1);
    if (k % 3 === 0) P(ctx, X - 3, Y - 16, body, 7, 2); // 帽子
    if (k % 4 === 1) P(ctx, X + dir * 3, Y - 8, "#c8945a", 2, 3); // 提着篮子
  }
  const GARLAND = [[2.4, 2], [4.4, 2], [6.4, 2], [8.4, 2], [10.4, 2.6]];
  function drawGarland(t) {
    let prev = null;
    for (const [x, y] of GARLAND) {
      const [X, Y] = W2S(x, y, 28);
      if (prev) { for (let k = 0; k <= 12; k++) { const f = k / 12; P(ctx, prev[0] + (X - prev[0]) * f, prev[1] + (Y - prev[1]) * f + Math.sin(f * Math.PI) * 4, "#3a2a30"); } }
      if (prev && living.bunting) for (let k = 1; k < 6; k++) { const f = k / 6, bx = prev[0] + (X - prev[0]) * f, by = prev[1] + (Y - prev[1]) * f + Math.sin(f * Math.PI) * 4; P(ctx, bx - 1, by + 1, living.lanterns[k % 3], 3, 2); P(ctx, bx, by + 3, living.lanterns[k % 3], 1, 1); }
      ART.lantern(ctx, X, Y + 2, t, { col: living.lanterns[GARLAND.findIndex((g) => g[0] === x) % living.lanterns.length], on: L.night > 0.35 }); prev = [X, Y];
    }
  }
  function drawRing(o, t) { for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + (S.eggs.ring && L.night > 0.5 ? 0.4 : 0), [X, Y] = W2S(o.x + Math.cos(a) * 0.7, o.y + Math.sin(a) * 0.7); ART.mushroom(ctx, X, Y, t, { glow: L.night > 0.5 }); } }
  function drawWalls() {
    // 小屋：两面高墙从屏幕顶一直到地面，木地板铺满
    const [Ax, Ay] = W2S(0, 0), [Bx, By] = W2S(sc.W, 0), [Cx, Cy] = W2S(0, sc.H);
    ctx.fillStyle = "#3a2430"; ctx.fillRect(0, 0, RW, RH);
    const wallL = [[Cx, Cy], [Ax, Ay], [Ax, -10], [Cx, -10]], wallR = [[Ax, Ay], [Bx, By], [Bx, -10], [Ax, -10]];
    const fill = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };
    fill([[0, Cy], [Cx, Cy], [Cx, -10], [0, -10]], "#6a4a52"); fill([[Bx, By], [RW, By], [RW, -10], [Bx, -10]], "#8a6062");
    fill(wallL, "#a07870"); fill(wallR, "#c09488");
    for (let k = 1; k < 9; k++) { const f = k / 9; ctx.fillStyle = "rgba(255,240,220,0.08)"; const x = Ax + (Bx - Ax) * f, y = Ay + (By - Ay) * f; ctx.fillRect(x, -10, 1, y + 10); }
    ctx.fillStyle = "#6a4228"; for (const [a, b] of [[[Ax, Ay], [Bx, By]], [[Ax, Ay], [Cx, Cy]]]) for (let k = 0; k <= 40; k++) { const f = k / 40; ctx.fillRect(a[0] + (b[0] - a[0]) * f - 1, a[1] + (b[1] - a[1]) * f - 4, 3, 4); }
  }
  function drawHorizon(hz, t) {
    // 远处：一排房顶/树林的剪影 + 地平线的雾带（天空透明，露出底下的天色背景）
    const far = sc.id === "lake" ? "#3e5a48" : sc.id === "roof" ? "#4a3446" : "#5a6a5e", night = L.night;
    for (let x = 0; x < RW; x += 2) {
      const wx = x + cam.x * 0.3;
      const h = sc.id === "roof" ? 10 + ((wx / 18 | 0) % 3) * 8 + (hash2(wx / 18 | 0, 2) < 0.3 ? 6 : 0) : sc.id === "lake" ? 8 + Math.abs(Math.sin(wx * 0.07)) * 12 + hash2(wx / 6 | 0, 1) * 4 : 6 + ((wx / 14 | 0) % 4) * 4 + Math.sin(wx * 0.03) * 3;
      ctx.fillStyle = far; ctx.fillRect(x, hz - h, 2, h + 40);
      if ((sc.id === "roof" || sc.id === "plaza") && (wx | 0) % (sc.id === "roof" ? 18 : 14) < 2) {
        const b = Math.floor(wx / (sc.id === "roof" ? 18 : 14)), on = windowLit(((b % 24) + 24) % 24, living.lit);
        ctx.fillStyle = on ? (night > 0.3 ? "#ffd98a" : "#f4c890") : "rgba(30,24,40,0.35)"; ctx.fillRect(x + 4, hz - h + 3, 2, 2);
      }
    }
    const fogA = weather === "fog" ? 0.75 : 0.4;
    for (let k = 0; k < 10; k++) { ctx.fillStyle = `rgba(232,226,240,${fogA * (1 - k / 10)})`; ctx.fillRect(0, hz - 4 + k * 3, RW, 3); }
  }
  function drawWeather(hz, t) {
    if (sc.indoor) return; // 屋里只在窗外看得到天气
    if (weather === "rain") { ctx.fillStyle = "rgba(200,220,250,0.55)"; for (const f of flakes) ctx.fillRect(f.x | 0, f.y | 0, 1, 4); }
    if (weather === "snow") { ctx.fillStyle = "#f8fbff"; for (const f of flakes) ctx.fillRect(f.x | 0, f.y | 0, f.s > 0.7 ? 2 : 1, f.s > 0.7 ? 2 : 1); }
    if (weather === "fog" || (!sc.indoor && L.phase === "dawn")) {
      for (let k = 0; k < 4; k++) { const y = hz + 20 + k * (RH - hz) / 4, off = REDUCED ? 0 : (t * (0.2 + k * 0.1)) % RW; ctx.fillStyle = `rgba(236,232,244,${weather === "fog" ? 0.16 : 0.08})`; for (let x = -RW; x < RW * 2; x += 90) ctx.fillRect(x + off, y + Math.sin((x + k * 40) * 0.05) * 6, 70, 10); }
    }
    if (sc.indoor && weather !== "clear") { /* 屋里只在窗外看得到天气 */ }
  }
  function drawPart(q, t) {
    const a = clamp(q.life / 30, 0, 1);
    if (q.kind === "heart") { const X = q.sx, Y = q.sy; ctx.globalAlpha = a; P(ctx, X, Y, "#ff6f96", 2, 2); P(ctx, X + 3, Y, "#ff6f96", 2, 2); P(ctx, X, Y + 2, "#ff6f96", 5, 1); P(ctx, X + 1, Y + 3, "#ff6f96", 3, 1); P(ctx, X + 2, Y + 4, "#ff6f96"); ctx.globalAlpha = 1; return; }
    if (q.kind === "note") { ctx.globalAlpha = a; P(ctx, q.sx, q.sy, "#fff4e0", 2, 2); P(ctx, q.sx + 2, q.sy - 5, "#fff4e0", 1, 6); ctx.globalAlpha = 1; return; }
    if (q.kind === "z") { ctx.globalAlpha = a; P(ctx, q.sx, q.sy, "#fff4e0", 4, 1); P(ctx, q.sx + 2, q.sy + 1, "#fff4e0", 1, 1); P(ctx, q.sx + 1, q.sy + 2, "#fff4e0", 1, 1); P(ctx, q.sx, q.sy + 3, "#fff4e0", 4, 1); ctx.globalAlpha = 1; return; }
    if (q.kind === "text") { ctx.globalAlpha = clamp(q.life / 20, 0, 1); ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#2a1422"; ctx.fillText(q.text, q.sx + 1, q.sy + 1); ctx.fillStyle = q.text.includes("◆") ? "#ffd36b" : "#fff4e0"; ctx.fillText(q.text, q.sx, q.sy); ctx.globalAlpha = 1; return; }
    if (q.kind === "splash") { P(ctx, q.sx - 1, q.sy, "rgba(220,235,255,0.7)", 1, 1); P(ctx, q.sx + 1, q.sy - 1, "rgba(220,235,255,0.7)", 1, 1); return; }
    const [X, Y] = W2S(q.x, q.y, q.z || 0);
    if (q.kind === "ring") { ctx.globalAlpha = a; const r = 6 - q.life / 6; ctx.fillStyle = "#fff4e0"; ctx.fillRect(X - r, Y, r * 2, 1); ctx.fillRect(X - r / 2, Y - 1, r, 1); ctx.fillRect(X - r / 2, Y + 1, r, 1); ctx.globalAlpha = 1; return; }
    if (q.kind === "petal") { P(ctx, X, Y, q.col, 2, 1); return; }
    if (q.kind === "drop") { P(ctx, X, Y, "#8ac8ff", 1, 2); return; }
    if (q.kind === "smoke") { ctx.globalAlpha = a * 0.6; P(ctx, X - 3 + Math.sin(q.life * 0.1) * 3, Y - 3, "#d8d0dc", 6, 4); ctx.globalAlpha = 1; return; }
    if (q.kind === "fishjump") { CRITTER.fish(ctx, X, Y, t, { z: 0 }); return; }
  }

  // ---------- 尺寸 / 循环 ----------
  function resize() {
    const r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    K = w < 520 ? 2 : w < 1100 ? 3 : 4;
    RW = Math.ceil(w / K); RH = Math.ceil(h / K); cv.width = RW; cv.height = RH; ctx.imageSmoothingEnabled = false; flakes = []; snapCam(); host.style.setProperty("--k", K);
  }
  mapBtn.addEventListener("click", () => { mapOpen = !mapOpen; mapEl.hidden = !mapOpen; mapBtn.setAttribute("aria-expanded", String(mapOpen)); sfx("select"); });
  for (const b of mapEl.querySelectorAll("[data-to]")) b.addEventListener("click", () => { if (b.dataset.to === sc.id) { mapEl.hidden = true; mapOpen = false; return; } travel(b.dataset.to); });
  $(".room-call").addEventListener("click", () => { const [cx, cy] = S2W(RW / 2, RH * 0.72); const [x, y] = walkable(cx, cy) ? [cx, cy] : nearestDry(cx, cy); walkTo(x, y, { act: "come" }); });
  $(".room-open")?.addEventListener("click", () => onOpenChat?.());
  addEventListener("keydown", onKey);
  function onKey(e) { if (chat || e.target.closest?.("input,textarea")) return; const k = { ArrowLeft: [-1, 1], ArrowRight: [1, -1], ArrowUp: [-1, -1], ArrowDown: [1, 1] }[e.key]; if (!k) return; e.preventDefault(); const x = D.x + k[0] * 0.8, y = D.y + k[1] * 0.8; if (walkable(x, y)) walkTo(x, y); }

  setMode("idle"); load(sc.id); setWeather(weather); relight(); doing(MOOD.idle);
  tokEl.textContent = api ? "◆ …" : "◆ —";
  setLiving(null);
  if (api) api("/v1/world/state").then(setLiving).catch(() => {});
  if (api) api("/v1/world").then((r) => {
    tokens = r.tokens; tokEl.textContent = `◆ ${tokens}`; host.dataset.tokens = String(tokens);
    for (const f of r.finds || []) found.add(f);
    if (r.state && Object.keys(r.state).length && !(S.saved > (r.state.saved || 0))) { const sc0 = S.scene; S = { ...S, ...r.state, scene: sc0 }; S.plants ||= {}; S.eggs ||= {}; S.taps ||= {}; rollDay(); }
    finds = finds.filter((f) => !found.has(f.id));
  }).catch(() => { tokEl.textContent = "◆ —"; });
  const _save = save; // 记录最后保存时间，给多端合并用
  setInterval(() => { S.saved = Date.now(); }, 60000);

  let raf = 0, alive = true, iv = 0, last = 0;
  const loop = (ts) => {
    if (!alive) return; raf = requestAnimationFrame(loop);
    if (paused) return;
    if (chat && ts - last < 32) return; // 聊天时世界当背景，降到 30fps
    last = ts; step(); render();
  };
  resize(); const ro = new ResizeObserver(resize); ro.observe(host);
  if (REDUCED) { render(); iv = setInterval(() => { if (!paused) { step(); render(); } }, 250); } else raf = requestAnimationFrame(loop);
  const iv2 = setInterval(relight, 20_000); addEventListener("olo:tz", relight);
  host.dataset.reduced = REDUCED ? "1" : "0";
  const api_ = {
    setState(st) { s.state = st; host.dataset.state = st; if (!D.task) doing(MOOD[st] || MOOD.idle); },
    setChat(v) { chat = !!v; render(); host.dataset.chat = chat ? "1" : "0"; host.classList.toggle("dim", chat); bubble.hidden = true; if (!chat) { ambient(sc.amb); snapCam(); D.idleT = 60; } },
    setPaused(v) { paused = !!v; },
    say,
    stop() { alive = false; cancelAnimationFrame(raf); clearInterval(iv); clearInterval(iv2); ro.disconnect(); removeEventListener("olo:tz", relight); removeEventListener("keydown", onKey); clearTimeout(saveT); },
  };
  if (debug) window.__oloWorld = { travel: (id) => { load(id); arrive(); }, setWeather, nextDay: () => { for (const pl of Object.values(S.plants)) if (pl.watered && pl.stage < 4) { pl.stage++; pl.watered = ""; } S.fishToday = 0; S.bunsToday = 0; S.flies = 0; S.stars = 0; save(); }, state: () => S, D, objs: () => objs, items: () => items, finds: () => finds, crit: () => crit, w2s: (x, y, z) => { const [X, Y] = W2S(x, y, z); const r = cv.getBoundingClientRect(); return [r.left + X / RW * r.width, r.top + Y / RH * r.height]; }, bite: () => { if (D.task?.act === "fish") { D.task.phase = "wait"; D.task.wait = 1; } }, setNight: (n) => { nightOv = n; relight(); }, setLiving, living: () => living };
  return api_;
}
