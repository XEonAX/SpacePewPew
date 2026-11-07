/**
 * Collision geometry for the asteroid field and the ship.
 *
 * Asteroids use a two-stage collider: a **bounding circle** for cheap rejection
 * and a **convex polygon** fitted to the silhouette (which turns with the art)
 * for the accurate pass. The ship is a pointed hull, so its collider is a
 * convex outline inflated by a bubble radius — the same capsule-union shape the
 * energy shield draws.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * A rock: world centre and spin plus a convex outline in local metres. The
 * outline turns with `rotation`, and `radius` is the bounding circle used for
 * broad-phase rejection.
 */
export interface AsteroidCollider {
  x: number;
  y: number;
  rotation: number;
  /** Convex outline, metres, relative to the centre, before rotation. */
  points: readonly Vec2[];
  /** Bounding-circle radius in metres, for the fast pass. */
  radius: number;
}

/** Ship bubble collider, in ship-texture px except the radius being live units. */
export interface ShipHull {
  /** Convex outline in ship-local px (y down, negative = nose). */
  points: readonly Vec2[];
  /** How far outside the outline the shield surface sits, in the same units. */
  radius: number;
}

/** Hull-shaped bubble outline in ship-texture px. */
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

/** Radius of the smallest circle containing the rounded hull. */
export function shipBoundingRadius(hull: ShipHull): number {
  let largest = 0;
  for (const point of hull.points) largest = Math.max(largest, Math.hypot(point.x, point.y));
  return largest + hull.radius;
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

/** Convex hull (monotone chain) of arbitrary points. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (origin: Vec2, a: Vec2, b: Vec2): number =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function rotatedPoint(point: Vec2, centre: Vec2, cos: number, sin: number): Vec2 {
  return {
    x: centre.x + point.x * cos - point.y * sin,
    y: centre.y + point.x * sin + point.y * cos,
  };
}

/** World-space outline of a rotated collider. */
export function colliderWorldPoints(collider: AsteroidCollider): Vec2[] {
  const cos = Math.cos(collider.rotation);
  const sin = Math.sin(collider.rotation);
  return collider.points.map((point) => rotatedPoint(point, collider, cos, sin));
}

export interface ShipPose {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  angularVelocity: number;
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

interface Interval {
  min: number;
  max: number;
}

function projectPolygon(points: readonly Vec2[], axis: Vec2): Interval {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const value = point.x * axis.x + point.y * axis.y;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/**
 * Collide the ship's rounded hull polygon with an asteroid polygon.
 *
 * Fast pass: bounding circles. Accurate pass: separating-axis test between the
 * rock's convex outline and the ship hull inflated by its bubble radius. The
 * response is an impulse at the contact patch — restitution, Coulomb friction
 * and mass/inertia, so off-centre hits spin the hull.
 */
export function resolveShipCollision(
  ship: ShipPose,
  hull: ShipHull,
  rock: AsteroidCollider,
  body: ShipBody,
): ShipCollision {
  // Fast pass: bounding circles reject almost everything.
  const centreDistance = Math.hypot(rock.x - ship.x, rock.y - ship.y);
  if (centreDistance > rock.radius + shipBoundingRadius(hull)) return noHit(ship);

  const cos = Math.cos(ship.rotation);
  const sin = Math.sin(ship.rotation);
  const shipPoints = hull.points.map((point) => rotatedPoint(point, ship, cos, sin));
  const rockPoints = colliderWorldPoints(rock);

  // The bubble rounds the hull, so its extent grows by `radius` on every axis.
  const radius = hull.radius;
  const axes: Vec2[] = [];
  const addAxes = (points: readonly Vec2[]): void => {
    const clockwise = signedArea(points) > 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index]!;
      const b = points[(index + 1) % points.length]!;
      axes.push(edgeNormal(a, b, clockwise));
    }
  };
  addAxes(shipPoints);
  addAxes(rockPoints);

  let penetration = Infinity;
  let normal: Vec2 = { x: 0, y: 0 };
  for (const axis of axes) {
    const shipInterval = projectPolygon(shipPoints, axis);
    const rockInterval = projectPolygon(rockPoints, axis);
    const overlap = Math.min(
      rockInterval.max - (shipInterval.min - radius),
      shipInterval.max + radius - rockInterval.min,
    );
    if (overlap <= 0) return noHit(ship);
    if (overlap < penetration) {
      penetration = overlap;
      // Point the contact normal from the ship toward the rock.
      const towardRock = (rock.x - ship.x) * axis.x + (rock.y - ship.y) * axis.y >= 0 ? 1 : -1;
      normal = { x: axis.x * towardRock, y: axis.y * towardRock };
    }
  }

  // Separate: the normal points at the rock, so the ship moves the other way.
  const x = ship.x - normal.x * penetration;
  const y = ship.y - normal.y * penetration;

  // Contact patch: the hull point furthest toward the rock, plus the bubble.
  let support: Vec2 = shipPoints[0]!;
  let best = -Infinity;
  for (const point of shipPoints) {
    const value = point.x * normal.x + point.y * normal.y;
    if (value > best) {
      best = value;
      support = point;
    }
  }
  const contactX = x + (support.x - ship.x) + normal.x * radius;
  const contactY = y + (support.y - ship.y) + normal.y * radius;

  const comX = x + body.pivotX * cos - body.pivotY * sin;
  const comY = y + body.pivotX * sin + body.pivotY * cos;
  const rx = contactX - comX;
  const ry = contactY - comY;

  const contactVx = ship.vx - ship.angularVelocity * ry;
  const contactVy = ship.vy + ship.angularVelocity * rx;
  const inward = contactVx * normal.x + contactVy * normal.y;

  let vx = ship.vx;
  let vy = ship.vy;
  let angularVelocity = ship.angularVelocity;
  let impulse = 0;
  let hitEnergy = 0;

  if (inward > 0) {
    const inverseMass = 1 / body.mass;
    const normalLever = rx * normal.y - ry * normal.x;
    const normalDenominator = inverseMass + (normalLever * normalLever) / body.inertia;
    impulse = ((1 + body.restitution) * inward) / normalDenominator;
    const normalImpulseX = -impulse * normal.x;
    const normalImpulseY = -impulse * normal.y;
    vx += normalImpulseX * inverseMass;
    vy += normalImpulseY * inverseMass;
    angularVelocity += (rx * normalImpulseY - ry * normalImpulseX) / body.inertia;

    const tangentX = contactVx - inward * normal.x;
    const tangentY = contactVy - inward * normal.y;
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
 * Nearest point where a ray enters a rotated convex collider, or null. Fast
 * pass uses the bounding circle; the accurate pass clips the ray against the
 * polygon's half-planes.
 */
export function rayPolygonHit(
  origin: Vec2,
  direction: Vec2,
  maxLength: number,
  rock: AsteroidCollider,
): Vec2 | null {
  const dx = origin.x - rock.x;
  const dy = origin.y - rock.y;
  if (Math.hypot(dx, dy) > rock.radius + maxLength) return null;

  const cos = Math.cos(rock.rotation);
  const sin = Math.sin(rock.rotation);
  const length = Math.hypot(direction.x, direction.y) || 1;
  const dirX = direction.x / length;
  const dirY = direction.y / length;
  // Into the collider's local frame.
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const localDirX = dirX * cos + dirY * sin;
  const localDirY = -dirX * sin + dirY * cos;

  const clockwise = signedArea(rock.points) > 0;
  let enter = 0;
  let exit = maxLength;
  for (let index = 0; index < rock.points.length; index += 1) {
    const a = rock.points[index]!;
    const b = rock.points[(index + 1) % rock.points.length]!;
    const normal = edgeNormal(a, b, clockwise);
    const offset = normal.x * (localX - a.x) + normal.y * (localY - a.y);
    const denominator = normal.x * localDirX + normal.y * localDirY;
    if (Math.abs(denominator) < 1e-9) {
      if (offset > 0) return null;
      continue;
    }
    const t = -offset / denominator;
    if (denominator > 0) {
      exit = Math.min(exit, t);
    } else {
      enter = Math.max(enter, t);
    }
    if (enter > exit) return null;
  }
  if (enter < 0) return null;
  if (enter > maxLength) return null;
  return { x: origin.x + dirX * enter, y: origin.y + dirY * enter };
}

/** Does the segment touch the rotated convex collider? Fast circle pass first. */
export function segmentPolygonHit(a: Vec2, b: Vec2, rock: AsteroidCollider): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 1e-9) {
    t = ((rock.x - a.x) * dx + (rock.y - a.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const px = a.x + dx * t - rock.x;
  const py = a.y + dy * t - rock.y;
  if (px * px + py * py > rock.radius * rock.radius) return false;

  const cos = Math.cos(rock.rotation);
  const sin = Math.sin(rock.rotation);
  const toLocal = (point: Vec2): Vec2 => {
    const ox = point.x - rock.x;
    const oy = point.y - rock.y;
    return { x: ox * cos + oy * sin, y: -ox * sin + oy * cos };
  };
  const localA = toLocal(a);
  const localB = toLocal(b);
  if (pointInConvex(rock.points, localA) || pointInConvex(rock.points, localB)) return true;

  for (let index = 0; index < rock.points.length; index += 1) {
    const p = rock.points[index]!;
    const q = rock.points[(index + 1) % rock.points.length]!;
    if (segmentsIntersect(localA, localB, p, q)) return true;
  }
  return false;
}

/** Point-in-convex-polygon test. */
export function pointInConvex(points: readonly Vec2[], point: Vec2): boolean {
  const clockwise = signedArea(points) > 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (clockwise ? cross < 0 : cross > 0) return false;
  }
  return true;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) || d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0;
}

/** Outward surface normal at (or nearest to) a world point on a collider. */
export function polygonHitNormal(rock: AsteroidCollider, point: Vec2): Vec2 {
  const cos = Math.cos(rock.rotation);
  const sin = Math.sin(rock.rotation);
  const ox = point.x - rock.x;
  const oy = point.y - rock.y;
  const local = { x: ox * cos + oy * sin, y: -ox * sin + oy * cos };
  const clockwise = signedArea(rock.points) > 0;

  let bestDistance = Infinity;
  let bestNormal: Vec2 = { x: 1, y: 0 };
  for (let index = 0; index < rock.points.length; index += 1) {
    const a = rock.points[index]!;
    const b = rock.points[(index + 1) % rock.points.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    let t =
      lengthSquared > 1e-9 ? ((local.x - a.x) * dx + (local.y - a.y) * dy) / lengthSquared : 0;
    t = Math.max(0, Math.min(1, t));
    const distance = Math.hypot(local.x - (a.x + dx * t), local.y - (a.y + dy * t));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNormal = edgeNormal(a, b, clockwise);
    }
  }
  return { x: bestNormal.x * cos - bestNormal.y * sin, y: bestNormal.x * sin + bestNormal.y * cos };
}
