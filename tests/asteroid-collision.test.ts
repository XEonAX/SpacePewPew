import { describe, expect, it } from 'vitest';
import {
  ASTEROID_RADIUS_OF_WIDTH,
  closestPointOnPolygon,
  offsetPolygon,
  resolveShipCollision,
  segmentCircleHit,
  shipHull,
} from '../src/app/asteroid-collision';

/** Diamond hull, 2 m to a side, with a 0.5 m shield bubble. */
const HULL = {
  points: [
    { x: 0, y: -2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
  ],
  radius: 0.5,
};
const ROCK = { x: 0, y: 0, radius: 1 };
/** Tracer tests use a bigger rock at the origin. */
const ROCK_LARGE = { x: 0, y: 0, radius: 3 };

describe('asteroid circle collider', () => {
  it('fits the roughly circular art', () => {
    // The rock's silhouette sits just inside the texture edge.
    expect(ASTEROID_RADIUS_OF_WIDTH).toBeGreaterThan(0.44);
    expect(ASTEROID_RADIUS_OF_WIDTH).toBeLessThan(0.5);
  });

  it('shapes the shield bubble around the hull outline', () => {
    const hull = shipHull(100, 200);
    expect(hull.points).toHaveLength(5);
    expect(hull.radius).toBeGreaterThan(0);
    // Symmetric about the hull's centre line, nose up.
    expect(hull.points[0]!.x).toBeCloseTo(0);
    expect(hull.points[0]!.y).toBeLessThan(-50);
    expect(hull.points[1]!.x).toBeCloseTo(-hull.points[4]!.x);
    // The bubble reaches past the wing tips.
    expect(Math.abs(hull.points[1]!.x) + hull.radius).toBeGreaterThan(50);
  });
});

describe('hull bubble geometry', () => {
  it('finds the nearest point on the polygon', () => {
    expect(closestPointOnPolygon(HULL.points, { x: 0, y: 3 }).distance).toBeCloseTo(1);
    expect(closestPointOnPolygon(HULL.points, { x: 0, y: 0 }).distance).toBeCloseTo(0);
  });

  it('offsets a convex polygon outward and inward', () => {
    const square = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    const grown = offsetPolygon(square, 0.5);
    const shrunk = offsetPolygon(square, -0.5);
    expect(Math.max(...grown.map((point) => Math.abs(point.x)))).toBeCloseTo(1.5);
    expect(Math.max(...shrunk.map((point) => Math.abs(point.x)))).toBeCloseTo(0.5);
  });
});

describe('ship shield vs asteroid', () => {
  it('leaves a ship that is clear of the rock alone', () => {
    const ship = { x: 0, y: 20, vx: 0, vy: 0, rotation: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, 0.35);
    expect(result).toEqual({
      x: 0,
      y: 20,
      vx: 0,
      vy: 0,
      hit: false,
      impactSpeed: 0,
      contactX: 0,
      contactY: 20,
    });
  });

  it('pushes an overlapping ship out along the contact normal', () => {
    // The rock's surface reaches y = 1; the hull's nose bubble reaches y = 1.4.
    const ship = { x: 0, y: 3.4, vx: 0, vy: 0, rotation: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, 0.35);
    expect(result.hit).toBe(true);
    expect(result.y).toBeCloseTo(3.5);
    expect(result.x).toBeCloseTo(0);
  });

  it('reports the contact point on the rock-facing shield surface', () => {
    const ship = { x: 0, y: 3.4, vx: 0, vy: -5, rotation: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, 0.35);
    // The rock's nearest surface is at y = 1.
    expect(result.contactY).toBeCloseTo(1);
    expect(result.contactX).toBeCloseTo(0);
  });

  it('bounces the inward velocity and keeps the tangent', () => {
    const ship = { x: 0, y: 3.4, vx: 3, vy: -4, rotation: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, 0.35);
    // Downward 4 m/s bounces back at 35% restitution; sideways 3 m/s is kept.
    expect(result.vy).toBeCloseTo(1.4);
    expect(result.vx).toBeCloseTo(3);
    expect(result.impactSpeed).toBeCloseTo(4);
  });

  it('does not bounce a ship that is already flying away', () => {
    const ship = { x: 0, y: 3.4, vx: 0, vy: 5, rotation: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, 0.35);
    expect(result.vy).toBeCloseTo(5);
    expect(result.impactSpeed).toBe(0);
  });

  it('rotates with the ship', () => {
    // Turned 90 degrees the hull's long axis lies along X, so the rock is behind
    // the tail and the ship is pushed along +Y.
    const ship = { x: 0, y: 3.4, vx: 0, vy: 0, rotation: Math.PI / 2 };
    const result = resolveShipCollision(ship, HULL, ROCK, 0.35);
    expect(result.hit).toBe(true);
    expect(result.y).toBeGreaterThan(3.4);
  });
});

describe('swept tracer vs asteroid', () => {
  it('catches a tracer that crosses the rock between frames', () => {
    expect(segmentCircleHit({ x: -10, y: 0 }, { x: 10, y: 0 }, ROCK_LARGE)).toBe(true);
  });

  it('misses a tracer that passes beside it', () => {
    expect(segmentCircleHit({ x: -10, y: 4 }, { x: 10, y: 4 }, ROCK_LARGE)).toBe(false);
  });

  it('counts a tracer that stops inside it', () => {
    expect(segmentCircleHit({ x: -10, y: 0 }, { x: 1, y: 0 }, ROCK_LARGE)).toBe(true);
  });

  it('handles a zero-length step', () => {
    expect(segmentCircleHit({ x: 0, y: 0 }, { x: 0, y: 0 }, ROCK_LARGE)).toBe(true);
    expect(segmentCircleHit({ x: 20, y: 0 }, { x: 20, y: 0 }, ROCK_LARGE)).toBe(false);
  });
});
