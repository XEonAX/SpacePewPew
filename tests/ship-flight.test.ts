import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIGHT_TUNING,
  createFlightState,
  engineWrench,
  forwardTerminalSpeed,
  reverseTerminalSpeed,
  shipInertiaKgM2,
  stepFlight,
  yawTerminalSpeed,
} from '../src/app/ship-flight';
import type { FlightControls, FlightTuning } from '../src/app/ship-flight';
import type { ShipGeometry } from '../src/app/ship-engines';

const idle: FlightControls = {
  forward: false,
  reverse: false,
  turnLeft: false,
  turnRight: false,
  stabilize: false,
};

function press(partial: Partial<FlightControls>): FlightControls {
  return { ...idle, ...partial };
}

/** Symmetric drive: three mains abreast, two reverse nozzles further out. */
const GEOMETRY: ShipGeometry = {
  engines: [
    { group: 'main', index: 0, x: -0.8, y: 2.3, dirX: 0, dirY: -1 },
    { group: 'main', index: 1, x: 0, y: 2.3, dirX: 0, dirY: -1 },
    { group: 'main', index: 2, x: 0.8, y: 2.3, dirX: 0, dirY: -1 },
    { group: 'reverse', index: 0, x: -1.6, y: -1.2, dirX: 0, dirY: 1 },
    { group: 'reverse', index: 1, x: 1.6, y: -1.2, dirX: 0, dirY: 1 },
  ],
  radiusOfGyrationM: 2.4,
};

const TUNING = DEFAULT_FLIGHT_TUNING;

