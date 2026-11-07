import { describe, expect, it } from 'vitest';
import { DEFAULT_ASTEROID_COUNT, generateAsteroidLayout } from '../src/app/asteroid-layout';

const BASE = 6;
const AXIS_CLEARANCE = 5;
const SPAWN_CLEARANCE = 7;
const HALF_EXTENT = 70;

const layout = generateAsteroidLayout({
  count: 100,
  baseDiameter: BASE,
  axisClearanceM: AXIS_CLEARANCE,
  spawnClearanceM: SPAWN_CLEARANCE,
  halfExtentM: HALF_EXTENT,
});

/** Collider radius approximation used by the generator (art is not a circle). */
const radiusOf = (diameter: number): number => (diameter / 2) * 1.05;

describe('asteroid layout', () => {
  it('always produces the requested count', () => {
    expect(DEFAULT_ASTEROID_COUNT).toBe(100);
    expect(layout).toHaveLength(100);
  });

  it('is deterministic for a seed', () => {
    const again = generateAsteroidLayout({
      count: 100,
      baseDiameter: BASE,
      axisClearanceM: AXIS_CLEARANCE,
      spawnClearanceM: SPAWN_CLEARANCE,
      halfExtentM: HALF_EXTENT,
    });
    expect(again).toEqual(layout);
    const other = generateAsteroidLayout({
      count: 100,
      baseDiameter: BASE,
      seed: 42,
      axisClearanceM: AXIS_CLEARANCE,
      spawnClearanceM: SPAWN_CLEARANCE,
      halfExtentM: HALF_EXTENT,
    });
    expect(other).not.toEqual(layout);
  });

  it('keeps the vertical axis clear of rock edges', () => {
    for (const rock of layout) {
      expect(Math.abs(rock.x) - radiusOf(rock.diameter)).toBeGreaterThanOrEqual(
        AXIS_CLEARANCE - 1e-9,
      );
    }
    // And both sides of the axis are populated.
    expect(layout.some((rock) => rock.x < 0)).toBe(true);
    expect(layout.some((rock) => rock.x > 0)).toBe(true);
  });

  it('keeps the ship spawn bubble clear', () => {
    for (const rock of layout) {
      expect(Math.hypot(rock.x, rock.y) - radiusOf(rock.diameter)).toBeGreaterThanOrEqual(
        SPAWN_CLEARANCE - 1e-9,
      );
    }
  });

  it('varies diameters and art variants within bounds', () => {
    const diameters = layout.map((rock) => rock.diameter);
    expect(Math.min(...diameters)).toBeGreaterThanOrEqual(BASE * 0.5 - 1e-9);
    expect(Math.max(...diameters)).toBeLessThanOrEqual(BASE * 3 + 1e-9);
    expect(new Set(layout.map((rock) => rock.variant))).toEqual(new Set([0, 1]));
    // Mostly normal rocks, a few heroes.
    expect(diameters.filter((diameter) => diameter > BASE * 2.2).length).toBeLessThan(12);
  });
});
