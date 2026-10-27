# blender -b olo.blend --python render_olo.py -- <outdir> [mode]
import bpy, math, sys, os
from mathutils import Vector
argv = sys.argv[sys.argv.index('--')+1:]; OUT = argv[0]; MODE = argv[1] if len(argv) > 1 else 'hero'
S = bpy.context.scene
S.render.engine = 'CYCLES'; S.cycles.device = 'CPU'; S.cycles.samples = 48; S.cycles.use_denoising = True
S.render.resolution_x, S.render.resolution_y = 720, 900; S.render.film_transparent = False
S.view_settings.view_transform = 'AgX'; S.view_settings.look = 'AgX - Medium High Contrast'
arm = bpy.data.objects['olo_rig']; arm.animation_data.action = bpy.data.actions['idle']; S.frame_set(0)
# world: soft dusk gradient
w = bpy.data.worlds.new('w'); S.world = w; w.use_nodes = True; nt = w.node_tree
bg = nt.nodes['Background']; tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB'); nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], ramp.inputs[0])
ramp.color_ramp.elements[0].color = (.55, .42, .62, 1); ramp.color_ramp.elements[1].color = (.36, .42, .75, 1)
ramp.color_ramp.elements.new(.52).color = (1., .78, .7, 1)
nt.links.new(ramp.outputs[0], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.1
# floor (soft shadow catcher look)
bpy.ops.mesh.primitive_plane_add(size=12); fl = bpy.context.active_object
fm = bpy.data.materials.new('floor'); fm.use_nodes = True; p = fm.node_tree.nodes['Principled BSDF']
p.inputs['Base Color'].default_value = (.42, .38, .58, 1); p.inputs['Roughness'].default_value = .25; fl.data.materials.append(fm)
def area(loc, e, size, col=(1,1,1)):
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.active_object
    l.data.energy = e; l.data.size = size; l.data.color = col
    l.rotation_euler = (Vector((0, 0, .6)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler(); return l
area((-1.6, -2.2, 2.4), 260, 2.2, (1, .93, .85))      # warm key
area((2.2, 1.8, 1.8), 220, 1.5, (.7, .8, 1.))          # cool rim
area((1.8, -2.4, .6), 60, 2.5, (1, .8, .85))           # fill
cam_d = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_d); S.collection.objects.link(cam); S.camera = cam
cam_d.lens = 70
def shoot(az_deg, path, el=10, dist=4.4, tz=.55):
    a = math.radians(az_deg); e = math.radians(el)
    cam.location = (math.sin(a)*math.cos(e)*dist, -math.cos(a)*math.cos(e)*dist, tz + math.sin(e)*dist)
    cam.rotation_euler = (Vector((0, 0, tz)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    S.render.filepath = path; bpy.ops.render.render(write_still=True)
if MODE == 'hero': shoot(-28, f'{OUT}/blender-render.png')
elif MODE == 'turn':
    S.render.resolution_x, S.render.resolution_y = 420, 520; S.cycles.samples = 24
    for i, az in enumerate([0, 90, 180, -35]): shoot(az, f'{OUT}/turn_{i}.png')
elif MODE == 'moods':
    S.render.resolution_x, S.render.resolution_y = 400, 460; S.cycles.samples = 24
    sets = {'neutral': {}, 'happy': {'happy': 1, 'smile': 1}, 'sad': {'sad': 1, 'frown': 1}, 'sleepy': {'sleepy': 1}, 'surprised': {'o': 1}, 'blink': {'blink': 1}}
    for n, ks in sets.items():
        for o in bpy.data.objects:
            if o.data and hasattr(o.data, 'shape_keys') and o.data.shape_keys:
                for kb in o.data.shape_keys.key_blocks[1:]: kb.value = ks.get(kb.name, 0)
        shoot(-15, f'{OUT}/mood_{n}.png', dist=3.6, tz=.6)