describe('ship flight', () => {
  it('ramps input to full over the input ramp time', () => {
    const state = createFlightState();
    stepFlight(state, press({ forward: true }), TUNING.inputRampSeconds / 2, TUNING, GEOMETRY);
    expect(state.linearInput).toBeCloseTo(0.5, 5);

    stepFlight(state, press({ forward: true }), TUNING.inputRampSeconds / 2, TUNING, GEOMETRY);
    expect(state.linearInput).toBe(1);
  });

  it('ramps analog stick targets through the same input ramp', () => {
    const state = createFlightState();
    stepFlight(
      state,
      press({ thrustAxis: 0.5, turnAxis: -0.5 }),
      TUNING.inputRampSeconds / 4,
      TUNING,
      GEOMETRY,
    );
    expect(state.linearInput).toBeCloseTo(0.25, 5);
    expect(state.angularInput).toBeCloseTo(-0.25, 5);

    stepFlight(
      state,
      press({ thrustAxis: 0.5, turnAxis: -0.5 }),
      TUNING.inputRampSeconds / 4,
      TUNING,
      GEOMETRY,
    );
    expect(state.linearInput).toBeCloseTo(0.5, 5);
    expect(state.angularInput).toBeCloseTo(-0.5, 5);
  });

  it('ramps angular input in both directions over the same time', () => {
    const left = createFlightState();
    const right = createFlightState();
    stepFlight(left, press({ turnLeft: true }), TUNING.inputRampSeconds, TUNING, GEOMETRY);
    stepFlight(right, press({ turnRight: true }), TUNING.inputRampSeconds, TUNING, GEOMETRY);
    expect(left.angularInput).toBe(-1);
    expect(right.angularInput).toBe(1);
  });

  it('W accelerates harder than S', () => {
    const forward = createFlightState();
    const reverse = createFlightState();
    stepFlight(forward, press({ forward: true }), 1, TUNING, GEOMETRY);
    stepFlight(reverse, press({ reverse: true }), 1, TUNING, GEOMETRY);
    expect(Math.hypot(forward.vx, forward.vy)).toBeGreaterThan(Math.hypot(reverse.vx, reverse.vy));
  });

  it('turns by differential thrust without translating', () => {
    const left = createFlightState();
    const right = createFlightState();
    stepFlight(left, press({ turnLeft: true }), 0.5, TUNING, GEOMETRY);
    stepFlight(right, press({ turnRight: true }), 0.5, TUNING, GEOMETRY);

    expect(left.angularVelocity).toBeCloseTo(-right.angularVelocity, 6);
    expect(left.rotation).toBeCloseTo(-right.rotation, 6);
    // Equal per-engine thrust means the yaw pair cancels: pure torque.
    expect(Math.hypot(left.vx, left.vy)).toBeLessThan(1e-9);
    expect(left.x).toBeCloseTo(0, 9);
    expect(left.y).toBeCloseTo(0, 9);
  });

  it('turns without translating when the reverse engines are weaker', () => {
    const weaker: FlightTuning = { ...TUNING, reverseThrustN: TUNING.reverseThrustN / 2 };
    const state = createFlightState();
    stepFlight(state, press({ turnRight: true }), 0.5, weaker, GEOMETRY);

    expect(Math.hypot(state.vx, state.vy)).toBeLessThan(1e-9);
    expect(state.angularVelocity).toBeGreaterThan(0);
  });

  it('balances the yaw couple to the weaker engine pair', () => {
    const weaker: FlightTuning = { ...TUNING, reverseThrustN: TUNING.reverseThrustN / 2 };
    const torque = Math.abs(engineWrench(0, 1, weaker, GEOMETRY).torque);
    // Main arm 0.8 m + reverse arm 1.6 m, both sides at the weaker 60 kN.
    expect(torque).toBeCloseTo((TUNING.reverseThrustN / 2) * (0.8 + 1.6), 6);
    // Yaw authority shrinks with the weak reverse engines...
    expect(yawTerminalSpeed(weaker, GEOMETRY)).toBeLessThan(yawTerminalSpeed(TUNING, GEOMETRY));
    // ...but braking/thrust do not enter the couple.
    expect(Math.abs(engineWrench(1, 0, weaker, GEOMETRY).forceY)).toBeCloseTo(
      3 * TUNING.mainThrustN,
      6,
    );
  });

  it('settles at the forward thrust/drag terminal speed', () => {
    const state = createFlightState();
    const dt = 1 / 60;
    for (let frame = 0; frame < 60 * 40; frame += 1) {
      stepFlight(state, press({ forward: true }), dt, TUNING, GEOMETRY);
    }

    const terminal = forwardTerminalSpeed(TUNING, GEOMETRY);
    const speed = Math.hypot(state.vx, state.vy);
    expect(speed).toBeGreaterThan(terminal * 0.98);
    expect(speed).toBeLessThan(terminal * 1.02);
  });

  it('mass scales acceleration and inertia', () => {
    const light = createFlightState();
    light.linearInput = 1;
    light.angularInput = 1;
    const heavy = createFlightState();
    heavy.linearInput = 1;
    heavy.angularInput = 1;

    const doubleMass: FlightTuning = { ...TUNING, massKg: TUNING.massKg * 2 };
    stepFlight(light, idle, 1 / 60, TUNING, GEOMETRY);
    stepFlight(heavy, idle, 1 / 60, doubleMass, GEOMETRY);

    expect(Math.hypot(heavy.vx, heavy.vy)).toBeCloseTo(Math.hypot(light.vx, light.vy) / 2, 6);
    expect(heavy.angularVelocity).toBeCloseTo(light.angularVelocity / 2, 6);
    expect(shipInertiaKgM2(doubleMass, GEOMETRY)).toBeCloseTo(
      shipInertiaKgM2(TUNING, GEOMETRY) * 2,
      6,
    );
  });

  it('engine force scales with the ramped input', () => {
    const full = engineWrench(1, 0, TUNING, GEOMETRY);
    const half = engineWrench(0.5, 0, TUNING, GEOMETRY);
    expect(full.forceY).toBeCloseTo(-3 * TUNING.mainThrustN, 6);
    expect(half.forceY).toBeCloseTo(full.forceY / 2, 6);
    expect(full.forceX).toBeCloseTo(0, 9);
    expect(full.torque).toBeCloseTo(0, 9);
  });

  it('yaw torque comes from the nozzle positions', () => {
    const centred: ShipGeometry = {
      ...GEOMETRY,
      engines: GEOMETRY.engines.map((engine) => ({ ...engine, x: 0 })),
    };
    const state = createFlightState();
    stepFlight(state, press({ turnRight: true }), 0.5, TUNING, centred);
    expect(state.angularVelocity).toBeCloseTo(0, 12);
    expect(state.rotation).toBeCloseTo(0, 12);

    const normal = createFlightState();
    stepFlight(normal, press({ turnRight: true }), 0.5, TUNING, GEOMETRY);
    expect(normal.angularVelocity).toBeGreaterThan(0);
  });

  it('damps both axes while only linear input is active', () => {
    const state = createFlightState();
    state.vx = 100; // sideways drift, not along the thrust axis
    state.angularVelocity = 2; // residual spin

    stepFlight(state, press({ forward: true }), 0.1, TUNING, GEOMETRY);

    expect(state.linearInput).toBeGreaterThan(0);
    expect(state.angularInput).toBe(0);
    expect(state.vx).toBeLessThan(100); // linear drag without turn input
    expect(Math.abs(state.angularVelocity)).toBeLessThan(2); // angular drag without turn input
  });

  it('damps both axes while only angular input is active', () => {
    const state = createFlightState();
    state.vx = 100;
    state.angularVelocity = 2;

    stepFlight(state, press({ turnLeft: true }), 0.1, TUNING, GEOMETRY);

    expect(state.linearInput).toBe(0);
    expect(state.angularInput).toBeLessThan(0);
    expect(state.vx).toBeLessThan(100); // linear drag without thrust input
    expect(Math.abs(state.angularVelocity)).toBeLessThan(2); // drag outruns the new turn torque
  });

  it('coasts without drag once input is zero', () => {
    const state = createFlightState();
    state.vx = 100;
    state.linearInput = 0;

    stepFlight(state, idle, 1, TUNING, GEOMETRY);

    expect(state.vx).toBe(100);
  });

  it('keeps applying drag until the ramped input reaches zero', () => {
    // Thrust disabled so only drag can change velocity.
    const tuning: FlightTuning = {
      ...TUNING,
      mainThrustN: 0,
      reverseThrustN: 0,
    };
    const state = createFlightState();
    state.vx = 100;
    state.linearInput = 1;

    stepFlight(state, idle, 0.05, tuning, GEOMETRY);

    expect(state.linearInput).toBeGreaterThan(0);
    expect(state.vx).toBeLessThan(100); // drag still applies after key-up

    stepFlight(state, idle, TUNING.inputRampSeconds, tuning, GEOMETRY);
    expect(state.linearInput).toBe(0);

    const coast = state.vx;
    stepFlight(state, idle, 0.5, tuning, GEOMETRY);
    expect(state.vx).toBeCloseTo(coast, 6); // drag stops once input is zero
  });
});

