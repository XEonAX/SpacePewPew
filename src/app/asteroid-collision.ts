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

/** Separating-axis overlap between a convex piece and the rounded ship hull. */
interface PieceHit {
  penetration: number;
  normal: Vec2;
}

function hullAgainstPiece(
  piece: readonly Vec2[],
  pieceCentre: Vec2,
  shipPoints: readonly Vec2[],
  shipCentre: Vec2,
  radius: number,
): PieceHit | null {
  const axes: Vec2[] = [];
  const collect = (points: readonly Vec2[]): void => {
    const clockwise = signedArea(points) > 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index]!;
      const b = points[(index + 1) % points.length]!;
      axes.push(edgeNormal(a, b, clockwise));
    }
  };
  collect(piece);
  collect(shipPoints);

  let best: PieceHit | null = null;
  for (const axis of axes) {
    const pieceInterval = projectPolygon(piece, axis);
    const shipInterval = projectPolygon(shipPoints, axis);
    const overlap = Math.min(
      pieceInterval.max - (shipInterval.min - radius),
      shipInterval.max + radius - pieceInterval.min,
    );
    if (overlap <= 0) return null;
    if (!best || overlap < best.penetration) {
      const towardRock =
        (pieceCentre.x - shipCentre.x) * axis.x + (pieceCentre.y - shipCentre.y) * axis.y >= 0
          ? 1
          : -1;
      best = { penetration: overlap, normal: { x: axis.x * towardRock, y: axis.y * towardRock } };
    }
  }
  return best;
}

function segmentCrosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) || d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0;
}

/**
 * Point-in-polygon (even-odd), so concave silhouettes — notches, deep bites —
 * are handled properly instead of being bridged.
 */
export function pointInPolygon(points: readonly Vec2[], point: Vec2): boolean {
  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index, index += 1
  ) {
    const a = points[index]!;
    const b = points[previous]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

interface FanTriangle {
  points: Vec2[];
  centre: Vec2;
}

/**
 * Fan triangles around the outline's centre. The silhouette polygon is
 * radially star-shaped, so the fan is a valid compound decomposition: together
 * the triangles cover the real concave shape, unlike one convex hull.
 */
export function fanTriangles(points: readonly Vec2[]): FanTriangle[] {
  const triangles: FanTriangle[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    triangles.push({
      points: [{ x: 0, y: 0 }, a, b],
      centre: { x: (a.x + b.x) / 3, y: (a.y + b.y) / 3 },
    });
  }
  return triangles;
}

/** Local fan triangles of a collider, in world space. */
function worldFan(rock: AsteroidCollider): FanTriangle[] {
  const cos = Math.cos(rock.rotation);
  const sin = Math.sin(rock.rotation);
  return fanTriangles(rock.points).map((triangle) => ({
    points: triangle.points.map((point) => ({
      x: rock.x + point.x * cos - point.y * sin,
      y: rock.y + point.x * sin + point.y * cos,
    })),
    centre: {
      x: rock.x + triangle.centre.x * cos - triangle.centre.y * sin,
      y: rock.y + triangle.centre.x * sin + triangle.centre.y * cos,
    },
  }));
}

/**
 * Collide the ship's rounded hull polygon with an asteroid compound collider.
 *
 * Fast pass: bounding circles. Accurate pass: the silhouette is decomposed into
 * fan triangles, so concave notches are respected; each triangle does a
 * separating-axis test against the ship hull inflated by its bubble radius, and
 * the deepest contact drives the impulse response (mass/inertia, restitution,
 * Coulomb friction, off-centre spin).
 */
export function resolveShipCollision(
  ship: ShipPose,
  hull: ShipHull,
  rock: AsteroidCollider,
  body: ShipBody,
): ShipCollision {
  const centreDistance = Math.hypot(rock.x - ship.x, rock.y - ship.y);
  if (centreDistance > rock.radius + shipBoundingRadius(hull)) return noHit(ship);

  const cos = Math.cos(ship.rotation);
  const sin = Math.sin(ship.rotation);
  const shipPoints = hull.points.map((point) => rotatedPoint(point, ship, cos, sin));
  const radius = hull.radius;

  let best: PieceHit | null = null;
  for (const triangle of worldFan(rock)) {
    const hit = hullAgainstPiece(triangle.points, triangle.centre, shipPoints, ship, radius);
    if (hit && (!best || hit.penetration > best.penetration)) best = hit;
  }
  if (!best) return noHit(ship);

  const { penetration, normal } = best;
  // Separate: the normal points at the rock, so the ship moves the other way.
  const x = ship.x - normal.x * penetration;
  const y = ship.y - normal.y * penetration;

  // Contact patch: the hull point furthest toward the rock, plus the bubble.
  let support = shipPoints[0]!;
  let bestSupport = -Infinity;
  for (const point of shipPoints) {
    const value = point.x * normal.x + point.y * normal.y;
    if (value > bestSupport) {
      bestSupport = value;
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

/** Clip a ray against one convex piece; returns entry distance or null. */
function clipConvex(
  points: readonly Vec2[],
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxLength: number,
): number | null {
  const clockwise = signedArea(points) > 0;
  let enter = 0;
  let exit = maxLength;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const normal = edgeNormal(a, b, clockwise);
    const offset = normal.x * (originX - a.x) + normal.y * (originY - a.y);
    const denominator = normal.x * dirX + normal.y * dirY;
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
  return enter >= 0 && enter <= maxLength ? enter : null;
}

/**
 * Nearest point where a ray enters a rotated collider, or null. Fast pass uses
 * the bounding circle; the accurate pass clips against the fan triangles.
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

  let best = Infinity;
  for (const triangle of fanTriangles(rock.points)) {
    const t = clipConvex(triangle.points, localX, localY, localDirX, localDirY, maxLength);
    if (t !== null && t < best) best = t;
  }
  if (!Number.isFinite(best)) return null;
  return { x: origin.x + dirX * best, y: origin.y + dirY * best };
}

/** Does the segment touch the rotated collider? Circle fast pass, then edges. */
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
  if (pointInPolygon(rock.points, localA) || pointInPolygon(rock.points, localB)) return true;

  for (let index = 0; index < rock.points.length; index += 1) {
    const p = rock.points[index]!;
    const q = rock.points[(index + 1) % rock.points.length]!;
    if (segmentCrosses(localA, localB, p, q)) return true;
  }
  return false;
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
