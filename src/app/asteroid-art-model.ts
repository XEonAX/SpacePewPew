import { createRng } from '../utils/random';
import type { Vec2 } from './asteroid-collision';
import { fitClosedPolygon } from './polygon-fit';

export type AsteroidPalette = 'slate' | 'ice';

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
  slate: { base: [112, 130, 143], dark: [58, 74, 88], light: [182, 188, 190] },
  // Matches the bluer supplied rock.
  ice: { base: [78, 120, 160], dark: [40, 76, 116], light: [150, 178, 196] },
};

const OUTLINE_MIN_VERTICES = 16;
const OUTLINE_MAX_VERTICES = 24;
/** Collider budget for generated rocks: ~1.5% radius deviation, like supplied art. */
const COLLIDER_MAX_VERTICES = 16;
const MIN_FACETS = 9;
const MAX_FACETS = 13;
const MIN_CRATERS = 9;
const MAX_CRATERS = 16;

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
  const count =
    OUTLINE_MIN_VERTICES + Math.floor(rng() * (OUTLINE_MAX_VERTICES - OUTLINE_MIN_VERTICES + 1));
  const step = (Math.PI * 2) / count;
  const aspect = 0.82 + rng() * 0.36;
  const points: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index * step + (rng() - 0.5) * step * 0.55;
    let radius = baseRadius * (0.78 + rng() * 0.22);
    if (rng() < 0.22) radius *= 0.88; // notch, still star-shaped
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
  for (let attempt = 0; attempt < target * 8 && craters.length < target; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = size * 0.46 * (0.12 + rng() * 0.62);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    if (!pointInPolygon(outline, x, y)) continue;
    const rx = size * (0.03 + rng() * 0.075);
    const sides = 6 + Math.floor(rng() * 4);
    const rotation = rng() * Math.PI * 2;
    const planes = Array.from({ length: sides }, (_, index) => {
      const angle = rotation + (index / sides) * Math.PI * 2;
      return {
        nx: Math.cos(angle),
        ny: Math.sin(angle),
        // Jitter the inradius per wall for irregular, hand-cut looking pits.
        offset: 1 + (rng() - 0.5) * 0.22,
      };
    });
    craters.push({
      x,
      y,
      rx,
      ry: rx * (0.78 + rng() * 0.44),
      depth: size * (0.025 + rng() * 0.05),
      planes,
    });
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
}

/** Key light used to bake facet shading into the colour map. */
const BAKE_LIGHT: [number, number, number] = normalize3([0.7, -0.7, 0.45]);

function normalize3(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
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
    const lambert = Math.max(
      normal[0] * BAKE_LIGHT[0] + normal[1] * BAKE_LIGHT[1] + normal[2] * BAKE_LIGHT[2],
      0,
    );
    facets.push({ x, y, nx, ny, tint: rng(), shade: 0.62 + 0.75 * lambert });
  }
  while (facets.length < 3) {
    facets.push({ x: 0, y: 0, nx: 0, ny: 0, tint: rng(), shade: 1 });
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
  const outline = makeOutline(rng, size);
  const craters = makeCraters(rng, size, outline);
  const facets = makeFacets(rng, size, outline);

  const height = new Float32Array(size * size);
  const bowlMask = new Float32Array(size * size);
  const rimMask = new Float32Array(size * size);
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
      let rim = 0;
      for (const crater of craters) {
        const dx = (px - crater.x) / crater.rx;
        const dy = (py - crater.y) / crater.ry;
        // Polygonal distance: 1 on the rim, 0 at the centre.
        let d = -Infinity;
        for (const plane of crater.planes) {
          d = Math.max(d, (plane.nx * dx + plane.ny * dy) / plane.offset);
        }
        if (d > 1.35) continue;
        if (d < 1) {
          // Flat floor then straight walls: a faceted pit, not a spherical bowl.
          const wall = d < 0.45 ? 1 : 1 - (d - 0.45) / 0.55;
          h -= crater.depth * wall;
          bowl = Math.max(bowl, wall);
        }
        const rimDistance = Math.abs(d - 1.03) / 0.09;
        if (rimDistance < 1) {
          const bump = (1 - rimDistance) ** 2;
          h += crater.depth * 0.32 * bump;
          rim = Math.max(rim, bump);
        }
      }
      h += (valueNoise(px / 22, py / 22, noiseSeed) - 0.5) * size * 0.006;
      h += (valueNoise(px / 7, py / 7, noiseSeed ^ 0x9e3779b9) - 0.5) * size * 0.0018;
      height[index] = h;
      bowlMask[index] = bowl;
      rimMask[index] = rim;
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
      let nearestDistance = Infinity;
      let secondDistance = Infinity;
      for (const candidate of facets) {
        const dd = (px - candidate.x) ** 2 + (py - candidate.y) ** 2;
        if (dd < nearestDistance) {
          secondDistance = nearestDistance;
          nearestDistance = dd;
          facet = candidate;
        } else if (dd < secondDistance) {
          secondDistance = dd;
        }
      }
      const seam =
        1 - clamp01(Math.sqrt(secondDistance) - Math.sqrt(nearestDistance)) / (size * 0.02);

      // Height gradient from craters/grain tilts the facet normal.
      const left = height[y * size + Math.max(0, x - 1)]!;
      const right = height[y * size + Math.min(size - 1, x + 1)]!;
      const up = height[Math.max(0, y - 1) * size + x]!;
      const down = height[Math.min(size - 1, y + 1) * size + x]!;
      const gradientX = (right - left) * 0.5;
      const gradientY = (down - up) * 0.5;
      let nx = facet.nx * 0.4 - gradientX * 0.7;
      let ny = facet.ny * 0.4 - gradientY * 0.7;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;

      normal[index * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[index * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[index * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[index * 4 + 3] = 255;

      // Albedo: baked facet light (the supplied rocks paint their shading too),
      // crater darkening, rim light, facet seams, edge AO and grain.
      const facetTint = 0.92 + facet.tint * 0.16;
      const tinted = mixColor(palette.base, palette.light, facet.tint * 0.14);
      const highlight = clamp01((facet.shade - 1.15) * 1.6);
      let rgb = mixColor(
        [tinted[0] * facetTint, tinted[1] * facetTint, tinted[2] * facetTint],
        palette.light,
        highlight * 0.55,
      );
      rgb = [rgb[0] * facet.shade, rgb[1] * facet.shade, rgb[2] * facet.shade];
      const bowl = 0.62 * bowlMask[index]!;
      const rim = 0.45 * rimMask[index]!;
      const seamDark = 0.16 * seam;
      const ao = clamp01(edgeMask[index]! / 10);
      const aoFactor = 0.8 + 0.2 * ao;
      const grain = (hash2(x, y, noiseSeed) - 0.5) * 10;
      const red = lerp(lerp(rgb[0], palette.dark[0], bowl), palette.light[0], rim);
      const green = lerp(lerp(rgb[1], palette.dark[1], bowl), palette.light[1], rim);
      const blue = lerp(lerp(rgb[2], palette.dark[2], bowl), palette.light[2], rim);
      const out = index * 4;
      color[out] = clamp01((red * (1 - seamDark) * aoFactor + grain) / 255) * 255;
      color[out + 1] = clamp01((green * (1 - seamDark) * aoFactor + grain) / 255) * 255;
      color[out + 2] = clamp01((blue * (1 - seamDark) * aoFactor + grain) / 255) * 255;
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
    tolerance: maxRadius * 0.015,
  }).points;

  return { size, color, normal, outline, silhouette };
}
