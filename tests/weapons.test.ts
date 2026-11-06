import { describe, expect, it } from 'vitest';
import { WEAPON_PAIRS, WEAPON_SHOT_DELAYS, nextPairVariant } from '../src/app/weapons';

describe('weapon pairs', () => {
  it('has one front pair and three rear pairs', () => {
    expect(WEAPON_PAIRS).toHaveLength(4);
    expect(WEAPON_PAIRS[0]?.sounds).toEqual(['beam-front']);
    expect(WEAPON_PAIRS.slice(1).every((pair) => pair.sounds.length === 2)).toBe(true);
  });

  it('uses the three clean rear blast variants', () => {
    expect(new Set(WEAPON_PAIRS.slice(1).flatMap((pair) => pair.sounds))).toEqual(
      new Set(['blast-1', 'blast-2', 'blast-3']),
    );
  });

  it('cycles a pair without repeating the previous shot', () => {
    const pair = WEAPON_PAIRS[1]!;
    const first = nextPairVariant(pair, 0);
    const second = nextPairVariant(pair, first.cursor);
    const third = nextPairVariant(pair, second.cursor);

    expect(first.sound).toBe('blast-1');
    expect(second.sound).toBe('blast-2');
    expect(third.sound).toBe('blast-1');
  });

  it('keeps every pair cooldown positive', () => {
    expect(WEAPON_PAIRS.every((pair) => pair.cooldown > 0)).toBe(true);
  });

  it('has a sound-attack delay for every fired sound', () => {
    for (const pair of WEAPON_PAIRS) {
      for (const sound of pair.sounds) {
        expect(WEAPON_SHOT_DELAYS[sound]).toBeGreaterThan(0);
        expect(WEAPON_SHOT_DELAYS[sound]).toBeLessThan(pair.cooldown);
      }
    }
  });
});
