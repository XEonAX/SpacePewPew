import type { AudioManager, LoopHandle, LoopName } from '../audio/audio';
import { MAIN_ENGINE_LAYOUT, REVERSE_ENGINE_LAYOUT } from './engine-layout';
import { computeEngineOutputs } from './engine-mix';
import type { EngineMix } from './engine-mix';
import { clamp, smoothstep } from '../utils/math';

/**
 * Per-engine hum: continuous loops whose gain follows each nozzle's ramped
 * output. The three main engines get a heavy centre and normal sides; the two
 * reverse engines are lighter and higher, so turning reads through the audio.
 *
 * Two accelerations are layered on top:
 * - a speed rush that swells as the ship approaches forward terminal speed,
 * - a "retro strain" bed when an engine's thrust opposes the ship's velocity
 *   (dot product of thrust and velocity < 0), so firing the main engines while
 *   flying backwards sounds laboured instead of clean.
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
  /** Ship velocity in metres per second. */
  vx: number;
  vy: number;
  /** Forward terminal speed in metres per second (`forwardAccel / linearDrag`). */
  terminalSpeed: number;
  dt: number;
}

interface HumChannel {
  name: LoopName;
  /** True for the reverse engines, whose thrust points aft. */
  reverse: boolean;
  baseGain: number;
  baseRate: number;
  /** Nozzle position in ship-local pixels (matches the baked art). */
  localX: number;
  localY: number;
  handle: LoopHandle;
  strain: LoopHandle;
  level: number;
  strainLevel: number;
  pan: number;
}

const HEAVY_BASE_GAIN = 1;
const SIDE_BASE_GAIN = 0.58;
const REVERSE_BASE_GAIN = 0.44;

/** Extra layer that swells with speed (0 at rest, max at terminal). */
const RUSH_BASE_GAIN = 0.62;
const RUSH_CURVE = 1.6;
const RUSH_COAST_FLOOR = 0.35;

/** Braking bed; the normal hum ducks as it comes in. */
const STRAIN_GAIN = 0.85;
const BRAKE_DUCK = 0.45;
const STRAIN_RATE_SCALE = 0.94;

/** Gain curve: quiet near idle thrust, quick rise under load. */
export const HUM_GAIN_CURVE = 1.25;
/** Per-second smoothing for level and pan (avoids zipper noise). */
const HUM_SMOOTHING = 18;
/** Engines sit close to the ship centre; widen the stereo image a little. */
const PAN_WIDTH = 2.1;
const PAN_LIMIT = 0.85;
/** Subtle pitch rise with thrust and speed (audible spool-up ramp). */
const POWER_PITCH = 0.025;
export const SPEED_PITCH = 0.035;
/** Below this speed a velocity direction is meaningless, so alignment fades in. */
const ALIGN_MIN_SPEED = 0.75;
const ALIGN_FULL_SPEED = 3;

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

/** Speed as a fraction of forward terminal speed, clamped to 0..1. */
export function engineSpeedFraction(vx: number, vy: number, terminalSpeed: number): number {
  if (!(terminalSpeed > 0)) return 0;
  return clamp(Math.hypot(vx, vy) / terminalSpeed, 0, 1);
}

/**
 * Dot product of an engine's thrust direction with the ship's velocity
 * direction, in -1..1. `+1` = pushing along travel, `-1` = braking hard,
 * `0` = moving sideways (or too slow to have a direction).
 */
export function engineThrustAlignment(
  vx: number,
  vy: number,
  rotation: number,
  thrustDirection = 1,
): number {
  const speed = Math.hypot(vx, vy);
  if (speed <= 0) return 0;

  const gate = smoothstep(ALIGN_MIN_SPEED, ALIGN_FULL_SPEED, speed);
  // Ship forward is (sin rotation, -cos rotation); forwardDot is its dot with
  // the normalised velocity.
  const forwardDot = (Math.sin(rotation) * vx - Math.cos(rotation) * vy) / speed;
  return clamp(forwardDot * thrustDirection * gate, -1, 1);
}

