import { describe, expect, it } from 'vitest';
import { BULLET_FADE_METERS, BULLET_RANGE_METERS, bulletAlpha } from '../src/app/bullet-math';

describe('bullet fade', () => {
  it('stays fully opaque until the last 10 m', () => {
    expect(bulletAlpha(0)).toBe(1);
    expect(bulletAlpha(BULLET_RANGE_METERS - BULLET_FADE_METERS)).toBe(1);
  });

  it('fades linearly over the final 10 m', () => {
    const midpoint = BULLET_RANGE_METERS - BULLET_FADE_METERS / 2;
    expect(bulletAlpha(midpoint)).toBeCloseTo(0.5, 6);
    expect(bulletAlpha(BULLET_RANGE_METERS)).toBe(0);
    expect(bulletAlpha(BULLET_RANGE_METERS + 1)).toBe(0);
  });
});
