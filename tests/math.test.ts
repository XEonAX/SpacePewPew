import { describe, expect, it } from 'vitest';
import { clamp, lerp, smoothstep } from '../src/utils/math';

describe('clamp', () => {
  it('leaves values inside the range untouched', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below the minimum', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('clamps above the maximum', () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('returns the start value at t = 0', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('returns the end value at t = 1', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('interpolates linearly', () => {
    expect(lerp(0, 100, 0.25)).toBe(25);
  });
});

describe('smoothstep', () => {
  it('is 0 at or below the first edge', () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, -1)).toBe(0);
  });

  it('is 1 at or above the second edge', () => {
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it('eases through the middle', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});
