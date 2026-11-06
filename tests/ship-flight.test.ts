import { describe, expect, it } from 'vitest';
import {
  INPUT_RAMP_SECONDS,
  MAX_ANGULAR_SPEED,
  MAX_LINEAR_SPEED,
  createFlightState,
  stepFlight,
} from '../src/app/ship-flight';
import type { FlightControls } from '../src/app/ship-flight';

const idle: FlightControls = {
  forward: false,
  reverse: false,
  turnLeft: false,
  turnRight: false,
};

function press(partial: Partial<FlightControls>): FlightControls {
  return { ...idle, ...partial };
}

describe('ship flight', () => {
  it('ramps input to full over INPUT_RAMP_SECONDS', () => {
    const state = createFlightState();
    stepFlight(state, press({ forward: true }), INPUT_RAMP_SECONDS / 2);
    expect(state.linearInput).toBeCloseTo(0.5, 5);

    stepFlight(state, press({ forward: true }), INPUT_RAMP_SECONDS / 2);
    expect(state.linearInput).toBe(1);
  });

  it('ramps angular input in both directions over the same time', () => {
    const left = createFlightState();
    const right = createFlightState();
    stepFlight(left, press({ turnLeft: true }), INPUT_RAMP_SECONDS);
    stepFlight(right, press({ turnRight: true }), INPUT_RAMP_SECONDS);
    expect(left.angularInput).toBe(-1);
    expect(right.angularInput).toBe(1);
  });

  it('W accelerates harder than S', () => {
    const forward = createFlightState();
    const reverse = createFlightState();
    stepFlight(forward, press({ forward: true }), 1);
    stepFlight(reverse, press({ reverse: true }), 1);
    expect(Math.hypot(forward.vx, forward.vy)).toBeGreaterThan(Math.hypot(reverse.vx, reverse.vy));
  });

  it('A and D apply equal, opposite torque', () => {
    const left = createFlightState();
    const right = createFlightState();
    stepFlight(left, press({ turnLeft: true }), 0.5);
    stepFlight(right, press({ turnRight: true }), 0.5);
    expect(left.angularVelocity).toBeCloseTo(-right.angularVelocity, 6);
    expect(left.rotation).toBeCloseTo(-right.rotation, 6);
  });

  it('caps linear and angular speed', () => {
    const state = createFlightState();
    state.vx = MAX_LINEAR_SPEED * 10;
    state.vy = MAX_LINEAR_SPEED * 10;
    state.angularVelocity = MAX_ANGULAR_SPEED * 10;

    stepFlight(state, idle, 1 / 60);

    expect(Math.hypot(state.vx, state.vy)).toBeCloseTo(MAX_LINEAR_SPEED, 6);
    expect(state.angularVelocity).toBeCloseTo(MAX_ANGULAR_SPEED, 6);
  });

  it('coasts without drag once input is zero', () => {
    const state = createFlightState();
    state.vx = 100;
    state.linearInput = 0;

    stepFlight(state, idle, 1);

    expect(state.vx).toBe(100);
  });

  it('applies drag while the input is still non-zero after release', () => {
    const state = createFlightState();
    state.vx = 100;

    stepFlight(state, press({ forward: true }), INPUT_RAMP_SECONDS);
    const accelerated = Math.hypot(state.vx, state.vy);
    stepFlight(state, idle, INPUT_RAMP_SECONDS);

    expect(accelerated).toBeGreaterThan(0);
    expect(state.linearInput).toBe(0);
  });
});
