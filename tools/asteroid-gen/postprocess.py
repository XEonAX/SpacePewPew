"""Finish the stylized asteroid sprite: ink outline + shader-friendly normal map.

The Blender pass already paints the fake lighting, so the post pass only adds the
cut-out ink edge, a subtle warm rim on the lit silhouette and attenuates the
normal map for the game's 2D lighting.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

directory = Path(sys.argv[1])
color = np.array(Image.open(directory / "color.png").convert("RGBA"), dtype=np.float32) / 255.0
normal = np.array(Image.open(directory / "normal.png").convert("RGBA"), dtype=np.float32) / 255.0

rgb = color[..., :3]
alpha = color[..., 3]
size = rgb.shape[0]

ambient_path = directory / "ambient.png"
if ambient_path.exists():
    ambient = np.array(Image.open(ambient_path).convert("RGBA"), dtype=np.float32) / 255.0
    occlusion = ambient[..., 0]
    occlusion = np.array(
        Image.fromarray((occlusion * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)),
        dtype=np.float32,
    ) / 255.0
    rgb = rgb * (0.35 + 0.65 * np.power(occlusion, 1.5)[..., None])
    rgb = rgb + 0.05 * np.clip(occlusion - 0.55, 0.0, 1.0)[..., None] * np.array([1.0, 0.95, 0.84], dtype=np.float32)

# Ink outline: darken the outermost couple of pixels of the silhouette.
alpha_image = Image.fromarray((alpha * 255).astype(np.uint8))
eroded = np.array(alpha_image.filter(ImageFilter.MinFilter(3)), dtype=np.float32) / 255.0
outline = np.clip(alpha - eroded, 0.0, 1.0)
ink = np.array([0.11, 0.14, 0.2], dtype=np.float32)
rgb = rgb * (1.0 - 0.6 * outline[..., None]) + ink * (0.6 * outline[..., None])

# A warm rim on the lit (top-left) silhouette.
blurred = np.array(alpha_image.filter(ImageFilter.GaussianBlur(1.1)), dtype=np.float32) / 255.0
grad_x, grad_y = np.gradient(blurred)
length = np.hypot(grad_x, grad_y) + 1e-5
outward_x = -grad_x / length
outward_y = -grad_y / length
facing = np.clip(outward_x * -0.62 + outward_y * -0.78, 0.0, 1.0)
rim_band = np.clip(1.0 - np.abs(np.hypot(grad_x, grad_y)) * 26.0, 0.0, 1.0) * (alpha > 0.1)
rgb = rgb + 0.10 * (facing * rim_band)[..., None] * np.array([1.0, 0.94, 0.80], dtype=np.float32)

# Match the supplied reference art's tonal band without flattening hue: remap
# luminance into the reference's p3..p97 range and scale RGB by the same ratio
# so chroma survives (a per-channel affine lift washed the rocks out to grey).
rgb = np.clip(rgb, 0.0, 1.0)
opaque = alpha > 0.5
# Base colour stays as rendered (albedo); the shader supplies lighting.
rgb = np.clip(rgb, 0.0, 1.0)

# Crisp facet seams from the raw normal map: give plate boundaries a thin dark
# albedo line. Use the unflattened normals so the edges stay sharp.
raw = normal[..., :3] * 2.0 - 1.0
raw /= np.maximum(np.linalg.norm(raw, axis=2, keepdims=True), 1e-4)
gx = np.gradient(raw[..., 0], axis=1) + np.gradient(raw[..., 1], axis=1) + np.gradient(raw[..., 2], axis=1)
gy = np.gradient(raw[..., 0], axis=0) + np.gradient(raw[..., 1], axis=0) + np.gradient(raw[..., 2], axis=0)
facet_edge = np.clip(np.hypot(gx, gy) * 2.2, 0.0, 1.0) * (alpha > 0.5)
rgb = rgb * (1.0 - 0.18 * facet_edge[..., None])
rgb = np.clip(rgb, 0.0, 1.0)

out_color = np.concatenate([np.clip(rgb, 0.0, 1.0), alpha[..., None]], axis=2)
Image.fromarray((out_color * 255).clip(0, 255).astype(np.uint8), "RGBA").save(directory / "color-final.png")

# Attenuate the normal map for the 2D shader. The supplied reference maps were
# blended toward a flat (0, 0, 1) normal *before* renormalising; scaling X/Y and
# keeping Z leaves side facets steep, which reads as harsh in-game lighting and
# gives the map strong, "weird" colours. Blend toward flat instead.
nx = normal[..., 0] * 2.0 - 1.0
ny = normal[..., 1] * 2.0 - 1.0
nz = normal[..., 2] * 2.0 - 1.0
blend = 0.3
mild = np.stack([nx * blend, ny * blend, nz * blend + (1.0 - blend)], axis=2)
mild /= np.maximum(np.linalg.norm(mild, axis=2, keepdims=True), 1e-4)
normal_out = np.concatenate([mild * 0.5 + 0.5, np.ones_like(nx[..., None])], axis=2)
Image.fromarray((normal_out * 255).clip(0, 255).astype(np.uint8), "RGBA").save(
    directory / "normal-final.png"
)
print(f"wrote {directory / 'color-final.png'} and {directory / 'normal-final.png'}")
