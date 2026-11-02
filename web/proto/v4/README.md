# olo proto v4: little monster 噗噗

Fully replaces the water-drop body. Same single-pass WebGL2 shader framework as v3 (scene, reflection, blinking, gaze, 4 moods, poke, 10 colours, steps, wave).
Run: `python3 -m http.server -d web/proto` → `/v4/`.

- Silhouette: a squat bean body (narrow top, wide bottom), two soft coral horns that hook outward (left long, right short), a little curl (小旋儿) between them, a chubby tail curled at the lower left, short stubby gel arms and legs.
- Features: light belly patch, two small downward fangs, three freckles on the left of the forehead; equal-sized eyes (fixes v3's mismatched eyes looking odd in the reflection).
- Material: translucent jelly + warm gold light specks inside + caustics/fresnel; horns in warm coral against the cool body colour.
- Mood moves the whole body: happy = body puffs wider, horns stand up, arms raise, tail wags; curious = body tilts, one horn perks up; sleepy = slumps flat like a rice cake, horns droop; sad = upper body sags, horns drop down.
- Iteration: shots/r1–r4.png (one close-up per round, 5 moods each).
