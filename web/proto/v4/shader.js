// olo v2 —— 单 pass 全屏着色器：倒影国（天/山/雾/水/芦苇/萤火/鱼）+ 涟漪兽 olo。
export const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

export const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 R; uniform float T;
uniform vec4 CAM;                 // cx, cy, zoom, roll
uniform vec3 SKYT, SKYM, SKYH, SUNC, MTN, WATC; uniform vec3 SUNP; uniform float NIGHT;
uniform vec4 RP[10];
uniform vec4 OLO;                 // x, y(底部接触点), sx, sy
uniform float LEAN, TIP, CURL, BLINK; uniform vec4 ARM; uniform vec2 STEP;
 uniform vec2 GAZE; uniform vec4 MOOD; // happy curious sleepy sad
uniform vec3 CA, CB, CA2, CB2; uniform float FILL;
uniform float UP, REFL, FADE, PIX, WIND;
uniform vec3 MOTE; uniform vec3 WIPE; uniform float POKE;
const float H = -0.06;
const float OR = 0.072;           // olo 半径（世界单位，屏高=1）

float h1(float x){ return fract(sin(x*127.1)*43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h1(i),h1(i+1.),f); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

// ---------------- 天空 + 远山 ----------------
vec3 sky(vec2 w){
  float y = w.y - H;
  vec3 c = mix(SKYH, SKYM, smoothstep(0., .16, y));
  c = mix(c, SKYT, smoothstep(.12, .6, y));
  float d = length((w - SUNP.xy)*vec2(1.,1.15));
  c += SUNC*(exp(-d*d*30.)*.45 + exp(-d*5.)*.18);
  c = mix(c, mix(SUNC, vec3(1.), .7)*1.15, smoothstep(SUNP.z, SUNP.z*.92, d));
  c += SUNC*.35*smoothstep(SUNP.z*1.6, SUNP.z, d);
  // 云带
  float cl = n2(vec2(w.x*2.2 + T*.012, y*16.)) * .6 + n2(vec2(w.x*5. - T*.02, y*30.))*.4;
  float band = smoothstep(.06,.14,y)*smoothstep(.5,.2,y);
  c = mix(c, mix(SKYM, SUNC, .45)*1.05, smoothstep(.55,.85,cl)*band*.45);
  // 星
  vec2 g = floor(w*150.); float s = h2(g);
  c += step(.993, s)*smoothstep(.45,.1,length(fract(w*150.)-.5))*(.5+.5*sin(T*1.7+s*80.))*NIGHT*smoothstep(.06,.35,y)*1.2;
  // 三层山：越远越亮越软（大气透视）
  for(int i=0;i<3;i++){
    float fi = float(i);
    float x = w.x*(1.4+fi*1.3) + fi*5.1 + CAM.x*fi*.15;
    float m = H + .004 + (.12-fi*.035)*(.35 + .4*sin(x*1.7+fi) + .35*n1(x*3.) + .1*n1(x*14.));
    float soft = .006 - fi*.0018;
    float a = smoothstep(soft, -soft, w.y - m);
    vec3 mc = mix(mix(SKYH, SKYM, .5), MTN, .28 + fi*.3);
    mc += SUNC*.12*exp(-abs(w.x-SUNP.x)*4.)*(1.-fi*.3);   // 迎光面
    c = mix(c, mc, a);
  }
  c = mix(c, SKYH*1.04 + SUNC*.05, exp(-abs(y)*45.)*.55);   // 地平线雾
  return c;
}

// ---------------- olo ----------------
float sdUC(vec2 p, float r1, float r2, float h){
  p.x = abs(p.x); float b = (r1-r2)/h; float a = sqrt(1.-b*b); float k = dot(p, vec2(-b,a));
  if(k < 0.) return length(p) - r1; if(k > a*h) return length(p-vec2(0.,h)) - r2; return dot(p, vec2(a,b)) - r1;
}
float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }
float cap(vec2 p, vec2 a, vec2 b, float ra, float rb){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h)-mix(ra,rb,h); }
// 小怪兽「噗噗」：矮墩墩的豆子身 + 一长一短两只软角 + 中间一撮小旋儿 + 胖尾巴 + 浅色肚皮 + 小短手脚
// 情绪带动全身：开心=身子鼓宽、角竖起；好奇=身子侧歪、一只角翘；犯困=塌成年糕、角垂；难过=上半身耷拉、角往下塌
float body(vec2 q){
  float hap = MOOD.x, cur = MOOD.y, slp = MOOD.z, sad = MOOD.w;
  float t = smoothstep(-.6, 1.2, q.y);
  q.x -= (TIP*.4 + .04*sin(T*1.3))*t*t + LEAN*(q.y+1.2)*.16 + cur*.18*t;
  vec2 b = q - vec2(0., -.2);
  float top = smoothstep(-.2, .8, b.y);
  b.x /= 1. - .14*top + .08*hap - .1*sad*top;               // 上窄下宽的豆子；开心鼓、难过耷拉
  b.y /= 1. - .18*slp - .1*sad + .05*hap;
  vec2 hb = vec2(.98, .74);
  vec2 dq = abs(b) - hb + .62; float d = length(max(dq,0.)) + min(max(dq.x,dq.y),0.) - .62;
  // 角：左长弯、右短圆，跟随 TIP 滞后摆
  float droop = .55*sad + .45*slp - .25*hap;
  for(int i=0;i<2;i++){ float s = i==0 ? -1. : 1.;
    vec2 a0 = vec2(s*.55, .42);
    float len = i==0 ? .42 : .28;
    float an = 1.57 - s*(.42 + droop) + (i==0 ? -.2*cur : .35*cur) - TIP*.5;
    vec2 a1 = a0 + len*vec2(cos(an), sin(an));
    vec2 a2 = a1 + (i==0 ? .26 : .16)*vec2(cos(an + s*1.5), sin(an + s*1.5));   // 角尖往外勾
    float hn = min(cap(q, a0, a1, .2, .13), cap(q, a1, a2, .13, .06));
    d = smin(d, hn, .12);
  }
  // 小旋儿：两角之间一撮卷毛，低阻尼过冲
  vec2 tp = rot(-(TIP*1.2 + CURL))*(q - vec2(.05, .56 - .15*sad));
  vec2 cc = tp - vec2(.1, .26);
  float ring = abs(length(cc) - .1) - .035;
  ring = max(ring, -max(-cc.x, -cc.y + .0));
  float curl = smin(cap(tp, vec2(0.), vec2(0., .26), .06, .04), ring, .04);
  d = smin(d, curl, .05);
  // 胖尾巴（身后右下），开心摇
  vec2 t0 = vec2(-.8, -.82), t1 = t0 + vec2(-.42, .12 + .25*sin(T*(2. + 8.*hap))*(.3 + hap) - .2*sad);
  d = smin(d, cap(q, t0, t1, .2, .1), .1);
  d = smin(d, length(q - t1 - vec2(-.04, .16)) - .15, .08);
  // 小短手
  float rt = 1. - ARM.z*.75;
  for(int i=0;i<2;i++){ float s = i==0 ? -1. : 1.;
    float an = (i==0 ? ARM.x : ARM.y);
    vec2 sh = vec2(s*.88, -.3);
    vec2 hd = sh + rt*vec2(cos(an), sin(an))*.4;
    d = smin(d, min(cap(q, sh, hd, .13, .1), length(q - hd) - .13*rt), .12);
    float lift = (i==0 ? STEP.x : STEP.y);
    vec2 hp = vec2(s*.4, -.85), fp = vec2(s*.42, -1.08 + lift*.22);
    float leg = min(cap(q, hp, fp, .2, .15), length((q - fp - vec2(s*.06, -.02))/vec2(1.3, .8))*.8 - .13);
    d = smin(d, leg, .1);
  }
  return d;
}
vec4 drawOlo(vec2 w, float vis){
  if(vis < .01) return vec4(0.);
  vec2 q = (w - OLO.xy)/OR;               // 以底部接触点为原点
  q /= OLO.zw; q.y -= 1.22;                  // 压扁/拉伸以底部为锚
  if(dot(q,q) > 10.) return vec4(0.);
  float d = body(q);
  float aa = 1.6*OR*0.0 + fwidth(d)*1.2;
  float a = smoothstep(aa, -aa, d);
  if(a <= 0.) return vec4(0.);
  vec2 e = vec2(.012,0.);
  vec2 g = vec2(body(q+e.xy)-body(q-e.xy), body(q+e.yx)-body(q-e.yx))/(2.*e.x);
  float k = clamp(-d, 0., 1.);
  float th = sqrt(k*(2.-k));
  vec3 n = normalize(vec3(g*(1.-th)*1.3, th + .12));
  vec3 L = normalize(vec3(clamp(SUNP.x-OLO.x,-.6,.6)*1.5 - .3, .7, .65));
  // 换色：液体从底部灌满
  float f = smoothstep(-.06, .06, (FILL*3.4 - 1.1) - q.y - .08*sin(q.x*7. + T*5.));
  vec3 ca = mix(CA, CA2, f), cb = mix(CB, CB2, f);
  vec3 base = mix(cb, ca, smoothstep(-1., 1.3, q.y));
  // 折射：透过身体看到背后的天
  vec3 bg = sky(w + n.xy*.028 + vec2(0., .01));
  vec3 c = mix(bg*mix(vec3(1.), base, .75), base, .5 + .2*th);
  // 次表面：边缘薄处更亮
  c += base*.22*(1.-th);
  // 内部焦散
  vec2 cq = q*1.9 + vec2(T*.12, -T*.08);
  float v = sin(cq.x*3.1 + sin(cq.y*2.3 + T*.9)*1.6) + sin(cq.y*3.6 + sin(cq.x*2.7 - T*.7)*1.6);
  float cs = pow(max(0., 1. - abs(v)*.45), 4.);
  c += mix(vec3(1.,.92,.72), SUNC, .4)*cs*.22*smoothstep(.4, -.9, q.y)*th;
  // 身体里的暖金亮点
  for(int i=0;i<3;i++){ float fi=float(i);
    vec2 sp = vec2(sin(T*.6+fi*2.2)*.42, -.35 + cos(T*.45+fi*1.9)*.3 + fi*.12);
    float sd = length(q - sp);
    c += vec3(1.,.82,.45)*(smoothstep(.07,.0,sd)*.8 + exp(-sd*9.)*.12);
  }
  // 漫反射 + 底部水面反光
  c *= .78 + .3*max(dot(n, L), 0.);
  c += WATC*.35*smoothstep(-.2, -1., q.y)*(1.-th*.5) + SKYH*.12*smoothstep(-.4,-1.,q.y);
  // 菲涅尔边缘光（受主光方向）
  float fr = pow(1. - n.z, 2.6);
  c += mix(vec3(1.), SUNC, .55)*fr*(.35 + .35*max(dot(n.xy, L.xy),0.));
  // 窗形高光 + 点高光
  vec2 hp = rot(.6)*(q - vec2(-.45, .38));
  c = mix(c, vec3(1.,.99,.97), .8*smoothstep(1., .55, length(hp/vec2(.30,.12))));
  c = mix(c, vec3(1.), smoothstep(.075, .04, length(q - vec2(-.08, .66))));
  c += vec3(1.)*.25*smoothstep(.2,.0,abs(length(q-vec2(.1,-.05))-.86))*smoothstep(-.2,-.75,q.y)*smoothstep(-.3,.5,q.x); // 右下反射弧

  base = base; c = mix(c, base*.9, .35);                               // 更实的体色，别洗白
  float tipz = smoothstep(.5, .66, q.y)*smoothstep(.28,.4,abs(q.x));     // 角：暖珊瑚色软角，和冷色身体撞色
  c = mix(c, mix(vec3(1.,.62,.5), cb, .2)*(.85+.25*th), tipz*.85);
  for(int i=0;i<3;i++){ float fi=float(i); vec2 sp = vec2(-.62 + fi*.22, .25 - fi*.1 + fi*fi*.06);
    c = mix(c, cb*.7, smoothstep(.075,.05,length(q - sp))*.55); }        // 左额三颗小雀斑
  // 浅色肚皮
  float bel = length((q - vec2(0., -.55))/vec2(.62, .42)) - 1.;
  c = mix(c, mix(c, vec3(1.,.96,.88), .45), smoothstep(.05, -.05, bel));
  c = mix(c, cb*.7, smoothstep(-.12, 0., d)*.35*smoothstep(.2,-.6,q.y));   // 底部轮廓
  // ---- 脸 ----
  vec2 gz = GAZE;
  vec2 fq = q - vec2(0., -.08 - .1*MOOD.w - .08*MOOD.z) - gz*vec2(.16, .1);
  float open = (1. - BLINK)*(1. - .62*MOOD.z);
  vec3 ink = vec3(.14,.12,.26);
  for(int i=0;i<2;i++){
    float s = i==0 ? -1. : 1.;
    vec2 ep = fq - vec2(s*.36, .12);
    float big = 1.12;
    vec2 er = vec2(.13, .175*max(open,.07))*big;
    float ed = (length(ep/er) - 1.)*min(er.x, er.y);
    // 难过：上眼睑斜切
    ed = max(ed, mix(-1., (ep.y - .04 + s*ep.x*.9*1.), MOOD.w));
    // 犯困：上缘平切
    ed = max(ed, mix(-1., ep.y - .155*open*.35, MOOD.z));
    // 开心：^ 形眯眼
    float arc = abs(length(ep - vec2(0., -.11)) - .14) - .028;
    arc = max(arc, -(ep.y + .02));
    ed = mix(ed, arc, MOOD.x);
    float em = smoothstep(.012, -.012, ed);
    c = mix(c, ink, em);
    float hl = smoothstep(.045, .025, length(ep - vec2(-.035, .06) - gz*.03)) + smoothstep(.022,.01,length(ep - vec2(.04,-.05)));
    c = mix(c, vec3(1.), hl*em*(1.-MOOD.x)*step(.25,open));
    // 腮红
    float bl = smoothstep(1., .2, length((fq - vec2(s*.56, -.1))/vec2(.17,.09)));
    c = mix(c, vec3(1.,.55,.65), bl*(.28 + .35*MOOD.x + .2*POKE));
  }
  // 嘴
  vec2 mq = fq - vec2(0., -.17);
  float curv = 4.5*(.25 + MOOD.x*.8) - 9.*MOOD.w;
  float wdt = .2 + .08*MOOD.x - .05*MOOD.z;
  float md = abs(mq.y - curv*mq.x*mq.x + curv*wdt*wdt*.5) - .024;
  md = max(md, abs(mq.x) - wdt);
  float om = abs(length(mq*vec2(1.,.8)) - .05) - .022;      // 好奇：o 形
  md = mix(md, om, MOOD.y*(1.-MOOD.x));
  c = mix(c, ink, smoothstep(.012, -.012, md));
  // 两颗小尖牙（向上），开心时更明显
  for(int k=0;k<2;k++){ float sx = k==0 ? -.11 : .12;
    vec2 tq = mq - vec2(sx, -.005);
    float fang = max(abs(tq.x) - (.065 + tq.y*.55), max(tq.y - .005, -tq.y - .11));
    c = mix(c, vec3(1.,.98,.94), smoothstep(.008,-.008,fang)*(1.-MOOD.y*.8)); }
  return vec4(c, a*vis);
}

