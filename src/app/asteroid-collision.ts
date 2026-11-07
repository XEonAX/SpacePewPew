/**
 * Circle/capsule colliders for the asteroid and the ship. The asteroid art is
 * roughly circular, so one circle fits it far better than its rectangular
 * bounds; the ship is a long hull, so its collider is a capsule down the centre
 * line — the same capsule the ship's energy shield draws.
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

/** Ship shield/collider proportions, in ship-texture pixels. */
export interface ShipCapsule {
  /** Half the length of the capsule's straight section, along the hull axis. */
  halfLength: number;
  /** Radius of the capsule's round caps. */
  radius: number;
}

/**
 * The shield hugs the hull body: wide enough to enclose the wings' root and
 * running from just past the nose to just past the engines.
 */
export function shipCapsule(width: number, height: number): ShipCapsule {
  return { halfLength: height * 0.3, radius: width * 0.38 };
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

/**
 * Push the ship's capsule out of a static circle and bounce the component of
 * its velocity heading into it. Tangential velocity is unaffected, so glancing
 * hits slide along the rock instead of stopping dead.
 *
 * The capsule axis follows the hull: a local +Y offset points at the tail, the
 * same convention the ship mesh and shield are drawn with.
 */
export function resolveShipCollision(
  ship: ShipPose,
  capsule: ShipCapsule,
  circle: Circle,
  restitution: number,
): ShipCollision {
  const cos = Math.cos(ship.rotation);
  const sin = Math.sin(ship.rotation);
  // Unit vector along the hull's forward axis: local (0, 1) rotated by `ship.rotation`.
  const axisX = -sin;
  const axisY = cos;

  // Closest point on the capsule's centre line to the rock's centre.
  const toShipX = circle.x - ship.x;
  const toShipY = circle.y - ship.y;
  const along = toShipX * axisX + toShipY * axisY;
  const clamped = Math.max(-capsule.halfLength, Math.min(capsule.halfLength, along));
  const closestX = ship.x + axisX * clamped;
  const closestY = ship.y + axisY * clamped;

  const dx = closestX - circle.x;
  const dy = closestY - circle.y;
  const distance = Math.hypot(dx, dy);
  const minimum = capsule.radius + circle.radius;

  if (distance >= minimum) {
    return {
      x: ship.x,
      y: ship.y,
      vx: ship.vx,
      vy: ship.vy,
      hit: false,
      impactSpeed: 0,
      contactX: ship.x,
      contactY: ship.y,
    };
  }

  // Normal points from the rock to the hull's surface.
  const nx = distance > 1e-6 ? dx / distance : 1;
  const ny = distance > 1e-6 ? dy / distance : 0;
  const penetration = minimum - distance;

  const inward = ship.vx * nx + ship.vy * ny;
  let vx = ship.vx;
  let vy = ship.vy;
  let impactSpeed = 0;
  if (inward < 0) {
    impactSpeed = -inward;
    vx -= (1 + restitution) * inward * nx;
    vy -= (1 + restitution) * inward * ny;
  }

  return {
    x: ship.x + nx * penetration,
    y: ship.y + ny * penetration,
    vx,
    vy,
    hit: true,
    impactSpeed,
    // Where the shield touches the rock once the ship has been pushed clear:
    // the hull's near surface, offset by the separation.
    contactX: closestX + nx * (penetration - capsule.radius),
    contactY: closestY + ny * (penetration - capsule.radius),
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
