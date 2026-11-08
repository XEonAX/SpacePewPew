# Stylized asteroid renderer

Procedural asteroid sprites in the style of the supplied reference art — flat
faceted rock, cream/blue painted lighting, octagonal flat-floored craters,
hex studs and small rock chunks — rendered with Blender (5.x) and finished with a
small Python pass.

## Status (2026-11-09)

- ✅ **Integrated.** Eight variants are committed in
  `public/assets/lighting/generated/` and loaded by `lighting-scene.ts`; the
  browser-baked generator was removed (ADR-038).
- ✅ Pipeline produces consistent variants across seeds/palettes; previews in
  `preview/`.
- Renders are deterministic: same seed + size + palette → same sprite.
- Working renders live in `.agent/blender/` (gitignored, disposable).

## Re-baking the shipped set

Shipped order and palettes (1–8):

| #   | seed | palette   |
| --- | ---- | --------- |
| 1   | 3    | slate     |
| 2   | 7    | ice       |
| 3   | 11   | slate     |
| 4   | 19   | limestone |
| 5   | 23   | ice       |
| 6   | 31   | slate     |
| 7   | 41   | ice       |
| 8   | 53   | limestone |

Render each at `ASTEROID_SIZE=1024` into a temp directory, run
`postprocess.py`, rename to `asteroid-gen-NN-color.png` / `-normal.png`, then run
`optimize_webp.py` to produce the committed `.webp` runtime copies:

```bash
python3 tools/asteroid-gen/optimize_webp.py <staging-dir> public/assets/lighting/generated
```

The optimizer uses WebP quality 88 for colour maps (with alpha) and 92 for normal maps; the
whole committed ship + asteroid art set is under 1 MB, versus 7.4 MB as PNGs.

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
`normal-final.png` — those are the files to convert for shipping.

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
