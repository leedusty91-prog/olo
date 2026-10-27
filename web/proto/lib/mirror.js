// 零依赖 WebGL2 "镜池" 渲染器：倒影国天空 + 水面 + 2.5D 折射水滴 olo。
// 一个全屏片元着色器，移动端友好；pixel>1 时先渲染到低分辨率再最近邻放大并做调色板抖动（像素混合方向）。
import { hex } from './forms.js';

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 R; uniform float T;
uniform vec3 CA, CB;           // 当前形态颜色
uniform vec4 RP[8];            // 涟漪: xy=位置(uv), z=开始时间, w=强度
uniform float FLIP;            // 0=正常，1=整个镜面翻转（开场用）
uniform float SHOW;            // olo 可见度
uniform float NIGHT;           // 0 黄昏粉彩 / 1 深夜
uniform float PIX;             // 像素模式：调色板量化 + 有序抖动
uniform float MOOD;            // 0 平静 1 开心(弹) -1 难过(塌)
uniform float GRID;            // >0: 角色卡网格模式，绘制 GRID 个水滴
uniform vec3 GA[10]; uniform vec3 GB[10];
uniform float HORIZON;
uniform float UP;               // 水面上方是否画 olo（开场里 olo 只在倒影中）

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }

// 水滴 SDF：圆身 + 顶部尖端（小旋儿）
float sdDrop(vec2 p, float r){
  p.y -= r*0.15;
  float c = length(p) - r;
  vec2 q = vec2(abs(p.x), p.y - r*0.55);
  float k = max(q.x*0.9 + q.y*0.42, -p.y) - r*0.62;   // 锥尖
  float h = 0.18*r;
  float m = clamp(0.5+0.5*(k-c)/h,0.,1.);
  return mix(k,c,m) - h*m*(1.-m);                      // smooth union
}

vec3 sky(vec2 uv){
  vec3 dusk = mix(vec3(1.,.86,.9), vec3(.73,.8,1.), uv.y);
  vec3 night= mix(vec3(.09,.1,.22), vec3(.02,.03,.09), uv.y);
  vec3 c = mix(dusk, night, NIGHT);
  // 双月
  vec2 m1 = uv - vec2(.72,.82), m2 = uv - vec2(.8,.88);
  c += vec3(1.,.97,.9)*smoothstep(.03,.026,length(m1*vec2(R.x/R.y,1.)))*(.6+.4*NIGHT);
  c += vec3(.8,.9,1.)*smoothstep(.016,.013,length(m2*vec2(R.x/R.y,1.)))*(.5+.5*NIGHT);
  // 倒雨（从下往上的细光点）
  float st = step(.997, hash(floor(vec2(uv.x*R.x/3., uv.y*R.y/3. - T*8.))));
  c += st*.5*NIGHT;
  // 远处倒影小镇的剪影（几何方块，无人）
  float bx = floor(uv.x*14.);
  float hgt = .05 + .07*hash(vec2(bx,3.));
  float town = step(uv.y, HORIZON + hgt) * step(HORIZON, uv.y) * (.35+.65*NIGHT);
  vec3 tc = mix(vec3(.95,.78,.86), vec3(.12,.12,.28), NIGHT);
  float win = step(.8,hash(floor(uv*vec2(56.,90.))))*step(uv.y, HORIZON+hgt-.012)*smoothstep(.6,1.,NIGHT);
  c = mix(c, tc + win*vec3(1.,.85,.5), town*.9);
  return c;
}

// 涟漪高度场的梯度
vec2 ripple(vec2 uv){
  vec2 g = vec2(0.);
  vec2 asp = vec2(R.x/R.y,1.);
  for(int i=0;i<8;i++){
    float age = T - RP[i].z; if(age<0. || age>5.) continue;
    vec2 d = (uv-RP[i].xy)*asp; d.y*=2.6;               // 透视压扁
    float r = length(d); float front = age*.22;
    float w = exp(-pow((r-front)*14.,2.)) * exp(-age*.7) * RP[i].w;
    g += normalize(d+1e-4) * sin((r-front)*60.) * w;
  }
  // 微风
  g += .006*vec2(noise(uv*vec2(6.,30.)+T*.3)-.5, noise(uv*vec2(5.,40.)-T*.2)-.5);
  return g;
}