export function createEngineAudio(audio: AudioManager): EngineAudio {
  const main = MAIN_ENGINE_LAYOUT;
  const reverse = REVERSE_ENGINE_LAYOUT;

  // L/R rates are deliberately detuned so the paired engines beat against
  // each other instead of playing as one phase-locked tone.
  const channels: HumChannel[] = [
    {
      name: 'engine-main',
      reverse: false,
      baseGain: HEAVY_BASE_GAIN,
      baseRate: 0.995,
      localX: main.xOffsets[1],
      localY: main.yOffset,
      handle: audio.createLoop('engine-main'),
      strain: audio.createLoop('engine-strain'),
      level: 0,
      strainLevel: 0,
      pan: 0,
    },
    {
      name: 'engine-side',
      reverse: false,
      baseGain: SIDE_BASE_GAIN,
      baseRate: 0.982,
      localX: main.xOffsets[0],
      localY: main.yOffset,
      handle: audio.createLoop('engine-side'),
      strain: audio.createLoop('engine-strain'),
      level: 0,
      strainLevel: 0,
      pan: 0,
    },
    {
      name: 'engine-side',
      reverse: false,
      baseGain: SIDE_BASE_GAIN,
      baseRate: 1.019,
      localX: main.xOffsets[2],
      localY: main.yOffset,
      handle: audio.createLoop('engine-side'),
      strain: audio.createLoop('engine-strain'),
      level: 0,
      strainLevel: 0,
      pan: 0,
    },
    {
      name: 'engine-reverse',
      reverse: true,
      baseGain: REVERSE_BASE_GAIN,
      baseRate: 1.012,
      localX: reverse.xOffsets[0],
      localY: reverse.flameBaseY,
      handle: audio.createLoop('engine-reverse'),
      strain: audio.createLoop('engine-strain'),
      level: 0,
      strainLevel: 0,
      pan: 0,
    },
    {
      name: 'engine-reverse',
      reverse: true,
      baseGain: REVERSE_BASE_GAIN,
      baseRate: 0.986,
      localX: reverse.xOffsets[1],
      localY: reverse.flameBaseY,
      handle: audio.createLoop('engine-reverse'),
      strain: audio.createLoop('engine-strain'),
      level: 0,
      strainLevel: 0,
      pan: 0,
    },
  ];

  const rush = audio.createLoop('engine-rush');
  let rushLevel = 0;

  return {
    update(frame: EngineAudioFrame): void {
      const mix = computeEngineOutputs(frame.linearInput, frame.angularInput);
      const powers = engineHumPowers(mix);
      const speedFraction = engineSpeedFraction(frame.vx, frame.vy, frame.terminalSpeed);
      const forwardAlignment = engineThrustAlignment(frame.vx, frame.vy, frame.rotation, 1);
      const cos = Math.cos(frame.rotation);
      const sin = Math.sin(frame.rotation);
      const smoothing = 1 - Math.exp(-Math.max(frame.dt, 0) * HUM_SMOOTHING);
      let maxPower = 0;

      for (let index = 0; index < channels.length; index += 1) {
        const channel = channels[index]!;
        const power = powers[index] ?? 0;
        maxPower = Math.max(maxPower, power);

        // Reverse engines thrust aft, so their alignment is mirrored. Negative
        // alignment means this engine is fighting the ship's momentum.
        const alignment = channel.reverse ? -forwardAlignment : forwardAlignment;
        const braking = Math.max(0, -alignment);

        const humTarget = engineHumGain(power, channel.baseGain) * (1 - BRAKE_DUCK * braking);
        channel.level += (humTarget - channel.level) * smoothing;
        channel.handle.setVolume(channel.level);

        const strainTarget = engineHumGain(power, channel.baseGain) * STRAIN_GAIN * braking;
        channel.strainLevel += (strainTarget - channel.strainLevel) * smoothing;
        channel.strain.setVolume(channel.strainLevel);

        // Pan follows the nozzle's actual screen position, so it stays
        // correct when the ship yaws (engines can cross or centre up).
        const localX = channel.localX * cos - channel.localY * sin;
        const targetPan = enginePan(frame.shipScreenX + localX * frame.shipScale, frame.width);
        channel.pan += (targetPan - channel.pan) * smoothing;
        channel.handle.setPan(channel.pan);
        channel.strain.setPan(channel.pan);

        // Pitch ramps with both thrust and how close the ship is to terminal
        // speed; this is the audible acceleration ramp.
        const rate = channel.baseRate * (1 + POWER_PITCH * power + SPEED_PITCH * speedFraction);
        channel.handle.setRate(rate);
        channel.strain.setRate(channel.baseRate * STRAIN_RATE_SCALE * (1 + 0.02 * power));
      }

      // Air/plasma rush: silent at rest, full at terminal speed, a little
      // stronger while the engines are lit.
      const thrustFactor = RUSH_COAST_FLOOR + (1 - RUSH_COAST_FLOOR) * maxPower;
      const rushTarget = RUSH_BASE_GAIN * Math.pow(speedFraction, RUSH_CURVE) * thrustFactor;
      rushLevel += (rushTarget - rushLevel) * smoothing;
      rush.setVolume(rushLevel);
      rush.setRate(0.92 + 0.16 * speedFraction);
      rush.setPan(0);
    },
    destroy(): void {
      for (const channel of channels) {
        channel.handle.stop();
        channel.strain.stop();
      }
      rush.stop();
    },
  };
}
