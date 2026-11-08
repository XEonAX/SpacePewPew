import { describe, expect, it } from 'vitest';
import { createMiningTuning, DEFAULT_MINING_TUNING } from '../src/app/mining-tuning';

describe('mining tuning', () => {
  it('defaults to the designed rig values', () => {
    expect(DEFAULT_MINING_TUNING).toMatchObject({
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
    });
  });

  it('merges overrides without touching the defaults', () => {
    const tuning = createMiningTuning({ meltSeconds: 0.4, tractorRangeM: 7 });
    expect(tuning.meltSeconds).toBe(0.4);
    expect(tuning.tractorRangeM).toBe(7);
    expect(tuning.chunkMinSpeedMps).toBe(DEFAULT_MINING_TUNING.chunkMinSpeedMps);
    expect(tuning).not.toBe(DEFAULT_MINING_TUNING);
    expect(DEFAULT_MINING_TUNING.meltSeconds).toBe(0.75);
  });
});
