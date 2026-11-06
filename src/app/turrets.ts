import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
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
const MUZZLE_GLOW_SIZE = 28;

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

function createChargeGlowTexture(): Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.16, 'rgba(180, 252, 255, 1)');
    gradient.addColorStop(0.42, 'rgba(70, 225, 255, 0.72)');
    gradient.addColorStop(0.72, 'rgba(25, 150, 220, 0.2)');
    gradient.addColorStop(1, 'rgba(10, 90, 160, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

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
  now: number;
}

export interface Turrets {
  container: Container;
  update(frame: TurretFrame): void;
  getActivePairs(): readonly boolean[];
  getMuzzles(): readonly TurretMuzzle[];
  setGlowLevels(levels: readonly number[]): void;
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
  const glowTexture = createChargeGlowTexture();
  const glowSprites = configs.map(() => {
    const glow = new Sprite({ texture: glowTexture, anchor: 0.5 });
    glow.width = MUZZLE_GLOW_SIZE;
    glow.height = MUZZLE_GLOW_SIZE;
    glow.blendMode = 'add';
    glow.visible = false;
    container.addChild(glow);
    return glow;
  });
  const aims: TurretAimState[] = configs.map((config) => ({
    angle: config.restAngle,
    angularVelocity: 0,
  }));
  let activePairs = [false, false, false, false];
  let muzzles: TurretMuzzle[] = [];
  let glowLevels: readonly number[] = [1, 1, 1, 1];
  const glowAlphas = configs.map(() => 1);

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
        const pairIndex = Math.floor(index / 2);

        let inArc = false;
        if (!frame.mouseActive) {
          aim.angle = wrapAngle(config.restAngle);
          aim.angularVelocity = 0;
        } else {
          const localX = config.x * frame.shipScale;
          const localY = config.y * frame.shipScale;
          const mountScreenX = frame.shipScreenX + localX * shipCos - localY * shipSin;
          const mountScreenY = frame.shipScreenY + localX * shipSin + localY * shipCos;
          const rawTarget = wrapAngle(
            Math.atan2(frame.mouseX - mountScreenX, -(frame.mouseY - mountScreenY)) -
              frame.rotation,
          );
          inArc = stepTurretAimInArc(
            aim,
            rawTarget,
            config.aimCenter,
            config.aimHalfAngle,
            frame.dt,
          );
        }
        sprite.rotation = aim.angle;

        const muzzleLength = muzzleLengths[index]!;
        const muzzleX = config.x + Math.sin(aim.angle) * muzzleLength;
        const muzzleY = config.y - Math.cos(aim.angle) * muzzleLength;

        const glow = glowSprites[index]!;
        // Charge/fire state only belongs to barrels currently tracking the mouse.
        const level = inArc ? (glowLevels[pairIndex] ?? 1) : 1;
        const charge = Math.max(0, level - 1);
        const flicker = Math.sin(frame.now * 5 + index * 1.7);
        const targetAlpha =
          level <= 0 ? 0 : Math.min(1, 0.92 + 0.08 * Math.min(1, charge / 0.9) + 0.02 * flicker);
        const alpha =
          glowAlphas[index]! + (targetAlpha - glowAlphas[index]!) * Math.min(1, frame.dt * 10);
        glowAlphas[index] = alpha;

        glow.position.set(muzzleX, muzzleY);
        glow.alpha = alpha;
        glow.visible = alpha > 0.005 || targetAlpha > 0;
        const size = MUZZLE_GLOW_SIZE * (1 + 0.55 * charge) * (1 + 0.015 * flicker);
        glow.width = size;
        glow.height = size;

        if (inArc) {
          nextActivePairs[pairIndex] = true;
          nextMuzzles.push({
            pairIndex,
            x: muzzleX,
            y: muzzleY,
            angle: aim.angle,
          });
        }
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
    setGlowLevels(levels: readonly number[]): void {
      glowLevels = levels;
    },
    destroy(): void {
      container.destroy({ children: true });
      glowTexture.destroy(true);
    },
  };
}
