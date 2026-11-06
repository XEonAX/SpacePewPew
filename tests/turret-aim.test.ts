import { describe, expect, it } from 'vitest';
import { TURRET_MAX_ANGULAR_SPEED, stepTurretAim, wrapAngle } from '../src/app/turret-aim';
import type { TurretAimState } from '../src/app/turret-aim';

function aimState(): TurretAimState {
  return { angle: 0, angularVelocity: 0 };
}

describe('turret aim', () => {
  it('wraps angles to [-π, π]', () => {
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(wrapAngle(-Math.PI * 3))).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(0)).toBe(0);
  });

  it('never exceeds the maximum turn speed', () => {
    const state = aimState();
    const dt = 1 / 60;

    for (let frame = 0; frame < 120; frame += 1) {
      stepTurretAim(state, Math.PI, dt);
      expect(Math.abs(state.angularVelocity)).toBeLessThanOrEqual(TURRET_MAX_ANGULAR_SPEED + 1e-9);
    }
  });

  it('converges on a stationary target', () => {
    const state = aimState();
    const dt = 1 / 60;
    const target = 1.1;

    for (let frame = 0; frame < 180; frame += 1) {
      stepTurretAim(state, target, dt);
    }

    expect(Math.abs(wrapAngle(target - state.angle))).toBeLessThan(0.02);
  });

  it('turns toward a new target without teleporting', () => {
    const state = aimState();
    const dt = 1 / 60;

    stepTurretAim(state, Math.PI / 2, dt);

    expect(Math.abs(state.angle)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(state.angularVelocity)).toBeGreaterThan(0);
  });
});
