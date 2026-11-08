import { Howl, Howler } from 'howler';
import { joinBaseUrl } from '../utils/paths';

export type SoundName =
  | 'beam-front'
  | 'blast-3'
  | 'blast-4'
  | 'blast-5'
  | 'cargo-intake'
  | 'impact-1'
  | 'impact-2'
  | 'laser-overheat'
  | 'laser-ready';

/** Continuous, looped beds (engine hums, beams, grinding). */
export type LoopName =
  | 'engine-main'
  | 'engine-side'
  | 'engine-reverse'
  | 'engine-rush'
  | 'engine-strain'
  | 'mining-laser'
  | 'tractor-beam'
  | 'scrape';

export interface PlayOptions {
  /** Playback rate, default 1. */
  rate?: number;
  /** Per-shot volume multiplier, default 1. */
  volume?: number;
  /** Stereo pan from -1 (left) to 1 (right). */
  pan?: number;
}

export interface LoopOptions {
  /** Loop gain, 0..1, default 0 (silent until the engine spools up). */
  volume?: number;
  /** Playback rate, default 1. */
  rate?: number;
  /** Stereo pan from -1 (left) to 1 (right). */
  pan?: number;
}

/** Live handle for one looping voice; volume/rate/pan changes are click-free. */
export interface LoopHandle {
  setVolume(volume: number): void;
  setRate(rate: number): void;
  setPan(pan: number): void;
  stop(): void;
}

interface LoopBinding {
  name: LoopName;
  sound: Howl | null;
  id: number | null;
  volume: number;
  rate: number;
  pan: number;
  stopped: boolean;
}

const SOUND_SOURCES: Record<SoundName, string> = {
  'beam-front': 'audio/weapons/beam-front.wav',
  'blast-3': 'audio/weapons/blast-3.wav',
  'blast-4': 'audio/weapons/blast-4.wav',
  'blast-5': 'audio/weapons/blast-5.wav',
  'cargo-intake': 'audio/mining/cargo-intake.wav',
  'laser-overheat': 'audio/mining/laser-overheat.wav',
  'laser-ready': 'audio/mining/laser-ready.wav',
  'impact-1': 'audio/impacts/impact-1.wav',
  'impact-2': 'audio/impacts/impact-2.wav',
};

