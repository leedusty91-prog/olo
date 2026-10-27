# Blender 4.2 headless: blender -b --python build_v7.py -- <outdir> <glb> [variant A|B|C]
# olo v7 — 倒影国 镜水系小精灵 (original). Big head / small body, zoned colors, fin-crest + mirror gem + ripple tail.
import bpy, math, sys, os
from mathutils import Vector, Euler
argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.dirname(os.path.abspath(__file__))
GLB = argv[1] if len(argv) > 1 else os.path.join(OUT, 'olo.glb')
V = argv[2] if len(argv) > 2 else 'A'
bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene
R = math.radians
mb = bpy.data.metaballs.new('olo_mb'); mb.resolution = 0.016; mb.threshold = 0.6
mbo = bpy.data.objects.new('olo_mb', mb); S.collection.objects.link(mbo)
def ball(co, r, typ='BALL', size=(0,0,0), rot=(0,0,0), stiff=2.0):
    e = mb.elements.new(); e.type = typ; e.co = co; e.radius = r; e.stiffness = stiff
    if typ != 'BALL': e.size_x, e.size_y, e.size_z = size
    e.rotation = Euler(rot).to_quaternion(); return e
HZ = .92                                           # head centre
# --- shared: big head, small pear body, neck blend, short limbs
ball((0, 0, HZ), .7, 'ELLIPSOID', (1.0, .88, .84))            # head (≈60% of height)
ball((0, -.02, .38), .34, 'ELLIPSOID', (.95, .85, .95), stiff=2.2)  # body
ball((0, 0, .62), .3, 'ELLIPSOID', (.9, .8, .7), stiff=1.4)   # neck blend → one mass
for s in (-1, 1):
    ball((s*.3, -.06, .43), .115, 'CAPSULE', (.12, 0, 0), (0, R(-s*48), 0), 2.6)   # arm
    ball((s*.14, -.03, .14), .12, 'CAPSULE', (.03, 0, 0), (0, R(90), 0), 2.0)        # leg
    ball((s*.15, -.09, .05), .13, 'ELLIPSOID', (1, 1.35, .62), stiff=1.6)            # foot
ACC = []   # accent regions: (centre, radius) — faces inside get accent material
if V == 'A':   # 水纹鳍冠 (3-step wave fin, sweeps back) + side fin-ears + ripple-tail
    for i, (y, z, r) in enumerate([(-.16, 1.36, .2), (.08, 1.44, .25), (.32, 1.32, .2)]):
        ball((0, y, z), r, 'ELLIPSOID', (.32, 1.1, 1.0), (R(-25 - i*12), 0, 0), 1.7)
    ACC += [((0, .08, 1.44), .3)]
    for s in (-1, 1):
        ball((s*.52, .06, 1.0), .22, 'ELLIPSOID', (1.1, .35, .75), (0, R(s*28), R(-s*15)), 1.6)
        ACC += [((s*.7, .08, 1.06), .16)]
    ball((0, .36, .3), .1, 'CAPSULE', (.12, 0, 0), (R(-35), 0, R(90)), 2.0)            # tail
    ball((0, .5, .46), .19, 'ELLIPSOID', (.3, .9, 1.0), (R(30), 0, 0), 1.7)            # tail fin
    ACC += [((0, .55, .5), .17)]
elif V == 'B':  # long droop ear-fins + antenna drop
    for s in (-1, 1):
        ball((s*.46, .05, .9), .18, 'CAPSULE', (.16, 0, 0), (0, R(s*60), 0), 1.6)
        ACC += [((s*.62, .05, .72), .15)]
    ball((0, -.03, 1.38), .09, 'CAPSULE', (.08, 0, 0), (0, R(90), 0), 2.4); ball((0, -.06, 1.54), .13, stiff=2.2)
    ACC += [((0, -.06, 1.55), .12)]
    ball((0, .42, .3), .16, stiff=1.8)
elif V == 'C':  # one big forward-curling wave horn + tiny ear nubs
    for i, (y, z, r) in enumerate([(.08, 1.3, .2), (-.02, 1.45, .16), (-.16, 1.52, .13), (-.27, 1.45, .11)]):
        ball((0, y, z), r, stiff=1.8)
    ACC += [((-.1, 1.6, 0), .28)]; ACC[-1] = ((0, -.1, 1.47), .2)
    for s in (-1, 1): ball((s*.42, .05, 1.14), .13, stiff=1.8)
    ball((0, .4, .3), .1, 'CAPSULE', (.1, 0, 0), (0, 0, R(90)), 2.0)
