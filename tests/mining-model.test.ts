import { describe, expect, it } from 'vitest';
import {
  arcToward,
  carryToward,
  dampVelocity,
  distance,
  hitsOverlap,
  pointInRotatedRect,
  pulsePhase,
  reflectDirection,
  relativeAngularRate,
} from '../src/app/mining-model';

const CARRY = { speedPerBeam: 1.8, maxSpeed: 9, arrivalSeconds: 0.9 };
const ARC = { speedPerBeam: 2.5, maxSpeed: 8, maxTurnRate: 2.2 };

describe('mining reflection', () => {
  it('bounces a head-on ray straight back', () => {
    const reflected = reflectDirection({ x: 1, y: 0 }, { x: -1, y: 0 });
    expect(reflected.x).toBeCloseTo(-1);
    expect(reflected.y).toBeCloseTo(0);
  });

  it('mirrors the incidence angle across the surface normal', () => {
    const reflected = reflectDirection({ x: 1, y: -1 }, { x: 0, y: 1 });
    const length = Math.hypot(reflected.x, reflected.y);
    expect(reflected.x / length).toBeCloseTo(Math.SQRT1_2);
    expect(reflected.y / length).toBeCloseTo(Math.SQRT1_2);
  });

  it('leaves the reflection unit-length', () => {
    const reflected = reflectDirection({ x: 3, y: 4 }, { x: -1, y: 0.5 });
    expect(Math.hypot(reflected.x, reflected.y)).toBeCloseTo(1);
  });
});

describe('metal damping', () => {
  it('slows a drifting chunk over time', () => {
    const after = dampVelocity({ x: 2, y: -1 }, 0.55, 2);
    expect(Math.hypot(after.x, after.y)).toBeLessThan(Math.hypot(2, -1));
  });

  it('keeps the direction while bleeding speed', () => {
    const after = dampVelocity({ x: 2, y: -1 }, 0.55, 2);
    expect(after.y / after.x).toBeCloseTo(-0.5);
  });

  it('leaves a chunk untouched with no damping', () => {
    expect(dampVelocity({ x: 3, y: 4 }, 0, 1)).toEqual({ x: 3, y: 4 });
  });
});

