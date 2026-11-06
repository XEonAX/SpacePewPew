export interface TurretAimState {
  angle: number;
  angularVelocity: number;
}

export const TURRET_MAX_ANGULAR_SPEED = 5.5;
export const TURRET_ANGULAR_ACCEL = 24;
export const TURRET_ANGULAR_DAMPING = 7;
const AIM_GAIN = 42;

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function isAngleInArc(angle: number, centerAngle: number, halfAngle: number): boolean {
  const limit = Math.max(0, Math.min(Math.PI, halfAngle));
  return Math.abs(wrapAngle(angle - centerAngle)) <= limit + 1e-9;
}

export function clampAngleToArc(
  targetAngle: number,
  centerAngle: number,
  halfAngle: number,
): number {
  const limit = Math.max(0, Math.min(Math.PI, halfAngle));
  const offset = wrapAngle(targetAngle - centerAngle);
  const clamped = Math.max(-limit, Math.min(limit, offset));
  return wrapAngle(centerAngle + clamped);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Angular spring-damper toward a target, with a hard finite turn-speed cap. */
export function stepTurretAim(state: TurretAimState, targetAngle: number, dt: number): void {
  if (dt <= 0) return;

  const error = wrapAngle(targetAngle - state.angle);
  const acceleration = clamp(error * AIM_GAIN, -TURRET_ANGULAR_ACCEL, TURRET_ANGULAR_ACCEL);

  state.angularVelocity += acceleration * dt;
  state.angularVelocity *= Math.exp(-TURRET_ANGULAR_DAMPING * dt);
  state.angularVelocity = clamp(
    state.angularVelocity,
    -TURRET_MAX_ANGULAR_SPEED,
    TURRET_MAX_ANGULAR_SPEED,
  );
  state.angle = wrapAngle(state.angle + state.angularVelocity * dt);
}

/**
 * Aim at a target only while it is inside this mount's arc. Outside the arc
 * the turret holds its current aim, so opposite-side turrets do not sweep as
 * the mouse passes on the other side of the ship.
 */
export function stepTurretAimInArc(
  state: TurretAimState,
  targetAngle: number,
  centerAngle: number,
  halfAngle: number,
  dt: number,
): void {
  if (!isAngleInArc(targetAngle, centerAngle, halfAngle)) {
    state.angularVelocity = 0;
    return;
  }

  stepTurretAim(state, targetAngle, dt);

  const bounded = clampAngleToArc(state.angle, centerAngle, halfAngle);
  if (Math.abs(wrapAngle(bounded - state.angle)) > 1e-9) {
    state.angle = bounded;
    state.angularVelocity = 0;
  }
}
