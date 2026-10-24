// 日记小短片：把一篇日记在浏览器里现场画成几秒钟的像素动画（标题、olo 出场、逐字字幕、落款），
// 可以重播、存成 webm（canvas.captureStream + MediaRecorder）或直接分享。不依赖任何库，全部程序绘制。
import { drawOlo, REDUCED, P } from "./pixel.js";

export const CW = 320, CH = 180;
const SAD = ["难过", "累", "烦", "哭", "焦虑", "压力", "孤独", "失眠", "崩溃", "委屈", "害怕", "不开心", "低落", "叹气"];
const HAPPY = ["开心", "高兴", "太好了", "哈哈", "成功", "喜欢", "谢谢", "棒", "终于", "被夸", "笑", "甜", "暖"];
const MOTIFS = [["猫", "cat"], ["鱼", "fish"], ["花", "flower"], ["星", "star"], ["月", "star"], ["雨", "rain"], ["雪", "snow"], ["包子", "bun"], ["灯", "lamp"], ["面试", "star"], ["咖啡", "cup"], ["茶", "cup"]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => 1 - (1 - clamp(k, 0, 1)) ** 3;
const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

export function clipScript(entry, name = "olo") {
  const body = String(entry?.body || ""), all = `${entry?.title || ""}\n${body}`;
  const sad = SAD.filter((w) => all.includes(w)).length, happy = HAPPY.filter((w) => all.includes(w)).length;
  const mood = happy > sad ? "happy" : sad > happy ? "sad" : "calm";
  const lines = body.split(/\n+/).map((t) => t.replace(/^[「『]|[」』]$/g, "").trim()).filter(Boolean)
    .flatMap((t) => t.split(/(?<=[。！？!?])/)).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 3).map((t) => (t.length > 44 ? t.slice(0, 43) + "…" : t));
  const motifs = [...new Set(MOTIFS.filter(([w]) => all.includes(w)).map(([, m]) => m))].slice(0, 3);
  const night = /夜|晚|星|月|睡/.test(all), rain = motifs.includes("rain"), snow = motifs.includes("snow");
  return { title: String(entry?.title || "今天").slice(0, 18), date: String(entry?.entry_date || ""), lines: lines.length ? lines : ["今天也想把你记下来。"], mood, night, rain, snow, motifs, name: String(name).slice(0, 12) };
}
// 时间轴（毫秒）
export const timeline = (sc) => { const t0 = 2600, per = 2300; const end = t0 + sc.lines.length * per; return { title: [700, 2500], lines: sc.lines.map((_, i) => [t0 + i * per, t0 + (i + 1) * per]), outro: [end, end + 1400], total: end + 1400 }; };

function wrap(ctx, text, max) { const out = []; let cur = ""; for (const ch of text) { if (ctx.measureText(cur + ch).width > max && cur) { out.push(cur); cur = ch; } else cur += ch; } if (cur) out.push(cur); return out; }
const spr = typeof document !== "undefined" ? document.createElement("canvas") : null; if (spr) { spr.width = 48; spr.height = 44; }

