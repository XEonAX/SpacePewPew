import { describe, expect, it } from 'vitest';
import {
  aimPointFromStick,
  applyDeadzone,
  readStick,
  thrustFromStick,
  wheelZoomFactor,
} from '../src/app/input-model';

describe('input model', () => {
  it('applies a rescaled deadzone', () => {
    expect(applyDeadzone(0.1, 0.2)).toBe(0);
    expect(applyDeadzone(-0.2, 0.2)).toBe(0);
    expect(applyDeadzone(0.6, 0.2)).toBeCloseTo(0.5);
    expect(applyDeadzone(1, 0.2)).toBe(1);
    expect(applyDeadzone(-1, 0.2)).toBe(-1);
  });

  it('reads sticks radially, preserving direction', () => {
    expect(readStick(0.1, 0.1, 0.2)).toMatchObject({ x: 0, y: 0, magnitude: 0 });
    const right = readStick(1, 0, 0.2);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
    const diagonal = readStick(1, 1, 0.2);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('maps stick up to forward thrust', () => {
    expect(thrustFromStick(-1)).toBe(1);
    expect(thrustFromStick(1)).toBe(-1);
    expect(thrustFromStick(0)).toBe(0);
  });

  it('builds an aim point in the stick direction', () => {
    expect(aimPointFromStick(100, 100, 0, -1, 50)).toEqual({ x: 100, y: 50 });
    const point = aimPointFromStick(100, 100, 1, 1, 50);
    expect(point.x).toBeCloseTo(135.36, 1);
    expect(point.y).toBeCloseTo(135.36, 1);
    expect(aimPointFromStick(10, 20, 0, 0, 50)).toEqual({ x: 10, y: 20 });
  });

  it('matches the old wheel zoom feel', () => {
    expect(wheelZoomFactor(0, 0)).toBe(1);
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
    // Line-mode wheels use the larger exponent.
    expect(wheelZoomFactor(1, 1)).toBeLessThan(wheelZoomFactor(1, 0));
  });
});
