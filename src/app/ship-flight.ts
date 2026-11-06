/** Ramped arcade flight: small forces, capped speeds, drag only while thrusting. */

export interface FlightControls {
  forward: boolean;
  reverse: boolean;
  turnLeft: boolean;
  turnRight: boolean;
}

export interface FlightTuning {
  forwardAccel: number;
  reverseAccel: number;
  angularAccel: number;
  linearDrag: number;
  angularDrag: number;
  inputRampSeconds: number;
}

export const DEFAULT_FLIGHT_TUNING: FlightTuning = {
  forwardAccel: 560,
  reverseAccel: 300,
  angularAccel: 4.8,
  linearDrag: 1.7,
  angularDrag: 2.4,
  inputRampSeconds: 0.3,
};

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

export function stepFlight(
  state: FlightState,
  controls: FlightControls,
  dt: number,
  tuning: FlightTuning = DEFAULT_FLIGHT_TUNING,
): void {
  if (dt <= 0) return;

  const linearTarget = controls.forward ? 1 : controls.reverse ? -1 : 0;
  const angularTarget = controls.turnRight ? 1 : controls.turnLeft ? -1 : 0;
  const rampSeconds = Math.max(tuning.inputRampSeconds, 0.0001);
  const maxInputStep = dt / rampSeconds;

  state.linearInput = moveTowards(state.linearInput, linearTarget, maxInputStep);
  state.angularInput = moveTowards(state.angularInput, angularTarget, maxInputStep);

  // W is deliberately stronger than S.
  const thrust = state.linearInput >= 0 ? tuning.forwardAccel : tuning.reverseAccel;
  const forwardX = Math.sin(state.rotation);
  const forwardY = -Math.cos(state.rotation);
  state.vx += forwardX * thrust * state.linearInput * dt;
  state.vy += forwardY * thrust * state.linearInput * dt;
  state.angularVelocity += state.angularInput * tuning.angularAccel * dt;

  // Drag only while the corresponding input is non-zero; with a positive drag
  // the thrust/drag ratio sets a finite terminal speed. Once the input ramps
  // back to zero the ship coasts on its momentum.
  if (state.linearInput !== 0) {
    const drag = Math.exp(-tuning.linearDrag * dt);
    state.vx *= drag;
    state.vy *= drag;
  }
  if (state.angularInput !== 0) {
    state.angularVelocity *= Math.exp(-tuning.angularDrag * dt);
  }

  state.rotation += state.angularVelocity * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
}
