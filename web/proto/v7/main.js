// olo v7：镜水系小精灵，Blender 建模（art/olo-3d/v7/build_v7.py）→ olo.glb → Three.js r170 渲染
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { Reflector } from './vendor/Reflector.js';

// 10 形态：只换主色，脸/肚奶白与镜银青点缀保留
const FORMS = [
  ['buddy', '暮湖靛', '#5a5fd6'], ['cloud', '雾蓝', '#5b86d8'], ['glow', '星紫', '#8a5ad8'], ['bud', '潭绿', '#2fa58f'],
  ['dew', '浅湾蓝', '#3fa6e0'], ['star', '晨霞橙', '#f08a4b'], ['peach', '珊瑚粉', '#ee6f98'], ['acorn', '苔青', '#7fb43c'],
  ['moon', '银月灰', '#7f88a8'], ['amber', '琥珀金', '#e0a43a'],
];
const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, +(q.get('dpr') || 2)));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = .55;

// 天空：程序化黄昏渐变 + 一轮淡月
const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { t: { value: 0 } },
  vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `varying vec3 v; uniform float t;
    void main(){ float y = v.y;
      vec3 top = vec3(.16,.14,.36), mid = vec3(.55,.42,.7), hor = vec3(1.,.74,.66);
      vec3 c = mix(hor, mid, smoothstep(.0,.22,abs(y))); c = mix(c, top, smoothstep(.2,.7,abs(y)));
      float m = smoothstep(.035,.03,distance(v, normalize(vec3(-.45,.32,-.84)))); c = mix(c, vec3(1.,.97,.9), m*.9);
      c += vec3(1.,.8,.7)*exp(-distance(v, normalize(vec3(-.45,.32,-.84)))*9.)*.25;
      gl_FragColor = vec4(c,1.);
      #include <colorspace_fragment>

    }` }));
scene.add(sky);
// 远山剪影
const hills = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 3, 96, 1, true), new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false,
  vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `varying vec2 u; void main(){ float h = .35 + .18*sin(u.x*40.) + .12*sin(u.x*97.+1.) + .06*sin(u.x*230.);
    float a = step(u.y, h); gl_FragColor = vec4(vec3(.36,.3,.52), a*.85);
      #include <colorspace_fragment>
 }` }));
hills.position.y = 1.4; scene.add(hills);

// 镜湖：Reflector + 淡色叠层
const mirror = new Reflector(new THREE.CircleGeometry(30, 64), {
  textureWidth: Math.min(1024, innerWidth * renderer.getPixelRatio()), textureHeight: Math.min(1024, innerHeight * renderer.getPixelRatio()), color: 0x8a7fb0 });
mirror.rotation.x = -Math.PI / 2; scene.add(mirror);
const tint = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshBasicMaterial({ color: 0x3a3266, transparent: true, opacity: .35, depthWrite: false }));
tint.rotation.x = -Math.PI / 2; tint.position.y = .002; scene.add(tint);
const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: .28 }));
shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = .004; shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);
// 涟漪环
const ripples = [];
function ripple(x = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.RingGeometry(.98, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, .006, z); m.userData.t = 0; scene.add(m); ripples.push(m);
}

// 光
const key = new THREE.DirectionalLight(0xfff0e0, 2.2); key.position.set(-2.2, 3.2, 2.4); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 6; key.shadow.bias = -.0005;
Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: .5, far: 10 }); scene.add(key);
const rim = new THREE.DirectionalLight(0xb8c8ff, 1.6); rim.position.set(2.5, 1.8, -2.5); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffd6e0, 0x40386a, .6));

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, .05, 100);
const fitDist = () => Math.max(5.2, 1.2 / (Math.tan(THREE.MathUtils.degToRad(16)) * camera.aspect));
camera.position.set(0, 1.7, fitDist());
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, .82, 0); controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .08;
controls.minDistance = 3.2; controls.maxDistance = fitDist() * 1.3; controls.minPolarAngle = .9; controls.maxPolarAngle = 1.62;
controls.rotateSpeed = .8; controls.autoRotateSpeed = .6;
let lastInteract = performance.now();
controls.addEventListener('start', () => { lastInteract = performance.now(); controls.autoRotate = false; });

