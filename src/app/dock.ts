import { Container, Graphics } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { isInDockZone } from './dock-model';
import type { DockZone } from './dock-model';
import { createLitSprite } from './lit-sprite';
import type { LightingState } from './lit-sprite';
import { PIXELS_PER_METER } from './world-scale';

const DOCK_HEIGHT_M = 28;
const DOCK_PAD_RADIUS_M = 4.5;
const DOCK_MAX_SPEED_MPS = 2;

export interface DockFrame {
  dustX: number;
  dustY: number;
  zoom: number;
  width: number;
  height: number;
  dt: number;
}

export interface Dock {
  container: Container;
  update(frame: DockFrame): void;
  setLighting(state: LightingState): void;
  /** True when the ship is centred over the pad and slow enough to unload. */
  canUnload(shipX: number, shipY: number, speedMps: number): boolean;
  /** Flash the pad after a cargo transfer. */
  pulse(): void;
  destroy(): void;
}

export function createDock(color: Texture, normal: Texture): Dock {
  const container = new Container();
  container.name = 'dock';
  const sprite = createLitSprite(color, normal);
  const landingRing = new Graphics();
  container.addChild(sprite.mesh, landingRing);

  const zone: DockZone = { x: 0, y: 0, radiusM: DOCK_PAD_RADIUS_M };
  let pulse = 0;

  return {
    container,
    update(frame: DockFrame): void {
      const scale = (DOCK_HEIGHT_M * PIXELS_PER_METER) / color.height;
      sprite.mesh.scale.set(scale * frame.zoom);
      sprite.mesh.position.set(
        (zone.x * PIXELS_PER_METER - frame.dustX * frame.width) * frame.zoom + frame.width / 2,
        (zone.y * PIXELS_PER_METER - frame.dustY * frame.height) * frame.zoom + frame.height / 2,
      );
      pulse = Math.max(0, pulse - frame.dt * 1.8);
      landingRing.clear();
      if (pulse > 0) {
        const x =
          (zone.x * PIXELS_PER_METER - frame.dustX * frame.width) * frame.zoom + frame.width / 2;
        const y =
          (zone.y * PIXELS_PER_METER - frame.dustY * frame.height) * frame.zoom + frame.height / 2;
        const radius = DOCK_PAD_RADIUS_M * PIXELS_PER_METER * frame.zoom * (1.1 + (1 - pulse));
        landingRing.circle(x, y, radius).stroke({ color: 0xffc15c, width: 3, alpha: 0.7 * pulse });
      }
    },
    setLighting(state: LightingState): void {
      sprite.setLighting(state);
    },
    canUnload(shipX: number, shipY: number, speedMps: number): boolean {
      return isInDockZone(shipX, shipY, speedMps, zone, DOCK_MAX_SPEED_MPS);
    },
    pulse(): void {
      pulse = 1;
    },
    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
