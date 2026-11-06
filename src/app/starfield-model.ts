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
  /** Normalized position in an endlessly repeating field (0–1). */
  x: number;
  y: number;
  /** Rendered glow radius in CSS pixels. */
  radius: number;
  alpha: number;
  tint: number;
  phase: number;
  twinkleSpeed: number;
  /** How much the star moves relative to the panning camera. */
  parallax: number;
  /** Downward drift in normalized screen heights per second. */
  drift: number;
}

interface StarLayer {
  count: number;
  parallax: number;
  drift: number;
  radius: readonly [number, number];
  alpha: readonly [number, number];
  twinkleSpeed: readonly [number, number];
}

export const STARFIELD_SEED = 0x5eed_5eed;

/** Three parallax layers: far, mid, near. Tuned for a calm starfield. */
export const STAR_LAYERS: readonly StarLayer[] = [
  {
    count: 160,
    parallax: 0.2,
    drift: 0.0015,
    radius: [0.5, 1.1],
    alpha: [0.25, 0.55],
    twinkleSpeed: [0.4, 1.4],
  },
  {
    count: 110,
    parallax: 0.5,
    drift: 0.0035,
    radius: [0.7, 1.6],
    alpha: [0.4, 0.8],
    twinkleSpeed: [0.6, 1.8],
  },
  {
    count: 55,
    parallax: 1,
    drift: 0.007,
    radius: [1.1, 2.4],
    alpha: [0.6, 0.95],
    twinkleSpeed: [0.8, 2.2],
  },
];

const STAR_TINTS: readonly number[] = [0xffffff, 0xffffff, 0xffffff, 0xdfefff, 0xc9e2ff, 0xfff1d6];

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
    x: rng(),
    y: rng(),
    radius: randomRange(rng, layer.radius[0], layer.radius[1]),
    alpha: randomRange(rng, layer.alpha[0], layer.alpha[1]),
    tint: pickOne(rng, STAR_TINTS),
    phase: rng() * Math.PI * 2,
    twinkleSpeed: randomRange(rng, layer.twinkleSpeed[0], layer.twinkleSpeed[1]),
    parallax: layer.parallax,
    drift: layer.drift,
  };
}

/** Normalizes any number into `[0, 1)`, including negative values. */
export function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

export function advanceStars(stars: Star[], deltaSeconds: number): void {
  for (const star of stars) {
    star.y = wrap01(star.y + star.drift * deltaSeconds);
  }
}

/**
 * Projects a star's repeating field position into screen space.
 *
 * The camera is unbounded, so panning can continue forever; stars wrap
 * seamlessly at the viewport edges.
 */
export function projectStar(star: Star, camera: Vec2, viewport: Size): Vec2 {
  return {
    x: wrap01(star.x - camera.x * star.parallax) * viewport.width,
    y: wrap01(star.y - camera.y * star.parallax) * viewport.height,
  };
}

/** Twinkling alpha as a deterministic function of elapsed time. */
export function starAlpha(star: Star, timeSeconds: number): number {
  const twinkle = 0.72 + 0.28 * Math.sin(timeSeconds * star.twinkleSpeed + star.phase);
  return Math.min(1, star.alpha * twinkle);
}