bpy.context.view_layer.objects.active = mbo; mbo.select_set(True)
bpy.ops.object.convert(target='MESH')
body = bpy.context.active_object; body.name = 'olo_body'
r = body.modifiers.new('rm', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = .011; bpy.ops.object.modifier_apply(modifier='rm')
sm = body.modifiers.new('sm', 'SMOOTH'); sm.factor = .6; sm.iterations = 5; bpy.ops.object.modifier_apply(modifier='sm')
try: bpy.ops.object.quadriflow_remesh(target_faces=3200, use_mesh_symmetry=True, smooth_normals=True)
except Exception as ex: print('qf fail', ex)
sub = body.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; bpy.ops.object.modifier_apply(modifier='sub')
bpy.ops.object.shade_smooth()
# --- materials: toon-ish PBR (matte skin, sheen, light coat, fresnel rim)
def mat(name, col, rough=.5, coat=0., metal=0., emit=None, alpha=1., sheen=0., rim=0.):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*col, 1); p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal; p.inputs['Coat Weight'].default_value = coat; p.inputs['Coat Roughness'].default_value = .2
    p.inputs['Sheen Weight'].default_value = sheen; p.inputs['Subsurface Weight'].default_value = .06
    if emit: p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = 1.
    if rim:   # fresnel rim → emission (勾边光)
        lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = .12
        mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'POWER'; mx.inputs[1].default_value = 3.
        nt.links.new(lw.outputs['Facing'], mx.inputs[0]); nt.links.new(mx.outputs[0], p.inputs['Emission Strength'])
        p.inputs['Emission Color'].default_value = (.75, .95, 1., 1)
        mr = nt.nodes.new('ShaderNodeMath'); mr.operation = 'MULTIPLY'; mr.inputs[1].default_value = rim
        nt.links.new(mx.outputs[0], mr.inputs[0]); nt.links.new(mr.outputs[0], p.inputs['Emission Strength'])
    if alpha < 1: p.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND'
    return m
M_SKIN  = mat('olo_skin',  (.13, .12, .5), .5, coat=.2, sheen=.3, rim=.12)     # 主色: 湖蓝
M_CREAM = mat('olo_cream', (.98, .92, .82), .55, coat=.15, sheen=.3, rim=.06)    # 脸/肚 浅色
M_ACC   = mat('olo_accent',(.3, .9, .95), .2, coat=.8, metal=.3, rim=.25)     # 点缀: 镜银青
M_GEM   = mat('olo_gem',   (.85, .95, 1.), .03, coat=1., metal=.9)
M_SCL   = mat('olo_sclera',(1, 1, 1), .25, coat=.6)
M_IRIS  = mat('olo_iris',  (.05, .5, .85), .15, coat=1., emit=(.02, .2, .35))
M_PUP   = mat('olo_pupil', (.02, .02, .06), .1, coat=1.)
M_HI    = mat('olo_eyehi', (1, 1, 1), .2, emit=(1, 1, 1))
M_BLUSH = mat('olo_blush', (1., .5, .6), .6, alpha=.6)
M_MOUTH = mat('olo_mouth', (.25, .05, .12), .4)
# zoned colours as a smooth vertex mask (R = cream face/belly/feet, G = accent) → crisp curved borders in shader
def ss(a, b, x): t = min(1, max(0, (x - a)/(b - a))); return t*t*(3 - 2*t)
ca = body.data.color_attributes.new('mask', 'FLOAT_COLOR', 'POINT')
for v in body.data.vertices:
    c = v.co; n = v.normal
    face = ss(0, .12, 1 - ((c.x/.3)**2 + ((c.z-.74)/.17)**2)) * ss(-.15, -.3, c.y)
    belly = ss(0, .12, 1 - ((c.x/.2)**2 + ((c.z-.4)/.2)**2)) * ss(-.1, -.22, c.y)
    foot = ss(.1, .065, c.z)
    acc = max([ss(rr + .03, rr - .03, (c - Vector(p)).length) for p, rr in ACC] + [0])
    ca.data[v.index].color = (max(face, belly, foot), acc, 0, 1)
