import type { AudioManager } from '../audio/audio';

export interface MiningAudioFrame {
  dt: number;
  /** Laser barrels cutting this frame (0..2). */
  laserBeams: number;
  /** Tractor barrels connected this frame (0..6). */
  tractorBeams: number;
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

/** Mining rig audio: continuous laser/tractor beds plus the cargo intake latch. */
export function createMiningAudio(audio: AudioManager): MiningAudio {
  const laser = audio.createLoop('mining-laser', { volume: 0 });
  const tractor = audio.createLoop('tractor-beam', { volume: 0 });
  let laserLevel = 0;
  let tractorLevel = 0;
  let deliveries = 0;

  return {
    update({ dt, laserBeams, tractorBeams }): void {
      const blend = 1 - Math.exp(-Math.max(dt, 0) * SMOOTHING_PER_SECOND);
      laserLevel += (laserGain(laserBeams) - laserLevel) * blend;
      tractorLevel += (tractorGain(tractorBeams) - tractorLevel) * blend;

      laser.setVolume(laserLevel);
      tractor.setVolume(tractorLevel);
      // More connected beams pull a slightly brighter, faster field.
      tractor.setRate(1 + 0.04 * Math.min(6, Math.max(0, tractorBeams)));
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
