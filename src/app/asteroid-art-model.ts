import { createRng } from '../utils/random';
import type { Vec2 } from './asteroid-collision';
import { fitClosedPolygon } from './polygon-fit';

export type AsteroidPalette = 'slate' | 'ice' | 'limestone';

export interface AsteroidArtPixels {
  /** Square texture size in pixels. */
  size: number;
  /** Straight-alpha RGBA colour pixels. */
  color: Uint8ClampedArray;
  /** Tangent-space normal map pixels (alpha 255 everywhere). */
  normal: Uint8ClampedArray;
  /** Visual silhouette polygon in pixels relative to the texture centre. */
  outline: Vec2[];
  /** Simplified collider silhouette in pixels relative to the texture centre. */
  silhouette: Vec2[];
}

export interface AsteroidArtOptions {
  size?: number;
  palette?: AsteroidPalette;
}

interface Palette {
  base: [number, number, number];
  dark: [number, number, number];
  light: [number, number, number];
}

const PALETTES: Record<AsteroidPalette, Palette> = {
  // Matches the greyer supplied rock.
  slate: { base: [114, 134, 152], dark: [58, 78, 96], light: [204, 208, 206] },
  // Matches the bluer supplied rock.
  ice: { base: [86, 128, 170], dark: [42, 84, 126], light: [172, 196, 210] },
  // Pale limestone with warm highlights, like the first supplied rock.
  limestone: { base: [136, 138, 126], dark: [74, 74, 64], light: [218, 212, 184] },
};

