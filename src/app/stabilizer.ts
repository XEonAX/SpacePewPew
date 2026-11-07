/**
 * The stabiliser (hold X): fires the nozzles to null linear and angular
 * velocity.
 *
 * Only axial thrust is available, so the controller first points the hull at
 * the burn that opposes travel (nose along the velocity for reverse thrust, or
 * nose against it for main thrust when moving backwards), damps spin with a
 * yaw couple, and then burns along the hull. The force couple is balanced so
 * turning the hull never adds translation.
 */
import type { EngineMix } from './engine-mix';
import type { EngineMount } from './ship-engines';
import type { ShipGeometry } from './ship-engines';
import type { FlightState, FlightTuning } from './ship-flight';
import { wrapAngle } from './turret-aim';

/** Speed below which the stabiliser holds its current heading. */
export const STABILIZE_ALIGN_SPEED = 0.3;
/** Desired braking deceleration per m/s of travel (clamped by available thrust). */
export const STABILIZE_BRAKE_GAIN = 2.4;
/** cos(alignment error) above which the braking thrust is allowed to fire. */
export const STABILIZE_ALIGN_COS = 0.95;
/** Attitude gain: desired angular acceleration per radian of heading error. */
export const STABILIZE_ATTITUDE_GAIN = 4;
/** Spin-damping gain: desired angular acceleration per rad/s of spin. */
export const STABILIZE_OMEGA_GAIN = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The nozzle on the requested side: sign -1 = most negative x, +1 = most positive. */
function sideNozzle(nozzles: readonly EngineMount[], sign: 1 | -1): EngineMount | null {
  let best: EngineMount | null = null;
  for (const nozzle of nozzles) {
    if (!best) {
      best = nozzle;
      continue;
    }
    const better = sign > 0 ? nozzle.x > best.x : nozzle.x < best.x;
    if (better) best = nozzle;
  }
  return best;
}

/**
 * Engine outputs that brake translation and damp spin. `ramp` scales the whole
 * command so the nozzles spool instead of snapping on.
 */
export function stabilizerEngineOutputs(
  state: FlightState,
  tuning: FlightTuning,
  geometry: ShipGeometry,
  ramp = 1,
): EngineMix {
  const mix: EngineMix = { main: [0, 0, 0], reverse: [0, 0] };
  const rampAmount = clamp(ramp, 0, 1);
  if (rampAmount <= 0) return mix;

  const mass = Math.max(tuning.massKg, 0.001);
  const inertia = Math.max(mass * geometry.radiusOfGyrationM ** 2, 0.001);
  const mainThrust = Math.max(tuning.mainThrustN, 0);
  const reverseThrust = Math.max(tuning.reverseThrustN, 0);

  const mains = geometry.engines.filter((engine) => engine.group === 'main');
  const reverses = geometry.engines.filter((engine) => engine.group === 'reverse');
  const mainArm = mains.reduce((arm, engine) => Math.max(arm, Math.abs(engine.x)), 0);
  const reverseArm = reverses.reduce((arm, engine) => Math.max(arm, Math.abs(engine.x)), 0);
  const coupleArm = mainArm + reverseArm;

  const speed = Math.hypot(state.vx, state.vy);
  const sin = Math.sin(state.rotation);
  const cos = Math.cos(state.rotation);
  // Positive = travelling along the nose.
  const axial = state.vx * sin - state.vy * cos;

  // Point at the thruster that pushes against travel: nose along the velocity
  // when the reversers will burn, nose against it when the mains will.
  let targetHeading = state.rotation;
  if (speed > STABILIZE_ALIGN_SPEED) {
    const heading = Math.atan2(state.vx, -state.vy);
    targetHeading = axial >= 0 ? heading : heading + Math.PI;
  }
  const headingError = wrapAngle(targetHeading - state.rotation);

  const maxCoupleForce = Math.min(mainThrust, reverseThrust);
  const maxAlpha = coupleArm > 0 ? (maxCoupleForce * coupleArm) / inertia : 0;
  const alpha = clamp(
    headingError * STABILIZE_ATTITUDE_GAIN - state.angularVelocity * STABILIZE_OMEGA_GAIN,
    -maxAlpha,
    maxAlpha,
  );

  // Axial braking along the hull, once it is roughly pointed at the burn.
  const brakingGroup: 'main' | 'reverse' = axial >= 0 ? 'reverse' : 'main';
  const groupThrust =
    brakingGroup === 'main' ? mains.length * mainThrust : reverses.length * reverseThrust;
  const aligned = Math.cos(headingError) > STABILIZE_ALIGN_COS;
  const brakeSpeed = speed > 0.02 && aligned ? speed : 0;
  const desiredForce = Math.min(brakeSpeed * STABILIZE_BRAKE_GAIN * mass, groupThrust);
  const groupOutput = groupThrust > 0 ? clamp(desiredForce / groupThrust, 0, 1) : 0;

  if (brakingGroup === 'main') {
    for (const engine of mains) mix.main[engine.index] = groupOutput;
  } else {
    for (const engine of reverses) mix.reverse[engine.index] = groupOutput;
  }

  // Balanced yaw couple: a side main and the opposite reverse nozzle, equal in
  // force so the pair adds torque without adding translation.
  if (coupleArm > 0 && Math.abs(alpha) > 1e-6) {
    const mainNozzle = sideNozzle(mains, alpha > 0 ? -1 : 1);
    const reverseNozzle = sideNozzle(reverses, alpha > 0 ? 1 : -1);
    const mainOutput = brakingGroup === 'main' ? groupOutput : 0;
    const reverseOutput = brakingGroup === 'reverse' ? groupOutput : 0;
    let coupleForce = (Math.abs(alpha) * inertia) / coupleArm;
    coupleForce = Math.min(
      coupleForce,
      (1 - mainOutput) * mainThrust,
      (1 - reverseOutput) * reverseThrust,
    );

    if (mainNozzle && mainThrust > 0 && coupleForce > 0) {
      mix.main[mainNozzle.index] = clamp(mainOutput + coupleForce / mainThrust, 0, 1);
    }
    if (reverseNozzle && reverseThrust > 0 && coupleForce > 0) {
      mix.reverse[reverseNozzle.index] = clamp(reverseOutput + coupleForce / reverseThrust, 0, 1);
    }
  }

  for (let index = 0; index < mix.main.length; index += 1) {
    mix.main[index] = (mix.main[index] ?? 0) * rampAmount;
  }
  for (let index = 0; index < mix.reverse.length; index += 1) {
    mix.reverse[index] = (mix.reverse[index] ?? 0) * rampAmount;
  }
  return mix;
}
