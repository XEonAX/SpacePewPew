import { describe, expect, it } from 'vitest';
import { dockAlignment, normalizeAngle } from '../src/app/dock-alignment';

const base = {
  shipX: 0,
  shipY: 0,
  shipRotation: 0,
  speedMps: 0,
  targetX: 0,
  targetY: 0,
  targetRotationRad: 0,
};

describe('dockAlignment', () => {
  it('is aligned at the target, pointed correctly and stopped', () => {
    const readout = dockAlignment(base);
    expect(readout.aligned).toBe(true);
    expect(readout.distanceM).toBe(0);
    expect(readout.positionScore).toBe(1);
    expect(readout.headingScore).toBe(1);
    expect(readout.speedScore).toBe(1);
  });

  it('rejects being off centre, rotated or too fast', () => {
    expect(dockAlignment({ ...base, shipX: 2 }).aligned).toBe(false);
    expect(dockAlignment({ ...base, shipRotation: 0.25 }).aligned).toBe(false);
    expect(dockAlignment({ ...base, speedMps: 0.3 }).aligned).toBe(false);
    expect(dockAlignment({ ...base, speedMps: 0.1 }).aligned).toBe(true);
  });

  it('normalizes heading across the wrap point', () => {
    expect(normalizeAngle(Math.PI * 2 - 0.1)).toBeCloseTo(-0.1);
    const readout = dockAlignment({
      ...base,
      targetRotationRad: Math.PI * 2 - 0.05,
      shipRotation: 0.05,
    });
    expect(readout.headingErrorRad).toBeCloseTo(0.1);
  });
});
