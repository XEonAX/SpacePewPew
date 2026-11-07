# Stylized asteroid renderer

Procedural asteroid sprites in the style of the supplied reference art — flat
faceted rock, cream/blue painted lighting, octagonal flat-floored craters,
hex studs and small rock chunks — rendered with Blender (5.x) and finished with a
small Python pass.

## Status (2026-11-08)

- ✅ Pipeline works and produces consistent variants across seeds/palettes.
- ✅ Candidate hero/contact sheet reviewed visually: `preview/`.
- ⏳ **Not wired into the game yet.** The field still uses the browser-baked
  variants in `src/app/asteroid-art.ts`; the plan is to render a final set of
  8 variants at 1024 px into `public/assets/lighting/generated/`, load them in
  `lighting-scene.ts`, and retire the browser-baked generator.
- Candidate renders live in `.agent/blender/` (gitignored, disposable).

## Usage

Open Blender and run the script (Scripting workspace, or headless):

```bash
ASTEROID_OUT=/tmp/rock ASTEROID_SEED=3 ASTEROID_SIZE=1024 \
ASTEROID_PALETTE=slate \
blender --background --python tools/asteroid-gen/render_asteroid.py
python3 tools/asteroid-gen/postprocess.py /tmp/rock
```

Environment:

- `ASTEROID_SEED` — deterministic seed.
- `ASTEROID_SIZE` — square render size (512 for iteration, 1024 for finals).
- `ASTEROID_PALETTE` — `slate`, `ice` or `limestone`.
- `ASTEROID_OUT` — output directory (created by the caller).

Outputs: `color.png` (transparent RGBA painted sprite), `normal.png`
(camera-space normals, attenuated by post), `ambient.png` (soft occlusion),
`stats.json` (crater/face counts). `postprocess.py` writes `color-final.png` and
`normal-final.png` — those are the files to ship.

## Technique

1. **Body** — blue-noise points on a peanut/lumpy surface → convex hull →
   dual mesh → planarised 5–7-sided flat facets (Voronoi-dual look), posed under
   a fixed key light.
2. **Craters** — tapered octagonal boolean cutters (wide outside, flat floor);
   crater faces are re-tinted darker with dark walls; crater rims get extra
   bevel weight so the lip catches light.
3. **Bits** — octagonal studs, micro studs and deformed-ico rock chunks scattered
   on camera-facing facets only, kept off the silhouette and out of craters.
4. **Paint** — fake-lit emission materials: ramp keyed by `dot(normal, light)`,
   per-facet random tint, painted blotches/dry-brush streaks, scratches and
   Voronoi pits. Different materials for rock, crater floor, crater wall, bevel
   ridge, plate skirt, studs and chunks.
5. **Relief** — inset-raised plate regions with dark skirts (no extrusion
   slivers), then a weighted bevel with the lighter ridge material.
6. **Render** — Cycles, Standard view transform, transparent film; a second pass
   writes camera-space normals. `postprocess.py` adds the dark silhouette ink,
   a subtle rim light, and attenuates normals to the game shader's 0.3 strength.

The normal map is deliberately mild because the lighting is painted into the
colour map (same approach as the supplied asteroid art).
