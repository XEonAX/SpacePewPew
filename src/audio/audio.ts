import { Howl, Howler } from 'howler';
import { joinBaseUrl } from '../utils/paths';

export type SoundName = 'beam-front' | 'blast-1' | 'blast-2';

export interface PlayOptions {
  /** Playback rate, default 1. */
  rate?: number;
  /** Per-shot volume multiplier, default 1. */
  volume?: number;
  /** Stereo pan from -1 (left) to 1 (right). */
  pan?: number;
}

const SOUND_SOURCES: Record<SoundName, string> = {
  'beam-front': 'audio/weapons/beam-front.wav',
  'blast-1': 'audio/weapons/blast-1.wav',
  'blast-2': 'audio/weapons/blast-2.wav',
};

export interface AudioManagerOptions {
  baseUrl?: string;
  volume?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Thin, typed wrapper around Howler.
 *
 * All game audio should go through this class so volume, mute and unlock
 * behaviour stay in one place. Browsers require a user gesture before audio
 * can play — call `enable()` from a pointer/keyboard handler.
 */
export class AudioManager {
  readonly #sounds = new Map<SoundName, Howl>();
  readonly #baseUrl: string;
  readonly #volume: number;
  #enabled = false;
  #muted = false;

  constructor({ baseUrl = '/', volume = 0.6 }: AudioManagerOptions = {}) {
    this.#baseUrl = baseUrl;
    this.#volume = volume;
  }

  get muted(): boolean {
    return this.#muted;
  }

  async load(): Promise<void> {
    const entries = Object.entries(SOUND_SOURCES) as [SoundName, string][];

    await Promise.all(
      entries.map(async ([name, source]) => {
        const sound = await loadSound(joinBaseUrl(this.#baseUrl, source), this.#volume);
        if (sound) this.#sounds.set(name, sound);
      }),
    );
  }

  async enable(): Promise<void> {
    this.#enabled = true;

    const context = Howler.ctx;
    if (context?.state === 'suspended') {
      await context.resume();
    }
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    if (!this.#enabled || this.#muted) return;

    const sound = this.#sounds.get(name);
    if (!sound || sound.state() !== 'loaded') return;

    const id = sound.play();
    if (id < 1) return;

    sound.volume(clamp(this.#volume * (options.volume ?? 1), 0, 1), id);
    if (options.rate !== undefined) {
      sound.rate(clamp(options.rate, 0.5, 4), id);
    }
    if (options.pan !== undefined && Math.abs(options.pan) > 0.001) {
      sound.stereo(clamp(options.pan, -1, 1), id);
    }
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    Howler.mute(muted);
  }

  toggleMute(): boolean {
    this.setMuted(!this.#muted);
    return this.#muted;
  }

  destroy(): void {
    for (const sound of this.#sounds.values()) {
      sound.unload();
    }
    this.#sounds.clear();
    Howler.unload();
  }
}

function loadSound(source: string, volume: number): Promise<Howl | null> {
  return new Promise((resolve) => {
    const sound = new Howl({
      src: [source],
      volume,
      preload: true,
      onload: () => resolve(sound),
      onloaderror: (_soundId, error) => {
        console.warn(`[audio] failed to load "${source}":`, error);
        resolve(null);
      },
    });
  });
}
