import { describe, expect, it } from 'vitest';
import {
  colliderWorldPoints,
  convexHull,
  offsetPolygon,
  pointInConvex,
  polygonHitNormal,
  rayPolygonHit,
  resolveShipCollision,
  segmentPolygonHit,
  shipHull,
} from '../src/app/asteroid-collision';
import type { AsteroidCollider } from '../src/app/asteroid-collision';

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
/** Square rock, 2 m across, centred on the origin. */
const ROCK: AsteroidCollider = {
  x: 0,
  y: 0,
  rotation: 0,
  points: [
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ],
  radius: Math.SQRT2,
};
const BODY = {
  mass: 1000,
  inertia: 1000,
  restitution: 0.35,
  friction: 0,
  pivotX: 0,
  pivotY: 0,
};

describe('ship hull bubble', () => {
  it('sizes the shield bubble to the hull', () => {
    const hull = shipHull(100, 200);
    expect(hull.points).toHaveLength(5);
    expect(hull.radius).toBeCloseTo(8);
    // Symmetric about the hull's centre line, nose up.
    expect(hull.points[0]!.x).toBeCloseTo(0);
    expect(hull.points[0]!.y).toBeLessThan(-50);
    expect(hull.points[1]!.x).toBeCloseTo(-hull.points[4]!.x);
  });
});

