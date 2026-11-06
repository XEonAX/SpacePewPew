import { Howl, Howler } from 'howler';
import { joinBaseUrl } from '../utils/paths';

export type SoundName = 'blip';

const SOUND_SOURCES: Record<SoundName, string> = {
  blip: 'audio/blip.wav',
};

export interface AudioManagerOptions {
  baseUrl?: string;
  volume?: number;
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

  play(name: SoundName): void {
    if (!this.#enabled || this.#muted) return;

    const sound = this.#sounds.get(name);
    if (!sound || sound.state() !== 'loaded') return;

    sound.play();
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
