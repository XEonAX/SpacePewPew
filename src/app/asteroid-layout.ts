import { createRng, randomRange } from '../utils/random';

export interface AsteroidPlacement {
  /** World centre in metres. */
  x: number;
  y: number;
  /** Art width in metres. */
  diameter: number;
  /** Art variant index. */
  variant: number;
}

export interface AsteroidLayoutOptions {
  /** How many rocks to place. */
  count: number;
  /** Base art width in metres; diameters are a multiple of this. */
  baseDiameter: number;
  /** Deterministic PRNG seed. */
  seed?: number;
  /** Minimum distance from the world y axis to a rock's edge, metres. */
  axisClearanceM?: number;
  /** Minimum distance from the world origin (ship spawn) to a rock's edge, metres. */
  spawnClearanceM?: number;
  /** Scatter half-extent in metres before the rock radius is added. */
  halfExtentM?: number;
  /** Number of art variants to pick from (default 2). */
  variantCount?: number;
}

export const DEFAULT_ASTEROID_COUNT = 100;
export const DEFAULT_ASTEROID_SEED = 0x5eed1234;
export const DEFAULT_AXIS_CLEARANCE_M = 5;
export const DEFAULT_SPAWN_CLEARANCE_M = 7;
export const DEFAULT_FIELD_HALF_EXTENT_M = 70;

/** Rocks are between this and this multiple of the base art width. */
const MIN_DIAMETER_SCALE = 0.5;
const MAX_DIAMETER_SCALE = 2.2;
/** A few hero rocks are much larger. */
const HERO_CHANCE = 0.06;
const HERO_SCALE = 3;
const PLACEMENT_ATTEMPTS = 400;
/** Fraction of the two radii that two rock centres must exceed. */
const MIN_SEPARATION = 0.95;

/**
 * Deterministically scatter a field of asteroids around the world origin.
 *
 * Placement is random but seeded, rocks never cross the world y axis (so the
 * vertical grid axis stays clear), the ship's spawn bubble is kept empty, and
 * rocks do not interpenetrate. If random rejection cannot find a slot it falls
 * back to a looser separation so the requested count is always produced.
 */
export function generateAsteroidLayout(options: AsteroidLayoutOptions): AsteroidPlacement[] {
  const {
    count,
    baseDiameter,
    seed = DEFAULT_ASTEROID_SEED,
    axisClearanceM = DEFAULT_AXIS_CLEARANCE_M,
    spawnClearanceM = DEFAULT_SPAWN_CLEARANCE_M,
    halfExtentM = DEFAULT_FIELD_HALF_EXTENT_M,
    variantCount = 2,
  } = options;
  const variantLimit = Math.max(1, Math.floor(variantCount));
  const rng = createRng(seed);
  const placements: AsteroidPlacement[] = [];
  const baseRadius = Math.max(baseDiameter, 0.01) / 2;

  const rockRadius = (diameter: number): number => (diameter / 2) * 1.05;
  const fits = (candidate: AsteroidPlacement, separation: number): boolean => {
    const radius = rockRadius(candidate.diameter);
    // Keep the vertical axis clear by distance from the rock's edge.
    if (Math.abs(candidate.x) - radius < axisClearanceM) return false;
    // Keep the ship's spawn bubble clear.
    if (Math.hypot(candidate.x, candidate.y) - radius < spawnClearanceM) return false;
    for (const other of placements) {
      const otherRadius = rockRadius(other.diameter);
      if (
        Math.hypot(candidate.x - other.x, candidate.y - other.y) <
        (radius + otherRadius) * separation
      ) {
        return false;
      }
    }
    return true;
  };

  for (let index = 0; index < count; index += 1) {
    let placed: AsteroidPlacement | null = null;
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && !placed; attempt += 1) {
      const scale =
        rng() < HERO_CHANCE ? HERO_SCALE : randomRange(rng, MIN_DIAMETER_SCALE, MAX_DIAMETER_SCALE);
      const diameter = baseDiameter * scale;
      const radius = rockRadius(diameter);
      const side = rng() < 0.5 ? -1 : 1;
      const offset = rng() * halfExtentM;
      const x = side * (axisClearanceM + radius + offset);
      const y = randomRange(rng, -halfExtentM, halfExtentM);
      const candidate: AsteroidPlacement = {
        x,
        y,
        diameter,
        variant: Math.floor(rng() * variantLimit),
      };
      if (fits(candidate, MIN_SEPARATION)) placed = candidate;
    }

    if (!placed) {
      // Relax separation but still honour the axis/spawn rules; try a wider ring.
      for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && !placed; attempt += 1) {
        const diameter = baseDiameter * randomRange(rng, MIN_DIAMETER_SCALE, 1.4);
        const radius = rockRadius(diameter);
        const side = rng() < 0.5 ? -1 : 1;
        const x = side * (axisClearanceM + radius + halfExtentM * (1 + rng()));
        const y = randomRange(rng, -halfExtentM * 1.4, halfExtentM * 1.4);
        const candidate: AsteroidPlacement = {
          x,
          y,
          diameter,
          variant: rng() < 0.5 ? 0 : 1,
        };
        if (fits(candidate, 0.5)) placed = candidate;
      }
    }

    placements.push(
      placed ?? {
        x: (rng() < 0.5 ? -1 : 1) * (baseRadius + axisClearanceM + halfExtentM * 2),
        y: randomRange(rng, -halfExtentM * 2, halfExtentM * 2),
        diameter: baseDiameter * MIN_DIAMETER_SCALE,
        variant: 0,
      },
    );
  }

  return placements;
}
