"""Render the web pixel olo (web/pixel.js drawOlo) into sprite sheets for the mobile app.

Usage: python scripts/gen_mobile_sprites.py   (needs playwright + chromium)
Output: apps/mobile/assets/olo/<form>-<state>.png, FRAMES frames of 32x32 scaled ×SCALE, side by side.
"""

import base64
import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/mobile/assets/olo"
FORMS = {"buddy": "sun", "cloud": "sky", "glow": "lavender"}  # same as web FORM_COLOR
STATES = ["idle", "happy", "talking", "sad", "thinking"]
FRAMES, SCALE, PERIOD = 12, 8, 26.0  # PERIOD in drawOlo t units (10 = 1 s)

JS = """
async ([form, color, state, frames, scale, period]) => {
  const { drawOlo } = await import('/pixel.js');
  const src = document.createElement('canvas'); src.width = src.height = 32;
  const sctx = src.getContext('2d');
  const out = document.createElement('canvas'); out.width = 32 * scale * frames; out.height = 32 * scale;
  const octx = out.getContext('2d'); octx.imageSmoothingEnabled = false;
  for (let i = 0; i < frames; i++) {
    sctx.clearRect(0, 0, 32, 32);
    drawOlo(sctx, { form, color, state, t: 3 + i * period / frames });
    octx.drawImage(src, 0, 0, 32, 32, i * 32 * scale, 0, 32 * scale, 32 * scale);
  }
  return out.toDataURL('image/png');
}
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "web"))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.emulate_media(reduced_motion="no-preference")
        page.goto(f"http://127.0.0.1:{port}/fonts/README.md")
        for form, color in FORMS.items():
            for state in STATES:
                url = page.evaluate(JS, [form, color, state, FRAMES, SCALE, PERIOD])
                (OUT / f"{form}-{state}.png").write_bytes(base64.b64decode(url.split(",", 1)[1]))
        browser.close()
    httpd.shutdown()
    print(f"wrote {len(FORMS) * len(STATES)} sheets to {OUT}")


if __name__ == "__main__":
    main()
