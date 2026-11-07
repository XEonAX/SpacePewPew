import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIGHT_TUNING,
  createFlightState,
  stepFlight,
  wrenchFromMix,
} from '../src/app/ship-flight';
import type { FlightControls, FlightState } from '../src/app/ship-flight';
import { stabilizerEngineOutputs } from '../src/app/stabilizer';
import type { ShipGeometry } from '../src/app/ship-engines';

const dt = 1 / 60;
const TUNING = DEFAULT_FLIGHT_TUNING;
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

const stabilize: FlightControls = {
  forward: false,
  reverse: false,
  turnLeft: false,
  turnRight: false,
  stabilize: true,
};

function sum(outputs: readonly number[]): number {
  return outputs.reduce((total, value) => total + value, 0);
}

function speedOf(state: FlightState): number {
  return Math.hypot(state.vx, state.vy);
}

describe('stabilizer', () => {
  it('fires the reversers when travelling forwards', () => {
    const state = createFlightState();
    state.vy = -30; // rotation 0: forward is -y
    const mix = stabilizerEngineOutputs(state, TUNING, GEOMETRY, 1);
    const wrench = wrenchFromMix(mix, TUNING, GEOMETRY);

    expect(sum(mix.reverse)).toBeGreaterThan(0);
    expect(sum(mix.main)).toBeCloseTo(0, 6);
    // Force opposes travel and there is no induced spin.
    expect(wrench.forceY).toBeGreaterThan(0);
    expect(wrench.torque).toBeCloseTo(0, 6);
    expect(wrench.forceX * state.vx + wrench.forceY * state.vy).toBeLessThan(0);
  });

  it('fires the mains when travelling backwards', () => {
    const state = createFlightState();
    state.vy = 20;
    const mix = stabilizerEngineOutputs(state, TUNING, GEOMETRY, 1);
    const wrench = wrenchFromMix(mix, TUNING, GEOMETRY);

    expect(sum(mix.main)).toBeGreaterThan(0);
    expect(wrench.forceY).toBeLessThan(0);
    expect(wrench.forceX * state.vx + wrench.forceY * state.vy).toBeLessThan(0);
  });

  it('counter-torques a spin with a balanced couple', () => {
    const state = createFlightState();
    state.angularVelocity = 2;
    const mix = stabilizerEngineOutputs(state, TUNING, GEOMETRY, 1);
    const wrench = wrenchFromMix(mix, TUNING, GEOMETRY);

    expect(wrench.torque).toBeLessThan(0); // opposite the positive spin
    expect(Math.abs(wrench.forceY)).toBeLessThan(1e-6); // pure couple
    expect(Math.abs(wrench.forceX)).toBeLessThan(1e-6);
  });

  it('never asks a nozzle past full output', () => {
    const state = createFlightState();
    state.vx = 40;
    state.vy = -40;
    state.angularVelocity = 4;
    const mix = stabilizerEngineOutputs(state, TUNING, GEOMETRY, 1);
    for (const output of [...mix.main, ...mix.reverse]) {
      expect(output).toBeGreaterThanOrEqual(0);
      expect(output).toBeLessThanOrEqual(1);
    }
  });

  it('scales with the ramped demand', () => {
    const state = createFlightState();
    state.vy = -20;
    const off = stabilizerEngineOutputs(state, TUNING, GEOMETRY, 0);
    const half = stabilizerEngineOutputs(state, TUNING, GEOMETRY, 0.5);
    const full = stabilizerEngineOutputs(state, TUNING, GEOMETRY, 1);

    expect(sum(off.reverse)).toBe(0);
    expect(sum(half.reverse)).toBeCloseTo(sum(full.reverse) / 2, 6);
  });

  it('steps the flight model with the stabilizer mix', () => {
    const state = createFlightState();
    state.vy = -20;
    const mix = stepFlight(state, stabilize, dt, TUNING, GEOMETRY);
    expect(sum(mix.reverse)).toBeGreaterThan(0);
    expect(state.stabilizeInput).toBeGreaterThan(0);
  });
});

describe('stabilizer closed loop', () => {
  function settle(
    start: Partial<FlightState>,
    maxSeconds = 9,
  ): { state: FlightState; seconds: number } {
    const state = createFlightState();
    Object.assign(state, start);
    let seconds = 0;
    while (seconds < maxSeconds) {
      stepFlight(state, stabilize, dt, TUNING, GEOMETRY);
      seconds += dt;
      if (speedOf(state) < 0.25 && Math.abs(state.angularVelocity) < 0.05) break;
    }
    return { state, seconds };
  }

  it('stops forward travel with a retro burn', () => {
    const { state, seconds } = settle({ vy: -30 });
    expect(seconds).toBeLessThan(4);
    expect(speedOf(state)).toBeLessThan(0.25);
    expect(state.rotation).toBeCloseTo(0, 1);
  });

  it('stops backward travel on the mains', () => {
    const { state, seconds } = settle({ vy: 20 });
    expect(seconds).toBeLessThan(4);
    expect(speedOf(state)).toBeLessThan(0.25);
  });

  it('kills a spin', () => {
    const { state, seconds } = settle({ angularVelocity: 2 }, 3);
    expect(seconds).toBeLessThan(2);
    expect(Math.abs(state.angularVelocity)).toBeLessThan(0.05);
  });

  it('turns to face a sideways drift, then brakes it', () => {
    const { state, seconds } = settle({ vx: 20 });
    expect(seconds).toBeLessThan(9);
    expect(speedOf(state)).toBeLessThan(0.25);
    // It points along the drift (nose along +x) before burning retro.
    expect(state.rotation).toBeCloseTo(Math.PI / 2, 0);
  });

  it('handles translation and spin together', () => {
    const { state, seconds } = settle({ vx: 15, vy: -15, angularVelocity: -1.5 });
    expect(seconds).toBeLessThan(9);
    expect(speedOf(state)).toBeLessThan(0.25);
    expect(Math.abs(state.angularVelocity)).toBeLessThan(0.05);
  });
});
