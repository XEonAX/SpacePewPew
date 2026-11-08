import { describe, expect, it } from 'vitest';
import {
  HEADING_DEADBAND_RAD,
  headingFromStick,
  headingTurnInput,
  wrapAngle,
} from '../src/app/heading-steer';

describe('heading steer', () => {
  it('maps stick directions to ship headings', () => {
    expect(headingFromStick(0, -1)).toBeCloseTo(0); // up
    expect(headingFromStick(1, 0)).toBeCloseTo(Math.PI / 2); // right
    expect(headingFromStick(-1, 0)).toBeCloseTo(-Math.PI / 2); // left
    expect(Math.abs(headingFromStick(0, 1))).toBeCloseTo(Math.PI); // down
  });

  it('requests a turn toward the stick', () => {
    const right = headingTurnInput(1, 0, 0, 0);
    expect(right).toBeGreaterThan(0);
    const left = headingTurnInput(-1, 0, 0, 0);
    expect(left).toBeLessThan(0);
    // Facing the stick direction needs no turn.
    expect(headingTurnInput(0, -1, 0, 0)).toBe(0);
  });

  it('damps angular velocity instead of overshooting', () => {
    // Already turning right: the controller asks for less (or left) yaw.
    const damping = headingTurnInput(0, -1, 0, 1.5);
    expect(damping).toBeLessThan(0);
    // Inside the deadband at rest, the demand is exactly zero.
    expect(headingTurnInput(0, -1, HEADING_DEADBAND_RAD / 2, 0)).toBe(0);
  });

  it('wraps the shortest way around the back of the ship', () => {
    expect(wrapAngle(Math.PI * 2 + 0.1)).toBeCloseTo(0.1);
    expect(wrapAngle(-Math.PI * 2 - 0.1)).toBeCloseTo(-0.1);
    expect(headingTurnInput(0, -1, Math.PI * 2 - 0.01, 0)).toBe(0);
  });
});