export function drawClipFrame(ctx, sc, ms, look = {}) {
  const T = timeline(sc), t = ms / 16.7;
  ctx.imageSmoothingEnabled = false; ctx.textBaseline = "top";
  // 天空：按心情和白天黑夜分色带
  const bands = sc.night ? ["#1e1a40", "#2a2a5a", "#3a3a6e", "#4a4a7a"] : sc.mood === "sad" ? ["#6a7a94", "#7a8aa2", "#8c9ab0", "#a0acbe"] : sc.mood === "happy" ? ["#ffb88a", "#ffcc9a", "#ffe0b0", "#fff0c8"] : ["#a8c8e0", "#b8d4e8", "#c8dcee", "#dce8f2"];
  for (let i = 0; i < 4; i++) { ctx.fillStyle = bands[i]; ctx.fillRect(0, i * 34, CW, 34); }
  if (sc.night) for (let k = 0; k < 40; k++) { const tw = Math.sin(t * 0.08 + k) > 0.6; P(ctx, hash(k) * CW, hash(k + 50) * 110, tw ? "#ffffff" : "#c8c8f0"); }
  else { ctx.fillStyle = sc.mood === "happy" ? "#fff4c8" : "#fffaf0"; const sx = 250 - ms * 0.002; for (let j = -10; j <= 10; j++) { const w = Math.round(Math.sqrt(100 - j * j)); ctx.fillRect(sx - w, 36 + j, w * 2, 1); } }
  // 云 / 远山 / 草地
  for (let k = 0; k < 3; k++) { const x = ((hash(k + 9) * CW + t * (0.2 + k * 0.1)) % (CW + 80)) - 40, y = 20 + k * 22; ctx.fillStyle = sc.night ? "rgba(200,200,240,.18)" : "rgba(255,255,255,.75)"; ctx.fillRect(x | 0, y, 40, 6); ctx.fillRect((x + 8) | 0, y - 4, 22, 4); }
  for (let x = 0; x < CW; x += 2) { const h = 18 + Math.sin(x * 0.03) * 8 + Math.sin(x * 0.011 + 2) * 10; ctx.fillStyle = sc.night ? "#2a3050" : "#7a9a8a"; ctx.fillRect(x, 136 - h, 2, h); }
  ctx.fillStyle = sc.night ? "#2a4a3a" : sc.snow ? "#eef2f8" : "#72b25a"; ctx.fillRect(0, 130, CW, 50);
  ctx.fillStyle = sc.night ? "#22402f" : sc.snow ? "#d8e0ec" : "#5d9c4d"; for (let x = 0; x < CW; x += 7) ctx.fillRect(x + (x % 3), 132 + (x % 5), 2, 1);
  // 小屋 + 灯
  ctx.fillStyle = "#8a5a44"; ctx.fillRect(24, 104, 40, 28); ctx.fillStyle = "#c8463a"; for (let j = 0; j < 14; j++) ctx.fillRect(20 + j, 104 - j, 48 - j * 2, 1);
  ctx.fillStyle = sc.night ? "#ffd98a" : "#5a3a34"; ctx.fillRect(34, 112, 8, 8); ctx.fillStyle = "#4a2a22"; ctx.fillRect(48, 114, 9, 18);
  // 小物件（从日记里出现过的东西）
  sc.motifs.forEach((m, i) => {
    const x = 200 + i * 34, y = 128, b = REDUCED ? 0 : Math.round(Math.sin(t * 0.1 + i) * 1.5);
    if (m === "cat") { P(ctx, x, y - 6, "#3a2a30", 10, 6); P(ctx, x + 8, y - 10, "#3a2a30", 5, 5); P(ctx, x + 8, y - 12, "#3a2a30", 1, 2); P(ctx, x + 12, y - 12, "#3a2a30", 1, 2); P(ctx, x - 3, y - 9 + b, "#3a2a30", 2, 5); }
    if (m === "fish") { P(ctx, x, y - 14 + b, "#9ac8e8", 9, 4); P(ctx, x - 3, y - 15 + b, "#9ac8e8", 3, 6); P(ctx, x + 7, y - 13 + b, "#2a1422"); }
    if (m === "flower") { P(ctx, x + 2, y - 8, "#4a8a3a", 1, 8); P(ctx, x, y - 12 + b, "#ff8ab0", 5, 4); P(ctx, x + 2, y - 11 + b, "#ffd36b"); }
    if (m === "star") { P(ctx, x + 2, y - 40 + b, "#fff4a0", 1, 5); P(ctx, x, y - 38 + b, "#fff4a0", 5, 1); }
    if (m === "bun") { P(ctx, x, y - 6, "#f4e8d8", 9, 5); P(ctx, x + 2, y - 8, "#f4e8d8", 5, 2); }
    if (m === "lamp") { P(ctx, x + 2, y - 24, "#3a2a30", 1, 24); P(ctx, x, y - 28, sc.night ? "#ffd98a" : "#c8a44a", 5, 5); }
    if (m === "cup") { P(ctx, x, y - 7, "#f4f0e8", 7, 7); P(ctx, x + 7, y - 5, "#f4f0e8", 2, 3); P(ctx, x + 2, y - 12 - b, "rgba(240,240,250,.7)", 1, 3); }
  });
  // 天气
  if (sc.rain && !REDUCED) { ctx.fillStyle = "rgba(220,235,255,.7)"; for (let k = 0; k < 60; k++) ctx.fillRect(((hash(k) * CW - t * 2) % CW + CW) % CW, (hash(k + 3) * CH + t * 5) % CH, 1, 4); }
  if (sc.snow && !REDUCED) { ctx.fillStyle = "#ffffff"; for (let k = 0; k < 50; k++) ctx.fillRect((hash(k) * CW + Math.sin(t * 0.03 + k) * 6) % CW, (hash(k + 7) * CH + t * 0.8) % CH, 2, 2); }
  if (sc.mood === "happy" && !REDUCED) for (let k = 0; k < 10; k++) P(ctx, (hash(k + 1) * CW + t * 0.6) % CW, (hash(k + 2) * 130 + t * 0.5) % 130, "#ff8ab0", 2, 1);
  // olo：走进画面 → 停在中间 → 按心情做动作
  const walk = REDUCED ? 1 : ease((ms - 500) / 1900), ox = Math.round(-40 + walk * 190);
  const st = ms > T.lines[0][0] ? (sc.mood === "sad" ? "sad" : sc.mood === "happy" ? "happy" : "talking") : walk < 1 ? "idle" : "happy";
  const hop = REDUCED ? 0 : walk < 1 ? Math.abs(Math.sin(ms / 110)) * 4 : sc.mood === "happy" ? Math.max(0, Math.sin(ms / 260)) * 6 : 0;
  const sx = spr.getContext("2d"); sx.clearRect(0, 0, 48, 44); drawOlo(sx, { form: look.form, color: look.color, hair: look.hair, eyes: look.eyes, cheeks: look.cheeks, state: st, t: REDUCED ? 0 : t, ox: 8, oy: 8 });
  ctx.fillStyle = "rgba(20,10,30,.25)"; ctx.fillRect(ox - 12, 139, 24, 3);
  ctx.drawImage(spr, ox - 32, Math.round(140 - 48 - hop), 64, 59);
  if (sc.mood === "sad" && ms > T.lines[0][0] && !REDUCED) { const k = (ms / 400) % 1; P(ctx, ox + 14, 92 + k * 10, "#8ac8ff", 2, 3); }
  // 标题卡
  ctx.font = "16px FusionPixel, monospace"; const [a, b] = T.title;
  const tn = REDUCED ? 99 : Math.floor((ms - a) / 70); if (ms > a) { const txt = sc.title.slice(0, clamp(tn, 0, 99)), w = Math.min(300, ctx.measureText(sc.title).width + 24), x = (CW - w) / 2, y = 10 - (REDUCED ? 0 : Math.round(8 * (1 - ease((ms - a) / 300))));
    ctx.fillStyle = "rgba(42,20,34,.82)"; ctx.fillRect(x, y, w, 26); ctx.fillStyle = "#ffd36b"; ctx.fillRect(x, y + 25, w, 1); ctx.fillStyle = "#fff4e0"; ctx.fillText(txt, x + 12, y + 5); ctx.font = "12px FusionPixel, monospace"; ctx.fillStyle = "#e8c46a"; ctx.fillText(sc.date, x + w - ctx.measureText(sc.date).width - 6, y + 28); }
  // 字幕：一句一句逐字打出来
  ctx.font = "12px FusionPixel, monospace";
  T.lines.forEach(([s0, s1], i) => {
    if (ms < s0 || ms >= s1 && i < T.lines.length - 1 || ms >= T.outro[0]) return;
    const n = REDUCED ? 999 : Math.floor((ms - s0) / 55), rows = wrap(ctx, sc.lines[i], 284), shown = []; let left = n;
    for (const r of rows) { shown.push(r.slice(0, Math.max(0, left))); left -= r.length; }
    ctx.fillStyle = "rgba(42,20,34,.86)"; ctx.fillRect(10, 146, 300, 30); ctx.fillStyle = "#c8a44a"; ctx.fillRect(10, 146, 300, 1);
    ctx.fillStyle = "#fff4e0"; shown.slice(0, 2).forEach((r, k) => ctx.fillText(r, 18, 150 + k * 13));
    if (left > -2 && (ms / 300 | 0) % 2) P(ctx, 300, 168, "#ffd36b", 4, 4);
  });
  // 落款 + 开头结尾的圆形遮罩
  if (ms >= T.outro[0]) { const k = ease((ms - T.outro[0]) / 400); ctx.fillStyle = `rgba(42,20,34,${0.75 * k})`; ctx.fillRect(0, 0, CW, CH); ctx.font = "16px FusionPixel, monospace"; ctx.fillStyle = "#ffd36b"; const s = `—— ${sc.name} 的日记`; ctx.fillText(s, (CW - ctx.measureText(s).width) / 2, 76); ctx.font = "12px FusionPixel, monospace"; ctx.fillStyle = "#fff4e0"; ctx.fillText(sc.date, (CW - ctx.measureText(sc.date).width) / 2, 98); }
  if (!REDUCED) { const r = ms < 700 ? ease(ms / 700) * 200 : ms > T.total - 500 ? ease((T.total - ms) / 500) * 200 : 999; if (r < 200) { ctx.fillStyle = "#140a14"; for (let y = 0; y < CH; y++) { const dy = y - CH / 2, w = r > Math.abs(dy) ? Math.sqrt(r * r - dy * dy) : 0; ctx.fillRect(0, y, Math.max(0, CW / 2 - w), 1); ctx.fillRect(CW / 2 + w, y, CW, 1); } } }
}

