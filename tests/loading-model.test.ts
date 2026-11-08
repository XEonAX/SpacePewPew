import { describe, expect, it } from 'vitest';
import { formatPercent, loadFraction } from '../src/app/loading-model';

describe('loading model', () => {
  it('clamps progress into 0..1', () => {
    expect(loadFraction(0, 24)).toBe(0);
    expect(loadFraction(6, 24)).toBeCloseTo(0.25);
    expect(loadFraction(30, 24)).toBe(1);
    expect(loadFraction(-2, 24)).toBe(0);
    // An unknown total reads as complete rather than dividing by zero.
    expect(loadFraction(3, 0)).toBe(1);
  });

  it('formats a percentage', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.255)).toBe('26%');
    expect(formatPercent(1.3)).toBe('100%');
  });
});
