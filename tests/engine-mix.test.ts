import { describe, expect, it } from 'vitest';
import { FULL_TURN_BALANCE, computeEngineOutputs, turnThrustBalance } from '../src/app/engine-mix';

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

  it('keeps the default full-thrust balance when the groups are equal', () => {
    expect(turnThrustBalance(120_000, 120_000)).toEqual({ main: 1, reverse: 1 });
    expect(computeEngineOutputs(0, 1, FULL_TURN_BALANCE)).toEqual({
      main: [1, 0, 0],
      reverse: [0, 1],
    });
  });

  it('throttles the strong side of the turn couple down to the weak engine', () => {
    // Reverse engines are half the main thrust: pair force = 60 kN.
    const balance = turnThrustBalance(120_000, 60_000);
    expect(balance).toEqual({ main: 0.5, reverse: 1 });

    const mix = computeEngineOutputs(0, 1, balance);
    expect(mix.main[0]).toBeCloseTo(0.5, 6); // left main throttled to 60 kN
    expect(mix.main[1]).toBeCloseTo(0, 6);
    expect(mix.reverse[1]).toBeCloseTo(1, 6); // right reverse at its own max: 60 kN
  });

  it('throttles the reverse side down when the reverse engines are stronger', () => {
    const balance = turnThrustBalance(60_000, 120_000);
    expect(balance).toEqual({ main: 1, reverse: 0.5 });

    const mix = computeEngineOutputs(0, -1, balance);
    expect(mix.main[2]).toBeCloseTo(1, 6); // right main at its own max: 60 kN
    expect(mix.reverse[0]).toBeCloseTo(0.5, 6); // left reverse throttled to 60 kN
  });

  it('leaves braking at each group own thrust', () => {
    const balance = turnThrustBalance(120_000, 60_000);
    const mix = computeEngineOutputs(-1, 0, balance);
    expect(mix.reverse).toEqual([1, 1]); // braking is not part of the turn couple
  });
});