// 睡莲叶
vec3 pads(vec2 w, vec3 c, vec2 g){
  for(int i=0;i<4;i++){
    float fi = float(i);
    vec2 pc = vec2((h1(fi*4.1)-.5)*.42, H - .1 - h1(fi*8.3)*.22) + vec2(sin(T*.2+fi)*.004, 0.) + g*.6;
    float sz = .028 + .02*(H - pc.y)*5.;
    vec2 l = (w - pc)/vec2(sz, sz*.3);
    float ang = atan(l.y, l.x);
    float d = length(l) - 1.;
    d = max(d, -(abs(ang - .6 - fi) < .22 ? 1. : -1.)*(length(l) - .02));   // 缺口
    float a = smoothstep(.04, -.04, d);
    vec3 pcol = mix(vec3(.45,.68,.55), MTN, .3)*(.8 + .25*l.y) + SUNC*.15*(1.-length(l));
    pcol += SUNC*.25*smoothstep(.15,.0,abs(d+.08))*step(0.,l.y);  // 边缘受光
    c = mix(c*(1.-.25*smoothstep(.5,-.2,length(l - vec2(.1,-.4))-.9)), pcol, a);
    if(i==1){ vec2 fl = w - pc - vec2(sz*.15, sz*.25); float fd = length(fl*vec2(1.,1.3)) - .008;      // 一朵小花
      c = mix(c, mix(vec3(1.,.82,.88), SUNC, .3), smoothstep(.002,-.002,fd)); c += vec3(1.,.8,.85)*exp(-length(fl)*90.)*.25; }
  }
  return c;
}
// ---------------- 水 ----------------
vec2 ripple(vec2 w){
  vec2 g = vec2(0.);
  for(int i=0;i<10;i++){
    float age = T - RP[i].z; if(age < 0. || age > 4.5) continue;
    vec2 d = (w - RP[i].xy); d.y *= 3.2;
    float r = length(d), fr = age*.13*(1.+RP[i].w*.3);
    float x = (r - fr)*95.;
    g += normalize(d + 1e-5)*sin(x)*exp(-x*x*.02)*exp(-age*.95)*RP[i].w*.012;
  }
  return g;
}
vec4 fish(vec2 w, float i){
  float t = T*.06 + i*2.7;
  vec2 c = vec2(sin(t)*.2, H - .2 - .1*sin(t*.7 + i));
  vec2 v = normalize(vec2(cos(t)*.2, -.07*cos(t*.7+i)*.7) + 1e-4);
  vec2 l = w - c; l = vec2(dot(l, v), dot(l, vec2(-v.y, v.x))); l.y *= 3.2;
  l.y += sin(l.x*60. + T*6.)*.004*smoothstep(0.,-.03,l.x);
  float d = length(l/vec2(.022, .008)) - 1.;
  float tail = length((l - vec2(-.028, 0.))/vec2(.008,.012)) - 1.;
  return vec4(0., 0., 0., smoothstep(.8, -.6, min(d, tail))*.22);
}
vec3 water(vec2 w){
  vec2 g = ripple(w);
  float depth = H - w.y;
  float wav = (n2(vec2(w.x*40., w.y*260./(depth*4.+.3) + T*.8)) - .5)*.0022*(.3+depth*5.);
  vec2 m = vec2(w.x + wav + g.x*1.3, 2.*H - w.y + g.y*(1. + depth*4.));
  vec3 r = sky(m);
  vec4 ol = drawOlo(m, REFL); r = mix(r, ol.rgb*.92, ol.a);
  float fres = mix(.92, .5, smoothstep(0., .35, depth));
  vec3 c = mix(WATC, r, fres);
  // 鱼影
  for(int i=0;i<2;i++){ vec4 f = fish(w + g*2., float(i)); c = mix(c, WATC*.45, f.a*(1.-NIGHT*.5)); }
  // 太阳金光路径
  float path = exp(-abs(w.x - SUNP.x)*(9. + depth*30.))*smoothstep(.5,.0,depth);
  vec2 gq = vec2(w.x*220., w.y*900./(depth*3.+.25));
  float gl = smoothstep(.75, 1., n2(gq + vec2(T*1.3, -T*2.)))*smoothstep(.5,1.,n2(gq*.37 - T*.6));
  c += SUNC*path*(gl*1.4 + .14);
  // 涟漪高光/暗面
  c += mix(SUNC, vec3(1.), .5)*clamp(g.y*22., -.06, .16);
  // olo 在水面上的软阴影 + 接触光环
  vec2 sd = (w - vec2(OLO.x, H - .004))/vec2(OR*1.25, OR*.22);
  float lift = clamp((OLO.y - H)/OR, 0., 3.);
  c *= 1. - .28*exp(-dot(sd,sd)*(1.+lift))*UP/(1.+lift*.6);
  float ring = abs(length(sd) - 1.25 - .15*sin(T*2.)) ;
  c += mix(CA, vec3(1.), .4)*smoothstep(.25, 0., ring)*.12*UP/(1.+lift);
  c = mix(c, SKYH*1.1, smoothstep(.006, 0., depth)*.35);       // 近水线高亮
  c = pads(w, c, g);
  return c;
}

