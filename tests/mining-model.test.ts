import { describe, expect, it } from 'vitest';
import {
  carryToward,
  dampVelocity,
  distance,
  pointInRotatedRect,
  rayCircleHit,
  reflectDirection,
} from '../src/app/mining-model';

const CARRY = { speedPerBeam: 1.8, maxSpeed: 9, arrivalSeconds: 0.9 };

describe('mining reflection', () => {
  it('bounces a head-on ray straight back', () => {
    const reflected = reflectDirection({ x: 1, y: 0 }, { x: -1, y: 0 });
    expect(reflected.x).toBeCloseTo(-1);
    expect(reflected.y).toBeCloseTo(0);
  });

  it('mirrors the incidence angle across the surface normal', () => {
    const reflected = reflectDirection({ x: 1, y: -1 }, { x: 0, y: 1 });
    const length = Math.hypot(reflected.x, reflected.y);
    expect(reflected.x / length).toBeCloseTo(Math.SQRT1_2);
    expect(reflected.y / length).toBeCloseTo(Math.SQRT1_2);
  });

  it('leaves the reflection unit-length', () => {
    const reflected = reflectDirection({ x: 3, y: 4 }, { x: -1, y: 0.5 });
    expect(Math.hypot(reflected.x, reflected.y)).toBeCloseTo(1);
  });
});

describe('mining laser hit test', () => {
  const asteroid = { x: 20, y: 0, radius: 5 };

  it('finds the near surface of the asteroid', () => {
    const hit = rayCircleHit({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, asteroid, 5);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(15);
    expect(hit?.y).toBeCloseTo(0);
  });

  it('misses when the ray passes beside the asteroid', () => {
    expect(rayCircleHit({ x: 0, y: 0 }, { x: 1, y: 0 }, 100, { x: 20, y: 12 }, 5)).toBeNull();
  });

  it('misses when the asteroid is beyond the laser range', () => {
    expect(rayCircleHit({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, asteroid, 5)).toBeNull();
  });

  it('still hits when the emitter is inside the asteroid', () => {
    const hit = rayCircleHit({ x: 20, y: 0 }, { x: 1, y: 0 }, 100, asteroid, 5);
    expect(hit?.x).toBeCloseTo(25);
  });
});

describe('metal damping', () => {
  it('slows a drifting chunk over time', () => {
    const after = dampVelocity({ x: 2, y: -1 }, 0.55, 2);
    expect(Math.hypot(after.x, after.y)).toBeLessThan(Math.hypot(2, -1));
  });

  it('keeps the direction while bleeding speed', () => {
    const after = dampVelocity({ x: 2, y: -1 }, 0.55, 2);
    expect(after.y / after.x).toBeCloseTo(-0.5);
  });

  it('leaves a chunk untouched with no damping', () => {
    expect(dampVelocity({ x: 3, y: 4 }, 0, 1)).toEqual({ x: 3, y: 4 });
  });
});

describe('tractor carry', () => {
  it('slides a gripped chunk toward the hatch', () => {
    const carried = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 1, CARRY);
    expect(carried.x).toBeCloseTo(0.9);
    expect(carried.y).toBeCloseTo(0);
    expect(carried.arrived).toBe(false);
  });

  it('drags faster when more beams grip the same chunk', () => {
    const one = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 1, CARRY);
    const three = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 3, CARRY);
    expect(three.x).toBeGreaterThan(one.x);
  });

  it('caps the carried speed however many beams are active', () => {
    const many = carryToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, CARRY);
    expect(many.x).toBeCloseTo(CARRY.maxSpeed);
  });

  it('eases in as it reaches the hatch', () => {
    const far = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 2, CARRY);
    const near = carryToward({ x: 9.6, y: 0 }, { x: 10, y: 0 }, 0.5, 2, CARRY);
    expect(near.x - 9.6).toBeLessThan(far.x);
  });

  it('cannot overshoot the hatch and snaps onto it', () => {
    const carried = carryToward({ x: 9.9, y: 0 }, { x: 10, y: 0 }, 1, 6, CARRY);
    expect(carried.x).toBeCloseTo(10);
    expect(carried.arrived).toBe(true);
  });

  it('does not move a chunk no beam is holding', () => {
    const carried = carryToward({ x: 2, y: 3 }, { x: 10, y: 0 }, 0.5, 0, CARRY);
    expect(carried).toEqual({ x: 2, y: 3, arrived: false });
  });

  it('measures straight-line distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('grill intake rectangle', () => {
  it('accepts a point inside an axis-aligned hatch', () => {
    expect(pointInRotatedRect({ x: 10.5, y: 0.2 }, { x: 10, y: 0 }, 0, 1, 0.5)).toBe(true);
    expect(pointInRotatedRect({ x: 12, y: 0 }, { x: 10, y: 0 }, 0, 1, 0.5)).toBe(false);
  });

  it('rotates the hatch with the ship', () => {
    // At 90 degrees the hatch's local width lies along world Y and its local
    // height along world X, so the axes swap in world space.
    const centre = { x: 0, y: 0 };
    expect(pointInRotatedRect({ x: -0.5, y: 1 }, centre, Math.PI / 2, 2, 1)).toBe(true);
    expect(pointInRotatedRect({ x: 1.5, y: 0 }, centre, Math.PI / 2, 2, 1)).toBe(false);
  });
});
