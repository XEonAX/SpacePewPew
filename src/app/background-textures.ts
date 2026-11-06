import { CanvasSource, Texture } from 'pixi.js';
import { clamp, lerp, smoothstep } from '../utils/math';

export const STAR_TEXTURE_SIZE = 32;
export const FLARE_TEXTURE_SIZE = 64;
export const NEBULA_TEXTURE_SIZE = 512;
export const GALAXY_TEXTURE_SIZE = 512;

type Rgb = readonly [number, number, number];

const NEBULA_PALETTES: readonly (readonly [number, number])[] = [
  [0xff4fd8, 0x6a2cff],
  [0x36e2ff, 0x2b4dff],
  [0x9a5cff, 0xff4fa3],
  [0x2bd6ff, 0x6a2cff],
];

export function createStarTexture(): Texture {
  const { canvas, context } = createCanvas(STAR_TEXTURE_SIZE);
  const center = STAR_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.65, 'rgba(255, 255, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, STAR_TEXTURE_SIZE, STAR_TEXTURE_SIZE);
  return toTexture(canvas);
}

/** A four-point sparkle used to make a handful of hero stars glow. */
export function createFlareTexture(): Texture {
  const size = FLARE_TEXTURE_SIZE;
  const { canvas, context } = createCanvas(size);
  const center = size / 2;

  context.translate(center, center);
  context.globalCompositeOperation = 'lighter';

  const glow = context.createRadialGradient(0, 0, 0, 0, 0, size * 0.46);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.18, 'rgba(255, 255, 255, 0.9)');
  glow.addColorStop(0.45, 'rgba(190, 225, 255, 0.18)');
  glow.addColorStop(1, 'rgba(190, 225, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(-center, -center, size, size);

  for (const [scaleX, scaleY] of [
    [1, 0.055],
    [0.055, 1],
  ] as const) {
    context.save();
    context.scale(scaleX, scaleY);
    const beam = context.createRadialGradient(0, 0, 0, 0, 0, size * 0.48);
    beam.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
    beam.addColorStop(0.4, 'rgba(190, 225, 255, 0.22)');
    beam.addColorStop(1, 'rgba(190, 225, 255, 0)');
    context.fillStyle = beam;
    context.beginPath();
    context.arc(0, 0, size * 0.48, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  return toTexture(canvas);
}

/**
 * Seamless nebula cloud texture. The noise is periodic, so the texture tiles
 * perfectly and can be scrolled forever with a TilingSprite.
 */
export function createNebulaTexture(seed: number, paletteIndex: number): Texture {
  const size = NEBULA_TEXTURE_SIZE;
  const { canvas, context } = createCanvas(size);
  const image = context.createImageData(size, size);
  const data = image.data;

  const palette = NEBULA_PALETTES[paletteIndex % NEBULA_PALETTES.length] ?? NEBULA_PALETTES[0]!;
  const fromRgb = hexToRgb(palette[0]);
  const toRgb = hexToRgb(palette[1]);
  const basePeriod = 5;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * basePeriod;
      const v = ((y + 0.5) / size) * basePeriod;
      const cloud = fbm(u, v, seed, 5, basePeriod);
      const warp = fbm(u * 2 + 9.1, v * 2 + 3.7, seed + 1337, 3, basePeriod * 2);
      const density = smoothstep(0.34, 0.8, cloud * 0.8 + warp * 0.35);
      const alpha = Math.pow(density, 1.2) * 235;

      if (alpha < 1) continue;

      const [red, green, blue] = mixRgb(fromRgb, toRgb, clamp(cloud * 1.25, 0, 1));
      const brighten = smoothstep(0.6, 0.95, density) * 0.35;
      const index = (y * size + x) * 4;
      data[index] = Math.round(lerp(red, 255, brighten));
      data[index + 1] = Math.round(lerp(green, 255, brighten));
      data[index + 2] = Math.round(lerp(blue, 255, brighten));
      data[index + 3] = Math.round(alpha);
    }
  }

  context.putImageData(image, 0, 0);
  return toTexture(canvas);
}

/** A small spiral galaxy with a warm core and blue/violet arms. */
export function createGalaxyTexture(seed: number): Texture {
  const size = GALAXY_TEXTURE_SIZE;
  const { canvas, context } = createCanvas(size);
  const image = context.createImageData(size, size);
  const data = image.data;
  const coreColor = hexToRgb(0xffeecb);
  const armColor = hexToRgb(0x93c6ff);
  const outerColor = hexToRgb(0x5647ff);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const radius = Math.hypot(nx, ny);

      if (radius > 1) continue;

      const noise = fbm(((x + 0.5) / size) * 6, ((y + 0.5) / size) * 6, seed, 4, 6);
      const angle = Math.atan2(ny, nx);
      const arms = Math.pow((Math.sin(angle * 2 + radius * 10 + noise * 3.1) + 1) / 2, 2.8);
      const core = Math.exp(-radius * radius * 34);
      const disk = Math.exp(-radius * radius * 4);
      const brightness = clamp(core * 1.05 + arms * disk * 0.82 + disk * 0.14, 0, 1);
      const alpha = brightness * (1 - smoothstep(0.7, 1, radius)) * 190;

      if (alpha < 1) continue;

      const inner = mixRgb(coreColor, armColor, smoothstep(0.03, 0.5, radius));
      const [red, green, blue] = mixRgb(inner, outerColor, smoothstep(0.5, 0.95, radius));
      const index = (y * size + x) * 4;
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
      data[index + 3] = Math.round(alpha);
    }
  }

  context.putImageData(image, 0, 0);
  return toTexture(canvas);
}

function createCanvas(size: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable for background textures');

  return { canvas, context };
}

function toTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function hexToRgb(hex: number): Rgb {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function mixRgb(from: Rgb, to: Rgb, t: number): [number, number, number] {
  return [
    Math.round(lerp(from[0], to[0], t)),
    Math.round(lerp(from[1], to[1], t)),
    Math.round(lerp(from[2], to[2], t)),
  ];
}

function hashLattice(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed | 0, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Value noise that wraps at `period`, which makes generated textures tileable. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = modulo(xi, period);
  const x1 = modulo(xi + 1, period);
  const y0 = modulo(yi, period);
  const y1 = modulo(yi + 1, period);

  const top = lerp(hashLattice(x0, y0, seed), hashLattice(x1, y0, seed), u);
  const bottom = lerp(hashLattice(x0, y1, seed), hashLattice(x1, y1, seed), u);
  return lerp(top, bottom, v);
}

function fbm(x: number, y: number, seed: number, octaves: number, period: number): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalizer = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total +=
      amplitude *
      periodicNoise(x * frequency, y * frequency, period * frequency, seed + octave * 101);
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / normalizer;
}
