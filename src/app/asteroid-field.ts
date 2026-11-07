import { Container } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { AsteroidCollider, Vec2 } from './asteroid-collision';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import { createRng, randomRange } from '../utils/random';
import { PIXELS_PER_METER } from './world-scale';

/** One asteroid art set (processed colour + normal maps). */
export interface AsteroidArt {
  color: Texture;
  normal: Texture;
}

/** One world-space asteroid: static position, slowly spinning art. */
export interface Asteroid {
  /** World centre in metres. */
  x: number;
  y: number;
  /** Art width in metres. */
  diameter: number;
  /** Radians per second; sign picks the spin direction. */
  spin: number;
  mesh: LitSprite;
  art: AsteroidArt;
}

export interface AsteroidFieldFrame {
  dustX: number;
  dustY: number;
  zoom: number;
  width: number;
  height: number;
  dt: number;
}

export interface AsteroidField {
  container: Container;
  /** Add a rock at a world position (metres) with a given art width (metres). */
  add(x: number, y: number, diameter: number, variant?: number): Asteroid;
  update(frame: AsteroidFieldFrame): void;
  setLighting(state: LightingState): void;
  /**
   * The rocks as solid colliders: a bounding circle for the fast pass and a
   * convex silhouette polygon that turns with the art for the accurate pass.
   */
  getColliders(): readonly AsteroidCollider[];
  /** The same colliders as mining targets. */
  getMiningTargets(): readonly AsteroidCollider[];
  destroy(): void;
}

/** Angular samples used to trace the silhouette polygon (more = tighter fit). */
const SILHOUETTE_SAMPLES = 48;
/** Pixels below this alpha don't contribute to the silhouette. */
const SILHOUETTE_ALPHA = 128;

/**
 * Trace the rock's outline from the colour map's alpha: the maximum radius in
 * each angular slice around the texture centre, in angle order.
 */
function silhouettePolygon(color: Texture): Vec2[] {
  const source = color.source.resource as CanvasImageSource | undefined;
  const width = color.width;
  const height = color.height;
  const bins = new Array<number>(SILHOUETTE_SAMPLES).fill(0);
  const centreX = width / 2;
  const centreY = height / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context && source) {
    context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3]! < SILHOUETTE_ALPHA) continue;
        const dx = x - centreX;
        const dy = y - centreY;
        const angle = Math.atan2(dy, dx);
        const bin = Math.min(
          SILHOUETTE_SAMPLES - 1,
          Math.floor(((angle + Math.PI) / (Math.PI * 2)) * SILHOUETTE_SAMPLES),
        );
        const radius = Math.hypot(dx, dy);
        if (radius > bins[bin]!) bins[bin] = radius;
      }
    }
  }

  // Fill slices with no silhouette from their neighbours.
  for (let index = 0; index < SILHOUETTE_SAMPLES; index += 1) {
    if (bins[index]! > 0) continue;
    let before = index;
    let after = index;
    for (let step = 1; step < SILHOUETTE_SAMPLES; step += 1) {
      before = (index - step + SILHOUETTE_SAMPLES) % SILHOUETTE_SAMPLES;
      if (bins[before]! > 0) break;
    }
    for (let step = 1; step < SILHOUETTE_SAMPLES; step += 1) {
      after = (index + step) % SILHOUETTE_SAMPLES;
      if (bins[after]! > 0) break;
    }
    bins[index] = ((bins[before] ?? 0) + (bins[after] ?? 0)) / 2;
  }

  // Radial samples in angular order: star-shaped, so the fan decomposition in
  // the collider covers the real (possibly concave) silhouette.
  return bins.map((radius, index) => {
    const angle = ((index + 0.5) / SILHOUETTE_SAMPLES) * Math.PI * 2 - Math.PI;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

/**
 * All asteroids live in the dust-layer world, so they pan and zoom with the
 * environment instead of being placed in screen space. Each one is a lit mesh
 * with a two-stage collider fitted to the art: a bounding circle for the fast
 * pass and a convex silhouette polygon for the accurate pass.
 */
export function createAsteroidField(arts: readonly AsteroidArt[]): AsteroidField {
  if (arts.length === 0) throw new Error('Asteroid field needs at least one art variant');
  const container = new Container();
  const spinRng = createRng(0x51a7_2f3d);
  const asteroids: Asteroid[] = [];
  const colliders: AsteroidCollider[] = [];
  // Trace each art variant once; colliders scale the template to the rock size.
  const silhouetteTemplates = arts.map((art) => silhouettePolygon(art.color));

  return {
    container,
    add(x: number, y: number, diameter: number, variant = 0): Asteroid {
      const artIndex = Math.min(Math.max(variant, 0), arts.length - 1);
      const art = arts[artIndex]!;
      const mesh = createLitSprite(art.color, art.normal);
      container.addChild(mesh.mesh);
      // Slow tumble, either direction: rocks are heavy, not pinwheels.
      const spin = randomRange(spinRng, 0.02, 0.06) * (spinRng() > 0.5 ? 1 : -1);
      const asteroid: Asteroid = {
        x,
        y,
        diameter,
        spin,
        mesh,
        art,
      };
      asteroids.push(asteroid);

      const template = silhouetteTemplates[artIndex]!;
      const metrePerArtPixel = diameter / art.color.width;
      const points = template.map((point) => ({
        x: point.x * metrePerArtPixel,
        y: point.y * metrePerArtPixel,
      }));
      let radius = 0;
      for (const point of points) radius = Math.max(radius, Math.hypot(point.x, point.y));
      colliders.push({ x, y, rotation: 0, points, radius });
      return asteroid;
    },
    update(frame: AsteroidFieldFrame): void {
      for (let index = 0; index < asteroids.length; index += 1) {
        const asteroid = asteroids[index]!;
        asteroid.mesh.mesh.rotation += asteroid.spin * frame.dt;
        // The silhouette turns with the art, so the collider rotates too.
        colliders[index]!.rotation = asteroid.mesh.mesh.rotation;
        asteroid.mesh.mesh.scale.set(
          ((asteroid.diameter * PIXELS_PER_METER) / asteroid.art.color.width) * frame.zoom,
        );
        asteroid.mesh.mesh.position.set(
          (asteroid.x * PIXELS_PER_METER - frame.dustX * frame.width) * frame.zoom +
            frame.width / 2,
          (asteroid.y * PIXELS_PER_METER - frame.dustY * frame.height) * frame.zoom +
            frame.height / 2,
        );
      }
    },
    setLighting(state: LightingState): void {
      for (const asteroid of asteroids) asteroid.mesh.setLighting(state);
    },
    getColliders(): readonly AsteroidCollider[] {
      return colliders;
    },
    getMiningTargets(): readonly AsteroidCollider[] {
      return colliders;
    },
    destroy(): void {
      for (const asteroid of asteroids) asteroid.mesh.mesh.destroy({ children: true });
      container.destroy({ children: true });
    },
  };
}
