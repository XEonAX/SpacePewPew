/**
 * Per-barrel mining-laser heat.
 *
 * A barrel can fire continuously for `maxHeatSeconds`. Releasing early vents
 * quickly and lets the pilot feather the trigger; hitting the limit forces a
 * slow, locked cool-down until every second of heat is gone.
 */
export interface LaserHeatTuning {
  /** Seconds of continuous fire before the barrel locks out. */
  laserMaxHeatSeconds: number;
  /** Heat shed per second after a voluntary release. */
  laserCoolPerSecond: number;
  /** Heat shed per second while locked out after overheating. */
  laserOverheatCoolPerSecond: number;
}

export interface LaserHeatState {
  heatSeconds: number;
  overheated: boolean;
}

export interface LaserHeatReadout {
  /** 0..1, for HUD bars. */
  heat: number;
  overheated: boolean;
}

export function createLaserHeatState(): LaserHeatState {
  return { heatSeconds: 0, overheated: false };
}

/**
 * Advance one barrel and return whether its beam may fire this frame.
 *
 * Once overheated the barrel is locked out even while the trigger is held; it
 * only unlocks when heat reaches zero.
 */
export function stepLaserHeat(
  state: LaserHeatState,
  triggerHeld: boolean,
  deltaSeconds: number,
  tuning: LaserHeatTuning,
): boolean {
  const dt = Math.max(0, deltaSeconds);
  const maxHeat = Math.max(0.001, tuning.laserMaxHeatSeconds);

  if (state.overheated) {
    state.heatSeconds = Math.max(
      0,
      state.heatSeconds - Math.max(0, tuning.laserOverheatCoolPerSecond) * dt,
    );
    if (state.heatSeconds <= 0) {
      state.heatSeconds = 0;
      state.overheated = false;
    }
    return false;
  }

  if (triggerHeld) {
    state.heatSeconds = Math.min(maxHeat, state.heatSeconds + dt);
    if (state.heatSeconds >= maxHeat) {
      state.heatSeconds = maxHeat;
      // Let the barrel finish the frame that fills the gauge; the next frame
      // sees `overheated` and locks out.
      state.overheated = true;
    }
    return true;
  }

  state.heatSeconds = Math.max(0, state.heatSeconds - Math.max(0, tuning.laserCoolPerSecond) * dt);
  return false;
}

export function laserHeatReadout(state: LaserHeatState, tuning: LaserHeatTuning): LaserHeatReadout {
  const maxHeat = Math.max(0.001, tuning.laserMaxHeatSeconds);
  return {
    heat: Math.max(0, Math.min(1, state.heatSeconds / maxHeat)),
    overheated: state.overheated,
  };
}
