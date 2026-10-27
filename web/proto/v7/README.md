# olo v7 — 镜水系小精灵（Blender → glb → Three.js）
Build: `blender -b --python art/olo-3d/v7/build_v7.py -- art/olo-3d/v7 web/proto/v7/olo.glb A`（B/C = 草模变体）
Render: `blender -b art/olo-3d/v7/olo.blend --python art/olo-3d/v7/render_v7.py -- <out> hero|turn|moods|concept|wave`
Serve `web/proto` statically, open `v7/` (`?hq=1` turns on accent transmission).
Body zones = vertex mask COLOR_0 (R cream, G accent) mixed in shader; forms change only the main colour.
Credits: three.js r170 (MIT, vendor/three-LICENSE); RoomEnvironment procedural, no HDR. Design study: art/olo-3d/seer-study.md (no game assets used).
