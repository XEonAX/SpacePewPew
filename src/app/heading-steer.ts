/**
 * Gamepad heading control: the left stick points where the nose should go, and
 * this PD loop converts the heading error + current yaw rate into a turn input.
 * Feeds FlightControls.turnAxis, so it still goes through the flight ramp.
 */
export const HEADING_TURN_GAIN = 2.2;
export const HEADING_RATE_GAIN = 0.55;
export const HEADING_DEADBAND_RAD = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Direction the stick points, as a ship heading: stick up is nose-up (rotation
 * 0), stick right is nose-right (positive rotation).
 */
export function headingFromStick(x: number, y: number): number {
  return Math.atan2(x, -y);
}

/**
 * Turn input -1..1. Positive = turn right. The derivative term damps the spin
 * so the ship settles on the stick direction without a large overshoot.
 */
export function headingTurnInput(
  stickX: number,
  stickY: number,
  rotation: number,
  angularVelocity: number,
): number {
  if (Math.hypot(stickX, stickY) < 0.05) return 0;
  const error = wrapAngle(headingFromStick(stickX, stickY) - rotation);
  if (Math.abs(error) < HEADING_DEADBAND_RAD && Math.abs(angularVelocity) < 0.05) return 0;
  return clamp(error * HEADING_TURN_GAIN - angularVelocity * HEADING_RATE_GAIN, -1, 1);
}
