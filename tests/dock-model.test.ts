import { describe, expect, it } from 'vitest';
import { isInDockZone } from '../src/app/dock-model';

const zone = { x: 0, y: 0, radiusM: 4.5 };

describe('isInDockZone', () => {
  it('docks only when close and slow', () => {
    expect(isInDockZone(1, 1, 0.5, zone)).toBe(true);
    expect(isInDockZone(5, 0, 0.5, zone)).toBe(false);
    expect(isInDockZone(1, 1, 3, zone)).toBe(false);
  });

  it('uses a custom speed tolerance', () => {
    expect(isInDockZone(1, 1, 3, zone, 4)).toBe(true);
  });
});