// ---------------- 前景 ----------------
vec4 reeds(vec2 w){
  vec4 acc = vec4(0.);
  float halfW = .5*R.x/R.y;
  for(int i=0;i<12;i++){
    float fi = float(i);
    float side = i < 7 ? -1. : 1.;
    float x0 = side*(halfW - .015 - h1(fi*3.1)*.11);
    float y0 = -.6, hg = .16 + h1(fi*7.3)*.22 + (side<0.?.04:0.);
    float ph = T*.9 + x0*9.;
    float wind = (.02*sin(ph) + .009*sin(T*2.3 + fi*1.7) + .006*sin(T*4.1+fi))*(1. + WIND*2.) - side*.012 + .03*WIND;
    float s = clamp((w.y - y0)/hg, 0., 1.);
    float lean = -side*(.02 + h1(fi*1.3)*.05);
    float x = x0 + (wind + lean)*s*s;
    float wd = mix(.006, .0008, s);
    float dd = abs(w.x - x) - wd;
    dd = max(dd, max(y0 - w.y, w.y - (y0 + hg)));
    if(mod(fi,3.) < 1.){                                     // 香蒲穗
      vec2 hp = w - vec2(x0 + wind + lean, y0 + hg + .012);
      hp = rot(-(wind+lean)*4.)*hp;
      dd = min(dd, (length(hp/vec2(.0075, .026)) - 1.)*.0075);
    }
    float z = h1(fi*5.9);                                   // 越近越虚
    float blur = mix(.0012, .006, z);
    float a = smoothstep(blur, -blur, dd);
    vec3 rc = mix(MTN*.55, WATC*.35, .4) + SKYH*.08;
    float rim = smoothstep(-.004, .003, (w.x - x)*sign(SUNP.x - x0));
    rc += SUNC*.35*rim*s;
    rc = mix(rc, SKYH, z*.12);                              // 近景略带雾
    acc.rgb = mix(acc.rgb, rc, a); acc.a = max(acc.a, a*(.85 - z*.15));
  }
  return acc;
}
vec3 motes(vec2 w, vec3 c){
  for(int i=0;i<16;i++){
    float fi = float(i);
    float z = h1(fi*2.3);                                    // 0 远 1 近
    vec2 p = vec2((h1(fi*5.7)-.5)*.6 + sin(T*.23*(1.+z) + fi)*.05,
                  H + .02 + h1(fi*9.1)*.32 + sin(T*.31 + fi*2.)*.03 - z*.3);
    p += CAM.xy*z*.1;
    float s = mix(.0025, .012, z*z);                         // 近处更大更虚（散景）
    float d = length(w - p);
    float fly = (.5 + .5*sin(T*(1.3+z) + fi*4.))*NIGHT;
    float dust = (1.-NIGHT)*.35;
    vec3 col = mix(mix(vec3(1.,.95,.85), SUNC, .5), vec3(.85,1.,.55), NIGHT);
    c += col*(smoothstep(s, s*.4, d)*(.5 - z*.3) + exp(-d*d/(s*s*9.))*.4)*(fly + dust);
  }
  return c;
}

