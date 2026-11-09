import { Container } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { AsteroidCollider, Vec2 } from './asteroid-collision';
import { fitClosedPolygon } from './polygon-fit';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import { createRng, randomRange } from '../utils/random';
import { PIXELS_PER_METER } from './world-scale';

/** One asteroid art set (processed colour + normal maps). */
export interface AsteroidArt {
  color: Texture;
  normal: Texture;
  /**
   * Optional authored silhouette in texture px relative to the centre. When
   * present the collider uses it directly and skips the alpha contour trace.
   */
  silhouette?: readonly Vec2[];
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
  /** The rock's live polygon collider (same object as the field's list entry). */
  collider: AsteroidCollider;
  /** Broken rocks stay allocated but drop out of collision/mining queries. */
  active: boolean;
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

/** Angular samples used to trace the silhouette contour. */
const SILHOUETTE_SAMPLES = 128;
/** Pixels below this alpha don't contribute to the silhouette. */
const SILHOUETTE_ALPHA = 128;
/**
 * Vertex budget for the physical outline. The art is faceted, so a low-poly fit
 * is enough; fewer vertices means fewer SAT pieces and ray clips per query.
 */
const COLLIDER_MAX_VERTICES = 32;
/** Starting Douglas–Peucker tolerance as a fraction of the rock radius. */
const COLLIDER_FIT_TOLERANCE = 0.01;

/** Bilinear alpha lookup, 0–1. */
function sampleAlpha(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const alpha = (ix: number, iy: number): number => {
    const cx = Math.min(Math.max(ix, 0), width - 1);
    const cy = Math.min(Math.max(iy, 0), height - 1);
    return pixels[(cy * width + cx) * 4 + 3]! / 255;
  };
  return (
    alpha(x0, y0) * (1 - fx) * (1 - fy) +
    alpha(x0 + 1, y0) * fx * (1 - fy) +
    alpha(x0, y0 + 1) * (1 - fx) * fy +
    alpha(x0 + 1, y0 + 1) * fx * fy
  );
}

/**
 * Trace the rock's outline by marching a ray outward at each sample angle and
 * interpolating the alpha crossing, so the contour is subpixel-accurate and the
 * simplifier sees real facets instead of pixel steps.
 */
function silhouetteContour(color: Texture): Vec2[] {
  const source = color.source.resource as CanvasImageSource | undefined;
  const width = color.width;
  const height = color.height;
  const points: Vec2[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !source) return points;

  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const centreX = width / 2;
  const centreY = height / 2;
  const maxRadius = Math.hypot(width, height) / 2;
  const threshold = SILHOUETTE_ALPHA / 255;
  let fallback = 0;

  for (let index = 0; index < SILHOUETTE_SAMPLES; index += 1) {
    const angle = (index / SILHOUETTE_SAMPLES) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let lastInside = 0;
    for (let radius = 1; radius <= maxRadius; radius += 1) {
      const x = centreX + dirX * radius;
      const y = centreY + dirY * radius;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (sampleAlpha(pixels, width, height, x, y) > threshold) {
        lastInside = radius;
      } else if (lastInside > 0) {
        break;
      }
    }
    let radius = fallback;
    if (lastInside > 0) {
      const inside = sampleAlpha(
        pixels,
        width,
        height,
        centreX + dirX * lastInside,
        centreY + dirY * lastInside,
      );
      const outside = sampleAlpha(
        pixels,
        width,
        height,
        centreX + dirX * (lastInside + 1),
        centreY + dirY * (lastInside + 1),
      );
      const t =
        inside === outside
          ? 0.5
          : Math.max(0, Math.min(1, (threshold - inside) / (outside - inside)));
      radius = lastInside + t;
    }
    if (radius <= 0) radius = fallback;
    fallback = radius;
    points.push({ x: dirX * radius, y: dirY * radius });
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
  // Trace and low-poly fit each art variant once; colliders scale the template.
  const silhouetteTemplates = arts.map((art) => {
    if (art.silhouette) return art.silhouette.map((point) => ({ x: point.x, y: point.y }));
    const contour = silhouetteContour(art.color);
    let maxRadius = 0;
    for (const point of contour) maxRadius = Math.max(maxRadius, Math.hypot(point.x, point.y));
    return fitClosedPolygon(contour, {
      maxVertices: COLLIDER_MAX_VERTICES,
      tolerance: COLLIDER_FIT_TOLERANCE * maxRadius,
    }).points;
  });

  return {
    container,
    add(x: number, y: number, diameter: number, variant = 0): Asteroid {
      const artIndex = Math.min(Math.max(variant, 0), arts.length - 1);
      const art = arts[artIndex]!;
      const mesh = createLitSprite(art.color, art.normal);
      container.addChild(mesh.mesh);
      // Slow tumble, either direction: rocks are heavy, not pinwheels.
      const spin = randomRange(spinRng, 0.02, 0.06) * (spinRng() > 0.5 ? 1 : -1);
      const template = silhouetteTemplates[artIndex]!;
      const metrePerArtPixel = diameter / art.color.width;
      const points = template.map((point) => ({
        x: point.x * metrePerArtPixel,
        y: point.y * metrePerArtPixel,
      }));
      let radius = 0;
      for (const point of points) radius = Math.max(radius, Math.hypot(point.x, point.y));
      const collider: AsteroidCollider = { x, y, rotation: 0, points, radius, variant: artIndex };
      colliders.push(collider);
      const asteroid: Asteroid = {
        x,
        y,
        diameter,
        spin,
        mesh,
        art,
        collider,
        active: true,
      };
      asteroids.push(asteroid);
      return asteroid;
    },
    update(frame: AsteroidFieldFrame): void {
      for (let index = 0; index < asteroids.length; index += 1) {
        const asteroid = asteroids[index]!;
        if (!asteroid.active) continue;
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
      return colliders.filter((_, index) => asteroids[index]?.active !== false);
    },
    getMiningTargets(): readonly AsteroidCollider[] {
      return colliders.filter((_, index) => asteroids[index]?.active !== false);
    },
    destroy(): void {
      for (const asteroid of asteroids) asteroid.mesh.mesh.destroy({ children: true });
      container.destroy({ children: true });
    },
  };
}