// 角色
let olo, mixer, clips = {}, cur, bodyMat, morphMeshes = [], bodyMesh;
const st = document.getElementById('st');
const moodT = { happy: 0, sad: 0, sleepy: 0, o: 0 }, moodX = { ...moodT };
let blinkT = 2, blinkS = -9;
new GLTFLoader().load('./olo.glb', (g) => {
  olo = g.scene; scene.add(olo);
  olo.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const n = o.material.name;
    if (n === 'olo_skin') {
      // 一张身体网格，分区配色走顶点 mask（R=奶白脸/肚/脚，G=镜银青点缀），着色器里 smoothstep 出干净曲线边
      const m = new THREE.MeshPhysicalMaterial({ color: FORMS[0][2], vertexColors: true, roughness: .55, clearcoat: .3, clearcoatRoughness: .3,
        sheen: .5, sheenRoughness: .6, sheenColor: new THREE.Color('#ffffff'), iridescence: .25, iridescenceIOR: 1.3 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.creamCol = { value: new THREE.Color('#fbf1e2') }; sh.uniforms.accCol = { value: new THREE.Color('#8ff0f4') };
        sh.fragmentShader = 'uniform vec3 creamCol; uniform vec3 accCol;\n' + sh.fragmentShader
          .replace('#include <color_fragment>', 'float kC = smoothstep(.42,.58,vColor.r), kA = smoothstep(.42,.58,vColor.g);\n diffuseColor.rgb = mix(mix(diffuse, creamCol, kC), accCol, kA);')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .18, kA);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n float rimF = pow(1. - clamp(dot(normalize(vViewPosition), normal), 0., 1.), 3.);\n totalEmissiveRadiance += mix(vec3(.55,.8,1.), accCol, kA) * rimF * (.3 + .4*kA);');
      };
      o.material = m; bodyMesh = o; bodyMat = m;
    } else if (n === 'olo_gem') { o.material = new THREE.MeshPhysicalMaterial({ color: '#e8f6ff', metalness: 1, roughness: .04, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6, flatShading: true }); }
    else if (n === 'olo_sclera' || n === 'olo_iris' || n === 'olo_pupil') { o.material.roughness = .08; o.material.envMapIntensity = 1.4; o.castShadow = false; }
    else if (n === 'olo_blush') { o.material.transparent = true; o.material.opacity = .5; o.material.depthWrite = false; o.castShadow = false; }
    else if (n === 'olo_eyehi' || n === 'olo_mouth') { o.castShadow = false; }
    if (o.morphTargetDictionary) morphMeshes.push(o);
  });
  mixer = new THREE.AnimationMixer(olo);
  for (const c of g.animations) clips[c.name] = mixer.clipAction(c);
  for (const n of ['wave', 'hop', 'poke']) if (clips[n]) { clips[n].setLoop(THREE.LoopOnce); clips[n].clampWhenFinished = false; }
  cur = clips.idle; cur.play();
  mixer.addEventListener('finished', () => { clips.idle.reset().fadeIn(.25).play(); cur.fadeOut(.25); cur = clips.idle; });
  window.__ready = true;
});
function play(name) {
  const a = clips[name]; if (!a) return; lastInteract = performance.now();
  a.reset().setEffectiveWeight(1).fadeIn(.12).play(); if (cur && cur !== a) cur.fadeOut(.12); cur = a;
  if (name === 'hop') setTimeout(() => ripple(), 700);
  if (name === 'poke') ripple();
}
function setMood(m) { for (const k in moodT) moodT[k] = 0; if (m === 'happy') moodT.happy = 1; if (m === 'sad') moodT.sad = 1; if (m === 'sleepy') moodT.sleepy = 1; if (m === 'o') moodT.o = 1;
  st.textContent = { happy: '开心地晃了晃', sad: '有点难过', sleepy: '犯困了', o: '吃了一惊', none: '在发呆' }[m] || '在发呆'; }
