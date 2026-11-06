import { describe, expect, it } from 'vitest';
import { listenerGainForZoom } from '../src/audio/listener-gain';

describe('listenerGainForZoom', () => {
  it('is full volume at the default 1x zoom', () => {
    expect(listenerGainForZoom(1)).toBe(1);
  });

  it('fades out as the camera zooms out, monotonically', () => {
    const zooms = [1, 0.5, 0.25, 0.1, 0.02];
    for (let index = 1; index < zooms.length; index += 1) {
      expect(listenerGainForZoom(zooms[index]!)).toBeLessThan(
        listenerGainForZoom(zooms[index - 1]!),
      );
    }
    expect(listenerGainForZoom(0.02)).toBeGreaterThan(0.2);
    expect(listenerGainForZoom(0.02)).toBeLessThan(0.3);
  });

  it('clamps zoom outside 0..1', () => {
    expect(listenerGainForZoom(-1)).toBeCloseTo(0.2, 6);
    expect(listenerGainForZoom(4)).toBe(1);
  });
});