body.data.color_attributes.active_color = ca
nt = M_SKIN.node_tree; P = nt.nodes['Principled BSDF']
at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'mask'
sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(at.outputs['Color'], sp.inputs[0])
def step(out):
    m = nt.nodes.new('ShaderNodeMapRange'); m.interpolation_type = 'SMOOTHSTEP'; m.inputs['From Min'].default_value = .42; m.inputs['From Max'].default_value = .58
    nt.links.new(out, m.inputs['Value']); return m.outputs['Result']
def mix(fac, a, b):
    m = nt.nodes.new('ShaderNodeMix'); m.data_type = 'RGBA'; nt.links.new(fac, m.inputs['Factor'])
    m.inputs[6].default_value = a; m.inputs[7].default_value = b; return m
kc, ka = step(sp.outputs['Red']), step(sp.outputs['Green'])
m1 = mix(kc, P.inputs['Base Color'].default_value[:], (.98, .92, .82, 1))
m2 = mix(ka, (0, 0, 0, 1), (.3, .9, .95, 1)); nt.links.new(m1.outputs[2], m2.inputs[6])
nt.links.new(m2.outputs[2], P.inputs['Base Color'])
rr = nt.nodes.new('ShaderNodeMapRange'); nt.links.new(ka, rr.inputs['Value']); rr.inputs['To Min'].default_value = .5; rr.inputs['To Max'].default_value = .2
nt.links.new(rr.outputs['Result'], P.inputs['Roughness'])
body.data.materials.append(M_SKIN)
# --- face: layered eyes (sclera / iris / pupil / 2 highlights), raycast onto head front
def surf(x, z):
    ok, loc, n, _ = body.ray_cast(Vector((x, -3, z)), Vector((0, 1, 0))); assert ok, (x, z); return loc, n
def part(name, loc, n, scale, m, push=0., seg=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg//2, radius=1)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(m); o.scale = scale
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = (-n).to_track_quat('Y', 'Z')
    o.location = loc + n*push; bpy.ops.object.shade_smooth(); return o
EYE_X, EYE_Z = .2, .9               # closer together than v6 + on the flatter front → side view OK
def eye(side):
    loc, n = surf(side*EYE_X, EYE_Z); n = (n + Vector((0, -1, 0))).normalized()   # face mostly forward
    sc = part(f'olo_eye_{side}', loc, n, (.11, .022, .14), M_SCL, .0)
    ir = part(f'olo_iris_{side}', loc, n, (.085, .016, .11), M_IRIS, .012)
    pu = part(f'olo_pupil_{side}', loc + Vector((0, 0, -.01)), n, (.048, .012, .062), M_PUP, .022)
    h1 = part(f'olo_hi_{side}', loc + Vector((-.035*side + -.02, 0, .05)), n, (.03, .01, .034), M_HI, .032, 12)
    h2 = part(f'olo_hi2_{side}', loc + Vector((.03, 0, -.055)), n, (.014, .008, .014), M_HI, .03, 12)
    return [sc, ir, pu, h1, h2]
EYES = {1: eye(1), -1: eye(-1)}
print('DIMS', body.dimensions, [round(v,2) for v in body.bound_box[0]], [round(v,2) for v in body.bound_box[6]]); ml, mn = surf(0, .7); mouth = part('olo_mouth', ml, mn, (.04, .02, .018), M_MOUTH)
blush = [part(f'olo_blush_{s}', *surf(s*.28, .78), (.07, .012, .035), M_BLUSH, .004) for s in (-1, 1)]
gl, gn = surf(0, 1.13); bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.09)
gem = bpy.context.active_object; gem.name = 'olo_gem'; gem.data.materials.append(M_GEM)
gem.scale = (1, .45, 1.2); gem.location = gl + gn*.01; gem.rotation_mode = 'QUATERNION'; gem.rotation_quaternion = (-gn).to_track_quat('Y', 'Z')
# shape keys (local unit coords)
def keys(o, defs):
    o.shape_key_add(name='Basis')
    for name, f in defs:
        k = o.shape_key_add(name=name, from_mix=False)
        for v, kv in zip(o.data.vertices, k.data): kv.co = Vector(f(*v.co))
