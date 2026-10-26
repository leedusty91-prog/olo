// 方向 A：Three.js 真 3D。透射材质水滴 + Reflector 实时镜面水 + 涟漪扰动。WebGL2（Three r170），可选 WebGPU 以后再换 WebGPURenderer。
import * as THREE from 'three';
import { Reflector } from '../vendor/Reflector.js';
import { FORMS } from './forms.js';

const WaterShader = {
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    T: { value: 0 }, RP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)) }, deep: { value: new THREE.Color('#6d7fc2') } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vP;
    void main(){ vP = position.xy; vUv = textureMatrix*vec4(position,1.); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float T; uniform vec4 RP[8]; uniform vec3 deep; varying vec4 vUv; varying vec2 vP;
    void main(){
      vec2 g = vec2(0.);
      for(int i=0;i<8;i++){ float age=T-RP[i].z; if(age<0.||age>5.) continue;
        vec2 d=vP-RP[i].xy; float r=length(d), f=age*1.1;
        g += normalize(d+1e-4)*sin((r-f)*12.)*exp(-pow((r-f)*3.,2.))*exp(-age*.7)*RP[i].w; }
      g += .02*vec2(sin(vP.x*3.+T*.8)+sin(vP.y*5.-T), cos(vP.y*4.+T*.6));
      vec4 uv = vUv; uv.xy += g*.06*uv.w;
      vec3 c = texture2DProj(tDiffuse, uv).rgb;
      c = mix(deep, c, .78) + pow(max(0.,g.y*2.),2.)*.3;
      gl_FragColor = vec4(c,1.);
      #include <colorspace_fragment>
    }` };

function dropGeometry() {
  // 经典泪滴曲线：x = sin t · sin^m(t/2), y = cos t（底部圆、顶部尖）
  const pts = [];
  for (let i = 0; i <= 48; i++) { const t = Math.PI * (1 - i / 48);
    pts.push(new THREE.Vector2(Math.max(Math.sin(t) * Math.pow(Math.sin(t / 2), 1.6), 1e-4) * .62, Math.cos(t) * .55)); }
  const g = new THREE.LatheGeometry(pts, 64); g.computeVertexNormals(); return g;
}

export function makeOlo(form, t0 = 0) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ color: form.a, transmission: .92, thickness: .3, roughness: .12, emissive: new THREE.Color(form.b), emissiveIntensity: .12, ior: 1.33,
    attenuationColor: new THREE.Color(form.b), attenuationDistance: 2.5, clearcoat: 1, iridescence: .3, sheen: .2, sheenColor: new THREE.Color(form.b) });
  const body = new THREE.Mesh(dropGeometry(), mat); grp.add(body);
  const eyeM = new THREE.MeshBasicMaterial({ color: '#262144' });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(.026, 16, 12), eyeM); e.scale.set(1, 1.4, .4); e.position.set(s * .13, -.06, .49); grp.add(e);
    const ch = new THREE.Mesh(new THREE.CircleGeometry(.05, 16), new THREE.MeshBasicMaterial({ color: '#ff9fb4', transparent: true, opacity: .55 })); ch.position.set(s * .23, -.13, .465); ch.rotation.y = s * .45; grp.add(ch); }
  const spark = []; const sm = new THREE.MeshBasicMaterial({ color: '#ffd36b' });
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(.025, 8, 6), sm); grp.add(s); spark.push(s); }
  grp.userData.tick = (t, mood = 0) => {
    t += t0; const sq = .05 * Math.sin(t * 2.1) + .1 * mood * Math.max(0, Math.sin(t * 7));
    body.scale.set(1 + sq * .6, 1 - sq, 1 + sq * .6);
    spark.forEach((s, i) => s.position.set(Math.sin(t * .7 + i * 2.1) * .2, Math.cos(t * .5 + i * 1.7) * .18 - .1, Math.sin(t * .4 + i) * .15));
  };
  grp.userData.setForm = (f) => { mat.color.set(f.a); mat.emissive.set(f.b); mat.attenuationColor.set(f.b); mat.sheenColor.set(f.b); };
  return grp;
}

export function makeWorld(canvas, { dprCap = 1.5 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d8d2ee');
  // 渐变天空球
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { N: { value: .35 } },
    vertexShader: 'varying vec3 v; void main(){ v=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float N; varying vec3 v; void main(){ float y=v.y*.5+.5;
      vec3 d=mix(vec3(1.,.84,.9),vec3(.68,.76,1.),smoothstep(.45,.9,y)); vec3 n=mix(vec3(.12,.12,.28),vec3(.02,.03,.1),y);
      gl_FragColor=vec4(mix(d,n,N),1.); }` }));
  scene.add(sky);
  scene.add(new THREE.HemisphereLight('#fff4f8', '#8899dd', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(-2, 3, 2); scene.add(sun);
  // 倒影小镇：粉彩方块（无人）
  const town = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#f4c9dc', roughness: .9 }), 26);
  const M = new THREE.Matrix4(); for (let i = 0; i < 26; i++) { const h = .6 + Math.random() * 1.8, x = -9 + i * .72;
    M.compose(new THREE.Vector3(x, h / 2, -9 - Math.random() * 3), new THREE.Quaternion(), new THREE.Vector3(.6, h, .6)); town.setMatrixAt(i, M);
    town.setColorAt(i, new THREE.Color().setHSL(.85 + Math.random() * .2, .5, .82)); }
  scene.add(town);
  const moons = [[2.6, 4.2, .55, '#fff6e6'], [3.6, 4.9, .28, '#d9e6ff']].map(([x, y, r, c]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, -14); scene.add(m); return m; });
  const water = new Reflector(new THREE.PlaneGeometry(40, 40), { shader: WaterShader, textureWidth: 512, textureHeight: 512, clipBias: .003 });
  water.rotation.x = -Math.PI / 2; scene.add(water);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100); camera.position.set(0, 1.1, 4.2); camera.lookAt(0, .55, 0);
  const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w < h ? 58 : 40; camera.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);
  let ri = 0; const clock = new THREE.Clock(); const frames = [];
  const api = { THREE, renderer, scene, camera, water, sky, moons, town,
    ripple(x, z, k = 1) { water.material.uniforms.RP.value[ri++ % 8].set(x, z, clock.getElapsedTime(), k); },
    now: () => clock.getElapsedTime(),
    fps: () => frames.length < 2 ? 0 : (frames.length - 1) * 1000 / (frames[frames.length - 1] - frames[0]),
    loop(cb) { renderer.setAnimationLoop(() => { const t = clock.getElapsedTime(); water.material.uniforms.T.value = t; cb && cb(t); renderer.render(scene, camera);
      frames.push(performance.now()); if (frames.length > 120) frames.shift(); }); } };
  return api;
}
export { FORMS };
