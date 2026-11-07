import { describe, expect, it } from 'vitest';
import { BULLET_FADE_METERS, BULLET_RANGE_METERS, bulletAlpha } from '../src/app/bullet-math';

describe('bullet fade', () => {
  it('keeps 200 m of travel before expiring', () => {
    expect(BULLET_RANGE_METERS).toBe(200);
    expect(BULLET_FADE_METERS).toBe(50);
  });

  it('stays fully opaque until the fade window', () => {
    expect(bulletAlpha(0)).toBe(1);
    expect(bulletAlpha(BULLET_RANGE_METERS - BULLET_FADE_METERS)).toBe(1);
  });

  it('fades linearly over the final window', () => {
    const midpoint = BULLET_RANGE_METERS - BULLET_FADE_METERS / 2;
    expect(bulletAlpha(midpoint)).toBeCloseTo(0.5, 6);
    expect(bulletAlpha(BULLET_RANGE_METERS)).toBe(0);
    expect(bulletAlpha(BULLET_RANGE_METERS + 1)).toBe(0);
  });
});
