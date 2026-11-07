import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { forwardAimInArc, stepTurretAim, stepTurretAimInArc, wrapAngle } from './turret-aim';
import type { TurretAimState } from './turret-aim';
import type { TurretAimMode } from './weapon-mode';

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
  /** Angular speed/acceleration multiplier for this mount. */
  turnScale: number;
}

// Front pair keeps its ±60° outer edge, but the inner edges meet ahead of the
// nose tip instead of overlapping across the hull.
const FRONT_OUTER = Math.PI / 3;
const FRONT_INNER = (11 * Math.PI) / 180;
const FRONT_CENTER = (FRONT_OUTER - FRONT_INNER) / 2;
const FRONT_CONE = (FRONT_OUTER + FRONT_INNER) / 2;
const MID_CENTER = Math.PI / 2; // exactly sideways
const MID_CONE = Math.PI / 4; // covers ±45° around sideways
// Rear arcs extend past straight-back so their inner rays cross ~5 m behind
// the engines.
const REAR_CENTER = (140.25 * Math.PI) / 180;
const REAR_CONE = (50.25 * Math.PI) / 180;
const TURRET_SCALE = 1.5;
const FRONT_TURN_SCALE = 1.85;
/** Tractor barrels slew faster than guns so their beams stay on the cargo. */
const MINING_TURN_SCALE = 1.7;
const MUZZLE_GLOW_SIZE = 28;

const mount = (
  x: number,
  y: number,
  restAngle: number,
  aimCenter: number,
  aimHalfAngle: number,
  turnScale = 1,
): TurretMountConfig => ({
  x,
  y,
  scale: TURRET_SCALE,
  restAngle,
  aimCenter,
  aimHalfAngle,
  turnScale,
});

const TURRET_LAYOUT: readonly TurretMountConfig[] = [
  // Front pair: forward only.
  mount(-65, -88, 0, -FRONT_CENTER, FRONT_CONE, FRONT_TURN_SCALE),
  mount(64, -88, 0, FRONT_CENTER, FRONT_CONE, FRONT_TURN_SCALE),
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
  /**
   * `forward` parks every mount at its forward-most legal aim; `mining` tracks
   * the pointer with the front pair only and parks the six tractor barrels.
   */
  mode: TurretAimMode;
  /**
   * World position of the chunk each tractor barrel is holding, so mining
   * barrels can swing fully round to point at what they carry.
   */
  tractorTargets?: readonly ({ x: number; y: number } | null)[];
  dt: number;
  now: number;
}

export interface Turrets {
  container: Container;
  update(frame: TurretFrame): void;
  getActivePairs(): readonly boolean[];
  getMuzzles(): readonly TurretMuzzle[];
  /** Every mount's muzzle pose, whether or not its pair is hot. */
  getAimPoses(): readonly TurretMuzzle[];
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
  let aimPoses: TurretMuzzle[] = [];
  let glowLevels: readonly number[] = [1, 1, 1, 1];
  const glowAlphas = configs.map(() => 1);
  // Barrels that fired this charge, so they keep glowing after the mouse
  // leaves their arc; the shot is already committed.
  const latchedBarrels = configs.map(() => false);

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
      const nextAimPoses: TurretMuzzle[] = [];

      for (let index = 0; index < configs.length; index += 1) {
        const config = configs[index]!;
        const sprite = sprites[index]!;
        const aim = aims[index]!;
        const pairIndex = Math.floor(index / 2);

        let inArc = false;
        const forwardOnly = frame.mode === 'forward' || (frame.mode === 'mining' && index >= 2);
        const mouseTracked = frame.mode === 'mouse' || (frame.mode === 'mining' && index < 2);
        if (forwardOnly) {
          const tractorTarget =
            frame.mode === 'mining' ? (frame.tractorTargets?.[index] ?? null) : null;
          if (tractorTarget) {
            // Tractor barrels rotate fully — no cone clamp — to face the chunk
            // they are gripping.
            const localX = config.x * frame.shipScale;
            const localY = config.y * frame.shipScale;
            const mountScreenX = frame.shipScreenX + localX * shipCos - localY * shipSin;
            const mountScreenY = frame.shipScreenY + localX * shipSin + localY * shipCos;
            const rawTarget = wrapAngle(
              Math.atan2(tractorTarget.x - mountScreenX, -(tractorTarget.y - mountScreenY)) -
                frame.rotation,
            );
            // Tractor barrels get extra slew so capturing a chunk never leaves
            // the beam detached from a still-turning barrel.
            stepTurretAim(aim, rawTarget, frame.dt, config.turnScale * MINING_TURN_SCALE);
          } else {
            // Aim as close to straight ahead as this mount's cone allows; all
            // pairs are hot so the keyboard can fire the whole battery.
            stepTurretAim(
              aim,
              forwardAimInArc(config.aimCenter, config.aimHalfAngle),
              frame.dt,
              config.turnScale,
            );
          }
          // Mining tractors are not gun pairs: they never mark a pair hot.
          inArc = frame.mode === 'forward';
        } else if (!mouseTracked || !frame.mouseActive) {
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
            config.turnScale,
          );
        }
        sprite.rotation = aim.angle;

        const muzzleLength = muzzleLengths[index]!;
        const muzzleX = config.x + Math.sin(aim.angle) * muzzleLength;
        const muzzleY = config.y - Math.cos(aim.angle) * muzzleLength;

        const glow = glowSprites[index]!;
        // A pair charging a committed shot keeps its firing barrels lit even
        // once the mouse leaves their arc.
        const charging = (glowLevels[pairIndex] ?? 1) > 1;
        if (!charging) {
          latchedBarrels[index] = false;
        } else if (inArc) {
          latchedBarrels[index] = true;
        }
        const level = inArc || latchedBarrels[index] ? (glowLevels[pairIndex] ?? 1) : 1;
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

        nextAimPoses.push({
          pairIndex,
          x: muzzleX,
          y: muzzleY,
          angle: aim.angle,
        });
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
      aimPoses = nextAimPoses;
    },
    getActivePairs(): readonly boolean[] {
      return activePairs;
    },
    getMuzzles(): readonly TurretMuzzle[] {
      return muzzles;
    },
    getAimPoses(): readonly TurretMuzzle[] {
      return aimPoses;
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
