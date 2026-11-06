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
  { sounds: ['blast-3'], cooldown: 1.0, volume: 0.62 },
  { sounds: ['blast-4'], cooldown: 1.25, volume: 0.58 },
  { sounds: ['blast-5'], cooldown: 1.4, volume: 0.55 },
];

/** Time from clip start to its first audible shot transient. */
export const WEAPON_SHOT_DELAYS: Record<SoundName, number> = {
  'beam-front': 0.035,
  'blast-3': 0.63,
  'blast-4': 0.704,
  'blast-5': 0.737,
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
