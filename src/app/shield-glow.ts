/**
 * Shield glow level: dim at rest, brought up to full brightness by a recent
 * impact, then eased back down over a couple of seconds.
 *
 * Pure so the curve can be unit-tested without PixiJS.
 */

/** Resting glow: the shield is passive, so it barely reads. */
export const DIM_ALPHA = 0.2;
/** The brightness a recent hit brings it up to. */
export const HIT_ALPHA = 0.58;
/** Seconds for a full afterglow to fall to rest (~2.2 s). */
export const AFTERGLOW_DECAY_PER_SECOND = 0.45;
/** Breathing ripple amplitude, added to the glow. */
export const BREATH_AMPLITUDE = 0.05;
/** Extra brightness of the immediate impact flash. */
export const FLASH_ALPHA = 0.3;
/** Hard floor so the surface never disappears completely. */
export const MIN_ALPHA = 0.12;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Advance the afterglow clock; 1 = just hit, 0 = back to rest. */
export function decayAfterglow(afterglow: number, dt: number): number {
  return Math.max(0, afterglow - Math.max(0, dt) * AFTERGLOW_DECAY_PER_SECOND);
}

/** Glow from the afterglow alone: dim at rest, old brightness when hit recently. */
export function afterglowAlpha(afterglow: number): number {
  return DIM_ALPHA + (HIT_ALPHA - DIM_ALPHA) * clamp01(afterglow);
}

/** Final graphics alpha: afterglow + breathing + the immediate impact flash. */
export function shieldAlpha(afterglow: number, breath: number, flash: number): number {
  return Math.max(
    MIN_ALPHA,
    Math.min(1, afterglowAlpha(afterglow) + breath + Math.max(0, flash) * FLASH_ALPHA),
  );
}
