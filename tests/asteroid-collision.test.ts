import { describe, expect, it } from 'vitest';
import {
  ASTEROID_RADIUS_OF_WIDTH,
  resolveShipCollision,
  segmentCircleHit,
  shipCapsule,
} from '../src/app/asteroid-collision';

const CAPSULE = { halfLength: 1, radius: 1 };
const ROCK = { x: 0, y: 0, radius: 3 };

describe('asteroid circle collider', () => {
  it('fits the roughly circular art', () => {
    // The rock's silhouette sits just inside the texture edge.
    expect(ASTEROID_RADIUS_OF_WIDTH).toBeGreaterThan(0.44);
    expect(ASTEROID_RADIUS_OF_WIDTH).toBeLessThan(0.5);
  });

  it('sizes the shield capsule to the hull', () => {
    const capsule = shipCapsule(100, 200);
    expect(capsule.radius).toBeCloseTo(38);
    expect(capsule.halfLength).toBeCloseTo(60);
  });
});

describe('ship shield vs asteroid', () => {
  it('leaves a ship that is clear of the rock alone', () => {
    const ship = { x: 10, y: 0, vx: 0, vy: 0, rotation: 0 };
    const result = resolveShipCollision(ship, CAPSULE, ROCK, 0.35);
    expect(result).toEqual({
      x: 10,
      y: 0,
      vx: 0,
      vy: 0,
      hit: false,
      impactSpeed: 0,
      contactX: 10,
      contactY: 0,
    });
  });

  it('pushes an overlapping ship back out along the contact normal', () => {
    const ship = { x: 3.5, y: 0, vx: 0, vy: 0, rotation: 0 };
    const result = resolveShipCollision(ship, CAPSULE, ROCK, 0.35);
    expect(result.hit).toBe(true);
    expect(result.x).toBeCloseTo(4);
    expect(result.y).toBeCloseTo(0);
  });

  it('reports the contact point on the shield surface', () => {
    const ship = { x: 3.5, y: 0, vx: -5, vy: 0, rotation: 0 };
    const result = resolveShipCollision(ship, CAPSULE, ROCK, 0.35);
    // After separation the shield surface rests on the rock's surface at x = 3.
    expect(result.contactX).toBeCloseTo(3);
    expect(result.contactY).toBeCloseTo(0);
  });

  it('bounces the inward velocity component and keeps the tangent', () => {
    const ship = { x: 3.5, y: 0, vx: -10, vy: 4, rotation: 0 };
    const result = resolveShipCollision(ship, CAPSULE, ROCK, 0.35);
    // Inward 10 m/s bounces back at 35% restitution; sideways 4 m/s is kept.
    expect(result.vx).toBeCloseTo(3.5);
    expect(result.vy).toBeCloseTo(4);
    expect(result.impactSpeed).toBeCloseTo(10);
  });

  it('does not bounce a ship that is already flying away', () => {
    const ship = { x: 3.5, y: 0, vx: 6, vy: 0, rotation: 0 };
    const result = resolveShipCollision(ship, CAPSULE, ROCK, 0.35);
    expect(result.vx).toBeCloseTo(6);
    expect(result.impactSpeed).toBe(0);
  });

  it('handles a dead-centre overlap without NaNs', () => {
    const ship = { x: 0, y: 0, vx: 0, vy: 0, rotation: 0 };
    const result = resolveShipCollision(ship, CAPSULE, ROCK, 0.35);
    expect(result.hit).toBe(true);
    expect(Number.isNaN(result.x)).toBe(false);
    expect(Number.isNaN(result.y)).toBe(false);
  });

  it('turns the capsule with the ship', () => {
    // Same ship position: pointing at the rock the capsule reaches it, lying
    // across it the hull is clear.
    const rock = { x: 0, y: 0, radius: 1 };
    const capsule = { halfLength: 2, radius: 0.5 };
    const ship = { x: 0, y: 2.5, vx: 0, vy: 0, rotation: 0 };
    expect(resolveShipCollision(ship, capsule, rock, 0.35).hit).toBe(true);
    const across = { ...ship, rotation: Math.PI / 2 };
    expect(resolveShipCollision(across, capsule, rock, 0.35).hit).toBe(false);
  });
});

describe('swept tracer vs asteroid', () => {
  it('catches a tracer that crosses the rock between frames', () => {
    expect(segmentCircleHit({ x: -10, y: 0 }, { x: 10, y: 0 }, ROCK)).toBe(true);
  });

  it('misses a tracer that passes beside it', () => {
    expect(segmentCircleHit({ x: -10, y: 4 }, { x: 10, y: 4 }, ROCK)).toBe(false);
  });

  it('counts a tracer that stops inside it', () => {
    expect(segmentCircleHit({ x: -10, y: 0 }, { x: 1, y: 0 }, ROCK)).toBe(true);
  });

  it('handles a zero-length step', () => {
    expect(segmentCircleHit({ x: 0, y: 0 }, { x: 0, y: 0 }, ROCK)).toBe(true);
    expect(segmentCircleHit({ x: 20, y: 0 }, { x: 20, y: 0 }, ROCK)).toBe(false);
  });
});
