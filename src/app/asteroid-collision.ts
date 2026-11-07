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
  angularVelocity: number;
}

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

/** Physical properties the collision response needs, all in SI units. */
export interface ShipBody {
  /** Mass, kg. */
  mass: number;
  /** Moment of inertia about the centre of mass, kg·m². */
  inertia: number;
  /** Bounce: 0 = the shield eats the hit, 1 = perfect bounce. */
  restitution: number;
  /** Coulomb friction coefficient of the shield surface. */
  friction: number;
  /** Centre of mass offset from the pose origin, local metres (y down). */
  pivotX: number;
  pivotY: number;
}

export interface ShipCollision {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angularVelocity: number;
  hit: boolean;
  /** Inward speed along the contact normal, m/s. */
  impactSpeed: number;
  /** Normal impulse magnitude, N·s. */
  impulse: number;
  /** Kinetic energy dissipated at the contact, J. */
  hitEnergy: number;
  /** Shield-surface contact point in world metres (ship position when no hit). */
  contactX: number;
  contactY: number;
}

const noHit = (ship: ShipPose): ShipCollision => ({
  x: ship.x,
  y: ship.y,
  vx: ship.vx,
  vy: ship.vy,
  angularVelocity: ship.angularVelocity,
  hit: false,
  impactSpeed: 0,
  impulse: 0,
  hitEnergy: 0,
  contactX: ship.x,
  contactY: ship.y,
});

/**
 * Impulse-based collision of the ship's hull bubble with a static circle.
 *
 * The shield is the contact surface: restitution controls bounce, friction the
 * tangential grip, and the ship's mass and inertia give the hit weight — an
 * off-centre hit spins the hull about its centre of mass instead of simply
 * reversing it. The rock is scenery with effectively infinite mass, so the
 * ship takes the whole impulse.
 */
export function resolveShipCollision(
  ship: ShipPose,
  hull: ShipHull,
  circle: Circle,
  body: ShipBody,
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

  // Separate first: the same displacement moves the whole hull.
  const worldNormalX = nx * cos - ny * sin;
  const worldNormalY = nx * sin + ny * cos;
  const x = ship.x - worldNormalX * penetration;
  const y = ship.y - worldNormalY * penetration;

  // Contact patch on the shield, and the hull's centre of mass.
  const contactLocalX = closest.x + nx * hull.radius;
  const contactLocalY = closest.y + ny * hull.radius;
  const contactX = x + contactLocalX * cos - contactLocalY * sin;
  const contactY = y + contactLocalX * sin + contactLocalY * cos;
  const comX = x + body.pivotX * cos - body.pivotY * sin;
  const comY = y + body.pivotX * sin + body.pivotY * cos;
  // Lever arm from the centre of mass to the contact patch.
  const rx = contactX - comX;
  const ry = contactY - comY;

  // Velocity of the contact patch (rigid body: v + ω × r, y down).
  const contactVx = ship.vx - ship.angularVelocity * ry;
  const contactVy = ship.vy + ship.angularVelocity * rx;
  const inward = contactVx * worldNormalX + contactVy * worldNormalY;

  let vx = ship.vx;
  let vy = ship.vy;
  let angularVelocity = ship.angularVelocity;
  let impulse = 0;
  let hitEnergy = 0;

  if (inward > 0) {
    const inverseMass = 1 / body.mass;
    const normalLever = rx * worldNormalY - ry * worldNormalX;
    const normalDenominator = inverseMass + (normalLever * normalLever) / body.inertia;
    impulse = ((1 + body.restitution) * inward) / normalDenominator;
    const normalImpulseX = -impulse * worldNormalX;
    const normalImpulseY = -impulse * worldNormalY;
    vx += normalImpulseX * inverseMass;
    vy += normalImpulseY * inverseMass;
    angularVelocity += (rx * normalImpulseY - ry * normalImpulseX) / body.inertia;

    // Coulomb friction opposes the sliding at the contact patch.
    const tangentX = contactVx - inward * worldNormalX;
    const tangentY = contactVy - inward * worldNormalY;
    const tangentSpeed = Math.hypot(tangentX, tangentY);
    if (tangentSpeed > 1e-6 && body.friction > 0) {
      const slideX = tangentX / tangentSpeed;
      const slideY = tangentY / tangentSpeed;
      const tangentLever = rx * slideY - ry * slideX;
      const tangentDenominator = inverseMass + (tangentLever * tangentLever) / body.inertia;
      const maxFriction = body.friction * impulse;
      const frictionImpulse = Math.max(
        -maxFriction,
        Math.min(maxFriction, -tangentSpeed / tangentDenominator),
      );
      const frictionX = frictionImpulse * slideX;
      const frictionY = frictionImpulse * slideY;
      vx += frictionX * inverseMass;
      vy += frictionY * inverseMass;
      angularVelocity += (rx * frictionY - ry * frictionX) / body.inertia;
    }

    hitEnergy = 0.5 * body.mass * inward * inward;
  }

  return {
    x,
    y,
    vx,
    vy,
    angularVelocity,
    hit: true,
    impactSpeed: inward > 0 ? inward : 0,
    impulse,
    hitEnergy,
    contactX,
    contactY,
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
