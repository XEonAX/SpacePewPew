/** Ramped arcade flight: small forces, capped speeds, drag only while thrusting. */

export interface FlightControls {
  forward: boolean;
  reverse: boolean;
  turnLeft: boolean;
  turnRight: boolean;
}

export interface FlightState {
  /** World position in screen pixels at zoom 1, relative to the viewport center. */
  x: number;
  y: number;
  rotation: number;
  vx: number;
  vy: number;
  angularVelocity: number;
  /** Ramped input, -1..1. */
  linearInput: number;
  /** Ramped input, -1..1. */
  angularInput: number;
}

export const INPUT_RAMP_SECONDS = 0.3;
export const MAX_LINEAR_SPEED = 360;
export const MAX_ANGULAR_SPEED = 2.2;

const FORWARD_ACCEL = 560;
const REVERSE_ACCEL = 300;
const ANGULAR_ACCEL = 4.8;
const LINEAR_DRAG = 1.7;
const ANGULAR_DRAG = 2.4;

function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

export function createFlightState(x = 0, y = 0, rotation = 0): FlightState {
  return {
    x,
    y,
    rotation,
    vx: 0,
    vy: 0,
    angularVelocity: 0,
    linearInput: 0,
    angularInput: 0,
  };
}

export function stepFlight(state: FlightState, controls: FlightControls, dt: number): void {
  if (dt <= 0) return;

  const linearTarget = controls.forward ? 1 : controls.reverse ? -1 : 0;
  const angularTarget = controls.turnRight ? 1 : controls.turnLeft ? -1 : 0;
  const maxInputStep = dt / INPUT_RAMP_SECONDS;

  state.linearInput = moveTowards(state.linearInput, linearTarget, maxInputStep);
  state.angularInput = moveTowards(state.angularInput, angularTarget, maxInputStep);

  // W is deliberately stronger than S.
  const thrust = state.linearInput >= 0 ? FORWARD_ACCEL : REVERSE_ACCEL;
  const forwardX = Math.sin(state.rotation);
  const forwardY = -Math.cos(state.rotation);
  state.vx += forwardX * thrust * state.linearInput * dt;
  state.vy += forwardY * thrust * state.linearInput * dt;
  state.angularVelocity += state.angularInput * ANGULAR_ACCEL * dt;

  // Drag only while the corresponding input is non-zero. Once it ramps back to
  // zero the ship coasts; velocity caps below keep that finite.
  if (state.linearInput !== 0) {
    const drag = Math.exp(-LINEAR_DRAG * dt);
    state.vx *= drag;
    state.vy *= drag;
  }
  if (state.angularInput !== 0) {
    state.angularVelocity *= Math.exp(-ANGULAR_DRAG * dt);
  }

  const speed = Math.hypot(state.vx, state.vy);
  if (speed > MAX_LINEAR_SPEED) {
    const scale = MAX_LINEAR_SPEED / speed;
    state.vx *= scale;
    state.vy *= scale;
  }
  state.angularVelocity = Math.max(
    -MAX_ANGULAR_SPEED,
    Math.min(MAX_ANGULAR_SPEED, state.angularVelocity),
  );

  state.rotation += state.angularVelocity * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
}
