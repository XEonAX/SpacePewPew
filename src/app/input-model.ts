/** Pure mapping helpers shared by keyboard, gamepad and touch input. */

export interface StickReading {
  /** Deadzoned, rescaled axes in -1..1. */
  x: number;
  y: number;
  /** Magnitude after the deadzone, 0..1. */
  magnitude: number;
}

const clampAxis = (value: number): number => Math.max(-1, Math.min(1, value));

/** Rescale one axis so the deadzone edge maps to 0 and the limit maps to 1. */
export function applyDeadzone(value: number, deadzone: number): number {
  const limit = Math.max(0, Math.min(0.95, deadzone));
  const magnitude = Math.abs(value);
  if (magnitude <= limit) return 0;
  return Math.sign(value) * clampAxis((magnitude - limit) / (1 - limit));
}

/** Read a stick pair, with radial deadzone so diagonals stay symmetric. */
export function readStick(x: number, y: number, deadzone = 0.18): StickReading {
  const magnitude = Math.hypot(x, y);
  const limit = Math.max(0, Math.min(0.95, deadzone));
  if (magnitude <= limit) return { x: 0, y: 0, magnitude: 0 };
  const scale = (Math.min(1, magnitude) - limit) / (1 - limit) / magnitude;
  const scaledX = clampAxis(x * scale);
  const scaledY = clampAxis(y * scale);
  return {
    x: scaledX,
    y: scaledY,
    magnitude: Math.hypot(scaledX, scaledY),
  };
}

/**
 * Vertical stick axis to thrust: sticks report up as -1, the ship treats
 * positive thrust as forward.
 */
export function thrustFromStick(y: number, deadzone = 0.18): number {
  return applyDeadzone(-y, deadzone);
}

/** Convert a right-stick direction into an off-ship screen aim point. */
export function aimPointFromStick(
  shipScreenX: number,
  shipScreenY: number,
  directionX: number,
  directionY: number,
  reachPx: number,
): { x: number; y: number } {
  const magnitude = Math.hypot(directionX, directionY);
  if (magnitude < 1e-4) return { x: shipScreenX, y: shipScreenY };
  return {
    x: shipScreenX + (directionX / magnitude) * Math.max(0, reachPx),
    y: shipScreenY + (directionY / magnitude) * Math.max(0, reachPx),
  };
}

/** Zoom factor for a wheel event; matches the previous background wheel feel. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  return Math.exp(-deltaY * (deltaMode === 1 ? 0.032 : 0.002));
}
