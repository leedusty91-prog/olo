import { Mirror } from './mirror.js';
import { FORMS } from './forms.js';
export function chars({ pixel = 1 } = {}) {
  const m = new Mirror(document.querySelector('canvas'), { pixel }); window.__m = m;
  m.setGrid(FORMS); const hud = document.querySelector('.hud');
  m.loop(() => { hud.textContent = `${m.fps().toFixed(0)} fps · 10 forms · ${m.c.width}×${m.c.height}`; });
}
