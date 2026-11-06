import { describe, expect, it } from 'vitest';
import { computeEngineOutputs } from '../src/app/engine-mix';

describe('engine mix', () => {
  it('lights all main engines for W', () => {
    expect(computeEngineOutputs(1, 0)).toEqual({ main: [1, 1, 1], reverse: [0, 0] });
  });

  it('lights both reverse engines for S', () => {
    expect(computeEngineOutputs(-1, 0)).toEqual({ main: [0, 0, 0], reverse: [1, 1] });
  });

  it('lights left reverse + right main when turning left', () => {
    expect(computeEngineOutputs(0, -1)).toEqual({ main: [0, 0, 1], reverse: [1, 0] });
  });

  it('lights right reverse + left main when turning right', () => {
    expect(computeEngineOutputs(0, 1)).toEqual({ main: [1, 0, 0], reverse: [0, 1] });
  });

  it('cuts the left main when W is held while turning left', () => {
    expect(computeEngineOutputs(1, -1)).toEqual({ main: [0, 1, 1], reverse: [1, 0] });
  });

  it('cuts the right main when W is held while turning right', () => {
    expect(computeEngineOutputs(1, 1)).toEqual({ main: [1, 1, 0], reverse: [0, 1] });
  });

  it('crossfades with partially ramped inputs', () => {
    const mix = computeEngineOutputs(0.5, -0.5);
    expect(mix.main[0]).toBeCloseTo(0.25, 6);
    expect(mix.main[1]).toBeCloseTo(0.5, 6);
    expect(mix.main[2]).toBeCloseTo(0.5, 6);
    expect(mix.reverse[0]).toBeCloseTo(0.5, 6);
    expect(mix.reverse[1]).toBeCloseTo(0, 6);
  });

  it('clamps out-of-range inputs', () => {
    expect(computeEngineOutputs(2, 0)).toEqual({ main: [1, 1, 1], reverse: [0, 0] });
    expect(computeEngineOutputs(-2, 0)).toEqual({ main: [0, 0, 0], reverse: [1, 1] });
  });
});
