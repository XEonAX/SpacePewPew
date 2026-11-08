import { describe, expect, it } from 'vitest';
import {
  createLaserHeatState,
  laserHeatReadout,
  stepLaserHeat,
  type LaserHeatTuning,
} from '../src/app/laser-heat';

const TUNING: LaserHeatTuning = {
  laserMaxHeatSeconds: 5,
  laserCoolPerSecond: 2.2,
  laserOverheatCoolPerSecond: 0.8,
};

describe('laser heat', () => {
  it('fires for the full five-second window, then locks out', () => {
    const barrel = createLaserHeatState();
    for (let second = 0; second < 5; second += 1) {
      expect(stepLaserHeat(barrel, true, 1, TUNING)).toBe(true);
    }
    expect(barrel.overheated).toBe(true);
    expect(laserHeatReadout(barrel, TUNING).heat).toBe(1);
    expect(stepLaserHeat(barrel, true, 0.001, TUNING)).toBe(false);
  });

  it('stays locked out while the trigger is held, then unlocks at zero heat', () => {
    const barrel = createLaserHeatState();
    for (let second = 0; second < 5; second += 1) stepLaserHeat(barrel, true, 1, TUNING);
    // 0.8 heat/s means 6.25 s to shed a full five seconds.
    expect(stepLaserHeat(barrel, true, 6, TUNING)).toBe(false);
    expect(barrel.overheated).toBe(true);
    expect(stepLaserHeat(barrel, true, 1, TUNING)).toBe(false);
    expect(barrel.overheated).toBe(false);
    expect(stepLaserHeat(barrel, true, 0.1, TUNING)).toBe(true);
  });

  it('cools faster after an early release than during overheat lockout', () => {
    const early = createLaserHeatState();
    const forced = createLaserHeatState();
    for (let second = 0; second < 3; second += 1) stepLaserHeat(early, true, 1, TUNING);
    for (let second = 0; second < 5; second += 1) stepLaserHeat(forced, true, 1, TUNING);

    stepLaserHeat(early, false, 1, TUNING);
    stepLaserHeat(forced, false, 1, TUNING);
    expect(early.heatSeconds).toBeCloseTo(0.8);
    expect(forced.heatSeconds).toBeCloseTo(4.2);
    expect(early.overheated).toBe(false);
    expect(forced.overheated).toBe(true);
  });

  it('keeps independent heat per barrel', () => {
    const left = createLaserHeatState();
    const right = createLaserHeatState();
    for (let second = 0; second < 5; second += 1) stepLaserHeat(left, true, 1, TUNING);
    stepLaserHeat(right, true, 2, TUNING);
    expect(left.overheated).toBe(true);
    expect(right.overheated).toBe(false);
    expect(laserHeatReadout(left, TUNING).heat).toBe(1);
    expect(laserHeatReadout(right, TUNING).heat).toBeCloseTo(0.4);
  });

  it('clamps heat when idle and tolerates a large delta', () => {
    const barrel = createLaserHeatState();
    stepLaserHeat(barrel, true, 1, TUNING);
    stepLaserHeat(barrel, false, 100, TUNING);
    expect(barrel.heatSeconds).toBe(0);
    expect(laserHeatReadout(barrel, TUNING).heat).toBe(0);
  });
});
