export interface Vec2 {
  x: number;
  y: number;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
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

export interface MoveTowardResult {
  x: number;
  y: number;
  arrived: boolean;
}

/** Ease a point toward a target at a capped speed; `arrived` means it reached it. */
export function moveToward(
  position: Vec2,
  target: Vec2,
  speed: number,
  dt: number,
): MoveTowardResult {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(0, speed) * Math.max(0, dt);
  if (dist === 0 || dist <= step) return { x: target.x, y: target.y, arrived: true };
  return {
    x: position.x + (dx / dist) * step,
    y: position.y + (dy / dist) * step,
    arrived: false,
  };
}
