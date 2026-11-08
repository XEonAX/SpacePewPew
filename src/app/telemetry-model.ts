/** Standard gravity, m/s². */
export const STANDARD_GRAVITY = 9.80665;

/**
 * Convert a velocity change over a frame into g-force. Used by the telemetry
 * overlay to show the actual acceleration the hull sees, including collisions.
 */
export function gForceFromVelocityDelta(deltaVx: number, deltaVy: number, dt: number): number {
  if (!(dt > 0)) return 0;
  return Math.hypot(deltaVx, deltaVy) / dt / STANDARD_GRAVITY;
}

export function formatG(value: number): string {
  return `${value.toFixed(2)} g`;
}

export function formatEnergyJ(joules: number): string {
  if (joules >= 1_000_000) return `${(joules / 1_000_000).toFixed(2)} MJ`;
  if (joules >= 1_000) return `${(joules / 1_000).toFixed(1)} kJ`;
  return `${Math.round(joules)} J`;
}