describe('tractor tracking limit', () => {
  it('is zero for motion straight along the sight line', () => {
    expect(relativeAngularRate({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
  });

  it('measures sideways motion over distance', () => {
    // r = (2, 0), v = (0, 3) -> cross 6, r^2 4 -> 1.5 rad/s.
    expect(relativeAngularRate({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 3 })).toBeCloseTo(1.5);
  });

  it('needs more slew when the object is closer', () => {
    const far = relativeAngularRate({ x: 4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 });
    const near = relativeAngularRate({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 });
    expect(near).toBeGreaterThan(far);
  });

  it('stays finite even when the object is on the muzzle', () => {
    const rate = relativeAngularRate({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBe(0);
  });
});

describe('curved tractor carry', () => {
  it('turns toward the hatch no faster than the allowed rate', () => {
    const carried = arcToward({ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 3, y: 0 }, 1 / 60, 1, ARC);
    const before = Math.atan2(0, 3);
    const after = Math.atan2(carried.vy, carried.vx);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(ARC.maxTurnRate / 60 + 1e-9);
  });

  it('limits speed by distance so the arc stays trackable', () => {
    const carried = arcToward({ x: 0.5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 6, ARC);
    expect(Math.hypot(carried.vx, carried.vy)).toBeLessThanOrEqual(ARC.maxTurnRate * 0.5 + 1e-9);
  });

  it('arrives without overshooting', () => {
    let position = { x: 6, y: 0 };
    let velocity = { x: 0, y: 2 };
    let arrived = false;
    for (let frame = 0; frame < 600 && !arrived; frame += 1) {
      const carried = arcToward(position, { x: 0, y: 0 }, velocity, 1 / 60, 1, ARC);
      position = { x: carried.x, y: carried.y };
      velocity = { x: carried.vx, y: carried.vy };
      arrived = carried.arrived;
    }
    expect(arrived).toBe(true);
    expect(Math.hypot(position.x, position.y)).toBeLessThan(0.05);
  });

  it('travels a longer (curved) path than the straight line', () => {
    let position = { x: 6, y: 0 };
    let velocity = { x: 0, y: 2 };
    let travelled = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      const carried = arcToward(position, { x: 0, y: 0 }, velocity, 1 / 60, 1, ARC);
      travelled += Math.hypot(carried.x - position.x, carried.y - position.y);
      position = { x: carried.x, y: carried.y };
      velocity = { x: carried.vx, y: carried.vy };
      if (carried.arrived) break;
    }
    expect(travelled).toBeGreaterThan(6.5);
  });
});

describe('tractor carry', () => {
  it('slides a gripped chunk toward the hatch', () => {
    const carried = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 1, CARRY);
    expect(carried.x).toBeCloseTo(0.9);
    expect(carried.y).toBeCloseTo(0);
    expect(carried.arrived).toBe(false);
  });

  it('drags faster when more beams grip the same chunk', () => {
    const one = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 1, CARRY);
    const three = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 3, CARRY);
    expect(three.x).toBeGreaterThan(one.x);
  });

  it('caps the carried speed however many beams are active', () => {
    const many = carryToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 20, CARRY);
    expect(many.x).toBeCloseTo(CARRY.maxSpeed);
  });

  it('eases in as it reaches the hatch', () => {
    const far = carryToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 2, CARRY);
    const near = carryToward({ x: 9.6, y: 0 }, { x: 10, y: 0 }, 0.5, 2, CARRY);
    expect(near.x - 9.6).toBeLessThan(far.x);
  });

  it('cannot overshoot the hatch and snaps onto it', () => {
    const carried = carryToward({ x: 9.9, y: 0 }, { x: 10, y: 0 }, 1, 6, CARRY);
    expect(carried.x).toBeCloseTo(10);
    expect(carried.arrived).toBe(true);
  });

  it('does not move a chunk no beam is holding', () => {
    const carried = carryToward({ x: 2, y: 3 }, { x: 10, y: 0 }, 0.5, 0, CARRY);
    expect(carried).toEqual({ x: 2, y: 3, arrived: false });
  });

  it('measures straight-line distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('grill intake rectangle', () => {
  it('accepts a point inside an axis-aligned hatch', () => {
    expect(pointInRotatedRect({ x: 10.5, y: 0.2 }, { x: 10, y: 0 }, 0, 1, 0.5)).toBe(true);
    expect(pointInRotatedRect({ x: 12, y: 0 }, { x: 10, y: 0 }, 0, 1, 0.5)).toBe(false);
  });

  it('rotates the hatch with the ship', () => {
    // At 90 degrees the hatch's local width lies along world Y and its local
    // height along world X, so the axes swap in world space.
    const centre = { x: 0, y: 0 };
    expect(pointInRotatedRect({ x: -0.5, y: 1 }, centre, Math.PI / 2, 2, 1)).toBe(true);
    expect(pointInRotatedRect({ x: 1.5, y: 0 }, centre, Math.PI / 2, 2, 1)).toBe(false);
  });
});

describe('intake pulses', () => {
  it('sweeps one full ring cycle per period', () => {
    expect(pulsePhase(0, 1, 0, 1)).toBeCloseTo(0);
    expect(pulsePhase(0.25, 1, 0, 1)).toBeCloseTo(0.25);
    expect(pulsePhase(0.5, 1, 0, 1)).toBeCloseTo(0.5);
    expect(pulsePhase(0.999, 1, 0, 1)).toBeCloseTo(0.999);
  });

  it('wraps back to the start after a period', () => {
    expect(pulsePhase(1, 1, 0, 1)).toBeCloseTo(0);
    expect(pulsePhase(2.5, 1, 0, 2)).toBeCloseTo(0.25);
  });

  it('staggers rings by their offset and stays in range', () => {
    expect(pulsePhase(0, 1, 1 / 3, 1)).toBeCloseTo(1 / 3);
    expect(pulsePhase(0, 1, 2 / 3, 1)).toBeCloseTo(2 / 3);
    expect(pulsePhase(0.9, 1, 0.9, 1)).toBeCloseTo(0.8);
  });

  it('travels faster while cargo is inbound', () => {
    const idle = pulsePhase(0.4, 1, 0, 1);
    const pull = pulsePhase(0.4, 1.7, 0, 1);
    expect(pull).toBeGreaterThan(idle);
  });

  it('never returns a negative or NaN phase for a zero period', () => {
    expect(pulsePhase(-0.5, 1, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(pulsePhase(1, 1, 0, 0))).toBe(false);
  });
});

describe('hitsOverlap', () => {
  it('focuses two hit points inside the radius', () => {
    expect(hitsOverlap({ x: 0, y: 0 }, { x: 1, y: 0 }, 1.2)).toBe(true);
    expect(hitsOverlap({ x: 0, y: 0 }, { x: 1.3, y: 0 }, 1.2)).toBe(false);
  });

  it('does not focus a missing beam', () => {
    expect(hitsOverlap(null, { x: 0, y: 0 }, 1.2)).toBe(false);
    expect(hitsOverlap({ x: 0, y: 0 }, null, 1.2)).toBe(false);
  });
});
