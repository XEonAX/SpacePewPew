import { describe, expect, it } from 'vitest';
import {
  WEAPON_PAIRS,
  WEAPON_SHOT_DELAYS,
  advanceShots,
  commitShot,
  muzzleWorldPose,
  muzzlesForPair,
  nextPairVariant,
} from '../src/app/weapons';
import type { PairMuzzle, PendingShot } from '../src/app/weapons';

const SIDE_MUZZLE: PairMuzzle = { pairIndex: 1, x: 4, y: 2, angle: -Math.PI / 2 };

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

describe('committed shots', () => {
  it('selects only the barrels owned by the firing pair', () => {
    const muzzles: PairMuzzle[] = [
      { pairIndex: 0, x: -1, y: -2, angle: 0 },
      { pairIndex: 1, x: 3, y: 4, angle: 0 },
      { pairIndex: 1, x: 5, y: 6, angle: 0 },
      { pairIndex: 2, x: 7, y: 8, angle: 0 },
    ];
    expect(muzzlesForPair(muzzles, 1)).toEqual([
      { pairIndex: 1, x: 3, y: 4, angle: 0 },
      { pairIndex: 1, x: 5, y: 6, angle: 0 },
    ]);
    expect(muzzlesForPair(muzzles, 3)).toEqual([]);
  });

  it('places a ship-local muzzle in metres, rotated with the hull', () => {
    const pose = muzzleWorldPose({ x: 2, y: 0, angle: -Math.PI / 2 }, 10, -4, Math.PI / 2, 0.5);
    expect(pose.x).toBeCloseTo(10);
    expect(pose.y).toBeCloseTo(-3);
    expect(pose.angle).toBeCloseTo(Math.PI / 2 - Math.PI / 2);
  });

  it('refuses to charge a shot when no barrel is tracking the pair', () => {
    const pending: PendingShot[] = [];
    expect(commitShot(pending, 1, [], 0.28)).toBeUndefined();
    expect(pending).toHaveLength(0);
  });

  it('fires a shot committed inside the arc after the mouse leaves it', () => {
    const pending: PendingShot[] = [];
    const live: PairMuzzle[] = [{ ...SIDE_MUZZLE }];
    const shot = commitShot(pending, SIDE_MUZZLE.pairIndex, muzzlesForPair(live, 1), 0.28);
    expect(shot?.muzzles).toEqual([{ x: 4, y: 2, angle: -Math.PI / 2 }]);

    // The mouse leaves the cone: the pair stops tracking and reports no muzzle.
    live.length = 0;

    const fired: PendingShot[] = [];
    advanceShots(pending, 0.2, (pendingShot) => fired.push(pendingShot));
    expect(fired).toHaveLength(0);

    advanceShots(pending, 0.1, (pendingShot) => fired.push(pendingShot));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.muzzles).toEqual([{ x: 4, y: 2, angle: -Math.PI / 2 }]);
    expect(pending).toHaveLength(0);
  });

  it('keeps the barrel snapshot independent of the live turret poses', () => {
    const pending: PendingShot[] = [];
    const live: PairMuzzle[] = [{ ...SIDE_MUZZLE }];
    commitShot(pending, 1, muzzlesForPair(live, 1), 0.1);
    live[0]!.x = 999;
    live[0]!.angle = Math.PI;
    expect(pending[0]?.muzzles[0]).toEqual({ x: 4, y: 2, angle: -Math.PI / 2 });
  });

  it('fires each committed shot exactly once', () => {
    const pending: PendingShot[] = [];
    commitShot(pending, 1, [{ ...SIDE_MUZZLE }], 0.05);
    commitShot(pending, 2, [{ ...SIDE_MUZZLE, pairIndex: 2 }], 0.2);
    const fired: number[] = [];
    advanceShots(pending, 0.1, (shot) => fired.push(shot.pairIndex));
    advanceShots(pending, 0.1, (shot) => fired.push(shot.pairIndex));
    advanceShots(pending, 1, (shot) => fired.push(shot.pairIndex));
    expect(fired).toEqual([1, 2]);
    expect(pending).toHaveLength(0);
  });
});
