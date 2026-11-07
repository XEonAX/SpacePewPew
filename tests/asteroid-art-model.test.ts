import { describe, expect, it } from 'vitest';
import { generateAsteroidArt } from '../src/app/asteroid-art-model';
import { pointInPolygon } from '../src/app/asteroid-collision';

const SIZE = 128;
const art = generateAsteroidArt(0x5eed, { size: SIZE, palette: 'slate' });

const alphaAt = (index: number): number => art.color[index * 4 + 3]!;
const centreIndex = (SIZE * SIZE) / 2 - SIZE / 2 - 1;

describe('asteroid art model', () => {
  it('is deterministic for a seed', () => {
    const again = generateAsteroidArt(0x5eed, { size: SIZE, palette: 'slate' });
    expect(again.outline).toEqual(art.outline);
    expect(again.silhouette).toEqual(art.silhouette);
    expect(Array.from(again.color)).toEqual(Array.from(art.color));
    expect(Array.from(again.normal)).toEqual(Array.from(art.normal));
    const other = generateAsteroidArt(0x5eed + 1, { size: SIZE, palette: 'slate' });
    expect(other.outline).not.toEqual(art.outline);
  });

  it('builds a detailed star-shaped visual outline', () => {
    expect(art.outline.length).toBeGreaterThanOrEqual(10);
    expect(art.outline.length).toBeLessThanOrEqual(20);
    expect(pointInPolygon(art.outline, { x: 0, y: 0 })).toBe(true);
    for (const point of art.outline) {
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(SIZE * 0.55 + 1e-9);
      // Star-shaped about the centre: the halfway point is still inside.
      expect(pointInPolygon(art.outline, { x: point.x * 0.5, y: point.y * 0.5 })).toBe(true);
      expect(pointInPolygon(art.outline, { x: point.x * 0.9, y: point.y * 0.9 })).toBe(true);
    }
  });

  it('supplies a simplified collider silhouette', () => {
    expect(art.silhouette.length).toBeGreaterThanOrEqual(6);
    expect(art.silhouette.length).toBeLessThanOrEqual(18);
    expect(art.silhouette.length).toBeLessThan(art.outline.length);
    for (const point of art.silhouette) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('produces an opaque rock with a transparent gutter', () => {
    expect(art.color.length).toBe(SIZE * SIZE * 4);
    expect(alphaAt(centreIndex)).toBeGreaterThan(200);
    expect(alphaAt(0)).toBe(0);
    expect(alphaAt(SIZE - 1)).toBe(0);
    let opaque = 0;
    for (let index = 0; index < SIZE * SIZE; index += 1) {
      if (alphaAt(index) > 200) opaque += 1;
    }
    const fraction = opaque / (SIZE * SIZE);
    expect(fraction).toBeGreaterThan(0.3);
    expect(fraction).toBeLessThan(0.85);
  });

  it('produces valid lit colour and tangent-space normals', () => {
    expect(art.normal.length).toBe(SIZE * SIZE * 4);
    for (let index = 0; index < SIZE * SIZE; index += 1) {
      expect(art.normal[index * 4 + 3]).toBe(255);
      if (alphaAt(index) < 200) continue;
      for (const channel of [0, 1, 2]) {
        expect(art.color[index * 4 + channel]).toBeGreaterThanOrEqual(0);
        expect(art.color[index * 4 + channel]).toBeLessThanOrEqual(255);
      }
      // Normals point mostly out of the surface (blue channel high).
      expect(art.normal[index * 4 + 2]).toBeGreaterThanOrEqual(128);
    }
    // Flat gutter normal is straight up.
    expect(art.normal[0]).toBe(128);
    expect(art.normal[1]).toBe(128);
    expect(art.normal[2]).toBe(255);
  });

  it('varies between palettes', () => {
    const ice = generateAsteroidArt(0x5eed, { size: SIZE, palette: 'ice' });
    const mean = (pixels: Uint8ClampedArray): number => {
      let total = 0;
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3]! < 200) continue;
        total += (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3;
        count += 1;
      }
      return total / count;
    };
    expect(Math.abs(mean(ice.color) - mean(art.color))).toBeGreaterThan(2);
  });
});
