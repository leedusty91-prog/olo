// 独立的雾里集页面：给手机 App 的 WebView / iframe 用。参数放在 # 后面（不进服务器日志）：
// #base=https://…&token=…&name=…&form=…&color=…&hair=…&eyes=…&cheeks=…&tz=…
import { setLocale } from "./i18n.js?v=20261026d";
import { mountWorld } from "./world.js?v=20261026d";
import { setUserTz, skyAt, bands, localHour } from "./skytime.js?v=20261023b";

const q = new URLSearchParams(location.hash.slice(1));
const base = (q.get("base") || "").replace(/\/$/, ""), token = q.get("token") || "";
if (q.get("tz")) setUserTz(q.get("tz"));
if (q.get("lang")) setLocale(q.get("lang"));
const p = { name: q.get("name") || "olo", form: q.get("form") || "buddy", color: q.get("color") || "sun", hair: q.get("hair") || "none", eyes: q.get("eyes") || "circle", cheeks: q.get("cheeks") || "round" };
history.replaceState(null, "", location.pathname + location.search); // 别把 token 留在地址栏
const api = token ? async (path, { method = "GET", body } = {}) => {
  const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
} : null;
const post = (m) => { try { window.ReactNativeWebView?.postMessage(JSON.stringify(m)); window.parent !== window && window.parent.postMessage(m, "*"); } catch {} };

// 天空：简单竖向色带（主站的动画天空太重，这里只画一张）
const bg = document.getElementById("bg");
function sky() { const c = bands(skyAt(localHour()).sky, 12); bg.width = 1; bg.height = c.length; const x = bg.getContext("2d"); c.forEach((col, i) => { x.fillStyle = col; x.fillRect(0, i, 1, 1); }); }
Object.assign(bg.style, { position: "fixed", inset: "0", width: "100%", height: "100%", imageRendering: "pixelated" });
sky(); setInterval(sky, 60_000);

const w = mountWorld(document.querySelector(".world-host"), p, { api, onOpenChat: () => post({ type: "openChat" }), debug: q.get("debug") === "1" });
w.setChat(false);
addEventListener("message", (e) => { if (e.data?.type === "mood") w.setState(e.data.state); });
