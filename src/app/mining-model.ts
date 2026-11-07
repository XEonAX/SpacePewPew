export interface Vec2 {
  x: number;
  y: number;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Molten metal cools and slows the longer it drifts: an exponential decay of
 * velocity, so a fresh chunk is fast but settles instead of sailing forever.
 */
export function dampVelocity(velocity: Vec2, dampingPerSecond: number, dt: number): Vec2 {
  const decay = Math.exp(-Math.max(0, dampingPerSecond) * Math.max(0, dt));
  return { x: velocity.x * decay, y: velocity.y * decay };
}

function unit(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: v.x / length, y: v.y / length };
}

/**
 * Mirror an incoming direction about a surface normal. Molten metal leaves the
 * asteroid along this direction, so it flies off at the laser's reflection angle.
 */
export function reflectDirection(direction: Vec2, normal: Vec2): Vec2 {
  const d = unit(direction);
  const n = unit(normal);
  const dot = d.x * n.x + d.y * n.y;
  return { x: d.x - 2 * dot * n.x, y: d.y - 2 * dot * n.y };
}

/**
 * First intersection of a ray with a circle, or `null` when the ray misses or
 * the circle sits beyond `length`. Used to decide whether a mining laser has
 * bitten the asteroid.
 */
export function rayCircleHit(
  origin: Vec2,
  direction: Vec2,
  length: number,
  centre: Vec2,
  radius: number,
): Vec2 | null {
  if (radius <= 0 || length <= 0) return null;
  const d = unit(direction);
  const ox = origin.x - centre.x;
  const oy = origin.y - centre.y;
  const b = ox * d.x + oy * d.y;
  const c = ox * ox + oy * oy - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  let t = -b - root;
  if (t < 0) t = -b + root;
  if (t < 0 || t > length) return null;
  return { x: origin.x + d.x * t, y: origin.y + d.y * t };
}

export interface CarryOptions {
  /** Metres per second each tractor beam adds while carrying. */
  speedPerBeam: number;
  /** Hard cap on the carried speed, however many beams are on the chunk. */
  maxSpeed: number;
  /** Final-approach easing distance in metres (0 = no easing at all). */
  easeDistance?: number;
  /** Fraction of carry speed kept right at the hatch (1 = no slowdown). */
  easeFloor?: number;
  /** Distance at which the chunk counts as delivered (metres). */
  arriveDistance?: number;
}

export interface CarryResult {
  x: number;
  y: number;
  arrived: boolean;
}

export interface SteerOptions {
  /** Cap on how hard the tractor can push or brake, in m/s². */
  maxAccel: number;
  /** Cap on the chunk's speed relative to the ship, in m/s. */
  maxSpeed: number;
  /** Seconds the tractor aims to need for the remaining distance. */
  arrivalSeconds: number;
}

/**
 * Physics-flavoured alternative to `carryToward`: treat the chunk as a real
 * mass and steer it with a bounded acceleration, so it eases in under its own
 * momentum instead of being snapped along a line.
 */
export function steerToward(
  position: Vec2,
  target: Vec2,
  velocity: Vec2,
  dt: number,
  options: SteerOptions,
): Vec2 {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dist = Math.hypot(dx, dy);
  const arrival = Math.max(options.arrivalSeconds, 1e-3);
  const desiredSpeed = Math.min(options.maxSpeed, dist / arrival);
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 0;

  let dvx = dirX * desiredSpeed - velocity.x;
  let dvy = dirY * desiredSpeed - velocity.y;
  const change = Math.hypot(dvx, dvy);
  const maxChange = Math.max(0, options.maxAccel) * Math.max(0, dt);
  if (change > maxChange && change > 0) {
    const scale = maxChange / change;
    dvx *= scale;
    dvy *= scale;
  }
  return { x: velocity.x + dvx, y: velocity.y + dvy };
}

/**
 * Fake tractor carry: slide a gripped chunk straight at the hatch. It is not a
 * physics force — the chunk is translated toward the target at full carry speed
 * and only eases over the last short stretch, so delivery stays snappy instead
 * of crawling in. The step never exceeds the remaining distance, so a chunk
 * cannot overshoot or be flung past the intake.
 */
