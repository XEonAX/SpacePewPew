/**
 * The stabiliser (hold X): cancels spin and brakes along the hull's current
 * heading, without re-orienting the ship.
 *
 * It fires a balanced yaw couple to null angular velocity, then uses the
 * applicable axial thruster — reversers when travelling nose-first, mains when
 * travelling backwards — to slow translation. Sideways drift is left to the
 * linear drag that stabilising also engages; the hull keeps the heading the
 * pilot chose. The yaw couple is balanced so turning the nozzles never adds
 * translation.
 */
import type { EngineMix } from './engine-mix';
import type { EngineMount } from './ship-engines';
import type { ShipGeometry } from './ship-engines';
import type { FlightState, FlightTuning } from './ship-flight';

/** Desired braking deceleration per m/s of axial travel (clamped by thrust). */
export const STABILIZE_BRAKE_GAIN = 2.4;
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

  const sin = Math.sin(state.rotation);
  const cos = Math.cos(state.rotation);
  // Positive = travelling along the nose.
  const axial = state.vx * sin - state.vy * cos;

  const maxCoupleForce = Math.min(mainThrust, reverseThrust);
  const maxAlpha = coupleArm > 0 ? (maxCoupleForce * coupleArm) / inertia : 0;
  // Only cancel spin; never steer toward a new heading.
  const alpha = clamp(-state.angularVelocity * STABILIZE_OMEGA_GAIN, -maxAlpha, maxAlpha);

  // Axial braking along the current heading: reversers oppose nose-first
  // travel, mains oppose backwards travel. Lateral drift is drag's job.
  const brakingGroup: 'main' | 'reverse' = axial >= 0 ? 'reverse' : 'main';
  const groupThrust =
    brakingGroup === 'main' ? mains.length * mainThrust : reverses.length * reverseThrust;
  const brakeSpeed = Math.abs(axial) > 0.02 ? Math.abs(axial) : 0;
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