def eye_keys(o, side, layer):
    z0 = lambda x, y, z: (x*.01, y*.01, z*.01)
    if layer == 2:   # pupil carries the dark lid-line shapes (blink / ^ happy), scaled to sclera size
        bl = lambda x,y,z: (x*2.5, y*.6, (z*.07 - .45)*2.2 + .1)
        hp = lambda x,y,z: (x*2.4, y*.6, (.25 - .85*x*x + .16*z)*2.2)
        sl = lambda x,y,z: (x*2.4, y*.6, (z*.08 - .2)*2.2)
    else: bl = hp = sl = z0
    if layer == 0: sl = lambda x,y,z: (x*1.04, y*.7, (z*.2 if z > -.1 else z*.55) - .25)
    keys(o, [('blink', bl), ('happy', hp),
             ('sad', lambda x,y,z: (x, y, (z if z < 0 else z*(.6 + .3*(x*side))) - .05)), ('sleepy', sl)])
for side, parts in EYES.items():
    for i, o in enumerate(parts): eye_keys(o, side, i)
# happy/blink for sclera: dark arc line → sclera material can't be white then; use pupil-coloured lid line by keeping sclera visible as arc (reads as ^)
keys(mouth, [('smile', lambda x,y,z: (x*1.6, y, -.4 + .9*x*x + .35*z)),
             ('frown', lambda x,y,z: (x*1.2, y, .3 - .8*x*x + .35*z)),
             ('o',     lambda x,y,z: (x*.7, y, z*1.9))])
# --- armature
bpy.ops.object.armature_add(location=(0, 0, 0)); arm = bpy.context.active_object; arm.name = 'olo_rig'
bpy.ops.object.mode_set(mode='EDIT'); eb = arm.data.edit_bones
root = eb[0]; root.name = 'root'; root.head = (0, 0, 0); root.tail = (0, 0, .12)
def bone(n, h, t, p): b = eb.new(n); b.head = h; b.tail = t; b.parent = eb[p]; return b
bone('body', (0, 0, .14), (0, 0, .56), 'root'); bone('head', (0, 0, .56), (0, 0, 1.3), 'body')
EAR = {'A': ((.42, .05, 1.0), (.78, .08, 1.12)), 'B': ((.42, .05, .98), (.72, .05, .7)), 'C': ((.4, .05, 1.15), (.6, .05, 1.25))}[V]
for s, n in ((-1, 'L'), (1, 'R')):
    (hx, hy, hz), (tx, ty, tz) = EAR
    bone('ear.'+n, (s*hx, hy, hz), (s*tx, ty, tz), 'head')
    bone('arm.'+n, (s*.2, -.05, .53), (s*.44, -.07, .32), 'body')
    bone('leg.'+n, (s*.14, -.03, .24), (s*.15, -.08, .0), 'root')
bone('crest', (0, 0, 1.3), (0, .1, 1.62), 'head')
bone('tail', (0, .26, .3), (0, .64, .55), 'body')
for b in eb:
    b.use_deform = b.name != 'root'
    if b.name[:3] in ('arm', 'ear'): b.align_roll(Vector((0, -1, 0)))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm; bpy.ops.object.parent_set(type='ARMATURE_NAME')
# explicit region weights (auto heat weights mixed up the tiny limbs)
def ss(a, b, x): t = min(1, max(0, (x - a)/(b - a))); return t*t*(3 - 2*t)
G = {b.name: body.vertex_groups.get(b.name) or body.vertex_groups.new(name=b.name) for b in arm.data.bones if b.use_deform}
for v in body.data.vertices:
    x, y, z = v.co; side = 'R' if x > 0 else 'L'; ax = abs(x); w = {}
    hd = ss(.56, .7, z); w['head'] = hd; w['body'] = 1 - hd
    def take(n, k):
        if k <= 0: return
        for kk in list(w): w[kk] *= (1 - k)
        w[n] = w.get(n, 0) + k
    if z < .62 and z > .2 and y < .15: take('arm.'+side, ss(.2, .3, ax))
    if z < .24: take('leg.'+side, ss(.24, .1, z) * ss(.02, .08, ax))
    if z > .8: take('ear.'+side, ss(.4, .52, ax))
    if z > 1.2 and ax < .25: take('crest', ss(1.26, 1.36, z))
    if y > .22 and z < .8: take('tail', ss(.22, .34, y))
    for n, k in w.items():
        if k > 1e-3: G[n].add([v.index], k, 'REPLACE')
for o in sum(EYES.values(), []) + [mouth, gem] + blush:
    mw = o.matrix_world.copy(); o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = 'head'; o.matrix_world = mw