export function carryToward(
  position: Vec2,
  target: Vec2,
  dt: number,
  beams: number,
  options: CarryOptions,
): CarryResult {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: target.x, y: target.y, arrived: true };

  const beamSpeed = Math.min(options.maxSpeed, Math.max(0, beams) * options.speedPerBeam);
  const easeDistance = Math.max(0, options.easeDistance ?? 0);
  const easeFloor = Math.min(1, Math.max(0, options.easeFloor ?? 1));
  const ease =
    easeDistance > 0 && dist < easeDistance
      ? easeFloor + (1 - easeFloor) * (dist / easeDistance)
      : 1;
  const step = Math.min(dist, beamSpeed * ease * Math.max(0, dt));
  return {
    x: position.x + (dx / dist) * step,
    y: position.y + (dy / dist) * step,
    arrived: step >= dist,
  };
}

/** Point-in-rectangle test for a rectangle rotated with the ship. */
export function pointInRotatedRect(
  point: Vec2,
  centre: Vec2,
  rotation: number,
  halfWidth: number,
  halfHeight: number,
): boolean {
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight;
}

export interface ArcOptions {
  /** Metres per second each tractor beam adds while carrying. */
  speedPerBeam: number;
  /** Hard cap on the carried speed, however many beams are on the chunk. */
  maxSpeed: number;
  /** Radar/s of heading change the tractor allows, so the barrel can follow. */
  maxTurnRate: number;
  /** Final-approach easing distance in metres (0 = no easing). */
  easeDistance?: number;
  /** Fraction of carry speed kept right at the hatch (1 = no slowdown). */
  easeFloor?: number;
  /** Distance at which the chunk counts as delivered (metres). */
  arriveDistance?: number;
}

export interface ArcResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  arrived: boolean;
}

/**
 * Curved tractor carry. The chunk is pulled toward the hatch but its heading
 * only rotates at `maxTurnRate`, and its speed is limited by how far it is from
 * the hatch, so the arc stays inside what a tractor barrel can physically track.
 * The step never exceeds the remaining distance, so it still cannot overshoot.
 */
export function arcToward(
  position: Vec2,
  target: Vec2,
  velocity: Vec2,
  dt: number,
  beams: number,
  options: ArcOptions,
): ArcResult {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dt <= 0) {
    return { x: target.x, y: target.y, vx: 0, vy: 0, arrived: true };
  }

  const desired = { x: dx / dist, y: dy / dist };
  const speedNow = Math.hypot(velocity.x, velocity.y);
  let heading = speedNow > 0.05 ? { x: velocity.x / speedNow, y: velocity.y / speedNow } : desired;

  const maxTurn = Math.max(0, options.maxTurnRate) * dt;
  const cross = heading.x * desired.y - heading.y * desired.x;
  const dot = Math.max(-1, Math.min(1, heading.x * desired.x + heading.y * desired.y));
  const turn = Math.max(-maxTurn, Math.min(maxTurn, Math.atan2(cross, dot)));
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  heading = { x: heading.x * cos - heading.y * sin, y: heading.x * sin + heading.y * cos };

  const beamSpeed = Math.min(options.maxSpeed, Math.max(0, beams) * options.speedPerBeam);
  const easeDistance = Math.max(0, options.easeDistance ?? 0);
  const easeFloor = Math.min(1, Math.max(0, options.easeFloor ?? 1));
  const ease =
    easeDistance > 0 && dist < easeDistance
      ? easeFloor + (1 - easeFloor) * (dist / easeDistance)
      : 1;
  // Cap the speed by the turn rate so the chunk never swings round the hull
  // faster than the tractor barrel can rotate toward it. Keep a margin below
  // the orbital rate, otherwise the chunk would circle the hatch forever.
  const orbitLimit = Math.max(0, options.maxTurnRate) * dist * 0.7;
  const speed = Math.min(beamSpeed * ease, orbitLimit);
  const arriveDistance = Math.max(0, options.arriveDistance ?? 0.05);
  const step = Math.min(dist, speed * dt);
  const arrived = dist <= Math.max(step, arriveDistance);

  return {
    x: arrived ? target.x : position.x + heading.x * step,
    y: arrived ? target.y : position.y + heading.y * step,
    vx: arrived ? 0 : heading.x * speed,
    vy: arrived ? 0 : heading.y * speed,
    arrived,
  };
}
