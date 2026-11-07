import { describe, expect, it } from 'vitest';
import {
  AFTERGLOW_DECAY_PER_SECOND,
  DIM_ALPHA,
  FLASH_ALPHA,
  HIT_ALPHA,
  MIN_ALPHA,
  afterglowAlpha,
  decayAfterglow,
  shieldAlpha,
} from '../src/app/shield-glow';

describe('shield glow', () => {
  it('rests dim and brightens to full while recently hit', () => {
    expect(afterglowAlpha(0)).toBeCloseTo(DIM_ALPHA, 6);
    expect(afterglowAlpha(1)).toBeCloseTo(HIT_ALPHA, 6);
    expect(afterglowAlpha(0.5)).toBeCloseTo((DIM_ALPHA + HIT_ALPHA) / 2, 6);
    expect(afterglowAlpha(2)).toBeCloseTo(HIT_ALPHA, 6);
    expect(afterglowAlpha(-1)).toBeCloseTo(DIM_ALPHA, 6);
  });

  it('eases the afterglow back down to rest', () => {
    expect(decayAfterglow(1, 0)).toBe(1);
    expect(decayAfterglow(1, 1)).toBeCloseTo(1 - AFTERGLOW_DECAY_PER_SECOND, 6);
    expect(decayAfterglow(0, 1)).toBe(0);

    let afterglow = 1;
    let seconds = 0;
    while (afterglow > 0 && seconds < 10) {
      afterglow = decayAfterglow(afterglow, 1 / 60);
      seconds += 1 / 60;
    }
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(2.5);
  });

  it('adds the impact flash on top and clamps the result', () => {
    const rest = shieldAlpha(0, 0, 0);
    expect(rest).toBeCloseTo(DIM_ALPHA, 6);
    expect(shieldAlpha(1, 0, 0)).toBeCloseTo(HIT_ALPHA, 6);
    expect(shieldAlpha(0, 0, 1)).toBeCloseTo(DIM_ALPHA + FLASH_ALPHA, 6);
    expect(shieldAlpha(1, 0.05, 1)).toBeLessThanOrEqual(1);
    // Breathing can dip below the resting level but never past the floor.
    expect(shieldAlpha(0, -1, 0)).toBeCloseTo(MIN_ALPHA, 6);
  });
});
