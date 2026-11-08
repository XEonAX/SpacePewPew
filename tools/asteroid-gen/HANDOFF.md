# Handoff — asteroid art pipeline

**Status: integrated.** Eight variants are committed under
`public/assets/lighting/generated/`, `lighting-scene.ts` loads them alongside the
two supplied rocks, and the browser-baked generator has been deleted (ADR-038).
This file remains as the reference for re-baking/polishing the art.

Code is on `main`; the `asteroid-art-wip` tag marks the pre-integration snapshot.

## Where things are

- **Pipeline code (committed)**
  - `tools/asteroid-gen/render_asteroid.py` — Blender scene builder + colour and
    normal renders.
  - `tools/asteroid-gen/postprocess.py` — ink outline, rim light, normal-map
    attenuation. Most composition knobs live in `render_asteroid.py`:
    `CRATERS`, `FACET_COUNT`, `FACET_SIZE_VARIATION`, `CHUNK_RAMP`,
    `PLATES_ENABLED`, `BEVEL_WIDTH`, `ROCK_RAMP`, `PALETTE_TINT`.
  - `tools/asteroid-gen/preview/` — committed previews: `contact-sheet.png`,
    `hero-512.png`, `hero-192.png`.
- **Latest candidate renders (gitignored, disposable)**
  - `.agent/blender/v11-seed<seed>-<palette>/color-final.png`
  - `.agent/blender/hero3-seed3-slate/color-final.png` (1024 hero)
  - Regenerate if wiped; the command is below.
- **Game art state**: the field renders the two supplied rocks plus the eight
  committed Blender variants from `public/assets/lighting/generated/`; the
  browser-baked generator is gone.

## Resume commands

One variant (headless Blender 5.2):

```bash
OUT=/tmp/rock
ASTEROID_OUT=$OUT ASTEROID_SEED=3 ASTEROID_SIZE=1024 ASTEROID_PALETTE=slate \
  blender --background --python tools/asteroid-gen/render_asteroid.py
python3 tools/asteroid-gen/postprocess.py $OUT
```

Six-variant contact sheet (run inside Blender or via the MCP Blender tool with
the same `runpy` loop used during development): for seeds
`(3,slate), (7,ice), (11,slate), (19,limestone), (23,ice), (31,slate)`, set the
env vars above and run `render_asteroid.py`, then postprocess each directory.

## Re-baking / iterating

The shipped seed/palette order is in `README.md`. To change the look, edit the
knobs in `render_asteroid.py`, re-render the eight variants at 1024 px, run
`postprocess.py`, copy the finals into `public/assets/lighting/generated/`, and
update `preview/`. No game-code change is needed unless the variant count
changes (`GENERATED_ASTEROID_VARIANTS` in `lighting-scene.ts`).

## Notes / gotchas

- Blender 5.2: `bpy.ops.wm.read_factory_settings` is blocked by the MCP sandbox;
  the script uses `read_homefile(use_empty=True, use_factory_startup=True)`.
  `bpy.context.object` is gone — use `view_layer.objects.active`. Modifier
  apply needs a `temp_override`. Refresh `bm.faces.ensure_lookup_table()` after
  topology edits.
- Materials are **painted emission** (fake-lit), not PBR, so the normal map is
  attenuated to 0.3 in post — the same convention as the supplied asteroid art.
- Plate relief uses `inset_region(..., depth=...)`; do not go back to extruding
  single faces, it creates thin bright slivers ("weird lines").
- Chunks are `CHUNK_RAMP` (blue-grey) and are excluded from crater volumes and
  the silhouette; keep that filtering when touching bit placement.
