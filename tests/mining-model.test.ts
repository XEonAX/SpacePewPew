import { describe, expect, it } from 'vitest';
import { distance, moveToward, rayCircleHit, reflectDirection } from '../src/app/mining-model';

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

describe('tractor drag', () => {
  it('moves at the capped speed without overshooting', () => {
    const stepped = moveToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 0.5);
    expect(stepped.x).toBeCloseTo(2);
    expect(stepped.y).toBeCloseTo(0);
    expect(stepped.arrived).toBe(false);
  });

  it('snaps onto the target once within one step', () => {
    const stepped = moveToward({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 4, 0.5);
    expect(stepped.arrived).toBe(true);
    expect(stepped.x).toBe(0.5);
  });

  it('arrives immediately when already at the target', () => {
    const stepped = moveToward({ x: 3, y: 3 }, { x: 3, y: 3 }, 10, 1 / 60);
    expect(stepped.arrived).toBe(true);
    expect(stepped.x).toBe(3);
    expect(stepped.y).toBe(3);
  });

  it('measures straight-line distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
