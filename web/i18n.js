// 界面语言：zh-CN / en。跟随 localStorage("olo.locale") → 浏览器语言。服务器上 olo 的回复语言由 /v1/me/locale 决定（两边同步）。
const DICT = {
  "zh-CN": {
    "login.title": "登录 olo", "login.email": "邮箱", "login.send": "发送验证码", "login.code": "验证码（6 位）", "login.go": "进入",
    "login.sent": "验证码已发到 {email}，10 分钟内有效。", "login.bad_email": "邮箱格式不对。", "login.bad_code": "验证码不对或已过期。",
    "login.too_soon": "发得太快了，一分钟后再试。", "login.dev": "开发者：用 API Token", "login.agree": "继续即表示同意<a href='/terms' target='_blank'>使用条款</a>和<a href='/privacy' target='_blank'>隐私政策</a>。",
    "ai.notice": "olo 是 AI，说的话可能出错，不能代替医生或心理咨询。", "ai.notice.crisis": "遇到危险请立即拨打 120 / 110，或心理援助热线 12356 / 400-161-9995。",
    "report.btn": "举报这条回复", "report.ask": "这条回复哪里不对？（可留空）", "report.done": "收到，谢谢你告诉我们。",
    "settings.account": "账号", "settings.language": "语言", "settings.export": "导出我的数据", "settings.delete": "删除账号和所有数据",
    "settings.delete.confirm": "删除后无法恢复：聊天、记忆、日记、花园都会被清空。请输入 DELETE 确认。", "settings.deleted": "账号已删除。",
    "settings.logout": "退出登录", "settings.privacy": "隐私政策", "settings.terms": "使用条款", "settings.exporting": "正在打包…",
  },
  en: {
    "login.title": "Sign in to olo", "login.email": "Email", "login.send": "Send code", "login.code": "6-digit code", "login.go": "Enter",
    "login.sent": "We sent a code to {email}. It expires in 10 minutes.", "login.bad_email": "That email doesn't look right.", "login.bad_code": "Wrong or expired code.",
    "login.too_soon": "Too fast. Try again in a minute.", "login.dev": "Developer: use API token", "login.agree": "By continuing you agree to the <a href='/terms?lang=en' target='_blank'>Terms</a> and <a href='/privacy?lang=en' target='_blank'>Privacy Policy</a>.",
    "ai.notice": "olo is an AI. It can be wrong and is not a substitute for a doctor or therapist.", "ai.notice.crisis": "If you're in danger, call your local emergency number or a crisis line now.",
    "report.btn": "Report this reply", "report.ask": "What was wrong with this reply? (optional)", "report.done": "Thanks, we got your report.",
    "settings.account": "Account", "settings.language": "Language", "settings.export": "Export my data", "settings.delete": "Delete account and all data",
    "settings.delete.confirm": "This can't be undone: chats, memories, diary and garden are all erased. Type DELETE to confirm.", "settings.deleted": "Your account was deleted.",
    "settings.logout": "Sign out", "settings.privacy": "Privacy Policy", "settings.terms": "Terms of Use", "settings.exporting": "Packing…",
  },
};

export const LOCALES = [["zh-CN", "简体中文"], ["en", "English"]];

function detect() {
  try { const s = JSON.parse(localStorage.getItem("olo.locale")); if (DICT[s]) return s; } catch {}
  return /^en/i.test(navigator.language || "") ? "en" : "zh-CN";
}

let current = detect();
document.documentElement.lang = current;

export const locale = () => current;
export function setLocale(l) {
  current = DICT[l] ? l : "zh-CN";
  localStorage.setItem("olo.locale", JSON.stringify(current));
  document.documentElement.lang = current;
}
export function t(key, vars = {}) {
  const s = DICT[current][key] ?? DICT["zh-CN"][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
export const _DICT = DICT; // tests: both locales must have the same keys

// ---- 旧界面的英文：按中文原文查表（i18n-en.js），并自动翻译插进页面的文字 ----
import { EN, EN_PATTERNS } from "./i18n-en.js?v=20261026d";

const HAN = /[\u4e00-\u9fff]/;
/** 把一段中文界面文字换成当前语言；中文界面或查不到时原样返回。 */
export function tr(s) {
  if (current === "zh-CN" || typeof s !== "string" || !HAN.test(s)) return s;
  const key = s.trim();
  if (EN[key] !== undefined) return s.replace(key, EN[key]);
  for (const [re, out] of EN_PATTERNS) {
    const m = re.exec(key);
    if (m) return s.replace(key, out.replace(/\$(\d)/g, (_, i) => tr(m[+i] ?? "")));
  }
  return s;
}

const SKIP = "script,style,textarea,.msgs,[data-noi18n]";
const ATTRS = ["aria-label", "placeholder", "title", "alt"];
function localizeEl(el) {
  if (el.closest?.(SKIP)) return;
  for (const a of ATTRS) { const v = el.getAttribute?.(a); if (v && HAN.test(v)) { const n = tr(v); if (n !== v) el.setAttribute(a, n); } }
}
/** 翻译一棵 DOM 里的文字节点和无障碍属性（聊天记录和用户输入不动）。 */
export function localize(root) {
  if (current === "zh-CN" || !root) return;
  if (root.nodeType === 3) {
    const p = root.parentElement;
    if (p && !p.closest(SKIP) && HAN.test(root.data)) { const n = tr(root.data); if (n !== root.data) root.data = n; }
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { if (root.closest(SKIP)) return; localizeEl(root); }
  const w = document.createTreeWalker(root, 5 /* element + text */);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 1) localizeEl(n);
    else localize(n);
  }
}
if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  const start = () => {
    localize(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "childList") m.addedNodes.forEach(localize);
        else if (m.type === "characterData") localize(m.target);
        else if (m.type === "attributes") localizeEl(m.target);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
}
