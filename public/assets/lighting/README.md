# Lighting demo assets

Processed runtime copies of the reference art in [`docs/reference/`](../../../docs/reference/).
These are the assets the game scene loads; do not edit them by hand.

| File                   | Size    | Source                      |
| ---------------------- | ------- | --------------------------- |
| `ship-color.png`       | 514×841 | `ship-color.webp`           |
| `ship-normal.png`      | 514×841 | `ship-normal.webp`          |
| `asteroid-color.png`   | 643×622 | `asteroid-color.webp`       |
| `asteroid-normal.png`  | 643×622 | `asteroid-normal.webp`      |
| `asteroid2-color.png`  | 620×635 | `asteroid2-color.webp`      |
| `asteroid2-normal.png` | 620×635 | `asteroid2-normal.webp`     |
| `ship-emissive.png`    | 514×841 | derived cyan panels         |
| `ship-glow.png`        | 514×841 | blurred emissive matte      |
| `turret.png`           | 164×208 | `docs/reference/turret.svg` |

Processing steps (one-off, not a runtime pipeline):

- magenta chroma-keyed to alpha with soft-edge matte extraction and despill,
- resampled in premultiplied alpha (LANCZOS) at roughly 2× their on-screen size,
- trimmed to the silhouette with a 4 px transparent gutter,
- color and normal maps dilated into the gutter so linear filtering has no dark halo,
- normal maps masked with the color alpha and paired at identical framing,
- normal strength softened to **~0.30** (blended toward a flat `(0, 0, 1)` normal) because the
  reference art already contains baked shading; full-strength normals read as polished metal,
- cyan panels extracted from the color art into `ship-emissive.png`, with a Gaussian-blurred
  `ship-glow.png` halo used additively by the shader,
- runtime ship art mirrored across the vertical centerline (source AI art was asymmetrical);
  the normal map is mirrored with its X channel flipped,
- the three rear cyan engine ovals are excluded from the emissive/glow maps for special
  treatment later; the baked reverse-engine nozzle ovals **are** included,
- the center nozzle is copied, turned 180°, scaled 0.58×, and composited **below** the ship
  color/normal maps under the outer wing edges as the reverse-engine visual,
- `turret.png` is the supplied turret SVG rasterized at 4× for the eight aiming turrets.
- `asteroid2-*` is the second supplied asteroid and went through the same one-off treatment
  (magenta key + despill, premultiplied LANCZOS resample, silhouette trim with a 4 px gutter,
  normal masked by the colour alpha and softened to ~0.30, flat `(127,127,254)` normals in the
  gutter). Its silhouette radius measures 0.474 × art width, within 0.002 of the first asteroid,
  so both share the same collider ratio.

Normal maps use tangent-space RGB (red = X, green = Y, blue = Z). Both pairs come from the
supplied reference art; re-export lossless versions if the source normal maps are ever replaced.
