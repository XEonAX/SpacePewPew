import type { SoundName } from '../audio/audio';

export interface WeaponPairSpec {
  /** Cycled without an immediate repeat. */
  sounds: readonly SoundName[];
  /** Seconds between shots from this pair. */
  cooldown: number;
  /** Per-shot volume multiplier. */
  volume: number;
}

/**
 * Pair order matches the turret mount order:
 * front, middle 1, middle 2, rear.
 */
export const WEAPON_PAIRS: readonly WeaponPairSpec[] = [
  { sounds: ['beam-front'], cooldown: 0.55, volume: 0.65 },
  { sounds: ['blast-3'], cooldown: 0.8, volume: 0.62 },
  { sounds: ['blast-4'], cooldown: 0.9, volume: 0.58 },
  { sounds: ['blast-5'], cooldown: 1.0, volume: 0.55 },
];

/** Time from clip start to its first audible shot transient. */
export const WEAPON_SHOT_DELAYS: Record<SoundName, number> = {
  'beam-front': 0.035,
  'blast-3': 0.286,
  'blast-4': 0.285,
  'blast-5': 0.279,
};

export function nextPairVariant(
  pair: WeaponPairSpec,
  cursor: number,
): { sound: SoundName; cursor: number } {
  const index = cursor % pair.sounds.length;
  return {
    sound: pair.sounds[index]!,
    cursor: (index + 1) % pair.sounds.length,
  };
}

/** A barrel pose in ship-texture pixels, relative to the ship centre. */
export interface MuzzleAim {
  x: number;
  y: number;
  angle: number;
}

/** A muzzle tagged with the turret pair that owns it. */
export interface PairMuzzle extends MuzzleAim {
  pairIndex: number;
}

export interface MuzzleWorldPose {
  x: number;
  y: number;
  angle: number;
}

/**
 * A shot committed at trigger time. It carries its own barrel snapshot, so it
 * still spawns after the mouse leaves the pair's aiming arc — the live turrets
 * are never consulted again for this shot.
 */
export interface PendingShot {
  pairIndex: number;
  muzzles: readonly MuzzleAim[];
  /** Seconds of charge left before the projectile leaves the barrel. */
  remaining: number;
  total: number;
}

export function muzzlesForPair(muzzles: readonly PairMuzzle[], pairIndex: number): PairMuzzle[] {
  return muzzles.filter((muzzle) => muzzle.pairIndex === pairIndex);
}

/** Ship-local barrel pose (texture px) to a world pose in metres. */
export function muzzleWorldPose(
  muzzle: MuzzleAim,
  shipX: number,
  shipY: number,
  rotation: number,
  metresPerTexturePixel: number,
): MuzzleWorldPose {
  const localX = muzzle.x * metresPerTexturePixel;
  const localY = muzzle.y * metresPerTexturePixel;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: shipX + localX * cos - localY * sin,
    y: shipY + localX * sin + localY * cos,
    angle: rotation + muzzle.angle,
  };
}

/**
 * Freezes the trigger-time barrel poses into the pending queue. Returns
 * `undefined` when no barrel is tracking the pair, so a shot is never charged
 * (and never sounds) without a projectile behind it.
 */
export function commitShot(
  pending: PendingShot[],
  pairIndex: number,
  muzzles: readonly PairMuzzle[],
  delay: number,
): PendingShot | undefined {
  if (muzzles.length === 0) return undefined;

  const charge = Math.max(0, delay);
  const shot: PendingShot = {
    pairIndex,
    muzzles: muzzles.map((muzzle) => ({ x: muzzle.x, y: muzzle.y, angle: muzzle.angle })),
    remaining: charge,
    total: charge,
  };
  pending.push(shot);
  return shot;
}

/** Ticks committed shots and fires each one exactly once. */
export function advanceShots(
  pending: PendingShot[],
  dt: number,
  onFire: (shot: PendingShot) => void,
): void {
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const shot = pending[index]!;
    shot.remaining -= dt;
    if (shot.remaining > 0) continue;
    pending.splice(index, 1);
    onFire(shot);
  }
}