// 画一颗水滴，返回 rgba
vec4 drop(vec2 p, float r, vec3 ca, vec3 cb, vec3 bg, float t){
  float sq = .06*sin(t*2.1) + .12*MOOD*max(0.,sin(t*7.));  // 呼吸/弹
  p.y *= 1. + sq; p.x *= 1. - sq*.6;
  if(MOOD<0.) { p.y *= 1.25; }
  float d = sdDrop(p, r);
  float a = smoothstep(.004, -.004, d);
  if(a<=0.) return vec4(0.);
  float k = clamp(-d/r,0.,1.);
  vec3 n = normalize(vec3(-p*.9/r, sqrt(k)*1.1 + .05));
  vec3 L = normalize(vec3(-.5,.7,.6));
  vec3 base = mix(cb, ca, clamp(p.y/r*.5+.6,0.,1.));
  // 折射：背景偏移后着色
  vec3 refr = bg*.35 + base*.75;
  float fres = pow(1.-n.z, 2.5);
  vec3 c = mix(refr, base, .55)*(.82+.25*n.y) + fres*.35*mix(vec3(1.),ca,.3);
  c = mix(c, cb*.85, .25*smoothstep(.1,-.9,p.y/r));
  c += pow(max(dot(reflect(-L,n),vec3(0,0,1)),0.),40.)*.9;      // 高光
  c += smoothstep(.02,.0,length(p-vec2(-.35*r,.45*r))-.06*r)*.8; // 小亮斑
  // 身体里的金色亮点
  for(int i=0;i<4;i++){
    float fi=float(i);
    vec2 sp = vec2(sin(t*.7+fi*2.1), cos(t*.5+fi*1.7))*r*.45 - vec2(0.,.1*r);
    c += vec3(1.,.82,.4)*smoothstep(.022*r+.004,0.,length(p-sp))*.9;
  }
  // 眼睛 + 腮红（简单，像素友好）
  vec2 e = vec2(abs(p.x)-.3*r, p.y+.02*r);
  float blink = step(.06, fract(t*.23));
  c = mix(c, vec3(.15,.13,.25), smoothstep(.05*r,.035*r,length(e*vec2(1.,mix(8.,1.,blink)))));
  c = mix(c, vec3(1.,.6,.7), .5*smoothstep(.09*r,.0,length(vec2(abs(p.x)-.48*r,p.y+.2*r))));
  return vec4(c, a*(.92));
}