# --- actions (arm.R +Z = raise, arm.L -Z = raise; ear.L -Z = up)
FPS = 30; S.render.fps = FPS; arm.animation_data_create()
def action(name, frames, fn):
    a = bpy.data.actions.new(name); a.use_fake_user = True; arm.animation_data.action = a; pb = arm.pose.bones
    for p in pb: p.rotation_mode = 'XYZ'
    for f in range(frames + 1):
        t = f / frames
        for p in pb: p.location = (0,0,0); p.rotation_euler = (0,0,0); p.scale = (1,1,1)
        fn(t, pb)
        for p in pb:
            for k in ('location', 'rotation_euler', 'scale'): p.keyframe_insert(k, frame=f)
    return a
TAU = math.tau
def idle(t, pb):
    s = math.sin(t*TAU)
    pb['body'].scale = (1 - .02*s, 1 - .02*s, 1 + .03*s)
    pb['head'].rotation_euler = (.02*math.sin(t*TAU + 1), .04*math.sin(t*TAU + .6), 0)
    pb['ear.L'].rotation_euler = (0, 0, .1*math.sin(t*TAU - .9)); pb['ear.R'].rotation_euler = (0, 0, -.1*math.sin(t*TAU - 1.3))
    pb['arm.L'].rotation_euler = (0, 0, -.15 + .08*math.sin(t*TAU - .5)); pb['arm.R'].rotation_euler = (0, 0, .15 - .08*math.sin(t*TAU - .5))
    pb['crest'].rotation_euler = (.08*math.sin(t*TAU*2 - .7), 0, 0)
    pb['tail'].rotation_euler = (0, 0, .3*math.sin(t*TAU*2))
def wave(t, pb):
    idle(t, pb); e = min(1, t*5, (1-t)*5)
    pb['arm.R'].rotation_euler = (0, 0, e*(1.55 + .35*math.sin(t*TAU*3)))
    pb['head'].rotation_euler = (0, -.1*e, 0); pb['ear.R'].rotation_euler = (0, 0, -.2*e*math.sin(t*TAU*3 - .8))
def hop(t, pb):
    if t < .2: k = t/.2; sq = -.2*math.sin(k*math.pi/2); z = 0
    elif t < .65: k = (t-.2)/.45; z = .45*math.sin(k*math.pi); sq = .14*(1-k) - .04*k
    else: k = (t-.65)/.35; z = 0; sq = -.18*math.exp(-k*4)*math.cos(k*9)
    pb['root'].location = (0, z, 0); pb['body'].scale = (1 - sq*.6, 1 - sq*.6, 1 + sq)
    up = 1 if .2 < t < .7 else 0
    pb['arm.L'].rotation_euler = (0, 0, -1.3*up); pb['arm.R'].rotation_euler = (0, 0, 1.3*up)
    pb['ear.L'].rotation_euler = (0, 0, .35*sq); pb['ear.R'].rotation_euler = (0, 0, -.35*sq)
    pb['crest'].rotation_euler = (-2*sq, 0, 0); pb['tail'].rotation_euler = (-1.5*sq, 0, 0)
def poke(t, pb):
    sq = -.28*math.exp(-t*5)*math.cos(t*14); pb['body'].scale = (1 - sq*.7, 1 - sq*.7, 1 + sq)
    pb['head'].rotation_euler = (.15*math.exp(-t*4)*math.sin(t*12), 0, 0); e = math.exp(-t*3.5)
    pb['arm.L'].rotation_euler = (0, 0, .5*e); pb['arm.R'].rotation_euler = (0, 0, -.5*e)
    pb['ear.L'].rotation_euler = (0, 0, .4*e*math.sin(t*16)); pb['ear.R'].rotation_euler = (0, 0, -.4*e*math.sin(t*16 + .5))
    pb['crest'].rotation_euler = (.4*e*math.sin(t*14), 0, 0)
A = {n: action(n, fr, fn) for n, fr, fn in [('idle', 72, idle), ('wave', 54, wave), ('hop', 33, hop), ('poke', 30, poke)]}
arm.animation_data.action = A['idle']
for n, a in A.items():
    tr = arm.animation_data.nla_tracks.new(); tr.name = n; tr.strips.new(n, 0, a); tr.mute = True
S.frame_start, S.frame_end = 0, 72
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'olo_{V}.blend' if V != 'A' or 'concept' in GLB else 'olo.blend'))
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', export_animation_mode='NLA_TRACKS', export_morph=True, export_skins=True, export_apply=False, export_yup=True, export_vertex_color='ACTIVE')
print('FACES', len(body.data.polygons))
