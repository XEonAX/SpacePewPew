/**
 * Live mining-rig tuning. The defaults are the values the rig was designed
 * around; the rate-of-fire overlay swaps to sliders for these when the mining
 * rig is equipped.
 */
export interface MiningTuning {
  /** Seconds a laser must dwell on one spot before a chunk lets go. */
  meltSeconds: number;
  /** Max drift of the beam that still counts as the same spot, metres. */
  meltSpotRadiusM: number;
  /** Extra melt progress while both barrels focus the same small spot. */
  meltFocusMultiplier: number;
  /** Hit-point distance under which two barrels count as focused, metres. */
  meltOverlapRadiusM: number;
  /** Continuous firing seconds before a barrel overheats. */
  laserMaxHeatSeconds: number;
  /** Heat shed per second after releasing the trigger early. */
  laserCoolPerSecond: number;
  /** Heat shed per second while a barrel is locked out after overheating. */
  laserOverheatCoolPerSecond: number;
  /** Seconds a cooling melt scar stays on the rock. */
  meltCoolSeconds: number;
  /** Ejection speed range for a fresh chunk, metres/second. */
  chunkMinSpeedMps: number;
  chunkMaxSpeedMps: number;
  /** Drag applied to free chunks, per second. */
  chunkDampingPerSecond: number;
  /** Free-chunk lifetime before it fades, seconds. */
  chunkLifetimeSeconds: number;
  chunkFadeSeconds: number;
  /** How far a mining laser reaches, metres. */
  laserRangeM: number;
  /** Tractor beam reach, metres. */
  tractorRangeM: number;
  /** Max angular rate a tractor barrel can follow before dropping its chunk, rad/s. */
  tractorTrackRateLimit: number;
  /** Cap speed for carried cargo, metres/second (both carry modes). */
  carrierMaxSpeedMps: number;
  /** Curved-carry max turn rate, rad/s. */
  carrierTurnRate: number;
  /** Physics-carry arrival easing, seconds. */
  carrierArrivalSeconds: number;
}

export const DEFAULT_MINING_TUNING: MiningTuning = {
  meltSeconds: 0.75,
  meltSpotRadiusM: 0.6,
  meltFocusMultiplier: 1.5,
  meltOverlapRadiusM: 1.2,
  laserMaxHeatSeconds: 5,
  laserCoolPerSecond: 2.2,
  laserOverheatCoolPerSecond: 0.8,
  meltCoolSeconds: 2.2,
  chunkMinSpeedMps: 1.2,
  chunkMaxSpeedMps: 2.8,
  chunkDampingPerSecond: 0.55,
  chunkLifetimeSeconds: 8,
  chunkFadeSeconds: 3,
  laserRangeM: 220,
  tractorRangeM: 5,
  tractorTrackRateLimit: 3,
  carrierMaxSpeedMps: 8,
  carrierTurnRate: 2.2,
  carrierArrivalSeconds: 0.7,
};

export function createMiningTuning(overrides: Partial<MiningTuning> = {}): MiningTuning {
  return { ...DEFAULT_MINING_TUNING, ...overrides };
}
