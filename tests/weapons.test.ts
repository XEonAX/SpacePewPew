import { describe, expect, it } from 'vitest';
import { WEAPON_PAIRS, WEAPON_SHOT_DELAYS, nextPairVariant } from '../src/app/weapons';

describe('weapon pairs', () => {
  it('has one front pair and three rear pairs', () => {
    expect(WEAPON_PAIRS).toHaveLength(4);
    expect(WEAPON_PAIRS[0]?.sounds).toEqual(['beam-front']);
    expect(WEAPON_PAIRS.slice(1).every((pair) => pair.sounds.length === 1)).toBe(true);
  });

  it('assigns one dedicated sound to each rear pair', () => {
    expect(WEAPON_PAIRS.slice(1).map((pair) => pair.sounds)).toEqual([
      ['blast-3'],
      ['blast-4'],
      ['blast-5'],
    ]);
  });

  it('returns the dedicated pair sound', () => {
    const pair = WEAPON_PAIRS[2]!;
    expect(nextPairVariant(pair, 0).sound).toBe('blast-4');
    expect(nextPairVariant(pair, 0).cursor).toBe(0);
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
