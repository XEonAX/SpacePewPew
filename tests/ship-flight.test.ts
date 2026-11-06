import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIGHT_TUNING,
  createFlightState,
  forwardTerminalSpeed,
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
    stepFlight(state, press({ forward: true }), DEFAULT_FLIGHT_TUNING.inputRampSeconds / 2);
    expect(state.linearInput).toBeCloseTo(0.5, 5);

    stepFlight(state, press({ forward: true }), DEFAULT_FLIGHT_TUNING.inputRampSeconds / 2);
    expect(state.linearInput).toBe(1);
  });

  it('ramps angular input in both directions over the same time', () => {
    const left = createFlightState();
    const right = createFlightState();
    stepFlight(left, press({ turnLeft: true }), DEFAULT_FLIGHT_TUNING.inputRampSeconds);
    stepFlight(right, press({ turnRight: true }), DEFAULT_FLIGHT_TUNING.inputRampSeconds);
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

  it('settles at the thrust/drag terminal speed', () => {
    const state = createFlightState();
    const dt = 1 / 60;
    for (let frame = 0; frame < 60 * 30; frame += 1) {
      stepFlight(state, press({ forward: true }), dt);
    }

    const terminal = DEFAULT_FLIGHT_TUNING.forwardAccel / DEFAULT_FLIGHT_TUNING.linearDrag;
    const speed = Math.hypot(state.vx, state.vy);
    expect(speed).toBeGreaterThan(terminal * 0.98);
    expect(speed).toBeLessThan(terminal * 1.02);
  });

  it('applies angular drag while any input is active', () => {
    const state = createFlightState();
    state.angularVelocity = 2;

    stepFlight(state, press({ forward: true }), 0.1);

    expect(state.angularInput).toBe(0);
    expect(state.angularVelocity).toBeGreaterThan(0);
    expect(state.angularVelocity).toBeLessThan(2);
  });

  it('applies linear drag while only angular input is active', () => {
    const state = createFlightState();
    state.vx = 100;

    stepFlight(state, press({ turnLeft: true }), 0.1);

    expect(state.linearInput).toBe(0);
    expect(state.vx).toBeGreaterThan(0);
    expect(state.vx).toBeLessThan(100);
  });

  it('coasts without drag once input is zero', () => {
    const state = createFlightState();
    state.vx = 100;
    state.linearInput = 0;

    stepFlight(state, idle, 1);

    expect(state.vx).toBe(100);
  });

  it('keeps applying drag until the ramped input reaches zero', () => {
    // Thrust disabled so only drag can change velocity.
    const tuning = {
      ...DEFAULT_FLIGHT_TUNING,
      forwardAccel: 0,
      reverseAccel: 0,
    };
    const state = createFlightState();
    state.vx = 100;
    state.linearInput = 1;

    stepFlight(state, idle, 0.05, tuning);

    expect(state.linearInput).toBeGreaterThan(0);
    expect(state.vx).toBeLessThan(100); // drag still applies after key-up

    stepFlight(state, idle, DEFAULT_FLIGHT_TUNING.inputRampSeconds, tuning);
    expect(state.linearInput).toBe(0);

    const coast = state.vx;
    stepFlight(state, idle, 0.5, tuning);
    expect(state.vx).toBeCloseTo(coast, 6); // drag stops once input is zero
  });
});

describe('forwardTerminalSpeed', () => {
  it('derives terminal speed from thrust over drag', () => {
    expect(forwardTerminalSpeed(DEFAULT_FLIGHT_TUNING)).toBeCloseTo(50, 6);
    expect(forwardTerminalSpeed({ ...DEFAULT_FLIGHT_TUNING, forwardAccel: 25 })).toBeCloseTo(
      100,
      6,
    );
    expect(forwardTerminalSpeed({ ...DEFAULT_FLIGHT_TUNING, linearDrag: 0.5 })).toBeCloseTo(25, 6);
  });
});
