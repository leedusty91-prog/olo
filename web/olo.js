// olo 角色：原创 SVG 灯籽，三种形态，四种状态（idle / talking / happy / sad / thinking）
export const COLORS = {
  mint: ["#bff3d6", "#7fd6a6"],
  sky: ["#cfe8ff", "#86bdf2"],
  sun: ["#ffeaa8", "#ffc95e"],
  blush: ["#ffd9e2", "#f6a1b6"],
  lavender: ["#e6dcff", "#b49cf0"],
};

function body(form, fill, edge, gid) {
  if (form === "cloud") {
    return `<path class="olo-body" d="M40 118c-18 0-28-12-26-26 2-12 12-19 22-18 3-16 17-27 34-25 14 1 24 10 27 22 13-2 25 8 25 23 0 14-11 24-25 24z" fill="url(#${gid})" stroke="${edge}" stroke-width="3"/>`;
  }
  if (form === "glow") {
    return `<circle class="olo-halo" cx="80" cy="84" r="48" fill="${fill}" opacity=".25"/>
      <circle class="olo-halo2" cx="80" cy="84" r="38" fill="${fill}" opacity=".35"/>
      <circle class="olo-body" cx="80" cy="84" r="28" fill="url(#${gid})" stroke="${edge}" stroke-width="2"/>`;
  }
  return `<path class="olo-body" d="M80 34c30 0 50 24 50 52 0 24-20 38-50 38s-50-14-50-38c0-28 20-52 50-52z" fill="url(#${gid})" stroke="${edge}" stroke-width="3"/>`;
}

let uid = 0;
export function oloSVG({ form = "buddy", color = "mint", state = "idle", size = 160 } = {}) {
  const gid = `og${++uid}`;
  const [fill, edge] = COLORS[color] || COLORS.mint;
  const glow = form === "glow";
  const eyeY = glow ? 80 : form === "cloud" ? 88 : 80;
  const eyeDx = glow ? 10 : 17;
  const eyeR = glow ? 3.6 : 5.5;
  const mouthY = eyeY + (glow ? 10 : 15);
  const sproutY = glow ? 46 : form === "cloud" ? 50 : 36;
  return `
  <svg class="olo olo-${form} is-${state}" viewBox="0 0 160 160" width="${size}" height="${size}" role="img" aria-label="olo">
    <defs>
      <radialGradient id="${gid}" cx="40%" cy="35%" r="70%">
        <stop offset="0%" stop-color="#fffdf5"/>
        <stop offset="45%" stop-color="${fill}"/>
        <stop offset="100%" stop-color="${edge}"/>
      </radialGradient>
    </defs>
    <ellipse class="olo-shadow" cx="80" cy="140" rx="${glow ? 22 : 38}" ry="6" fill="#000" opacity=".18"/>
    <g class="olo-float">
      <g class="olo-sprout" style="transform-origin:80px ${sproutY + 10}px">
        <path d="M80 ${sproutY + 10} C80 ${sproutY} 78 ${sproutY - 6} 74 ${sproutY - 10}" stroke="#5cb886" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path class="leaf-l" d="M76 ${sproutY - 4} c-12 -2 -18 -12 -14 -18 c8 0 14 8 14 18z" fill="#7fd6a6"/>
        <path class="leaf-r" d="M79 ${sproutY - 2} c10 -8 20 -6 22 0 c-6 6 -14 6 -22 0z" fill="#9be3b9"/>
      </g>
      ${body(form, fill, edge, gid)}
      <circle class="olo-core" cx="80" cy="${eyeY + 4}" r="${glow ? 9 : 14}" fill="#fff6c9" opacity=".55"/>
      <g class="olo-eyes">
        <ellipse class="eye" cx="${80 - eyeDx}" cy="${eyeY}" rx="${eyeR}" ry="${eyeR + 1}" fill="#2c2a3a"/>
        <ellipse class="eye" cx="${80 + eyeDx}" cy="${eyeY}" rx="${eyeR}" ry="${eyeR + 1}" fill="#2c2a3a"/>
        <circle cx="${80 - eyeDx + 1.8}" cy="${eyeY - 2}" r="1.6" fill="#fff"/>
        <circle cx="${80 + eyeDx + 1.8}" cy="${eyeY - 2}" r="1.6" fill="#fff"/>
      </g>
      <g class="olo-cheeks" opacity=".55">
        <ellipse cx="${80 - eyeDx - 9}" cy="${eyeY + 9}" rx="6" ry="3.5" fill="#ff9fb3"/>
        <ellipse cx="${80 + eyeDx + 9}" cy="${eyeY + 9}" rx="6" ry="3.5" fill="#ff9fb3"/>
      </g>
      <path class="olo-mouth mouth-smile" d="M${80 - 6} ${mouthY} q6 6 12 0" stroke="#2c2a3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <ellipse class="olo-mouth mouth-talk" cx="80" cy="${mouthY + 2}" rx="5" ry="4" fill="#2c2a3a"/>
      <path class="olo-mouth mouth-sad" d="M${80 - 6} ${mouthY + 4} q6 -5 12 0" stroke="#2c2a3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <circle class="olo-mouth mouth-o" cx="80" cy="${mouthY + 2}" r="3" fill="#2c2a3a"/>
      <g class="olo-sparkles">
        <path d="M128 40 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#fff3b0"/>
        <path d="M30 52 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#fff3b0"/>
      </g>
      <g class="olo-dots" fill="#fff" opacity=".9">
        <circle cx="120" cy="40" r="3"/><circle cx="131" cy="30" r="4"/><circle cx="144" cy="18" r="5"/>
      </g>
    </g>
  </svg>`;
}

export function setOloState(container, state) {
  const svg = container?.querySelector("svg.olo");
  if (!svg) return;
  svg.classList.remove("is-idle", "is-talking", "is-happy", "is-sad", "is-thinking");
  svg.classList.add(`is-${state}`);
}

const SAD = ["难过", "累", "烦", "哭", "焦虑", "压力", "孤独", "失眠", "崩溃", "委屈", "害怕", "不开心"];
const HAPPY = ["开心", "高兴", "太好了", "哈哈", "成功", "喜欢", "谢谢", "棒", "终于"];
export function moodOf(text) {
  if (SAD.some((w) => text.includes(w))) return "sad";
  if (HAPPY.some((w) => text.includes(w))) return "happy";
  return "idle";
}
