import { Container } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { ASTEROID_RADIUS_OF_WIDTH } from './asteroid-collision';
import type { Circle } from './asteroid-collision';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import { PIXELS_PER_METER } from './world-scale';

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
  add(x: number, y: number, diameter: number): Asteroid;
  update(frame: AsteroidFieldFrame): void;
  setLighting(state: LightingState): void;
  /** Solid circles in world metres, for ship collision and tracers. */
  getColliders(): readonly Circle[];
  /** The same rocks as mining targets (radius = fitted solid circle). */
  getMiningTargets(): readonly { x: number; y: number; radius: number }[];
  destroy(): void;
}

/**
 * All asteroids live in the dust-layer world, so they pan and zoom with the
 * environment instead of being placed in screen space. Each one is a lit mesh
 * with a circle collider fitted to the roughly circular art; adding more rocks
 * is just `field.add(x, y, diameter)`.
 */
export function createAsteroidField(color: Texture, normal: Texture): AsteroidField {
  const container = new Container();
  const asteroids: Asteroid[] = [];
  const colliders: Circle[] = [];
  const miningTargets: { x: number; y: number; radius: number }[] = [];
  const artWidth = color.width;

  return {
    container,
    add(x: number, y: number, diameter: number): Asteroid {
      const mesh = createLitSprite(color, normal);
      container.addChild(mesh.mesh);
      const asteroid: Asteroid = {
        x,
        y,
        diameter,
        spin: -0.22,
        mesh,
      };
      asteroids.push(asteroid);
      const radius = diameter * ASTEROID_RADIUS_OF_WIDTH;
      const collider = { x, y, radius };
      colliders.push(collider);
      miningTargets.push(collider);
      return asteroid;
    },
    update(frame: AsteroidFieldFrame): void {
      for (const asteroid of asteroids) {
        asteroid.mesh.mesh.rotation += asteroid.spin * frame.dt;
        asteroid.mesh.mesh.scale.set(
          ((asteroid.diameter * PIXELS_PER_METER) / artWidth) * frame.zoom,
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
    getMiningTargets(): readonly { x: number; y: number; radius: number }[] {
      return miningTargets;
    },
    destroy(): void {
      for (const asteroid of asteroids) asteroid.mesh.mesh.destroy({ children: true });
      container.destroy({ children: true });
    },
  };
}
