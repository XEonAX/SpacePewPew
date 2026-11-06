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
  { sounds: ['beam-front'], cooldown: 0.85, volume: 0.65 },
  { sounds: ['blast-1', 'blast-2'], cooldown: 0.9, volume: 0.62 },
  { sounds: ['blast-3', 'blast-4'], cooldown: 1.2, volume: 0.58 },
  { sounds: ['blast-5', 'blast-2'], cooldown: 1.35, volume: 0.55 },
];

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
