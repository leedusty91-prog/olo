// 宽屏桌面：把 /app 放进居中的 390x844 手机框（iframe 内才是真实手机宽度）。
// 窄屏、iframe 内、手机 App 的 WebView（OLO_NATIVE_SHELL / ReactNativeWebView）里都直接全屏，不套框。
// 令牌只在同源 localStorage 里共享，不进 URL。
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (window.top !== window || q.has("embed") || q.has("noframe")) return;
    if (window.OLO_NATIVE_SHELL || window.ReactNativeWebView || /\bwv\b|OloShell/i.test(navigator.userAgent)) return;
    if (!window.matchMedia("(min-width: 601px)").matches) return;
  } catch (e) { return; }
  window.OLO_PHONE_FRAME = true;
  // 后面的页面内容（含 app.js）变成不执行的文本，外层只留手机框
  document.write('<plaintext style="display:none">');
  q.set("embed", "phone");
  var src = location.pathname + "?" + q.toString() + location.hash;
  var html = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>olo</title><style>html,body{margin:0;height:100%;background:#1a0e16;overflow:hidden}' +
    '#pf{position:absolute;left:50%;top:50%;width:390px;height:844px;transform-origin:center;' +
    'border-radius:44px;border:10px solid #0b0609;box-shadow:0 0 0 2px #3a2430,0 24px 60px rgba(0,0,0,.55);overflow:hidden;background:#000}' +
    '#pf iframe{width:100%;height:100%;border:0;display:block}</style></head>' +
    '<body><div id="pf"><iframe id="olo-phone" title="olo" allow="microphone; autoplay; clipboard-write"></iframe></div></body>';
  function build() {
    document.documentElement.innerHTML = html;
    var f = document.getElementById("olo-phone");
    f.src = src;
    var pf = document.getElementById("pf");
    function fit() {
      var s = Math.min(1, (innerHeight - 24) / 864, (innerWidth - 24) / 410);
      pf.style.transform = "translate(-50%,-50%) scale(" + s + ")";
    }
    fit(); addEventListener("resize", fit);
    // 窗口拉窄到手机宽度：直接全屏打开
    matchMedia("(max-width: 600px)").addEventListener("change", function (e) {
      if (e.matches) location.replace(src.replace(/embed=phone/, "noframe=1"));
    });
  }
  document.addEventListener("DOMContentLoaded", build);
})();
