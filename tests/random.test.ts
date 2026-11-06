import { describe, expect, it } from 'vitest';
import { createRng, pickOne, randomRange } from '../src/utils/random';

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    const first = createRng(1234);
    const second = createRng(1234);

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it('produces different sequences for different seeds', () => {
    const first = createRng(1);
    const second = createRng(2);

    expect(first()).not.toBe(second());
  });

  it('returns values in [0, 1)', () => {
    const rng = createRng(42);

    for (let index = 0; index < 100; index += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('randomRange', () => {
  it('stays within the requested range', () => {
    const rng = createRng(7);

    for (let index = 0; index < 50; index += 1) {
      const value = randomRange(rng, -5, 5);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(5);
    }
  });
});

describe('pickOne', () => {
  it('is deterministic and stays in bounds', () => {
    const values = [10, 20, 30] as const;
    const rng = createRng(99);
    const picked = pickOne(rng, values);

    expect(values).toContain(picked);
  });

  it('rejects an empty list', () => {
    expect(() => pickOne(createRng(1), [])).toThrow('at least one value');
  });
});