describe('terminal speeds', () => {
  it('derives forward terminal speed from thrust over drag', () => {
    const expected = (3 * TUNING.mainThrustN) / TUNING.massKg / TUNING.linearDrag;
    expect(forwardTerminalSpeed(TUNING, GEOMETRY)).toBeCloseTo(expected, 6);

    const stronger: FlightTuning = { ...TUNING, mainThrustN: TUNING.mainThrustN * 2 };
    expect(forwardTerminalSpeed(stronger, GEOMETRY)).toBeCloseTo(expected * 2, 6);

    const draggier: FlightTuning = { ...TUNING, linearDrag: TUNING.linearDrag * 2 };
    expect(forwardTerminalSpeed(draggier, GEOMETRY)).toBeCloseTo(expected / 2, 6);
  });

  it('derives reverse terminal speed from both reverse engines', () => {
    const expected = (2 * TUNING.reverseThrustN) / TUNING.massKg / TUNING.linearDrag;
    expect(reverseTerminalSpeed(TUNING, GEOMETRY)).toBeCloseTo(expected, 6);
  });

  it('derives yaw terminal speed from nozzle torque, inertia and drag', () => {
    const torque = Math.abs(engineWrench(0, 1, TUNING, GEOMETRY).torque);
    const inertia = shipInertiaKgM2(TUNING, GEOMETRY);
    const expected = torque / inertia / TUNING.angularDrag;
    expect(yawTerminalSpeed(TUNING, GEOMETRY)).toBeCloseTo(expected, 6);
    expect(yawTerminalSpeed(TUNING, GEOMETRY)).toBeGreaterThan(0);
  });

  it('heavier ships are slower but keep the same thrust', () => {
    const heavy: FlightTuning = { ...TUNING, massKg: TUNING.massKg * 2 };
    expect(forwardTerminalSpeed(heavy, GEOMETRY)).toBeCloseTo(
      forwardTerminalSpeed(TUNING, GEOMETRY) / 2,
      6,
    );
    expect(Math.abs(engineWrench(1, 0, heavy, GEOMETRY).forceY)).toBeCloseTo(
      Math.abs(engineWrench(1, 0, TUNING, GEOMETRY).forceY),
      6,
    );
  });
});
