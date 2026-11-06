import type { AudioManager, LoopHandle, LoopName } from '../audio/audio';
import { MAIN_ENGINE_LAYOUT, REVERSE_ENGINE_LAYOUT } from './engine-layout';
import { computeEngineOutputs } from './engine-mix';
import type { EngineMix } from './engine-mix';
import { clamp } from '../utils/math';

/**
 * Per-engine hum: continuous loops whose gain follows each nozzle's ramped
 * output. The three main engines get a heavy centre and normal sides; the two
 * reverse engines are lighter and higher, so turning reads through the audio.
 */
export interface EngineAudio {
  update(frame: EngineAudioFrame): void;
  destroy(): void;
}

export interface EngineAudioFrame {
  /** Ship centre in screen pixels. */
  shipScreenX: number;
  rotation: number;
  /** Ship display scale including the camera zoom (ship-local px → screen px). */
  shipScale: number;
  width: number;
  /** Ramped linear input, -1..1 (W positive, S negative). */
  linearInput: number;
  /** Ramped angular input, -1..1 (A negative, D positive). */
  angularInput: number;
  dt: number;
}

interface HumChannel {
  name: LoopName;
  baseGain: number;
  baseRate: number;
  /** Nozzle position in ship-local pixels (matches the baked art). */
  localX: number;
  localY: number;
  handle: LoopHandle;
  level: number;
  pan: number;
}

const HEAVY_BASE_GAIN = 1;
const SIDE_BASE_GAIN = 0.58;
const REVERSE_BASE_GAIN = 0.44;

/** Gain curve: quiet near idle thrust, quick rise under load. */
export const HUM_GAIN_CURVE = 1.25;
/** Per-second smoothing for level and pan (avoids zipper noise). */
const HUM_SMOOTHING = 18;
/** Engines sit close to the ship centre; widen the stereo image a little. */
const PAN_WIDTH = 2.1;
const PAN_LIMIT = 0.85;
/** Subtle pitch rise with power so spool-up is audible. */
const POWER_PITCH = 0.025;

/** Engine power per hum channel: [main centre, main left, main right, reverse left, reverse right]. */
export function engineHumPowers(mix: EngineMix): [number, number, number, number, number] {
  return [mix.main[1], mix.main[0], mix.main[2], mix.reverse[0], mix.reverse[1]];
}

/** Maps a nozzle output to a hum gain; silent at rest, driven by power. */
export function engineHumGain(power: number, baseGain: number): number {
  return baseGain * Math.pow(clamp(power, 0, 1), HUM_GAIN_CURVE);
}

/** Screen-space pan for an engine at `screenX`. */
export function enginePan(screenX: number, width: number): number {
  if (width <= 0) return 0;
  return clamp(((screenX / width) * 2 - 1) * PAN_WIDTH, -PAN_LIMIT, PAN_LIMIT);
}

export function createEngineAudio(audio: AudioManager): EngineAudio {
  const main = MAIN_ENGINE_LAYOUT;
  const reverse = REVERSE_ENGINE_LAYOUT;

  // L/R rates are deliberately detuned so the paired engines beat against
  // each other instead of playing as one phase-locked tone.
  const channels: HumChannel[] = [
    {
      name: 'engine-main',
      baseGain: HEAVY_BASE_GAIN,
      baseRate: 0.995,
      localX: main.xOffsets[1],
      localY: main.yOffset,
      handle: audio.createLoop('engine-main'),
      level: 0,
      pan: 0,
    },
    {
      name: 'engine-side',
      baseGain: SIDE_BASE_GAIN,
      baseRate: 0.982,
      localX: main.xOffsets[0],
      localY: main.yOffset,
      handle: audio.createLoop('engine-side'),
      level: 0,
      pan: 0,
    },
    {
      name: 'engine-side',
      baseGain: SIDE_BASE_GAIN,
      baseRate: 1.019,
      localX: main.xOffsets[2],
      localY: main.yOffset,
      handle: audio.createLoop('engine-side'),
      level: 0,
      pan: 0,
    },
    {
      name: 'engine-reverse',
      baseGain: REVERSE_BASE_GAIN,
      baseRate: 1.012,
      localX: reverse.xOffsets[0],
      localY: reverse.flameBaseY,
      handle: audio.createLoop('engine-reverse'),
      level: 0,
      pan: 0,
    },
    {
      name: 'engine-reverse',
      baseGain: REVERSE_BASE_GAIN,
      baseRate: 0.986,
      localX: reverse.xOffsets[1],
      localY: reverse.flameBaseY,
      handle: audio.createLoop('engine-reverse'),
      level: 0,
      pan: 0,
    },
  ];

  return {
    update(frame: EngineAudioFrame): void {
      const mix = computeEngineOutputs(frame.linearInput, frame.angularInput);
      const powers = engineHumPowers(mix);
      const cos = Math.cos(frame.rotation);
      const sin = Math.sin(frame.rotation);
      const smoothing = 1 - Math.exp(-Math.max(frame.dt, 0) * HUM_SMOOTHING);

      for (let index = 0; index < channels.length; index += 1) {
        const channel = channels[index]!;
        const power = powers[index] ?? 0;

        const targetLevel = engineHumGain(power, channel.baseGain);
        channel.level += (targetLevel - channel.level) * smoothing;
        channel.handle.setVolume(channel.level);

        // Pan follows the nozzle's actual screen position, so it stays
        // correct when the ship yaws (engines can cross or centre up).
        const localX = channel.localX * cos - channel.localY * sin;
        const targetPan = enginePan(frame.shipScreenX + localX * frame.shipScale, frame.width);
        channel.pan += (targetPan - channel.pan) * smoothing;
        channel.handle.setPan(channel.pan);

        channel.handle.setRate(channel.baseRate * (1 + POWER_PITCH * power));
      }
    },
    destroy(): void {
      for (const channel of channels) channel.handle.stop();
    },
  };
}
