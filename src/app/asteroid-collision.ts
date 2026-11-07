/**
 * Colliders for the asteroid and the ship. The asteroid art is roughly
 * circular, so one circle fits it far better than its rectangular bounds. The
 * ship is a pointed hull with wide wings and a blunt tail, so its collider is a
 * convex hull outline inflated by a bubble radius — equivalently, the union of
 * capsule segments along that outline. The shield draws the same shape.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Radius of the rock's silhouette as a fraction of the texture width. Measured
 * from the processed colour map: the opaque pixels sit at ~0.476 × width from
 * the centre (95th percentile), and the art fills its texture edge to edge.
 */
export const ASTEROID_RADIUS_OF_WIDTH = 0.476;

/** Ship bubble collider, in ship-texture px except the radius being live units. */
export interface ShipHull {
  /** Convex outline in ship-local px (y down, negative = nose). */
  points: readonly Vec2[];
  /** How far outside the outline the shield surface sits, in the same units. */
  radius: number;
}

/**
 * Hull-shaped bubble outline in ship-texture px: pointed nose, wing tips, short
 * blunt tail. Five segments plus corner rounding — a four-segment diamond
 * cannot hug the wings and the blunt tail at once without ballooning.
 */
export function shipHull(width: number, height: number): ShipHull {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return {
    points: [
      { x: 0, y: -0.95 * halfHeight },
      { x: 0.965 * halfWidth, y: 0.39 * halfHeight },
      { x: 0.45 * halfWidth, y: 0.93 * halfHeight },
      { x: -0.45 * halfWidth, y: 0.93 * halfHeight },
      { x: -0.965 * halfWidth, y: 0.39 * halfHeight },
    ],
    radius: 0.08 * width,
  };
}

/** Signed area; positive means the points run clockwise in screen coords. */
function signedArea(points: readonly Vec2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Outward unit normal of an edge, honouring the polygon's winding. */
function edgeNormal(a: Vec2, b: Vec2, clockwise: boolean): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return clockwise ? { x: dy / length, y: -dx / length } : { x: -dy / length, y: dx / length };
}

/**
 * Offset a convex polygon by `delta` along its edge normals (positive grows it).
 * Corners are rebuilt as line intersections, so the result stays convex.
 */
export function offsetPolygon(points: readonly Vec2[], delta: number): Vec2[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const clockwise = signedArea(points) > 0;
  const lines = points.map((a, index) => {
    const b = points[(index + 1) % points.length]!;
    const normal = edgeNormal(a, b, clockwise);
    return { x: a.x + normal.x * delta, y: a.y + normal.y * delta, dx: b.x - a.x, dy: b.y - a.y };
  });
  return lines.map((line, index) => {
    const previous = lines[(index - 1 + lines.length) % lines.length]!;
    const determinant = previous.dx * line.dy - previous.dy * line.dx;
    if (Math.abs(determinant) < 1e-9) {
      return { x: line.x, y: line.y };
    }
    const t = ((line.x - previous.x) * line.dy - (line.y - previous.y) * line.dx) / determinant;
    return { x: previous.x + previous.dx * t, y: previous.y + previous.dy * t };
  });
}

interface ClosestPoint {
  x: number;
  y: number;
  distance: number;
  inside: boolean;
}

/** Distance from a point to a convex polygon (0 inside), with the nearest point. */
export function closestPointOnPolygon(points: readonly Vec2[], point: Vec2): ClosestPoint {
  const clockwise = signedArea(points) > 0;
  let bestX = 0;
  let bestY = 0;
  let bestDistanceSquared = Infinity;
  let inside = true;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    let t =
      lengthSquared > 1e-9 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const distanceSquared = (point.x - px) ** 2 + (point.y - py) ** 2;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestX = px;
      bestY = py;
    }
    // Inside when the point is on the inward side of every edge.
    const cross = dx * (point.y - a.y) - dy * (point.x - a.x);
    if (clockwise ? cross < 0 : cross > 0) inside = false;
  }
  return {
    x: bestX,
    y: bestY,
    distance: inside ? 0 : Math.sqrt(bestDistanceSquared),
    inside,
  };
}

export interface ShipPose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
}

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

export interface ShipCollision {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
  /** Inward speed along the contact normal at the deepest impact, m/s. */
  impactSpeed: number;
  /** Shield-surface contact point in world metres (ship position when no hit). */
  contactX: number;
  contactY: number;
}

const noHit = (ship: ShipPose): ShipCollision => ({
  x: ship.x,
  y: ship.y,
  vx: ship.vx,
  vy: ship.vy,
  hit: false,
  impactSpeed: 0,
  contactX: ship.x,
  contactY: ship.y,
});

/**
 * Push the ship's hull bubble out of a static circle and bounce the component
 * of its velocity heading into it. Tangential velocity is unaffected, so
 * glancing hits slide along the rock instead of stopping dead.
 */
export function resolveShipCollision(
  ship: ShipPose,
  hull: ShipHull,
  circle: Circle,
  restitution: number,
): ShipCollision {
  const cos = Math.cos(ship.rotation);
  const sin = Math.sin(ship.rotation);

  // Work in the hull's local frame: rotate the rock's centre by -rotation.
  const dx = circle.x - ship.x;
  const dy = circle.y - ship.y;
  const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };

  const closest = closestPointOnPolygon(hull.points, local);
  const reach = hull.radius + circle.radius;
  if (closest.distance >= reach) return noHit(ship);

  // Normal points from the hull's surface toward the rock's centre.
  const toRockX = local.x - closest.x;
  const toRockY = local.y - closest.y;
  const length = Math.hypot(toRockX, toRockY);
  const nx = length > 1e-6 ? toRockX / length : 1;
  const ny = length > 1e-6 ? toRockY / length : 0;
  const penetration = reach - closest.distance;

  // The same displacement applies to the hull's origin, pushing the whole ship
  // away from the rock (the normal points toward the rock, so subtract).
  const worldNormalX = nx * cos - ny * sin;
  const worldNormalY = nx * sin + ny * cos;
  const x = ship.x - worldNormalX * penetration;
  const y = ship.y - worldNormalY * penetration;

  const inward = ship.vx * worldNormalX + ship.vy * worldNormalY;
  let vx = ship.vx;
  let vy = ship.vy;
  if (inward > 0) {
    vx -= (1 + restitution) * inward * worldNormalX;
    vy -= (1 + restitution) * inward * worldNormalY;
  }

  // Where the shield surface sits on the rock side of the hull.
  const contactLocalX = closest.x + nx * hull.radius;
  const contactLocalY = closest.y + ny * hull.radius;

  return {
    x,
    y,
    vx,
    vy,
    hit: true,
    impactSpeed: inward > 0 ? inward : 0,
    // Contact from the resolved position, so the highlight lands on the rock.
    contactX: x + contactLocalX * cos - contactLocalY * sin,
    contactY: y + contactLocalX * sin + contactLocalY * cos,
  };
}

/**
 * Swept point-to-circle test: does the segment `a → b` touch the circle? The
 * tracer is thin and fast, so testing the whole step avoids tunnelling through
 * the rock at speed.
 */
export function segmentCircleHit(a: Vec2, b: Vec2, circle: Circle): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 1e-9) {
    t = ((circle.x - a.x) * dx + (circle.y - a.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const px = a.x + dx * t - circle.x;
  const py = a.y + dy * t - circle.y;
  return px * px + py * py <= circle.radius * circle.radius;
}