vec3 dither(vec3 c, vec2 fc){
  // 4x4 Bayer + 每通道 6 阶量化
  int x=int(mod(fc.x,4.)), y=int(mod(fc.y,4.));
  int b[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  float th=((float(b[y*4+x])+.5)/16.-.5)*.55;
  return floor(c*7.+th+.5)/7.;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc/R;
  float asp0 = R.x/R.y;
  if(FLIP>0.){ float a = 3.14159265*smoothstep(0.,1.,FLIP); vec2 c=(uv-.5)*vec2(asp0,1.); c = mat2(cos(a),-sin(a),sin(a),cos(a))*c; uv = c/vec2(asp0,1.)+.5; } // 镜面翻滚 180°
  float asp = R.x/R.y;

  if(GRID>0.){                                         // 角色卡：5x2
    vec2 g = vec2(5.,2.); if(asp<1.) g = vec2(2.,5.);
    vec2 cell = floor(uv*g); vec2 lp = fract(uv*g)-vec2(.5,.45);
    lp.x *= (R.x/g.x)/(R.y/g.y);
    int idx = int(cell.y*g.x+cell.x); if(asp<1.) idx = int((g.y-1.-cell.y)*g.x+cell.x); else idx=int((g.y-1.-cell.y)*g.x+cell.x);
    vec3 bg = mix(vec3(.98,.93,.96), vec3(.86,.9,1.), uv.y);
    vec3 ca=GA[0], cb=GB[0];
    for(int i=0;i<10;i++) if(i==idx){ ca=GA[i]; cb=GB[i]; }
    float sh = smoothstep(.2,.0,length(lp*vec2(1.,4.)+vec2(0.,1.2)));
    bg -= sh*.08;
    vec4 d = drop(lp+vec2(0.,.03*sin(T*1.6+float(idx))), .24, ca, cb, bg, T+float(idx));
    vec3 c = mix(bg, d.rgb, d.a);
    if(PIX>0.) c = dither(c, fc);
    o = vec4(c,1.); return;
  }

  float H = HORIZON;
  float DR = asp<1. ? .072 : .1;
  vec2 dp = vec2(.5, H + DR*1.75 + .012*sin(T*1.3));         // olo 位置（站在水面上方）
  vec3 col;
  if(uv.y > H){
    col = sky(uv);
    vec2 p = (uv-dp)*vec2(asp,1.);
    vec4 d = drop(p, DR, CA, CB, col, T);
    col = mix(col, d.rgb, d.a*SHOW*UP);
  } else {
    // 水面：镜像采样 + 涟漪扰动 + 菲涅尔
    vec2 g = ripple(uv);
    float depth = (H-uv.y)/H;
    vec2 m = vec2(uv.x, 2.*H-uv.y) + g*(.6+depth);
    vec3 refl = sky(m);
    vec2 p = (m-dp)*vec2(asp,1.);
    vec4 d = drop(p, DR, CA, CB, refl, T);
    refl = mix(refl, d.rgb, d.a*SHOW*.85);
    vec3 deep = mix(vec3(.55,.66,.9), vec3(.03,.05,.12), NIGHT);
    float fres = .35 + .65*pow(1.-depth,3.);
    col = mix(deep, refl, fres);
    col += vec3(1.)*clamp(g.y*5.,0.,.18);                 // 涟漪高光
    col *= .92 + .08*smoothstep(.0,.004,abs(uv.y-H+.002));       // 水线
  }
  col *= 1. - .25*pow(length(uv-.5)*1.2, 2.);                    // 暗角
  if(PIX>0.) col = dither(col, fc);
  o = vec4(col,1.);
}`;

export class Mirror {
  constructor(canvas, opts = {}) {
    this.c = canvas; this.pix = opts.pixel || 1; this.dprCap = opts.dprCap || 2;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no webgl2');
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const pr = this.pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.u = {}; for (const n of ['R', 'T', 'CA', 'CB', 'RP', 'FLIP', 'SHOW', 'NIGHT', 'PIX', 'MOOD', 'GRID', 'GA', 'GB', 'HORIZON', 'UP'])
      this.u[n] = gl.getUniformLocation(pr, n);
    this.rp = new Float32Array(32).fill(-99); this.ri = 0;
    this.s = { FLIP: 0, SHOW: 1, NIGHT: opts.night ?? .35, MOOD: 0, GRID: 0, HORIZON: .42, UP: 1 };
    this.setForm({ a: '#a9d8ff', b: '#9ff0cf' });
    this.t0 = performance.now(); this.frames = []; this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const d = Math.min(devicePixelRatio || 1, this.dprCap) / this.pix;
    this.c.width = Math.max(1, Math.round(this.c.clientWidth * d));
    this.c.height = Math.max(1, Math.round(this.c.clientHeight * d));
    this.gl.viewport(0, 0, this.c.width, this.c.height);
  }
  setForm(f) { this.ca = hex(f.a); this.cb = hex(f.b); }
  setGrid(forms) { this.s.GRID = forms.length; this.ga = forms.flatMap((f) => hex(f.a)); this.gb = forms.flatMap((f) => hex(f.b)); }
  now() { return (performance.now() - this.t0) / 1000; }
  ripple(x, y, k = 1) { const i = (this.ri++ % 8) * 4; this.rp.set([x, y, this.now(), k], i); }
  draw() {
    const { gl, u, s } = this; const t = this.now();
    gl.uniform2f(u.R, this.c.width, this.c.height); gl.uniform1f(u.T, t);
    gl.uniform3fv(u.CA, this.ca); gl.uniform3fv(u.CB, this.cb); gl.uniform4fv(u.RP, this.rp);
    for (const k of ['FLIP', 'SHOW', 'NIGHT', 'MOOD', 'GRID', 'HORIZON', 'UP']) gl.uniform1f(u[k], s[k]);
    gl.uniform1f(u.PIX, this.pix > 1 ? 1 : 0);
    if (this.ga) { gl.uniform3fv(u.GA, this.ga); gl.uniform3fv(u.GB, this.gb); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.frames.push(performance.now()); if (this.frames.length > 120) this.frames.shift();
  }
  fps() { const f = this.frames; return f.length < 2 ? 0 : (f.length - 1) * 1000 / (f[f.length - 1] - f[0]); }
  loop(cb) { const go = () => { cb && cb(this.now()); this.draw(); requestAnimationFrame(go); }; requestAnimationFrame(go); }
}
