import { clamp } from '../utils/math';

/** Gain floor at the 50× zoom-out limit (about -14 dB). */
const MIN_ZOOM_GAIN = 0.2;

/** < 1 keeps loudness loss slow at first, then more pronounced when far out. */
const ZOOM_GAIN_CURVE = 0.7;

/**
 * Listener gain for the camera zoom.
 *
 * Zoom 1× (the default and maximum zoom-in) is full volume; pulling the camera
 * out fades all audio toward `MIN_ZOOM_GAIN`. The curve is a power law so the
 * first wheel notches attenuate gently and the 50× zoom-out limit gets a clear
 * distance feel without going silent.
 */
export function listenerGainForZoom(zoom: number): number {
  return MIN_ZOOM_GAIN + (1 - MIN_ZOOM_GAIN) * Math.pow(clamp(zoom, 0, 1), ZOOM_GAIN_CURVE);
}