describe('polygon helpers', () => {
  it('takes the convex hull of arbitrary points', () => {
    const hull = convexHull([
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: 0, y: 0 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull.some((point) => point.x === 0 && point.y === 0)).toBe(false);
  });

  it('offsets a convex polygon outward and inward', () => {
    const grown = offsetPolygon(ROCK.points, 0.5);
    expect(Math.max(...grown.map((point) => Math.abs(point.x)))).toBeCloseTo(1.5);
    const shrunk = offsetPolygon(ROCK.points, -0.5);
    expect(Math.max(...shrunk.map((point) => Math.abs(point.x)))).toBeCloseTo(0.5);
  });

  it('turns the outline with the collider', () => {
    const turned = colliderWorldPoints({ ...ROCK, rotation: Math.PI / 2 });
    expect(turned.some((point) => Math.abs(point.y - 1) < 1e-6)).toBe(true);
  });

  it('knows inside points and surface normals', () => {
    expect(pointInConvex(ROCK.points, { x: 0, y: 0 })).toBe(true);
    expect(pointInConvex(ROCK.points, { x: 2, y: 0 })).toBe(false);
    const normal = polygonHitNormal(ROCK, { x: 2, y: 0.2 });
    expect(normal.x).toBeCloseTo(1);
    expect(normal.y).toBeCloseTo(0);
  });
});

describe('ship vs asteroid polygon', () => {
  it('leaves a ship that is clear of the rock alone', () => {
    const ship = { x: 0, y: 20, vx: 0, vy: 0, rotation: 0, angularVelocity: 0 };
    expect(resolveShipCollision(ship, HULL, ROCK, BODY)).toEqual({
      x: 0,
      y: 20,
      vx: 0,
      vy: 0,
      angularVelocity: 0,
      hit: false,
      impactSpeed: 0,
      impulse: 0,
      hitEnergy: 0,
      contactX: 0,
      contactY: 20,
    });
  });

  it('pushes an overlapping ship out along the contact normal', () => {
    const ship = { x: 0, y: 3.4, vx: 0, vy: 0, rotation: 0, angularVelocity: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, BODY);
    expect(result.hit).toBe(true);
    expect(result.y).toBeCloseTo(3.5);
    expect(result.x).toBeCloseTo(0);
  });

  it('reports the contact point on the rock-facing shield surface', () => {
    const ship = { x: 0, y: 3.4, vx: 0, vy: -5, rotation: 0, angularVelocity: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, BODY);
    expect(result.contactY).toBeCloseTo(1);
    expect(result.contactX).toBeCloseTo(0);
  });

  it('bounces the inward velocity and keeps the tangent', () => {
    const ship = { x: 0, y: 3.4, vx: 3, vy: -4, rotation: 0, angularVelocity: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, BODY);
    expect(result.vy).toBeCloseTo(1.4);
    expect(result.vx).toBeCloseTo(3);
    expect(result.impactSpeed).toBeCloseTo(4);
  });

  it('does not impulse a ship that is already flying away', () => {
    const ship = { x: 0, y: 3.4, vx: 0, vy: 5, rotation: 0, angularVelocity: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, BODY);
    expect(result.vy).toBeCloseTo(5);
    expect(result.impulse).toBe(0);
  });

  it('turns the hull collision with the ship', () => {
    // Nose pointed right at a rock that is 3.4 m to the right.
    const rock = { ...ROCK, x: 3.4 };
    const ship = { x: 0, y: 0, vx: 4, vy: 0, rotation: Math.PI / 2, angularVelocity: 0 };
    const result = resolveShipCollision(ship, HULL, rock, BODY);
    expect(result.hit).toBe(true);
    expect(result.x).toBeLessThan(0);
    // 4 m/s inward bounces back at 35% restitution.
    expect(result.vx).toBeCloseTo(-1.4);
  });

  it('gives the hit weight: mass sets the energy, inertia the spin', () => {
    const ship = { x: 0, y: 3.4, vx: 0, vy: -4, rotation: 0, angularVelocity: 0 };
    const result = resolveShipCollision(ship, HULL, ROCK, BODY);
    expect(result.hitEnergy).toBeCloseTo(8000);
    expect(result.impulse).toBeGreaterThan(0);

    const spun = resolveShipCollision(ship, HULL, ROCK, { ...BODY, pivotX: 0.6 });
    expect(Math.abs(spun.angularVelocity)).toBeGreaterThan(0.5);
  });

  it('friction drags the shield tangentially', () => {
    const ship = { x: 0, y: 3.4, vx: 3, vy: -4, rotation: 0, angularVelocity: 0 };
    const slippery = resolveShipCollision(ship, HULL, ROCK, BODY);
    const grippy = resolveShipCollision(ship, HULL, ROCK, { ...BODY, friction: 0.5 });
    expect(grippy.vx).toBeLessThan(slippery.vx);
    expect(Math.abs(grippy.angularVelocity)).toBeGreaterThan(0);
  });
});

describe('laser rays vs asteroid polygon', () => {
  it('finds the near surface of the rock', () => {
    const hit = rayPolygonHit({ x: -3, y: 0 }, { x: 1, y: 0 }, 10, ROCK);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(-1);
    expect(hit!.y).toBeCloseTo(0);
  });

  it('misses when the ray passes beside the rock', () => {
    expect(rayPolygonHit({ x: -3, y: 2.5 }, { x: 1, y: 0 }, 10, ROCK)).toBeNull();
  });

  it('returns a hit for a ray starting inside', () => {
    expect(rayPolygonHit({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, ROCK)).not.toBeNull();
  });

  it('respects max range', () => {
    expect(rayPolygonHit({ x: -10, y: 0 }, { x: 1, y: 0 }, 5, ROCK)).toBeNull();
  });
});

describe('tracers vs asteroid polygon', () => {
  it('catches a tracer that crosses the rock', () => {
    expect(segmentPolygonHit({ x: -3, y: 0 }, { x: 3, y: 0 }, ROCK)).toBe(true);
  });

  it('misses a tracer that passes beside it', () => {
    expect(segmentPolygonHit({ x: -3, y: 2 }, { x: 3, y: 2 }, ROCK)).toBe(false);
  });

  it('counts a tracer that stops inside it', () => {
    expect(segmentPolygonHit({ x: -3, y: 0 }, { x: 0.5, y: 0 }, ROCK)).toBe(true);
  });
});
