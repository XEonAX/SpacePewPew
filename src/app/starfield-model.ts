import { createRng, pickOne, randomRange } from '../utils/random';
import type { Rng } from '../utils/random';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Star {
  /** Position in the repeating field, centered on the origin: `[-1, 1)`. */
  x: number;
  y: number;
  /** Rendered glow radius in CSS pixels at zoom 1. */
  radius: number;
  alpha: number;
  tint: number;
  phase: number;
  twinkleSpeed: number;
  /** How much the star moves relative to the panning camera. */
  parallax: number;
  /** How much of the camera zoom the layer responds to (0 = fixed sky). */
  zoomResponse: number;
  /** Downward drift in normalized screen heights per second. */
  drift: number;
}

export interface DustMote {
  /** Position in the same repeating field as the stars. */
  x: number;
  y: number;
  radius: number;
  alpha: number;
  tint: number;
  phase: number;
  twinkleSpeed: number;
  drift: number;
}

interface StarLayer {
  count: number;
  parallax: number;
  zoomResponse: number;
  drift: number;
  radius: readonly [number, number];
  alpha: readonly [number, number];
  twinkleSpeed: readonly [number, number];
}

export const STARFIELD_SEED = 0x5eed_5eed;

/** The field spans 2×2 world units so the mid layers stay covered while zoomed out. */
const FIELD_HALF = 1;

/**
 * Three parallax layers: far, mid, near.
 *
 * The far layer does not zoom at all (it reads as the fixed sky), the mid and
 * near layers respond a little, and the near dust layer (rendered separately)
 * takes the full zoom + pan.
 */
export const STAR_LAYERS: readonly StarLayer[] = [
  {
    count: 640,
    parallax: 0.2,
    zoomResponse: 0,
    drift: 0.0015,
    radius: [0.5, 1.1],
    alpha: [0.25, 0.55],
    twinkleSpeed: [0.4, 1.4],
  },
  {
    count: 440,
    parallax: 0.5,
    zoomResponse: 0.25,
    drift: 0.0035,
    radius: [0.7, 1.6],
    alpha: [0.4, 0.8],
    twinkleSpeed: [0.6, 1.8],
  },
  {
    count: 220,
    parallax: 1,
    zoomResponse: 0.5,
    drift: 0.007,
    radius: [1.1, 2.4],
    alpha: [0.6, 0.95],
    twinkleSpeed: [0.8, 2.2],
  },
];

const STAR_TINTS: readonly number[] = [0xffffff, 0xffffff, 0xffffff, 0xdfefff, 0xc9e2ff, 0xfff1d6];

const DUST_TINTS: readonly number[] = [0xcfe3ff, 0xaec8ff, 0xffffff, 0xffe7c9];

export function generateStars(seed: number = STARFIELD_SEED): Star[] {
  const rng = createRng(seed);
  const stars: Star[] = [];

  for (const layer of STAR_LAYERS) {
    for (let index = 0; index < layer.count; index += 1) {
      stars.push(createStar(rng, layer));
    }
  }

  return stars;
}

function createStar(rng: Rng, layer: StarLayer): Star {
  return {
    x: rng() * 2 - 1,
    y: rng() * 2 - 1,
    radius: randomRange(rng, layer.radius[0], layer.radius[1]),
    alpha: randomRange(rng, layer.alpha[0], layer.alpha[1]),
    tint: pickOne(rng, STAR_TINTS),
    phase: rng() * Math.PI * 2,
    twinkleSpeed: randomRange(rng, layer.twinkleSpeed[0], layer.twinkleSpeed[1]),
    parallax: layer.parallax,
    zoomResponse: layer.zoomResponse,
    drift: layer.drift,
  };
}

/** Near-field dust motes: full parallax and full zoom response. */
export function generateDust(seed: number = STARFIELD_SEED ^ 0x51ed270b): DustMote[] {
  const rng = createRng(seed);
  const motes: DustMote[] = [];

  for (let index = 0; index < 220; index += 1) {
    motes.push({
      x: rng() * 2 - 1,
      y: rng() * 2 - 1,
      radius: randomRange(rng, 0.7, 3),
      alpha: randomRange(rng, 0.1, 0.35),
      tint: pickOne(rng, DUST_TINTS),
      phase: rng() * Math.PI * 2,
      twinkleSpeed: randomRange(rng, 0.3, 1.1),
      drift: randomRange(rng, 0.001, 0.004),
    });
  }

  return motes;
}

/** Normalizes a value into the centered field range `[-1, 1)`. */
export function wrapField(value: number): number {
  const span = FIELD_HALF * 2;
  return ((((value + FIELD_HALF) % span) + span) % span) - FIELD_HALF;
}

/** Effective scale of a layer for a given camera zoom. */
export function layerZoom(zoomResponse: number, zoom: number): number {
  return 1 + (zoom - 1) * zoomResponse;
}

export function advanceStars(stars: Star[], deltaSeconds: number): void {
  for (const star of stars) {
    star.y = wrapField(star.y + star.drift * deltaSeconds);
  }
}

export function advanceDust(motes: DustMote[], deltaSeconds: number): void {
  for (const mote of motes) {
    mote.y = wrapField(mote.y + mote.drift * deltaSeconds);
  }
}

/**
 * Projects a point in the repeating field into screen space.
 *
 * The field is centered on the origin, so `(0, 0)` maps to the viewport center.
 * `zoom` scales around that center, weighted by the layer's `zoomResponse`.
 * The camera is unbounded, so panning can continue forever.
 */
export function projectPoint(
  point: Vec2,
  camera: Vec2,
  viewport: Size,
  zoom: number,
  parallax: number,
  zoomResponse: number,
): Vec2 {
  const scale = layerZoom(zoomResponse, zoom);
  const x = wrapField(point.x - camera.x * parallax);
  const y = wrapField(point.y - camera.y * parallax);

  return {
    x: x * viewport.width * scale + viewport.width / 2,
    y: y * viewport.height * scale + viewport.height / 2,
  };
}

export function projectStar(star: Star, camera: Vec2, viewport: Size, zoom = 1): Vec2 {
  return projectPoint(star, camera, viewport, zoom, star.parallax, star.zoomResponse);
}

/** Twinkling alpha as a deterministic function of elapsed time. */
export function starAlpha(star: Star, timeSeconds: number): number {
  const twinkle = 0.72 + 0.28 * Math.sin(timeSeconds * star.twinkleSpeed + star.phase);
  return Math.min(1, star.alpha * twinkle);
}

export function dustAlpha(mote: DustMote, timeSeconds: number): number {
  const twinkle = 0.78 + 0.22 * Math.sin(timeSeconds * mote.twinkleSpeed + mote.phase);
  return Math.min(1, mote.alpha * twinkle);
}