/** Visual outline samples: a smooth radial shape, never a spiky star. */
const OUTLINE_VERTICES = 26;
/** Collider budget for generated rocks: ~1.5% radius deviation, like supplied art. */
const COLLIDER_MAX_VERTICES = 18;
const MIN_FACETS = 10;
const MAX_FACETS = 16;
const MIN_CRATERS = 5;
const MAX_CRATERS = 9;
/** Small chips and cracks etched across the rock. */
const MIN_FISSURES = 3;
const MAX_FISSURES = 5;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColor(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function pointInPolygon(points: readonly Vec2[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? clamp01(((px - a.x) * dx + (py - a.y) * dy) / lengthSq) : 0;
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

function distanceToPolygon(points: readonly Vec2[], px: number, py: number): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    best = Math.min(best, distanceToSegment(px, py, a, b));
  }
  return best;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

interface Crater {
  x: number;
  y: number;
  rx: number;
  ry: number;
  depth: number;
  /**
   * Convex polygonal pit: `max((n·p)/offset)` is 1 on the rim, 0 at the centre,
   * so craters are faceted hex/octagon pits instead of round bowls.
   */
  planes: { nx: number; ny: number; offset: number }[];
}

/**
 * Visual silhouette: 16–24 vertices with notches, still star-shaped about the
 * centre so the fan decomposition stays valid. Stretched on one axis for
 * shape variety; the collider is a simplified fit of this outline.
 */
function makeOutline(rng: () => number, size: number): Vec2[] {
  const baseRadius = size * 0.46;
  const aspect = 0.9 + rng() * 0.2;
  const rotation = rng() * Math.PI * 2;
  // Smooth low-frequency radial shape: rounded boulder with a couple of broad
  // lobes, not a spiky star. Small notches only soften the silhouette.
  const phase2 = rng() * Math.PI * 2;
  const phase3 = rng() * Math.PI * 2;
  const phase5 = rng() * Math.PI * 2;
  const notchAngle = rng() * Math.PI * 2;
  const notchAngle2 = notchAngle + 2.2 + rng() * 1.2;
  const radiusAt = (angle: number): number => {
    let radius =
      1 +
      0.1 * Math.sin(angle * 2 + phase2) +
      0.06 * Math.sin(angle * 3 + phase3) +
      0.035 * Math.sin(angle * 5 + phase5);
    const notch = (delta: number): number => Math.exp(-(delta * delta) / 0.09);
    radius -= 0.12 * notch(Math.atan2(Math.sin(angle - notchAngle), Math.cos(angle - notchAngle)));
    radius -=
      0.07 * notch(Math.atan2(Math.sin(angle - notchAngle2), Math.cos(angle - notchAngle2)));
    return baseRadius * radius;
  };
  const points: Vec2[] = [];
  for (let index = 0; index < OUTLINE_VERTICES; index += 1) {
    const angle = rotation + (index / OUTLINE_VERTICES) * Math.PI * 2;
    const radius = radiusAt(angle);
    points.push({
      x: Math.cos(angle) * radius * aspect,
      y: Math.sin(angle) * radius * (2 - aspect),
    });
  }
  return points;
}

function makeCraters(rng: () => number, size: number, outline: Vec2[]): Crater[] {
  const craters: Crater[] = [];
  const target = MIN_CRATERS + Math.floor(rng() * (MAX_CRATERS - MIN_CRATERS + 1));
  const addCrater = (x: number, y: number, rx: number): void => {
    const sides = 6 + Math.floor(rng() * 5);
    const rotation = rng() * Math.PI * 2;
    const planes = Array.from({ length: sides }, (_, index) => {
      const angle = rotation + (index / sides) * Math.PI * 2;
      return {
        nx: Math.cos(angle),
        ny: Math.sin(angle),
        // Jitter the inradius per wall for irregular, hand-cut looking pits.
        offset: 1 + (rng() - 0.5) * 0.28,
      };
    });
    craters.push({
      x,
      y,
      rx,
      ry: rx * (0.78 + rng() * 0.44),
      depth: size * (0.025 + rng() * 0.055) * Math.min(1, rx / (size * 0.05) + 0.35),
      planes,
    });
  };

  const clearOfOtherCraters = (x: number, y: number, rx: number, spacing: number): boolean => {
    for (const other of craters) {
      const clearance = (rx + other.rx) * spacing;
      if (Math.hypot(x - other.x, y - other.y) < clearance) return false;
    }
    return true;
  };

  for (let attempt = 0; attempt < target * 14 && craters.length < target; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = size * 0.46 * (0.12 + rng() * 0.62);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    if (!pointInPolygon(outline, x, y)) continue;
    // Big, medium and small craters: a proper cratered surface, not one scale.
    const roll = rng();
    const rx =
      roll < 0.35
        ? size * (0.06 + rng() * 0.04)
        : roll < 0.75
          ? size * (0.03 + rng() * 0.025)
          : size * (0.015 + rng() * 0.015);
    // Craters must not intersect each other: keep clear rims.
    if (!clearOfOtherCraters(x, y, rx, 1.15)) continue;
    const edgeDistance = distanceToPolygon(outline, x, y);
    if (edgeDistance < rx * 1.15) continue;
    addCrater(x, y, rx);
    // Big impacts get a couple of satellite pits along their ejecta rim.
    if (roll < 0.12 && craters.length + 2 < target) {
      const satellites = 1 + Math.floor(rng() * 2);
      for (let index = 0; index < satellites; index += 1) {
        const satelliteAngle = angle + (rng() - 0.5) * 1.4;
        const satelliteDistance = distance + rx * (1.15 + rng() * 0.9);
        const sx = Math.cos(satelliteAngle) * satelliteDistance;
        const sy = Math.sin(satelliteAngle) * satelliteDistance;
        if (!pointInPolygon(outline, sx, sy)) continue;
        const satelliteRadius = rx * (0.18 + rng() * 0.22);
        if (!clearOfOtherCraters(sx, sy, satelliteRadius, 1.1)) continue;
        if (distanceToPolygon(outline, sx, sy) < satelliteRadius * 1.2) continue;
        addCrater(sx, sy, satelliteRadius);
      }
    }
  }
  return craters;
}

interface Facet {
  x: number;
  y: number;
  nx: number;
  ny: number;
  tint: number;
  /** Light baked into the albedo, like the hand-painted supplied rocks. */
  shade: number;
  /** Relative plate height; drives the drop-shadow / bevel bands between plates. */
  height: number;
  /** 0 = cool base rock, 1 = cream highlight plate. */
  tone: number;
}

/** 2D direction of the baked key light (matches the sprite shader). */
const KEY_2D: [number, number] = [-0.7, -0.7];

interface Pebble {
  x: number;
  y: number;
  radius: number;
  planes: { nx: number; ny: number; offset: number }[];
  tone: number;
}

/** Key light used to bake facet shading into the colour map. */
const BAKE_KEY: [number, number, number] = normalize3([-0.7, -0.7, 0.5]);
/** Cool bounce from the opposite side, baked subtly for a less flat look. */
const BAKE_FILL: [number, number, number] = normalize3([0.55, 0.45, 0.4]);

function normalize3(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function makePebbles(
  rng: () => number,
  size: number,
  outline: Vec2[],
  craters: Crater[],
): Pebble[] {
  const pebbles: Pebble[] = [];
  const target = 12 + Math.floor(rng() * 10);
  for (let attempt = 0; attempt < target * 40 && pebbles.length < target; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = size * 0.46 * Math.sqrt(rng()) * 0.82;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const radius = size * (0.012 + rng() * 0.024);
    if (!pointInPolygon(outline, x, y)) continue;
    if (distanceToPolygon(outline, x, y) < radius * 1.5) continue;
    if (craters.some((crater) => Math.hypot(x - crater.x, y - crater.y) < crater.rx + radius))
      continue;
    if (
      pebbles.some(
        (pebble) => Math.hypot(x - pebble.x, y - pebble.y) < (radius + pebble.radius) * 1.2,
      )
    ) {
      continue;
    }
    const sides = 4 + Math.floor(rng() * 3);
    const rotation = rng() * Math.PI * 2;
    const planes = Array.from({ length: sides }, (_, index) => {
      const planeAngle = rotation + (index / sides) * Math.PI * 2;
      return {
        nx: Math.cos(planeAngle),
        ny: Math.sin(planeAngle),
        offset: 0.9 + rng() * 0.2,
      };
    });
    pebbles.push({ x, y, radius, planes, tone: rng() });
  }
  return pebbles;
}

function makeFacets(rng: () => number, size: number, outline: Vec2[]): Facet[] {
  const target = MIN_FACETS + Math.floor(rng() * (MAX_FACETS - MIN_FACETS + 1));
  const facets: Facet[] = [];
  for (let attempt = 0; attempt < target * 24 && facets.length < target; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = size * 0.46 * Math.sqrt(rng()) * 0.9;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    if (!pointInPolygon(outline, x, y)) continue;
    const nx = (x / (size * 0.46)) * 0.55 + (rng() - 0.5) * 0.55;
    const ny = (y / (size * 0.46)) * 0.55 + (rng() - 0.5) * 0.55;
    const normal = normalize3([nx * 0.6, ny * 0.6, 1]);
    const key = Math.max(
      normal[0] * BAKE_KEY[0] + normal[1] * BAKE_KEY[1] + normal[2] * BAKE_KEY[2],
      0,
    );
    const fill = Math.max(
      normal[0] * BAKE_FILL[0] + normal[1] * BAKE_FILL[1] + normal[2] * BAKE_FILL[2],
      0,
    );
    facets.push({
      x,
      y,
      nx,
      ny,
      tint: rng(),
      shade: 0.5 + 1.1 * key + 0.2 * fill,
      height: rng() * 2 - 1,
      tone: rng(),
    });
  }
  while (facets.length < 3) {
    facets.push({ x: 0, y: 0, nx: 0, ny: 0, tint: rng(), shade: 1, height: 0, tone: 0.5 });
  }
  return facets;
}

/**
 * Generate one asteroid's colour, normal and silhouette from a seed.
 *
 * The silhouette is a low-vertex star-shaped polygon, so the collider is cheap
 * and the fan decomposition is valid by construction. The interior uses flat
 * Voronoi facets (the lighting shader does the shading), bowl craters with
 * raised rims, fine grain and edge ambient occlusion.
 */
export function generateAsteroidArt(
  seed: number,
  options: AsteroidArtOptions = {},
): AsteroidArtPixels {
  const size = Math.max(64, Math.round(options.size ?? 512));
  const palette = PALETTES[options.palette ?? (seed % 2 === 0 ? 'slate' : 'ice')];
  const rng = createRng(seed);
  const centre = size / 2;
  const denseOutline = makeOutline(rng, size);
  const denseRadius = denseOutline.reduce(
    (best, point) => Math.max(best, Math.hypot(point.x, point.y)),
    0,
  );
  const outline = fitClosedPolygon(denseOutline, {
    maxVertices: 20,
    tolerance: denseRadius * 0.012,
  }).points;
  const craters = makeCraters(rng, size, outline);
  const facets = makeFacets(rng, size, outline);
  const pebbles = makePebbles(rng, size, outline, craters);

  const fissures = Array.from(
    { length: MIN_FISSURES + Math.floor(rng() * (MAX_FISSURES - MIN_FISSURES + 1)) },
    () => {
      const angle = rng() * Math.PI * 2;
      const distance = size * 0.46 * Math.sqrt(rng()) * 0.65;
      const ax = Math.cos(angle) * distance;
      const ay = Math.sin(angle) * distance;
      const direction = rng() * Math.PI * 2;
      const length = size * (0.18 + rng() * 0.3);
      return {
        ax,
        ay,
        bx: ax + Math.cos(direction) * length,
        by: ay + Math.sin(direction) * length,
        width: size * (0.002 + rng() * 0.004),
      };
    },
  );

  const height = new Float32Array(size * size);
  const bowlMask = new Float32Array(size * size);
  const wallShadowMask = new Float32Array(size * size);
  const rimLitMask = new Float32Array(size * size);
  const edgeMask = new Float32Array(size * size);
  const alpha = new Uint8Array(size * size);
  const noiseSeed = seed ^ 0x2545f491;

  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5 - centre;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - centre;
      const index = y * size + x;

      const isInside = pointInPolygon(outline, px, py);
      const edge = distanceToPolygon(outline, px, py);
      edgeMask[index] = edge;
      alpha[index] = Math.round(clamp01((isInside ? edge : -edge) + 0.5) * 255);

      let h = 0;
      let bowl = 0;
      let wallShadow = 0;
      let rimLit = 0;
      for (const crater of craters) {
        const dx = (px - crater.x) / crater.rx;
        const dy = (py - crater.y) / crater.ry;
        // Polygonal distance: 1 on the rim, 0 at the centre.
        let d = -Infinity;
        for (const plane of crater.planes) {
          d = Math.max(d, (plane.nx * dx + plane.ny * dy) / plane.offset);
        }
        if (d > 1.4) continue;
        const facing =
          Math.hypot(dx, dy) > 0 ? (dx * KEY_2D[0] + dy * KEY_2D[1]) / Math.hypot(dx, dy) : 0;
        if (d < 1) {
          // Flat floor, a terrace step, then straight walls: a faceted pit.
          const wall =
            d < 0.3
              ? 1
              : d < 0.5
                ? lerp(1, 0.7, (d - 0.3) / 0.2)
                : d < 0.78
                  ? lerp(0.7, 0.32, (d - 0.5) / 0.28)
                  : lerp(0.32, 0, (d - 0.78) / 0.22);
          h -= crater.depth * wall;
          bowl = Math.max(bowl, wall);
          wallShadow = Math.max(wallShadow, wall * clamp01(-facing));
        }
        const rimDistance = Math.abs(d - 1.03) / 0.17;
        if (rimDistance < 1) {
          const bump = (1 - rimDistance) ** 2;
          h += crater.depth * 0.46 * bump;
          rimLit = Math.max(rimLit, bump * clamp01(facing));
        }
      }
      for (const fissure of fissures) {
        const distance = distanceToSegment(
          px,
          py,
          { x: fissure.ax, y: fissure.ay },
          { x: fissure.bx, y: fissure.by },
        );
        if (distance > fissure.width * 4) continue;
        const groove = 1 - clamp01(distance / (fissure.width * 4));
        h -= size * 0.003 * groove;
        bowl = Math.max(bowl, groove * 0.3);
        wallShadow = Math.max(wallShadow, groove * 0.25);
      }
      // Multi-scale grain: broad strata, medium mottling, fine speckle.
      const broad = valueNoise(px / 90, py / 55, noiseSeed ^ 0x1234567) - 0.5;
      h += broad * size * 0.012;
      h += (valueNoise(px / 22, py / 22, noiseSeed) - 0.5) * size * 0.006;
      h += (valueNoise(px / 7, py / 7, noiseSeed ^ 0x9e3779b9) - 0.5) * size * 0.0022;
      height[index] = h;
      bowlMask[index] = bowl;
      wallShadowMask[index] = wallShadow;
      rimLitMask[index] = rimLit;
    }
  }

  const color = new Uint8ClampedArray(size * size * 4);
  const normal = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5 - centre;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - centre;
      const index = y * size + x;
      const alphaByte = alpha[index]!;

      if (alphaByte === 0) {
        normal[index * 4] = 128;
        normal[index * 4 + 1] = 128;
        normal[index * 4 + 2] = 255;
        normal[index * 4 + 3] = 255;
        continue;
      }

      // Nearest facet gives the flat shading normal; the runner-up gives seams.
      let facet = facets[0]!;
      let secondFacet = facets[0]!;
      let nearestDistance = Infinity;
      let secondDistance = Infinity;
      for (const candidate of facets) {
        const dd = (px - candidate.x) ** 2 + (py - candidate.y) ** 2;
        if (dd < nearestDistance) {
          secondDistance = nearestDistance;
          secondFacet = facet;
          nearestDistance = dd;
          facet = candidate;
        } else if (dd < secondDistance) {
          secondDistance = dd;
          secondFacet = candidate;
        }
      }
      const boundaryDistance = 0.5 * (Math.sqrt(secondDistance) - Math.sqrt(nearestDistance));

      // Height gradient from craters/grain tilts the facet normal.
      const left = height[y * size + Math.max(0, x - 1)]!;
      const right = height[y * size + Math.min(size - 1, x + 1)]!;
      const up = height[Math.max(0, y - 1) * size + x]!;
      const down = height[Math.min(size - 1, y + 1) * size + x]!;
      const gradientX = (right - left) * 0.5;
      const gradientY = (down - up) * 0.5;
      let nx = facet.nx * 0.55 - gradientX * 0.7;
      let ny = facet.ny * 0.55 - gradientY * 0.7;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;

      normal[index * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[index * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[index * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[index * 4 + 3] = 255;

      // Albedo: layered plates (light baked in), plate drop shadows/bevels,
      // crater shadow/rim light, pebbles, silhouette bevel and grain.
      const facetTint = 0.9 + facet.tint * 0.18;
      const plateTone = mixColor(palette.base, palette.light, 0.12 + facet.tone * 0.72);
      let rgb: [number, number, number] = [
        plateTone[0] * facetTint,
        plateTone[1] * facetTint,
        plateTone[2] * facetTint,
      ];
      rgb = [rgb[0] * facet.shade, rgb[1] * facet.shade, rgb[2] * facet.shade];

      // Raised plates drop a shadow onto lower neighbours; lower plates catch a
      // bright bevel under the raised edge.
      const bandWidth = size * 0.009;
      if (boundaryDistance < bandWidth) {
        const band = 1 - boundaryDistance / bandWidth;
        const heightDelta = secondFacet.height - facet.height;
        if (heightDelta > 0.12) {
          const shadow = 0.55 * band * clamp01(heightDelta);
          rgb = [rgb[0] * (1 - shadow), rgb[1] * (1 - shadow), rgb[2] * (1 - shadow)];
        } else if (heightDelta < -0.12) {
          const bevel = 0.45 * band * clamp01(-heightDelta);
          rgb = mixColor(rgb, palette.light, bevel);
        } else {
          const seam = 0.18 * band;
          rgb = [rgb[0] * (1 - seam), rgb[1] * (1 - seam), rgb[2] * (1 - seam)];
        }
      }

      // Broad strata bands plus medium mottling vary the albedo across facets.
      const broad = valueNoise(px / 90, py / 55, noiseSeed ^ 0x1234567) - 0.5;
      rgb = mixColor(rgb, broad > 0 ? palette.light : palette.dark, Math.abs(broad) * 0.18);
      const mottle = valueNoise(px / 26, py / 19, noiseSeed ^ 0x51ed270b) - 0.5;
      rgb = [rgb[0] + mottle * 12, rgb[1] + mottle * 12, rgb[2] + mottle * 11];

      // Craters: dark shadowed inner walls on the away side, lit rims toward the
      // key light, dark floor and a rim bevel.
      const bowl = bowlMask[index]!;
      const floorShadow = 0.34 + 0.4 * wallShadowMask[index]!;
      const rimLight = 0.3 + 0.7 * rimLitMask[index]!;
      rgb = mixColor(rgb, palette.dark, clamp01(bowl * floorShadow));
      rgb = mixColor(rgb, palette.light, clamp01(rimLitMask[index]! * rimLight));

      // Small beveled rock nubs sitting on the surface, with contact shadows.
      for (const pebble of pebbles) {
        const dx = (px - pebble.x) / pebble.radius;
        const dy = (py - pebble.y) / pebble.radius;
        if (dx * dx + dy * dy > 2.4) continue;
        let d = -Infinity;
        for (const plane of pebble.planes) {
          d = Math.max(d, (plane.nx * dx + plane.ny * dy) / plane.offset);
        }
        if (d < 1) {
          const vlen = Math.hypot(dx, dy, 1.15) || 1;
          const facing = (dx * KEY_2D[0] + dy * KEY_2D[1]) / vlen;
          const nubTone = mixColor(palette.light, palette.base, 0.35 - pebble.tone * 0.25);
          const shade = 0.6 + 0.6 * Math.max(facing, 0) + 0.12 * Math.max(-facing, 0);
          const nub: [number, number, number] = [
            nubTone[0] * shade,
            nubTone[1] * shade,
            nubTone[2] * shade,
          ];
          rgb = mixColor(rgb, nub, 0.88);
          if (d > 0.72) {
            const edge = (d - 0.72) / 0.28;
            const lit = Math.max(facing, 0);
            rgb = mixColor(rgb, lit > 0 ? palette.light : palette.dark, edge * (0.25 + 0.35 * lit));
          }
        } else {
          // Contact shadow cast down-right, opposite the top-left key light.
          const sx = (px - pebble.x - pebble.radius * 0.3) / pebble.radius;
          const sy = (py - pebble.y - pebble.radius * 0.3) / pebble.radius;
          let shadowD = -Infinity;
          for (const plane of pebble.planes) {
            shadowD = Math.max(shadowD, (plane.nx * sx + plane.ny * sy) / plane.offset);
          }
          if (shadowD < 1.05) {
            const contact = 1 - clamp01((shadowD - 0.2) / 0.85);
            rgb = [
              rgb[0] * (1 - 0.4 * contact),
              rgb[1] * (1 - 0.4 * contact),
              rgb[2] * (1 - 0.4 * contact),
            ];
          }
        }
      }

      // Silhouette: crisp dark outline plus a bevel lit from the top-left.
      const edge = edgeMask[index]!;
      if (edge < 8) {
        const leftEdge = edgeMask[y * size + Math.max(0, x - 1)]!;
        const rightEdge = edgeMask[y * size + Math.min(size - 1, x + 1)]!;
        const upEdge = edgeMask[Math.max(0, y - 1) * size + x]!;
        const downEdge = edgeMask[Math.min(size - 1, y + 1) * size + x]!;
        const gradientEdgeX = (rightEdge - leftEdge) * 0.5;
        const gradientEdgeY = (downEdge - upEdge) * 0.5;
        const gradientLength = Math.hypot(gradientEdgeX, gradientEdgeY) || 1;
        const outwardX = -gradientEdgeX / gradientLength;
        const outwardY = -gradientEdgeY / gradientLength;
        const facing = outwardX * KEY_2D[0] + outwardY * KEY_2D[1];
        if (edge < 1.8) {
          rgb = mixColor(rgb, palette.dark, (1 - edge / 1.8) * 0.62);
        } else {
          const band = 1 - (edge - 1.8) / 6.2;
          if (facing > 0) rgb = mixColor(rgb, palette.light, band * facing * 0.45);
          else rgb = mixColor(rgb, palette.dark, band * -facing * 0.2);
        }
      }

      const ao = clamp01(edgeMask[index]! / 16);
      const aoFactor = 0.86 + 0.14 * ao;
      const grain =
        (valueNoise(px / 5, py / 5, noiseSeed ^ 0x2545f491) - 0.5) * 5 +
        (valueNoise(px / 2.2, py / 2.2, noiseSeed ^ 0x7f4a7c15) - 0.5) * 2.5;
      const out = index * 4;
      color[out] = clamp01((rgb[0] * aoFactor + grain) / 255) * 255;
      color[out + 1] = clamp01((rgb[1] * aoFactor + grain) / 255) * 255;
      color[out + 2] = clamp01((rgb[2] * aoFactor + grain) / 255) * 255;
      color[out + 3] = alphaByte;
    }
  }

  // Simplify the visual outline into a cheap collider (validated star-shaped
  // kernel is guaranteed by the outline; the fit stays within 1.5% of radius).
  const maxRadius = outline.reduce(
    (best, point) => Math.max(best, Math.hypot(point.x, point.y)),
    0,
  );
  const silhouette = fitClosedPolygon(outline, {
    maxVertices: COLLIDER_MAX_VERTICES,
    tolerance: maxRadius * 0.012,
  }).points;

  return { size, color, normal, outline, silhouette };
}
