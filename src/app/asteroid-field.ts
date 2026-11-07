import { Container } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { ASTEROID_RADIUS_OF_WIDTH } from './asteroid-collision';
import type { Circle } from './asteroid-collision';
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
  /** Art width in metres; the solid collider is a circle fitted to it. */
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
  /** Solid circles in world metres, for ship collision and tracers. */
  getColliders(): readonly Circle[];
  /**
   * The same rocks as mining targets, with their current spin so melted decals
   * can be attached to the rotating surface.
   */
  getMiningTargets(): readonly { x: number; y: number; radius: number; rotation: number }[];
  destroy(): void;
}

/**
 * All asteroids live in the dust-layer world, so they pan and zoom with the
 * environment instead of being placed in screen space. Each one is a lit mesh
 * with a circle collider fitted to the roughly circular art; adding more rocks
 * is just `field.add(x, y, diameter)`, optionally picking an art variant.
 */
export function createAsteroidField(arts: readonly AsteroidArt[]): AsteroidField {
  if (arts.length === 0) throw new Error('Asteroid field needs at least one art variant');
  const container = new Container();
  const spinRng = createRng(0x51a7_2f3d);
  const asteroids: Asteroid[] = [];
  const colliders: Circle[] = [];
  const miningTargets: { x: number; y: number; radius: number; rotation: number }[] = [];

  return {
    container,
    add(x: number, y: number, diameter: number, variant = 0): Asteroid {
      const art = arts[Math.min(Math.max(variant, 0), arts.length - 1)]!;
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
      const radius = diameter * ASTEROID_RADIUS_OF_WIDTH;
      const collider = { x, y, radius };
      colliders.push(collider);
      miningTargets.push({ x, y, radius, rotation: 0 });
      return asteroid;
    },
    update(frame: AsteroidFieldFrame): void {
      for (let index = 0; index < asteroids.length; index += 1) {
        const asteroid = asteroids[index]!;
        asteroid.mesh.mesh.rotation += asteroid.spin * frame.dt;
        const target = miningTargets[index]!;
        target.rotation = asteroid.mesh.mesh.rotation;
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
    getColliders(): readonly Circle[] {
      return colliders;
    },
    getMiningTargets(): readonly { x: number; y: number; radius: number; rotation: number }[] {
      return miningTargets;
    },
    destroy(): void {
      for (const asteroid of asteroids) asteroid.mesh.mesh.destroy({ children: true });
      container.destroy({ children: true });
    },
  };
}
