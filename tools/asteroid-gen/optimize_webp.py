#!/usr/bin/env python3
"""Convert rendered PNGs to the WebP files committed under public/assets.

GitHub Pages ships these files on first load, so the runtime copies are encoded
as WebP: quality 92 for camera-space normal maps (low-frequency, shading must
stay clean) and 88 for painted colour maps with alpha.

Usage:
    python3 tools/asteroid-gen/optimize_webp.py SRC_DIR DEST_DIR

The relative path is preserved and the extension becomes .webp. Existing WebP
files are overwritten.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def quality_for(path: Path) -> int:
    return 92 if "normal" in path.stem else 88


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    source = Path(argv[1])
    destination = Path(argv[2])
    if not source.is_dir():
        print(f"source directory not found: {source}")
        return 1

    pngs = sorted(source.rglob("*.png"))
    if not pngs:
        print(f"no PNGs under {source}")
        return 1

    for png in pngs:
        relative = png.relative_to(source).with_suffix(".webp")
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(png) as image:
            image.convert("RGBA").save(output, "WEBP", quality=quality_for(png), method=6)
        print(f"{png} -> {output} ({output.stat().st_size // 1024} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
