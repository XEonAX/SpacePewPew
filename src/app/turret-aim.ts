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
