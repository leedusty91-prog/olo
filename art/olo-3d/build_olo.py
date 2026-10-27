# Blender 4.2 headless: blender -b --python build_olo.py -- <outdir>
# Procedurally builds olo (weird-cute jelly monster), rig, shape keys, actions; saves .blend + exports .glb
import bpy, bmesh, math, sys, os
from mathutils import Vector, Euler, Matrix
argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.dirname(os.path.abspath(__file__))
GLB = argv[1] if len(argv) > 1 else os.path.join(OUT, 'olo.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene

# ---------------- body: metaballs → one continuous surface ----------------
mb = bpy.data.metaballs.new('olo_mb'); mb.resolution = 0.018; mb.threshold = 0.6
mbo = bpy.data.objects.new('olo_mb', mb); S.collection.objects.link(mbo)
def ball(co, r, typ='BALL', size=(0,0,0), rot=(0,0,0), stiff=2.0):
    e = mb.elements.new(); e.type = typ; e.co = co; e.radius = r; e.stiffness = stiff
    if typ != 'BALL': e.size_x, e.size_y, e.size_z = size
    e.rotation = Euler(rot).to_quaternion()
    return e
# bean: wide soft bottom + slightly narrower top (one mass = head+body)
ball((0, 0, .36), .64, 'ELLIPSOID', (1.06, .9, .74))
ball((0, 0, .66), .54, 'ELLIPSOID', (.9, .84, .84))
# soft ear-horns grow from the top (left a touch longer, both tilt outward)
ball((-.3, 0, .95), .19, 'CAPSULE', (.08, 0, 0), (0, math.radians(-42), 0), 1.6)
ball(( .3, 0, .93), .18, 'CAPSULE', (.05, 0, 0), (0, math.radians(-140), 0), 1.6)
# stubby arms hugging the sides
ball((-.48, -.05, .33), .145, 'CAPSULE', (.05, 0, 0), (0, math.radians(50), 0), 2.2)
ball(( .48, -.05, .33), .145, 'CAPSULE', (.05, 0, 0), (0, math.radians(-50), 0), 2.2)
# tiny feet
ball((-.22, -.06, .06), .19, 'ELLIPSOID', (1, 1.2, .6), stiff=1.4)
ball(( .22, -.06, .06), .19, 'ELLIPSOID', (1, 1.2, .6), stiff=1.4)
# short tail continuing the back
ball((0, .44, .26), .16, 'CAPSULE', (.06, 0, 0), (0, 0, math.radians(90)), 1.6)
bpy.context.view_layer.objects.active = mbo; mbo.select_set(True)
bpy.ops.object.convert(target='MESH')
body = bpy.context.active_object; body.name = 'olo_body'
# clean topology: voxel → quadriflow → subdiv
r = body.modifiers.new('rm', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = .012
bpy.ops.object.modifier_apply(modifier='rm')
sm = body.modifiers.new('sm', 'SMOOTH'); sm.factor = .6; sm.iterations = 6
bpy.ops.object.modifier_apply(modifier='sm')
try:
    bpy.ops.object.quadriflow_remesh(target_faces=2600, use_preserve_sharp=False, use_mesh_symmetry=True, smooth_normals=True)
except Exception as ex:
    print('quadriflow failed', ex); d = body.modifiers.new('d', 'DECIMATE'); d.ratio = .08; bpy.ops.object.modifier_apply(modifier='d')
sub = body.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
bpy.ops.object.modifier_apply(modifier='sub')
bpy.ops.object.shade_smooth()

# ---------------- materials ----------------
def mat(name, col, rough=.35, sss=0., coat=0., trans=0., emit=None, alpha=1.):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*col, 1); p.inputs['Roughness'].default_value = rough
    p.inputs['Subsurface Weight'].default_value = sss; p.inputs['Subsurface Radius'].default_value = (.5, .8, .7)
    p.inputs['Subsurface Scale'].default_value = .08
    p.inputs['Coat Weight'].default_value = coat; p.inputs['Coat Roughness'].default_value = .08
    p.inputs['Transmission Weight'].default_value = trans
    if emit: p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = 1.
    if alpha < 1: p.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND'
    return m
M_BODY = mat('olo_jelly', (.2, .72, .6), .3, sss=.22, coat=.7, trans=.12)
M_EYE  = mat('olo_eye', (.025, .02, .05), .08, coat=1.)
M_BLUSH= mat('olo_blush', (1., .45, .55), .6, alpha=.55)
M_HI   = mat('olo_eyehi', (1, 1, 1), .2, emit=(1, 1, 1))
body.data.materials.append(M_BODY)

# ---------------- face (raycast onto surface) ----------------
dg = bpy.context.evaluated_depsgraph_get()
def surf(x, z):
    ok, loc, n, _ = body.ray_cast(Vector((x, -3, z)), Vector((0, 1, 0)))
    assert ok, (x, z)
    return loc, n
def face_part(name, x, z, scale, m, push=.0):
    loc, n = surf(x, z)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(m)
    o.scale = scale
    q = (-n).to_track_quat('Y', 'Z')                    # local +Y points into body
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = q
    o.location = loc + n*push
    bpy.ops.object.shade_smooth()
    return o
EYE_Z, EYE_X = .58, .23
eyeL = face_part('olo_eye_L', -EYE_X, EYE_Z, (.09, .03, .1), M_EYE, .0)
eyeR = face_part('olo_eye_R',  EYE_X, EYE_Z, (.09, .03, .1), M_EYE, .0)
mouth = face_part('olo_mouth', 0, .45, (.035, .02, .016), M_EYE, .0)
blL = face_part('olo_blush_L', -.33, .47, (.07, .012, .035), M_BLUSH, .004)
blR = face_part('olo_blush_R',  .33, .47, (.07, .012, .035), M_BLUSH, .004)
def hl(eye, dx, dz, r):
    loc, n = surf(eye.location.x + dx, eye.location.z + dz)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=r)
    o = bpy.context.active_object; o.data.materials.append(M_HI); o.location = loc - n*-.025 + Vector((0, -.012, 0))
    o.name = eye.name + '_hi'; bpy.ops.object.shade_smooth(); return o
