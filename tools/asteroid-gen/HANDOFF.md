# Handoff — asteroid art pipeline

Snapshot for continuing on 2026-11-09. Code is on `main`; a tag
`asteroid-art-wip` points at the same commit.

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
- **Game art state**: the game still renders the **browser-baked** variants from
  `src/app/asteroid-art.ts` / `asteroid-art-model.ts` (8 variants, 1024 px,
  slate/ice/limestone). The Blender sprites are **not integrated yet**.

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

## Next step (integration)

1. Render the final set (8 variants, 1024 px, alternating slate/ice/limestone)
   into `public/assets/lighting/generated/` as `asteroid-gen-XX-color.png` and
   `asteroid-gen-XX-normal.png` (use WebP if repo size matters).
2. In `src/app/lighting-scene.ts`, load those assets and append them to
   `asteroidArts` (the array already supports arbitrary variants); the layout
   picks variants across the whole array via `variantCount`.
3. Remove `createGeneratedAsteroidArts()` from the scene, delete
   `src/app/asteroid-art.ts` + `asteroid-art-model.ts` + their test, and update
   README/AGENTS/DECISIONS accordingly.
4. Verify: 100 rocks, 60 FPS, vertical axis clear, colliders present (the Blender
   alpha silhouette is traced once per variant by `asteroid-field.ts`; expected
   ~24–28 points, same as supplied art).

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
