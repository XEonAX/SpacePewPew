import { describe, expect, it } from 'vitest';
import {
  MINING_LASER_GAIN,
  MINING_TRACTOR_GAIN,
  laserGain,
  tractorGain,
} from '../src/app/mining-audio';

describe('mining audio gains', () => {
  it('plays the laser bed only while a barrel is cutting', () => {
    expect(laserGain(0)).toBe(0);
    expect(laserGain(1)).toBeGreaterThan(0.5);
    expect(laserGain(2)).toBeCloseTo(MINING_LASER_GAIN, 6);
    expect(laserGain(2)).toBeGreaterThan(laserGain(1));
  });

  it('clamps the laser bed above two barrels', () => {
    expect(laserGain(5)).toBeCloseTo(MINING_LASER_GAIN, 6);
  });

  it('ramps the tractor bed with connected beams and caps out', () => {
    expect(tractorGain(0)).toBe(0);
    expect(tractorGain(1)).toBeCloseTo(MINING_TRACTOR_GAIN / 3, 6);
    expect(tractorGain(3)).toBeCloseTo(MINING_TRACTOR_GAIN, 6);
    expect(tractorGain(6)).toBeCloseTo(MINING_TRACTOR_GAIN, 6);
    expect(tractorGain(-1)).toBe(0);
  });
});