hiL = hl(eyeL, -.03, .04, .022); hiR = hl(eyeR, -.03, .04, .022)

# shape keys on local unit sphere coordinates: x horizontal, z vertical (after scale), y depth
def keys(o, defs):
    o.shape_key_add(name='Basis')
    for name, f in defs:
        k = o.shape_key_add(name=name, from_mix=False)
        for v, kv in zip(o.data.vertices, k.data):
            x, y, z = v.co; kv.co = Vector(f(x, y, z))
def eye_keys(o, side):
    keys(o, [
        ('blink',  lambda x,y,z: (x*1.08, y*.6, z*.07 - .45)),
        ('happy',  lambda x,y,z: (x*1.05, y*.6, .25 - .85*x*x + .16*z)),       # ^ arc
        ('sad',    lambda x,y,z: (x, y, (z if z < 0 else z*(.5 + .4*(x*side))) - .05)),
        ('sleepy', lambda x,y,z: (x*1.04, y*.7, (z*.18 if z > -.1 else z*.55) - .25)),
    ])
eye_keys(eyeL, 1); eye_keys(eyeR, -1)
keys(mouth, [
    ('smile', lambda x,y,z: (x*1.5, y, -.4 + .9*x*x + .35*z)),
    ('frown', lambda x,y,z: (x*1.2, y, .3 - .8*x*x + .35*z)),
    ('o',     lambda x,y,z: (x*.6, y, z*1.7)),
])

# ---------------- armature ----------------
bpy.ops.object.armature_add(location=(0, 0, 0)); arm = bpy.context.active_object; arm.name = 'olo_rig'
bpy.ops.object.mode_set(mode='EDIT'); eb = arm.data.edit_bones
root = eb[0]; root.name = 'root'; root.head = (0, 0, 0); root.tail = (0, 0, .15)
def bone(n, h, t, p):
    b = eb.new(n); b.head = h; b.tail = t; b.parent = eb[p]; return b
bone('body', (0, 0, .15), (0, 0, .55), 'root')
bone('head', (0, 0, .55), (0, 0, .95), 'body')
bone('ear.L', (-.22, 0, .88), (-.36, 0, 1.08), 'head')
bone('ear.R', ( .22, 0, .86), ( .36, 0, 1.04), 'head')
bone('arm.L', (-.42, -.04, .38), (-.62, -.04, .24), 'body')
bone('arm.R', ( .42, -.04, .38), ( .62, -.04, .24), 'body')
bone('leg.L', (-.2, -.03, .22), (-.21, -.06, .0), 'root')
bone('leg.R', ( .2, -.03, .22), ( .21, -.06, .0), 'root')
bone('tail', (0, .32, .3), (0, .62, .24), 'body')
for b in eb:
    b.use_deform = b.name != 'root'
    if b.name[:3] in ('arm', 'ear'): b.align_roll(Vector((0, -1, 0)))   # local Z = facing axis → Z rotation swings in the front plane
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# face parts follow head bone
for o in (eyeL, eyeR, mouth, blL, blR, hiL, hiR):
    mw = o.matrix_world.copy(); o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = 'head'; o.matrix_world = mw

