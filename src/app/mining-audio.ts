import type { AudioManager } from '../audio/audio';

export interface MiningAudioFrame {
  dt: number;
  /** Laser barrels cutting this frame (0..2). */
  laserBeams: number;
  /** Tractor barrels connected this frame (0..6). */
  tractorBeams: number;
  /** Per-barrel heat fractions and overheat lockouts. */
  laserHeat: readonly { heat: number; overheated: boolean }[];
  /** Both barrels are cutting the same small spot. */
  laserFocused: boolean;
}

export interface MiningAudio {
  update(frame: MiningAudioFrame): void;
  /** One-shot for a chunk landing in the hatch. */
  cargoDelivered(): void;
  destroy(): void;
}

export const MINING_LASER_GAIN = 0.7;
export const MINING_TRACTOR_GAIN = 0.45;

/** Laser bed gain: two barrels are louder than one but not twice as loud. */
export function laserGain(beams: number): number {
  if (beams <= 0) return 0;
  return MINING_LASER_GAIN * (0.7 + (0.3 * Math.min(beams, 2)) / 2);
}

/** Tractor bed gain: one connected beam is clear, extra beams add less. */
export function tractorGain(beams: number): number {
  return MINING_TRACTOR_GAIN * Math.min(1, Math.max(0, beams) / 3);
}

const SMOOTHING_PER_SECOND = 9;
/** Small deterministic pitch lift so repeated deliveries do not sound cloned. */
const CARGO_RATES: readonly number[] = [1, 1.035];

/** Laser loop pitch rises with heat; focus adds a small extra snarl. */
export function laserRate(maxHeat: number, focused: boolean): number {
  return 1 + 0.28 * Math.max(0, Math.min(1, maxHeat)) + (focused ? 0.08 : 0);
}

/** How long the vent one-shot is suppressed after a trigger. */
const VENT_COOLDOWN_S = 0.7;

/** Mining rig audio: continuous laser/tractor beds plus the cargo intake latch. */
export function createMiningAudio(audio: AudioManager): MiningAudio {
  const laser = audio.createLoop('mining-laser', { volume: 0 });
  const tractor = audio.createLoop('tractor-beam', { volume: 0 });
  let laserLevel = 0;
  let tractorLevel = 0;
  let deliveries = 0;
  let ventCooldown = 0;
  let wasOverheated = false;
  let wasFiring = false;

  return {
    update({ dt, laserBeams, tractorBeams, laserHeat, laserFocused }): void {
      const blend = 1 - Math.exp(-Math.max(dt, 0) * SMOOTHING_PER_SECOND);
      laserLevel += (laserGain(laserBeams) - laserLevel) * blend;
      tractorLevel += (tractorGain(tractorBeams) - tractorLevel) * blend;

      const maxHeat = laserHeat.reduce((peak, barrel) => Math.max(peak, barrel.heat), 0);
      const overheated = laserHeat.some((barrel) => barrel.overheated);
      const anyFiring = laserBeams > 0;
      laser.setVolume(Math.min(1, laserLevel * (1 + 0.16 * maxHeat)));
      laser.setRate(laserRate(maxHeat, laserFocused));
      tractor.setVolume(tractorLevel);
      // More connected beams pull a slightly brighter, faster field.
      tractor.setRate(1 + 0.04 * Math.min(6, Math.max(0, tractorBeams)));

      ventCooldown = Math.max(0, ventCooldown - Math.max(0, dt));
      if (overheated && !wasOverheated) {
        audio.play('laser-overheat', { volume: 0.8 });
        ventCooldown = VENT_COOLDOWN_S;
      } else if (!overheated && wasOverheated) {
        audio.play('laser-vent', { volume: 0.7, rate: 0.92 });
        ventCooldown = VENT_COOLDOWN_S;
      } else if (!anyFiring && wasFiring && maxHeat > 0.35 && ventCooldown <= 0) {
        audio.play('laser-vent', { volume: 0.35, rate: 1.06 });
        ventCooldown = VENT_COOLDOWN_S;
      }

      wasOverheated = overheated;
      wasFiring = anyFiring;
    },
    cargoDelivered(): void {
      const rate = CARGO_RATES[deliveries % CARGO_RATES.length] ?? 1;
      audio.play('cargo-intake', { volume: 0.95, rate });
      deliveries += 1;
    },
    destroy(): void {
      laser.stop();
      tractor.stop();
    },
  };
}