vec3 dither(vec3 c, vec2 fc){
  int x=int(mod(fc.x,4.)), y=int(mod(fc.y,4.));
  int b[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  float th=((float(b[y*4+x])+.5)/16.-.5)*.6;
  return floor(c*9.+th+.5)/9.;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 p = (fc - .5*R)/R.y;
  // 转场：水波擦除
  if(WIPE.z > 0. && WIPE.z < 1.){
    float r = length(p - WIPE.xy), fr = WIPE.z*1.4;
    float x = (r - fr)*30.;
    p += normalize(p - WIPE.xy + 1e-4)*sin(x)*exp(-x*x*.08)*.025*(1.-WIPE.z);
  }
  vec2 w = rot(CAM.w)*p/CAM.z + CAM.xy;
  vec3 c;
  if(w.y >= H){
    c = sky(w);
    vec4 ol = drawOlo(w, UP);
    // olo 周围的柔光
    float glow = exp(-length((w - OLO.xy - vec2(0., OR*1.1))/OR)*1.3)*.16*UP;
    c += mix(CA, SUNC, .3)*glow*(.6 + .4*NIGHT);
    c = mix(c, ol.rgb, ol.a);
  } else c = water(w);
  c = motes(w, c);
  // 飞行中的光点（发出去的话）
  if(MOTE.z > 0.){ float d = length(w - MOTE.xy); c += vec3(1.,.93,.75)*(smoothstep(.008,.003,d) + exp(-d*40.)*.6)*MOTE.z; }
  vec4 rd = reeds(w); c = mix(c, rd.rgb, rd.a);
  // 调色：轻 S 曲线 + 冷暗部暖亮部 + 暗角 + 颗粒
  vec2 uv = fc/R;
  c = max(c, 0.);
  c = c/(1. + c*.12)*1.08;
  float l = dot(c, vec3(.3,.59,.11));
  c += mix(vec3(-.01,.0,.035), vec3(.03,.012,-.02), smoothstep(.2,.8,l));
  c = mix(vec3(l), c, 1.04);
  c *= 1. - .38*pow(length((uv - .5)*vec2(R.x/R.y*1.2, 1.)), 2.4);
  c += (h2(fc + fract(T)*97.) - .5)*.022;
  if(WIPE.z > 0. && WIPE.z < 1.) c += .12*sin(WIPE.z*3.14159);
  c *= FADE;
  if(PIX > 0.) c = dither(c, fc);
  o = vec4(c, 1.);
}`;
