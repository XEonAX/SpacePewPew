/**
 * Mass-based arcade flight in metres. The hull is a rigid body: every nozzle
 * pushes a thrust force at its real position, so differential throttle (W/S
 * plus A/D through the engine mix) yaws the hull as genuine torque, and a
 * heavier ship accelerates and turns more slowly for the same thrust.
 *
 * Damping is a velocity multiplier applied while any input is active — the
 * same rule Unity/Box2D use for drag, and deliberately not a force, so mass
 * does not change the decay rate.
 */
import { computeEngineOutputs } from './engine-mix';
import type { ShipGeometry } from './ship-engines';

export interface FlightControls {
  forward: boolean;
  reverse: boolean;
  turnLeft: boolean;
  turnRight: boolean;
}

export interface FlightTuning {
  /** Ship mass, kg. */
  massKg: number;
  /** Thrust of one main engine at full output, newtons. */
  mainThrustN: number;
  /** Thrust of one reverse engine at full output, newtons. */
  reverseThrustN: number;
  /** Velocity damping rate while any input is active, 1/s. */
  linearDrag: number;
  /** Angular damping rate while any input is active, 1/s. */
  angularDrag: number;
  /** Seconds for a ramped input to travel the full -1..1 range. */
  inputRampSeconds: number;
}

export const DEFAULT_FLIGHT_TUNING: FlightTuning = {
  massKg: 24_000,
  mainThrustN: 120_000,
  reverseThrustN: 120_000,
  linearDrag: 0.32,
  angularDrag: 1.5,
  inputRampSeconds: 0.3,
};

export interface FlightState {
  /** World position in metres at zoom 1, relative to the viewport center. */
  x: number;
  y: number;
  rotation: number;
  /** Velocity in metres per second. */
  vx: number;
  vy: number;
  angularVelocity: number;
  /** Ramped input, -1..1. */
  linearInput: number;
  /** Ramped input, -1..1. */
  angularInput: number;
}

/** Body-frame force and torque from the engine mix at the given ramped inputs. */
export interface EngineWrench {
  /** Body-frame force, newtons (y down; negative is forward). */
  forceX: number;
  forceY: number;
  /** Torque about the centre of mass, N·m (positive = nose right). */
  torque: number;
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

/** Moment of inertia about the centre of mass, kg·m². */
export function shipInertiaKgM2(tuning: FlightTuning, geometry: ShipGeometry): number {
  const mass = Math.max(tuning.massKg, 0.001);
  return mass * geometry.radiusOfGyrationM ** 2;
}

/**
 * Sum each nozzle's ramped thrust into a body-frame force and torque. The
 * engine mix turns the ramped linear/angular inputs into per-nozzle outputs;
 * this is the single place where input becomes force.
 */
export function engineWrench(
  linearInput: number,
  angularInput: number,
  tuning: FlightTuning,
  geometry: ShipGeometry,
): EngineWrench {
  const mix = computeEngineOutputs(linearInput, angularInput);
  let forceX = 0;
  let forceY = 0;
  let torque = 0;

  for (const engine of geometry.engines) {
    const outputs = engine.group === 'main' ? mix.main : mix.reverse;
    const output = outputs[engine.index] ?? 0;
    if (output <= 0) continue;

    const maxThrust = engine.group === 'main' ? tuning.mainThrustN : tuning.reverseThrustN;
    const thrust = maxThrust * output;
    const thrustX = engine.dirX * thrust;
    const thrustY = engine.dirY * thrust;
    forceX += thrustX;
    forceY += thrustY;
    // 2D cross product r × F about the centre of mass.
    torque += engine.x * thrustY - engine.y * thrustX;
  }

  return { forceX, forceY, torque };
}

function groupThrustN(
  tuning: FlightTuning,
  geometry: ShipGeometry,
  group: 'main' | 'reverse',
): number {
  let total = 0;
  for (const engine of geometry.engines) {
    if (engine.group !== group) continue;
    total += group === 'main' ? tuning.mainThrustN : tuning.reverseThrustN;
  }
  return total;
}

/** Forward terminal speed from all main engines at full thrust vs linear drag. */
export function forwardTerminalSpeed(tuning: FlightTuning, geometry: ShipGeometry): number {
  const mass = Math.max(tuning.massKg, 0.001);
  const drag = Math.max(tuning.linearDrag, 0.0001);
  return groupThrustN(tuning, geometry, 'main') / mass / drag;
}

/** Reverse terminal speed from both reverse engines at full thrust vs drag. */
export function reverseTerminalSpeed(tuning: FlightTuning, geometry: ShipGeometry): number {
  const mass = Math.max(tuning.massKg, 0.001);
  const drag = Math.max(tuning.linearDrag, 0.0001);
  return groupThrustN(tuning, geometry, 'reverse') / mass / drag;
}

/** Torque produced by a full-turn input with no throttle (pure yaw). */
export function yawTorqueNm(tuning: FlightTuning, geometry: ShipGeometry): number {
  return Math.abs(engineWrench(0, 1, tuning, geometry).torque);
}

/** Yaw rate at full turn input where thruster torque balances angular drag. */
export function yawTerminalSpeed(tuning: FlightTuning, geometry: ShipGeometry): number {
  const inertia = Math.max(shipInertiaKgM2(tuning, geometry), 0.001);
  const drag = Math.max(tuning.angularDrag, 0.0001);
  return yawTorqueNm(tuning, geometry) / inertia / drag;
}

export function stepFlight(
  state: FlightState,
  controls: FlightControls,
  dt: number,
  tuning: FlightTuning,
  geometry: ShipGeometry,
): void {
  if (dt <= 0) return;

  const linearTarget = controls.forward ? 1 : controls.reverse ? -1 : 0;
  const angularTarget = controls.turnRight ? 1 : controls.turnLeft ? -1 : 0;
  const rampSeconds = Math.max(tuning.inputRampSeconds, 0.0001);
  const maxInputStep = dt / rampSeconds;

  state.linearInput = moveTowards(state.linearInput, linearTarget, maxInputStep);
  state.angularInput = moveTowards(state.angularInput, angularTarget, maxInputStep);

  const mass = Math.max(tuning.massKg, 0.001);
  const inertia = Math.max(shipInertiaKgM2(tuning, geometry), 0.001);
  const wrench = engineWrench(state.linearInput, state.angularInput, tuning, geometry);

  // Body frame to world: body forward is -y and positive rotation is clockwise
  // on screen, so the matrix that turns the hull also turns its thrust.
  const cos = Math.cos(state.rotation);
  const sin = Math.sin(state.rotation);
  const worldForceX = wrench.forceX * cos - wrench.forceY * sin;
  const worldForceY = wrench.forceX * sin + wrench.forceY * cos;

  state.vx += (worldForceX / mass) * dt;
  state.vy += (worldForceY / mass) * dt;
  state.angularVelocity += (wrench.torque / inertia) * dt;

  // Drag applies to both axes whenever any input is active; with a positive
  // drag the thrust/drag ratio sets finite terminal speeds. After key-up the
  // input still takes inputRampSeconds to reach 0, so drag stays on for that
  // whole tail; once all inputs hit zero the ship coasts on its momentum.
  const anyInput = state.linearInput !== 0 || state.angularInput !== 0;
  if (anyInput) {
    const linearDrag = Math.exp(-tuning.linearDrag * dt);
    state.vx *= linearDrag;
    state.vy *= linearDrag;

    const angularDrag = Math.exp(-tuning.angularDrag * dt);
    state.angularVelocity *= angularDrag;
  }

  state.rotation += state.angularVelocity * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
}
