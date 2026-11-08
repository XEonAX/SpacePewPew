import { describe, expect, it } from 'vitest';
import {
  formatEnergyJ,
  formatG,
  gForceFromVelocityDelta,
  STANDARD_GRAVITY,
} from '../src/app/telemetry-model';

describe('telemetry model', () => {
  it('converts a velocity change to g-force', () => {
    expect(gForceFromVelocityDelta(0, 0, 0.016)).toBe(0);
    expect(gForceFromVelocityDelta(STANDARD_GRAVITY, 0, 1)).toBeCloseTo(1, 6);
    expect(gForceFromVelocityDelta(0, STANDARD_GRAVITY * 2, 0.5)).toBeCloseTo(4, 6);
    // Degenerate frame time is ignored instead of dividing by zero.
    expect(gForceFromVelocityDelta(1, 1, 0)).toBe(0);
  });

  it('formats g-force and shield energy', () => {
    expect(formatG(1.234)).toBe('1.23 g');
    expect(formatEnergyJ(450)).toBe('450 J');
    expect(formatEnergyJ(12_345)).toBe('12.3 kJ');
    expect(formatEnergyJ(2_500_000)).toBe('2.50 MJ');
  });
});
