import type { AudioManager } from '../audio/audio';

export interface ImpactAudioFrame {
  dt: number;
  /** Worst inward contact speed this frame, m/s. */
  impactSpeed: number;
  /** Energy of that contact, J. */
  hitEnergy: number;
  /** Worst tangential contact speed this frame, m/s. */
  slideSpeed: number;
}

export interface ImpactAudio {
  update(frame: ImpactAudioFrame): void;
  destroy(): void;
}

/** Contact speed below which a touch is a graze, not a hit. */
export const IMPACT_MIN_SPEED_MPS = 1.1;
/** Energy that makes an impact a full-force crunch. */
export const IMPACT_FULL_ENERGY_J = 90_000;
/** Contact speed that saturates the scrape bed. */
export const SCRAPE_FULL_SPEED_MPS = 6;
/** Scrape bed ceiling. */
export const SCRAPE_GAIN = 0.55;
const IMPACT_COOLDOWN_SECONDS = 0.12;
const SCRAPE_SMOOTHING_PER_SECOND = 8;

export function impactStrength(hitEnergy: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, hitEnergy) / IMPACT_FULL_ENERGY_J));
}

/** One-shot volume: grazes are quiet, full-speed hits are loud. */
export function impactVolume(hitEnergy: number): number {
  return 0.22 + 0.7 * impactStrength(hitEnergy);
}

/** One-shot playback rate: heavier hits sit a little lower. */
export function impactRate(hitEnergy: number): number {
  return 1.06 - 0.26 * impactStrength(hitEnergy);
}

/** Scrape bed gain from how fast the shield is sliding across the rock. */
export function scrapeGain(slideSpeed: number): number {
  return SCRAPE_GAIN * Math.min(1, Math.max(0, slideSpeed) / SCRAPE_FULL_SPEED_MPS);
}

/** Scrape bed rate: fast slides grind brighter. */
export function scrapeRate(slideSpeed: number): number {
  return 0.82 + 0.36 * Math.min(1, Math.max(0, slideSpeed) / SCRAPE_FULL_SPEED_MPS);
}

/** Impact one-shots plus a continuous scrape bed while the hull grinds rock. */
export function createImpactAudio(audio: AudioManager): ImpactAudio {
  const scrape = audio.createLoop('scrape', { volume: 0 });
  let scrapeLevel = 0;
  let cooldown = 0;
  let shots = 0;

  return {
    update({ dt, impactSpeed, hitEnergy, slideSpeed }): void {
      const delta = Math.max(0, dt);
      cooldown = Math.max(0, cooldown - delta);

      scrapeLevel +=
        (scrapeGain(slideSpeed) - scrapeLevel) *
        (1 - Math.exp(-delta * SCRAPE_SMOOTHING_PER_SECOND));
      scrape.setVolume(scrapeLevel);
      scrape.setRate(scrapeRate(slideSpeed));

      if (impactSpeed < IMPACT_MIN_SPEED_MPS || cooldown > 0) return;

      cooldown = IMPACT_COOLDOWN_SECONDS;
      audio.play(shots % 2 === 0 ? 'impact-1' : 'impact-2', {
        volume: impactVolume(hitEnergy),
        rate: impactRate(hitEnergy),
      });
      shots += 1;
    },
    destroy(): void {
      scrape.stop();
    },
  };
}
