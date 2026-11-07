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
const SILHOUETTE_SAMPLES = 128;
/** Pixels below this alpha don't contribute to the silhouette. */
const SILHOUETTE_ALPHA = 128;

/**
 * Trace the rock's outline by marching a ray outward at each sample angle and
 * keeping the outermost opaque point. Sampling the real contour per ray (rather
 * than a max radius per angular bin placed at the bin centre) keeps the polygon
 * hugging faceted edges instead of cutting corners.
 */
function silhouettePolygon(color: Texture): Vec2[] {
  const source = color.source.resource as CanvasImageSource | undefined;
  const width = color.width;
  const height = color.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const points: Vec2[] = [];
  if (!context || !source) return points;

  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const centreX = width / 2;
  const centreY = height / 2;
  const maxRadius = Math.hypot(width, height) / 2;

  for (let index = 0; index < SILHOUETTE_SAMPLES; index += 1) {
    const angle = (index / SILHOUETTE_SAMPLES) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let lastInside = 0;
    for (let radius = 1; radius <= maxRadius; radius += 1) {
      const x = Math.round(centreX + dirX * radius);
      const y = Math.round(centreY + dirY * radius);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (pixels[(y * width + x) * 4 + 3]! > SILHOUETTE_ALPHA) lastInside = radius;
    }
    points.push({ x: dirX * lastInside, y: dirY * lastInside });
  }
  return points;
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