const LOOP_SOURCES: Record<LoopName, string> = {
  'engine-main': 'audio/engines/engine-main.wav',
  'engine-side': 'audio/engines/engine-side.wav',
  'engine-reverse': 'audio/engines/engine-reverse.wav',
  'engine-rush': 'audio/engines/engine-rush.wav',
  'engine-strain': 'audio/engines/engine-strain.wav',
  'mining-laser': 'audio/mining/mining-laser.wav',
  'tractor-beam': 'audio/mining/tractor-beam.wav',
  scrape: 'audio/impacts/scrape.wav',
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
  readonly #loopSounds = new Map<LoopName, Howl>();
  readonly #loops = new Set<LoopBinding>();
  readonly #baseUrl: string;
  readonly #volume: number;
  #enabled = false;
  #muted = false;
  #listenerGain = 1;
  #listenerGainApplied = false;

  constructor({ baseUrl = '/', volume = 0.6 }: AudioManagerOptions = {}) {
    this.#baseUrl = baseUrl;
    this.#volume = volume;
  }

  get muted(): boolean {
    return this.#muted;
  }

  /**
   * Scales every voice (one-shots and loops) by camera distance.
   *
   * Applied through Howler's master gain so mute/unmute restores the current
   * distance level, and so already-playing one-shots fade with the camera too.
   */
  setListenerGain(gain: number): void {
    const next = clamp(gain, 0, 1);
    if (this.#listenerGainApplied && Math.abs(next - this.#listenerGain) < 0.001) return;
    this.#listenerGain = next;
    this.#listenerGainApplied = true;
    Howler.volume(next);
  }

  async load(): Promise<void> {
    const entries = Object.entries(SOUND_SOURCES) as [SoundName, string][];
    const loopEntries = Object.entries(LOOP_SOURCES) as [LoopName, string][];

    await Promise.all([
      ...entries.map(async ([name, source]): Promise<void> => {
        const sound = await loadSound(joinBaseUrl(this.#baseUrl, source), this.#volume);
        if (sound) this.#sounds.set(name, sound);
      }),
      ...loopEntries.map(async ([name, source]): Promise<void> => {
        const sound = await loadSound(joinBaseUrl(this.#baseUrl, source), this.#volume, true);
        if (sound) this.#loopSounds.set(name, sound);
      }),
    ]);

    // Loops can be created before `load()` finishes; start them now if the
    // user gesture has already happened.
    this.#refreshLoops();
  }

  async enable(): Promise<void> {
    this.#enabled = true;

    const context = Howler.ctx;
    if (context?.state === 'suspended') {
      await context.resume();
    }

    this.#refreshLoops();
  }

  /**
   * Starts a continuous loop voice. Handles can be created before the browser
   * unlocks audio: they begin playing from the next `enable()`/`load()`.
   * Calling this repeatedly with the same name creates independent voices, so
   * each engine can own its own gain, rate and pan.
   */
  createLoop(name: LoopName, options: LoopOptions = {}): LoopHandle {
    const binding: LoopBinding = {
      name,
      sound: this.#loopSounds.get(name) ?? null,
      id: null,
      volume: clamp(options.volume ?? 0, 0, 1),
      rate: clamp(options.rate ?? 1, 0.5, 4),
      pan: clamp(options.pan ?? 0, -1, 1),
      stopped: false,
    };
    this.#loops.add(binding);
    this.#startLoop(binding);

    return {
      setVolume: (volume: number): void => {
        if (binding.stopped) return;
        binding.volume = clamp(volume, 0, 1);
        this.#applyLoopVolume(binding);
      },
      setRate: (rate: number): void => {
        if (binding.stopped) return;
        binding.rate = clamp(rate, 0.5, 4);
        if (binding.id !== null && binding.sound) binding.sound.rate(binding.rate, binding.id);
      },
      setPan: (pan: number): void => {
        if (binding.stopped) return;
        binding.pan = clamp(pan, -1, 1);
        if (binding.id !== null && binding.sound) binding.sound.stereo(binding.pan, binding.id);
      },
      stop: (): void => {
        if (binding.stopped) return;
        binding.stopped = true;
        if (binding.id !== null && binding.sound) binding.sound.stop(binding.id);
        binding.id = null;
        this.#loops.delete(binding);
      },
    };
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
    for (const binding of this.#loops) {
      if (binding.id !== null && binding.sound) binding.sound.stop(binding.id);
    }
    this.#loops.clear();

    for (const sound of this.#sounds.values()) {
      sound.unload();
    }
    this.#sounds.clear();

    for (const sound of this.#loopSounds.values()) {
      sound.unload();
    }
    this.#loopSounds.clear();

    Howler.unload();
  }

  #refreshLoops(): void {
    for (const binding of this.#loops) {
      if (!binding.sound) binding.sound = this.#loopSounds.get(binding.name) ?? null;
      this.#startLoop(binding);
    }
  }

  #startLoop(binding: LoopBinding): void {
    if (binding.id !== null || binding.stopped || !this.#enabled) return;

    if (!binding.sound) binding.sound = this.#loopSounds.get(binding.name) ?? null;
    const sound = binding.sound;
    if (!sound || sound.state() !== 'loaded') return;

    const id = sound.play();
    if (id < 1) return;

    sound.volume(clamp(this.#volume * binding.volume, 0, 1), id);
    sound.rate(binding.rate, id);
    sound.stereo(binding.pan, id);
    binding.id = id;
  }

  #applyLoopVolume(binding: LoopBinding): void {
    if (binding.id === null || !binding.sound) return;
    binding.sound.volume(clamp(this.#volume * binding.volume, 0, 1), binding.id);
  }
}

function loadSound(source: string, volume: number, loop = false): Promise<Howl | null> {
  return new Promise((resolve) => {
    const sound = new Howl({
      src: [source],
      volume,
      loop,
      preload: true,
      onload: () => resolve(sound),
      onloaderror: (_soundId, error) => {
        console.warn(`[audio] failed to load "${source}":`, error);
        resolve(null);
      },
    });
  });
}