const MORPH = { happy: ['happy', 'smile'], sad: ['sad', 'frown'], sleepy: ['sleepy'], o: ['o'] };

// 点击 vs 拖动
const ray = new THREE.Raycaster(); let down = null;
canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY, performance.now()]));
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8 || performance.now() - down[2] > 400 || !olo) return;
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (ray.intersectObject(olo, true).length) { play('poke'); setMood('happy'); setTimeout(() => setMood('none'), 1600); }
  else { const h = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (h) ripple(h.x, h.z); }
});

// UI
const mk = (host, label, fn, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = fn; document.getElementById(host).append(b); return b; };
[['默认', 'none'], ['开心', 'happy'], ['难过', 'sad'], ['犯困', 'sleepy'], ['吃惊', 'o']].forEach(([l, m]) => mk('moods', l, () => setMood(m)));
[['挥手', 'wave'], ['开心跳', 'hop'], ['戳一下', 'poke']].forEach(([l, a]) => mk('acts', l, () => play(a)));
const sws = FORMS.map(([id, name, c], i) => { const b = mk('forms', '', () => setForm(i), 'sw' + (i ? '' : ' on')); b.style.background = c; b.title = name; return b; });
const tgt = new THREE.Color(FORMS[0][2]);
function setForm(i) { tgt.set(FORMS[i][2]); sws.forEach((b, j) => b.classList.toggle('on', i === j)); st.textContent = FORMS[i][1]; play('hop'); }
window.__olo = { play, setMood, setForm, controls, camera };

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight, false); });
renderer.setSize(innerWidth, innerHeight, false);
const clock = new THREE.Clock(); let fpsN = 0, fpsT = 0; window.__fps = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  fpsN++; fpsT += dt; if (fpsT > 1) { window.__fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  if (mixer) mixer.update(dt);
  if (performance.now() - lastInteract > 4000) controls.autoRotate = true;
  controls.update();
  // 表情：morph 平滑过渡 + 自动眨眼
  blinkT -= dt; if (blinkT < 0) { blinkS = t; blinkT = Math.random() < .2 ? .3 : 2.4 + Math.random() * 3; }
  const bt = t - blinkS, blink = bt < .07 ? bt / .07 : bt < .2 ? 1 - (bt - .07) / .13 : 0;
  for (const k in moodX) moodX[k] += (moodT[k] - moodX[k]) * Math.min(1, dt * 8);
  for (const m of morphMeshes) {
    const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
    for (const k in d) inf[d[k]] = 0;
    for (const k in MORPH) for (const n of MORPH[k]) if (n in d) inf[d[n]] = Math.max(inf[d[n]], moodX[k]);
    if ('blink' in d) inf[d.blink] = blink * (1 - moodX.happy) * (1 - moodX.sleepy * .5);
  }
  // 情绪也带动全身：难过塌一点、犯困缓慢下沉、开心轻弹
  if (olo) {
    const s = 1 - .08 * moodX.sad - .06 * moodX.sleepy + .04 * moodX.happy * Math.abs(Math.sin(t * 6));
    olo.scale.set(1 + (1 - s) * .5, s, 1 + (1 - s) * .5);
    olo.rotation.z = .05 * moodX.o * Math.sin(t * 20) * Math.exp(-0) * .3;
  }
  if (bodyMat) { bodyMat.color.lerp(tgt, Math.min(1, dt * 4)); }
  for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i]; r.userData.t += dt; const k = r.userData.t;
    r.scale.setScalar(.2 + k * 1.1); r.material.opacity = .5 * Math.max(0, 1 - k / 1.6); if (k > 1.6) { scene.remove(r); ripples.splice(i, 1); } }
  renderer.render(scene, camera);
});
