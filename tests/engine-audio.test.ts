import { describe, expect, it } from 'vitest';
import { HUM_GAIN_CURVE, engineHumGain, engineHumPowers, enginePan } from '../src/app/engine-audio';
import { computeEngineOutputs } from '../src/app/engine-mix';

describe('engineHumPowers', () => {
  it('runs the heavy centre and both normal sides under W', () => {
    expect(engineHumPowers(computeEngineOutputs(1, 0))).toEqual([1, 1, 1, 0, 0]);
  });

  it('lights only the reverse engines under S', () => {
    expect(engineHumPowers(computeEngineOutputs(-1, 0))).toEqual([0, 0, 0, 1, 1]);
  });

  it('follows the turn mix', () => {
    const right = engineHumPowers(computeEngineOutputs(1, 1));
    expect(right).toEqual([1, 1, 0, 0, 1]);
  });
});

describe('engineHumGain', () => {
  it('is silent at rest and scales with power', () => {
    expect(engineHumGain(0, 0.9)).toBe(0);
    expect(engineHumGain(1, 0.9)).toBeCloseTo(0.9);
    expect(engineHumGain(0.5, 0.9)).toBeGreaterThan(0);
    expect(engineHumGain(0.5, 0.9)).toBeLessThan(engineHumGain(0.75, 0.9));
  });

  it('clamps power outside 0..1', () => {
    expect(engineHumGain(-1, 0.5)).toBe(0);
    expect(engineHumGain(2, 0.5)).toBeCloseTo(0.5);
  });

  it('keeps low power quieter than linear for a dynamic spool-up', () => {
    expect(engineHumGain(0.5, 1)).toBeCloseTo(Math.pow(0.5, HUM_GAIN_CURVE));
    expect(engineHumGain(0.5, 1)).toBeLessThan(0.5);
  });
});

describe('enginePan', () => {
  it('centres at the middle and spreads to the sides', () => {
    expect(enginePan(500, 1000)).toBe(0);
    expect(enginePan(0, 1000)).toBeLessThan(0);
    expect(enginePan(1000, 1000)).toBeGreaterThan(0);
  });

  it('clamps at the edges', () => {
    expect(enginePan(-5000, 1000)).toBe(-0.85);
    expect(enginePan(5000, 1000)).toBe(0.85);
  });

  it('handles a zero-width viewport', () => {
    expect(enginePan(10, 0)).toBe(0);
  });
});