# ---------------- actions ----------------
FPS = 30; S.render.fps = FPS
arm.animation_data_create()
def action(name, frames, fn, loop=True):
    a = bpy.data.actions.new(name); a.use_fake_user = True; arm.animation_data.action = a
    pb = arm.pose.bones
    for p in pb: p.rotation_mode = 'XYZ'
    for f in range(frames + 1):
        t = f / frames
        for p in pb: p.location = (0,0,0); p.rotation_euler = (0,0,0); p.scale = (1,1,1)
        fn(t, pb)
        for p in pb:
            p.keyframe_insert('location', frame=f); p.keyframe_insert('rotation_euler', frame=f); p.keyframe_insert('scale', frame=f)
    return a
TAU = math.tau
def idle(t, pb):
    s = math.sin(t*TAU)
    pb['body'].scale = (1 - .025*s, 1 - .025*s, 1 + .04*s)
    pb['head'].rotation_euler = (0, .03*math.sin(t*TAU + .6), 0)
    pb['ear.L'].rotation_euler = (0, 0, .12*math.sin(t*TAU - .9))
    pb['ear.R'].rotation_euler = (0, 0, -.12*math.sin(t*TAU - 1.3))
    pb['arm.L'].rotation_euler = (0, 0, .1*math.sin(t*TAU - .5))
    pb['arm.R'].rotation_euler = (0, 0, -.1*math.sin(t*TAU - .5))
    pb['tail'].rotation_euler = (0, 0, .25*math.sin(t*TAU*2))
def wave(t, pb):
    idle(t, pb); e = min(1, t*5, (1-t)*5)
    pb['arm.R'].rotation_euler = (0, 0, e*(1.9 + .35*math.sin(t*TAU*3)))
    pb['head'].rotation_euler = (0, -.08*e, 0)
    pb['ear.R'].rotation_euler = (0, 0, -.25*e*math.sin(t*TAU*3 - .8))
def hop(t, pb):
    # anticipation squash → stretch in air → land squash → settle
    if t < .2: k = t/.2; sq = -.22*math.sin(k*math.pi/2); z = 0
    elif t < .65: k = (t-.2)/.45; z = .45*math.sin(k*math.pi); sq = .16*(1-k) - .05*k
    else: k = (t-.65)/.35; z = 0; sq = -.2*math.exp(-k*4)*math.cos(k*9)
    pb['root'].location = (0, 0, z)    # bone local Y is world Z for upright root
    pb['root'].location = (0, z, 0)
    pb['body'].scale = (1 - sq*.6, 1 - sq*.6, 1 + sq)
    up = 1 if .2 < t < .7 else 0
    pb['arm.L'].rotation_euler = (0, 0, -1.4*up); pb['arm.R'].rotation_euler = (0, 0, 1.4*up)
    pb['ear.L'].rotation_euler = (0, 0, -.35*(sq)); pb['ear.R'].rotation_euler = (0, 0, .35*(sq))
    pb['leg.L'].location = (0, -z*.25, 0); pb['leg.R'].location = (0, -z*.25, 0)
def poke(t, pb):
    sq = -.3*math.exp(-t*5)*math.cos(t*14)
    pb['body'].scale = (1 - sq*.7, 1 - sq*.7, 1 + sq)
    pb['head'].rotation_euler = (.15*math.exp(-t*4)*math.sin(t*12), 0, 0)
    e = math.exp(-t*3.5)
    pb['arm.L'].rotation_euler = (0, 0, .55*e); pb['arm.R'].rotation_euler = (0, 0, -.55*e)
    pb['ear.L'].rotation_euler = (0, 0, .4*e*math.sin(t*16)); pb['ear.R'].rotation_euler = (0, 0, -.4*e*math.sin(t*16 + .5))
A = {n: action(n, fr, fn) for n, fr, fn in [('idle', 72, idle), ('wave', 54, wave), ('hop', 33, hop), ('poke', 30, poke)]}
arm.animation_data.action = A['idle']
for n, a in A.items():
    tr = arm.animation_data.nla_tracks.new(); tr.name = n; tr.strips.new(n, 0, a); tr.mute = True
S.frame_start, S.frame_end = 0, 72

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'olo.blend'))
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', export_animation_mode='NLA_TRACKS',
    export_morph=True, export_skins=True, export_apply=False, export_yup=True, export_draco_mesh_compression_enable=False)
print('FACES', len(body.data.polygons), 'VERTS', len(body.data.vertices))
