import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { stepTurretAimInArc, wrapAngle } from './turret-aim';
import type { TurretAimState } from './turret-aim';

const NATIVE_WIDTH = 41;
const NATIVE_HEIGHT = 52;
// The pivot is the center of the base circle, not the image center.
const ANCHOR_X = 20.39 / NATIVE_WIDTH;
const ANCHOR_Y = 30.83 / NATIVE_HEIGHT;

interface TurretMountConfig {
  /** Position in ship-texture pixels relative to the ship centre. */
  x: number;
  y: number;
  scale: number;
  /** Rest angle in radians; 0 points up, ±π/2 point sideways. */
  restAngle: number;
  /** Centre of the allowed aiming arc. 0 = forward, ±π = rearward. */
  aimCenter: number;
  /** Half-width of the allowed aiming arc. */
  aimHalfAngle: number;
}

const FRONT_CONE = Math.PI / 3; // ±60° around forward
const MID_CENTER = Math.PI / 2; // exactly sideways
const MID_CONE = Math.PI / 4; // covers ±45° around sideways
const REAR_CENTER = (3 * Math.PI) / 4; // between side and rear
const REAR_CONE = Math.PI / 4; // covers 90°..180° on each side
const TURRET_SCALE = 1.5;

const mount = (
  x: number,
  y: number,
  restAngle: number,
  aimCenter: number,
  aimHalfAngle: number,
): TurretMountConfig => ({
  x,
  y,
  scale: TURRET_SCALE,
  restAngle,
  aimCenter,
  aimHalfAngle,
});

const TURRET_LAYOUT: readonly TurretMountConfig[] = [
  // Front pair: forward only.
  mount(-65, -88, 0, 0, FRONT_CONE),
  mount(64, -88, 0, 0, FRONT_CONE),
  // Middle four: side-facing, ±45° around sideways.
  mount(-91, 46, -Math.PI / 2, -MID_CENTER, MID_CONE),
  mount(90, 46, Math.PI / 2, MID_CENTER, MID_CONE),
  mount(-97, 126, -Math.PI / 2, -MID_CENTER, MID_CONE),
  mount(96, 126, Math.PI / 2, MID_CENTER, MID_CONE),
  // Rear pair: side-facing, arc runs from side through the rear.
  mount(-98, 201, -Math.PI / 2, -REAR_CENTER, REAR_CONE),
  mount(97, 201, Math.PI / 2, REAR_CENTER, REAR_CONE),
];

export interface TurretMuzzle {
  pairIndex: number;
  /** Muzzle position in ship-texture pixels relative to the ship centre. */
  x: number;
  y: number;
  /** Local turret angle; add the ship rotation for the world direction. */
  angle: number;
}

interface TurretFrame {
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
  update(frame: TurretFrame): void;
  getActivePairs(): readonly boolean[];
  getMuzzles(): readonly TurretMuzzle[];
  destroy(): void;
}

export function createTurrets(texture: Texture): Turrets {
  const configs = TURRET_LAYOUT.map((config) => ({ ...config }));
  const container = new Container();
  const baseScale = NATIVE_WIDTH / texture.width;
  const muzzleLengths = configs.map(
    (config) => ANCHOR_Y * texture.height * baseScale * config.scale,
  );
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
  let activePairs = [false, false, false, false];
  let muzzles: TurretMuzzle[] = [];

  return {
    container,
    update(frame: TurretFrame): void {
      container.position.set(frame.shipScreenX, frame.shipScreenY);
      container.rotation = frame.rotation;
      container.scale.set(frame.shipScale);

      const shipCos = Math.cos(frame.rotation);
      const shipSin = Math.sin(frame.rotation);
      const nextActivePairs = [false, false, false, false];
      const nextMuzzles: TurretMuzzle[] = [];

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
        const rawTarget = wrapAngle(
          Math.atan2(frame.mouseX - mountScreenX, -(frame.mouseY - mountScreenY)) - frame.rotation,
        );
        if (stepTurretAimInArc(aim, rawTarget, config.aimCenter, config.aimHalfAngle, frame.dt)) {
          const pairIndex = Math.floor(index / 2);
          nextActivePairs[pairIndex] = true;
          const muzzleLength = muzzleLengths[index]!;
          nextMuzzles.push({
            pairIndex,
            x: config.x + Math.sin(aim.angle) * muzzleLength,
            y: config.y - Math.cos(aim.angle) * muzzleLength,
            angle: aim.angle,
          });
        }
        sprite.rotation = aim.angle;
      }

      activePairs = nextActivePairs;
      muzzles = nextMuzzles;
    },
    getActivePairs(): readonly boolean[] {
      return activePairs;
    },
    getMuzzles(): readonly TurretMuzzle[] {
      return muzzles;
    },
    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
