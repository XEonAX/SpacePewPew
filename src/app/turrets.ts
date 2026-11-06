import { Container, Sprite, Texture } from 'pixi.js';
import { stepTurretAim, wrapAngle } from './turret-aim';
import type { TurretAimState } from './turret-aim';

const NATIVE_WIDTH = 41;
const NATIVE_HEIGHT = 52;
// The pivot is the center of the base circle, not the image center.
const ANCHOR_X = 20.39 / NATIVE_WIDTH;
const ANCHOR_Y = 30.83 / NATIVE_HEIGHT;

export interface TurretMountConfig {
  /** Position in ship-texture pixels relative to the ship centre. */
  x: number;
  y: number;
  scale: number;
  /** Rest angle in radians; 0 points up, ±π/2 point sideways. */
  restAngle: number;
}

export const TURRET_MOUNT_LABELS = [
  'Front L',
  'Front R',
  'Rear L1',
  'Rear R1',
  'Rear L2',
  'Rear R2',
  'Rear L3',
  'Rear R3',
] as const;

export const DEFAULT_TURRET_LAYOUT: readonly TurretMountConfig[] = [
  { x: -65, y: -88, scale: 1.5, restAngle: 0 }, // front left, up
  { x: 64, y: -88, scale: 1.5, restAngle: 0 }, // front right, up
  { x: -91, y: 46, scale: 1.5, restAngle: -Math.PI / 2 }, // rear left 1, side
  { x: 90, y: 46, scale: 1.5, restAngle: Math.PI / 2 }, // rear right 1, side
  { x: -97, y: 126, scale: 1.5, restAngle: -Math.PI / 2 }, // rear left 2
  { x: 96, y: 126, scale: 1.5, restAngle: Math.PI / 2 }, // rear right 2
  { x: -98, y: 201, scale: 1.5, restAngle: -Math.PI / 2 }, // rear left 3
  { x: 97, y: 201, scale: 1.5, restAngle: Math.PI / 2 }, // rear right 3
] as const;

export interface TurretFrame {
  shipScreenX: number;
  shipScreenY: number;
  shipScale: number;
  rotation: number;
  mouseX: number;
  mouseY: number;
  mouseActive: boolean;
  dt: number;
}

export interface Turrets {
  container: Container;
  setMount(index: number, config: TurretMountConfig): void;
  update(frame: TurretFrame): void;
  destroy(): void;
}

export function createTurrets(
  texture: Texture,
  configs: TurretMountConfig[] = DEFAULT_TURRET_LAYOUT.map((config) => ({ ...config })),
): Turrets {
  const container = new Container();
  const baseScale = NATIVE_WIDTH / texture.width;
  const sprites = configs.map((config) => {
    const sprite = new Sprite({ texture, anchor: { x: ANCHOR_X, y: ANCHOR_Y } });
    sprite.position.set(config.x, config.y);
    sprite.scale.set(baseScale * config.scale);
    container.addChild(sprite);
    return sprite;
  });
  const aims: TurretAimState[] = configs.map((config) => ({
    angle: config.restAngle,
    angularVelocity: 0,
  }));

  return {
    container,
    setMount(index: number, config: TurretMountConfig): void {
      const sprite = sprites[index];
      if (!sprite) return;
      sprite.position.set(config.x, config.y);
      sprite.scale.set(baseScale * config.scale);
    },
    update(frame: TurretFrame): void {
      container.position.set(frame.shipScreenX, frame.shipScreenY);
      container.rotation = frame.rotation;
      container.scale.set(frame.shipScale);

      const shipCos = Math.cos(frame.rotation);
      const shipSin = Math.sin(frame.rotation);

      for (let index = 0; index < configs.length; index += 1) {
        const config = configs[index]!;
        const sprite = sprites[index]!;
        const aim = aims[index]!;

        if (!frame.mouseActive) {
          aim.angle = wrapAngle(config.restAngle);
          aim.angularVelocity = 0;
          sprite.rotation = aim.angle;
          continue;
        }

        const localX = config.x * frame.shipScale;
        const localY = config.y * frame.shipScale;
        const mountScreenX = frame.shipScreenX + localX * shipCos - localY * shipSin;
        const mountScreenY = frame.shipScreenY + localX * shipSin + localY * shipCos;
        const target = wrapAngle(
          Math.atan2(frame.mouseX - mountScreenX, -(frame.mouseY - mountScreenY)) - frame.rotation,
        );

        stepTurretAim(aim, target, frame.dt);
        sprite.rotation = aim.angle;
      }
    },
    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
