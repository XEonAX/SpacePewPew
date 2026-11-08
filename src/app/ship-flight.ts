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
import { computeEngineOutputs, turnThrustBalance } from './engine-mix';
import type { EngineMix } from './engine-mix';
import type { ShipGeometry } from './ship-engines';
import { stabilizerEngineOutputs } from './stabilizer';

export interface FlightControls {
  forward: boolean;
  reverse: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  /**
   * Analog thrust target, -1..1 (positive forward). When present it replaces
   * the forward/reverse booleans and is still fed through the same input ramp,
   * so sticks ease in exactly like keys.
   */
  thrustAxis?: number;
  /** Analog turn target, -1..1 (positive right); replaces the turn booleans. */
  turnAxis?: number;
  /** X: fire thrusters to null translation and spin (flight assist hold). */
  stabilize: boolean;
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
  massKg: 18_500,
  mainThrustN: 200_000,
  reverseThrustN: 150_000,
  linearDrag: 0.6,
  angularDrag: 2.5,
  inputRampSeconds: 0.35,
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
  /** Ramped stabiliser demand, 0..1. */
  stabilizeInput: number;
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
    stabilizeInput: 0,
  };
}

/** Moment of inertia about the centre of mass, kg·m². */
export function shipInertiaKgM2(tuning: FlightTuning, geometry: ShipGeometry): number {
  const mass = Math.max(tuning.massKg, 0.001);
  return mass * geometry.radiusOfGyrationM ** 2;
}

/**
 * Bleed angular velocity by an explicit amount, used for collision-spin decay
 * that the flight model intentionally does not apply while coasting.
 */
export function dampShipAngularVelocity(flight: FlightState, delta: number): void {
  flight.angularVelocity -= delta;
}

/**
 * Apply a physical impulse (N·s) and angular impulse (N·m·s) to the flight body.
 * Collisions compute the impulse; only this layer mutates the flight velocities,
 * so impacts obey the same mass/inertia as thrust.
 */
export function applyShipImpulse(
  flight: FlightState,
  tuning: FlightTuning,
  geometry: ShipGeometry,
  impulseX: number,
  impulseY: number,
  angularImpulse: number,
): void {
  const inverseMass = 1 / Math.max(tuning.massKg, 0.001);
  const inverseInertia = 1 / Math.max(shipInertiaKgM2(tuning, geometry), 1e-6);
  flight.vx += impulseX * inverseMass;
  flight.vy += impulseY * inverseMass;
  flight.angularVelocity += angularImpulse * inverseInertia;
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
  // Equal-force couple: a turn must not translate even when the reverse
  // engines are weaker, so the main side is throttled down to match them.
  const balance = turnThrustBalance(tuning.mainThrustN, tuning.reverseThrustN);
  return wrenchFromMix(computeEngineOutputs(linearInput, angularInput, balance), tuning, geometry);
}

/** Body-frame force and torque from explicit per-nozzle outputs. */
export function wrenchFromMix(
  mix: EngineMix,
  tuning: FlightTuning,
  geometry: ShipGeometry,
): EngineWrench {
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
): EngineMix {
  const idleMix: EngineMix = { main: [0, 0, 0], reverse: [0, 0] };
  if (dt <= 0) return idleMix;

  const digitalLinear = controls.forward ? 1 : controls.reverse ? -1 : 0;
  const digitalTurn = controls.turnRight ? 1 : controls.turnLeft ? -1 : 0;
  // Analog targets are clamped here but deliberately ramped below alongside
  // digital input, so a gamepad/touch stick never snaps the ship instantly.
  const linearTarget = Math.max(-1, Math.min(1, controls.thrustAxis ?? digitalLinear));
  const angularTarget = Math.max(-1, Math.min(1, controls.turnAxis ?? digitalTurn));
  const rampSeconds = Math.max(tuning.inputRampSeconds, 0.0001);
  const maxInputStep = dt / rampSeconds;

  state.linearInput = moveTowards(state.linearInput, linearTarget, maxInputStep);
  state.angularInput = moveTowards(state.angularInput, angularTarget, maxInputStep);
  state.stabilizeInput = moveTowards(
    state.stabilizeInput,
    controls.stabilize ? 1 : 0,
    maxInputStep,
  );

  const mass = Math.max(tuning.massKg, 0.001);
  const inertia = Math.max(shipInertiaKgM2(tuning, geometry), 0.001);
  const balance = turnThrustBalance(tuning.mainThrustN, tuning.reverseThrustN);
  const mix =
    state.stabilizeInput > 0
      ? stabilizerEngineOutputs(state, tuning, geometry, state.stabilizeInput)
      : computeEngineOutputs(state.linearInput, state.angularInput, balance);
  const wrench = wrenchFromMix(mix, tuning, geometry);

  // Body frame to world: body forward is -y and positive rotation is clockwise
  // on screen, so the matrix that turns the hull also turns its thrust.
  const cos = Math.cos(state.rotation);
  const sin = Math.sin(state.rotation);
  const worldForceX = wrench.forceX * cos - wrench.forceY * sin;
  const worldForceY = wrench.forceX * sin + wrench.forceY * cos;

  state.vx += (worldForceX / mass) * dt;
  state.vy += (worldForceY / mass) * dt;
  state.angularVelocity += (wrench.torque / inertia) * dt;

  // Drag applies to BOTH axes whenever ANY input is active — thrust-only, turn
  // only, or both. A W burn therefore bleeds residual spin, and a pure A/D
  // manoeuvre bleeds residual drift. With a positive drag the thrust/drag ratio
  // sets finite terminal speeds. After key-up the input still takes
  // inputRampSeconds to reach 0, so drag stays on for that whole tail; once all
  // inputs hit zero the ship coasts on its momentum.
  const anyInput =
    state.linearInput !== 0 || state.angularInput !== 0 || state.stabilizeInput !== 0;
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
  return mix;
}