// 弹出播放器
export function openDiaryClip(entry, look, name, { sfx = () => {} } = {}) {
  const sc = clipScript(entry, name), T = timeline(sc);
  const dlg = document.createElement("dialog"); dlg.className = "sheet px-box clip-sheet"; dlg.dataset.testid = "diary-clip";
  dlg.innerHTML = `<h3>${sc.title.replace(/[&<>]/g, "")} · 小短片</h3><canvas class="clip-canvas" width="${CW}" height="${CH}" data-testid="clip-canvas" role="img" aria-label="日记动画：${sc.lines.join(" ").replace(/"/g, "")}"></canvas>
    <div class="clip-bar"><i data-testid="clip-progress"></i></div>
    <div class="row"><button class="btn ghost px-box" value="replay" data-testid="clip-replay">↺ 重播</button><button class="btn ghost px-box" value="save" data-testid="clip-save">⇩ 存成视频</button>${navigator.share ? `<button class="btn ghost px-box" value="share" data-testid="clip-share">↗ 分享</button>` : ""}<button class="btn px-box" value="close" data-testid="clip-close">好</button></div>
    <small class="clip-msg" role="status" data-testid="clip-msg"></small>`;
  document.body.appendChild(dlg); dlg.showModal();
  const cv = dlg.querySelector("canvas"), ctx = cv.getContext("2d"), bar = dlg.querySelector(".clip-bar i"), msg = dlg.querySelector(".clip-msg");
  let raf = 0, start = 0, onEnd = null, blob = null;
  const frame = (ts) => {
    const ms = Math.min(T.total, ts - start);
    // 减少动效：不做连续动画，按段落停在每一段的完成态
    const q = REDUCED ? [T.title[1], ...T.lines.map((l) => l[1] - 1), T.total - 1].find((x) => x >= ms) ?? T.total - 1 : ms;
    drawClipFrame(ctx, sc, q, look); bar.style.width = `${(ms / T.total) * 100}%`; cv.dataset.t = String(Math.round(ms));
    if (ms >= T.total) { cv.dataset.done = "1"; onEnd?.(); onEnd = null; return; }
    raf = requestAnimationFrame(frame);
  };
  const play = () => { cancelAnimationFrame(raf); cv.dataset.done = "0"; start = performance.now(); raf = requestAnimationFrame(frame); };
  const record = () => new Promise((res, rej) => {
    if (!cv.captureStream || typeof MediaRecorder === "undefined") return rej(new Error("这个浏览器不支持录制"));
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
    const rec = new MediaRecorder(cv.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 2_500_000 } : undefined), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data); rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || "video/webm" })); rec.onerror = (e) => rej(e.error || new Error("录制失败"));
    rec.start(250); onEnd = () => setTimeout(() => rec.stop(), 120); play();
  });
  const file = async () => { if (!blob) { msg.textContent = "正在录一遍…"; blob = await record(); } return blob; };
  const fname = () => `olo-diary-${sc.date || "today"}.${String(blob?.type || "").includes("mp4") ? "mp4" : "webm"}`;
  dlg.addEventListener("click", async (e) => {
    const v = e.target.closest?.("button")?.value;
    if (v === "replay") { play(); sfx("page"); }
    if (v === "save" || v === "share") {
      const btns = dlg.querySelectorAll("[value=save],[value=share]"); btns.forEach((b) => (b.disabled = true));
      try {
        const b = await file(); dlg.dataset.bytes = String(b.size);
        const f = new File([b], fname(), { type: b.type });
        if (v === "share" && navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: sc.title }); msg.textContent = "分享出去啦。"; }
        else { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); msg.textContent = `存好了：${f.name}（${Math.max(1, Math.round(b.size / 1024))} KB）`; }
        sfx("sparkle");
      } catch (er) { msg.textContent = er?.name === "AbortError" ? "" : er?.message || "存不下来，换个浏览器试试"; }
      btns.forEach((b) => (b.disabled = false));
    }
    if (v === "close" || e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => { cancelAnimationFrame(raf); dlg.remove(); });
  play(); sfx("page");
  return dlg;
}
