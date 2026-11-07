import { CanvasSource, Texture } from 'pixi.js';
import type { AsteroidArt } from './asteroid-field';
import { generateAsteroidArt } from './asteroid-art-model';
import type { AsteroidPalette } from './asteroid-art-model';

/** Procedural variants generated at startup, on top of the two supplied arts. */
export const GENERATED_ASTEROID_VARIANTS = 6;
const TEXTURE_SIZE = 512;
const SEED_BASE = 0x0a57e20;

/**
 * Bake extra asteroid variants into canvas textures in the browser.
 *
 * Generation is deterministic (fixed seeds), runs once at startup, and returns
 * the silhouette along with each texture so the collider does not have to trace
 * the alpha again.
 */
export function createGeneratedAsteroidArts(count = GENERATED_ASTEROID_VARIANTS): AsteroidArt[] {
  const arts: AsteroidArt[] = [];
  for (let index = 0; index < count; index += 1) {
    const palette: AsteroidPalette = index % 2 === 0 ? 'slate' : 'ice';
    const pixels = generateAsteroidArt(SEED_BASE + index * 7919, {
      size: TEXTURE_SIZE,
      palette,
    });
    arts.push({
      color: pixelsToTexture(pixels.color, pixels.size),
      normal: pixelsToTexture(pixels.normal, pixels.size),
      silhouette: pixels.silhouette,
    });
  }
  return arts;
}

function pixelsToTexture(pixels: Uint8ClampedArray, size: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const data = new Uint8ClampedArray(pixels.length);
    data.set(pixels);
    context.putImageData(new ImageData(data, size, size), 0, 0);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}
