# Lighting demo assets

Processed runtime copies of the reference art in [`docs/reference/`](../../../docs/reference/).
These are the assets the game scene loads; do not edit them by hand.

| File                  | Size    | Source                 |
| --------------------- | ------- | ---------------------- |
| `ship-color.png`      | 514×841 | `ship-color.webp`      |
| `ship-normal.png`     | 514×841 | `ship-normal.webp`     |
| `asteroid-color.png`  | 643×622 | `asteroid-color.webp`  |
| `asteroid-normal.png` | 643×622 | `asteroid-normal.webp` |

Processing steps (one-off, not a runtime pipeline):

- magenta chroma-keyed to alpha with soft-edge matte extraction and despill,
- resampled in premultiplied alpha (LANCZOS) at roughly 2× their on-screen size,
- trimmed to the silhouette with a 4 px transparent gutter,
- color and normal maps dilated into the gutter so linear filtering has no dark halo,
- normal maps masked with the color alpha and paired at identical framing.

`pixijs-light2d` expects normal maps with RGB encoded in tangent space (red = X, green = Y,
blue = Z). Both pairs come from the supplied reference art; re-export lossless versions if the
source normal maps are ever replaced.
