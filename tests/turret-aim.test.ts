import { describe, expect, it } from 'vitest';
import {
  TURRET_MAX_ANGULAR_SPEED,
  clampAngleToArc,
  stepTurretAim,
  stepTurretAimInArc,
  wrapAngle,
} from '../src/app/turret-aim';
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

  it('clamps front turrets to their forward cone', () => {
    const half = Math.PI / 3;
    expect(clampAngleToArc(Math.PI, 0, half)).toBeCloseTo(half, 6);
    expect(clampAngleToArc(-Math.PI, 0, half)).toBeCloseTo(-half, 6);
  });

  it('keeps mid turrets centred on the sides', () => {
    const center = Math.PI / 2;
    const half = Math.PI / 4;

    expect(clampAngleToArc(0, center, half)).toBeCloseTo(Math.PI / 4, 6);
    expect(clampAngleToArc(Math.PI, center, half)).toBeCloseTo((3 * Math.PI) / 4, 6);
    expect(clampAngleToArc(0, -center, half)).toBeCloseTo(-Math.PI / 4, 6);
    expect(clampAngleToArc(Math.PI, -center, half)).toBeCloseTo(-(3 * Math.PI) / 4, 6);
  });

  it('lets rear turrets cover the sides and the rear', () => {
    const center = (3 * Math.PI) / 4;
    const half = Math.PI / 4;

    // A front target clamps to sideways; a rear target is reachable.
    expect(clampAngleToArc(0, center, half)).toBeCloseTo(Math.PI / 2, 6);
    expect(clampAngleToArc(0, -center, half)).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.abs(clampAngleToArc(Math.PI, center, half))).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(clampAngleToArc(Math.PI, -center, half))).toBeCloseTo(Math.PI, 6);
  });

  it('never rotates outside the aiming cone, even when the mouse is outside it', () => {
    const state: TurretAimState = { angle: Math.PI / 2, angularVelocity: 0 };
    const center = Math.PI / 2;
    const half = Math.PI / 4;
    const dt = 1 / 60;

    for (let frame = 0; frame < 300; frame += 1) {
      stepTurretAimInArc(state, 0, center, half, dt);
      expect(Math.abs(wrapAngle(state.angle - center))).toBeLessThanOrEqual(half + 1e-9);
    }

    expect(state.angle).toBeCloseTo(Math.PI / 4, 6);
    expect(state.angularVelocity).toBeCloseTo(0, 6);
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
