import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { createRng, randomRange } from '../utils/random';
import { PIXELS_PER_METER } from './world-scale';
import { distance, moveToward, rayCircleHit, reflectDirection } from './mining-model';
import type { Vec2 } from './mining-model';
import { muzzleWorldPose } from './weapons';
import type { MuzzleAim } from './weapons';

export const CHUNK_POOL_SIZE = 64;
const CHUNK_SIZE_M = 0.6;
const CHUNK_MIN_SPEED = 6;
const CHUNK_MAX_SPEED = 13;
const CHUNK_SPREAD_RAD = 0.3;
const CHUNK_LIFETIME = 30;
const CHUNK_FADE_SECONDS = 4;
const CHUNK_CULL_RADIUS_M = 700;
const LASER_RANGE_M = 220;
const LASER_SPAWN_INTERVAL = 0.1;
const LASER_BARRELS = 2;
const TRACTOR_FIRST_BARREL = 2;
const TRACTOR_RANGE_M = 26;
const TRACTOR_PULL_SPEED = 18;
const GRILL_WIDTH_M = 1.8;
const GRILL_HEIGHT_M = 1.0;
const GRILL_INTAKE_M = 1.3;
const CHUNK_TEXTURE_SIZE = 32;

const LASER_COLOR = 0xff5340;
const LASER_CORE_COLOR = 0xffd9c2;
const TRACTOR_COLOR = 0x52ff9b;
const METAL_COLOR = 0xffb066;

interface Chunk {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Velocity before capture, restored if the tractors shut off mid-pull. */
  driftVx: number;
  driftVy: number;
  spin: number;
  life: number;
  active: boolean;
  tracted: boolean;
  barrel: number;
}

export interface MiningShip {
  x: number;
  y: number;
  rotation: number;
  /** Metres per ship-texture pixel, so muzzle poses get a metric pose too. */
  metresPerShipPixel: number;
}

export interface MiningAsteroid {
  x: number;
  y: number;
  radius: number;
}

export interface MiningFrame {
  dt: number;
  now: number;
  ship: MiningShip;
  asteroid: MiningAsteroid;
  /** All mount muzzle poses, in mount order (front pair first). */
  muzzles: readonly MuzzleAim[];
  laserFiring: boolean;
  /** Tractor beams run autonomously whenever the mining rig is equipped. */
  tractorsActive: boolean;
  dustX: number;
  dustY: number;
  zoom: number;
  width: number;
  height: number;
}

export interface Mining {
  container: Container;
  update(frame: MiningFrame): void;
  getCargo(): number;
  destroy(): void;
}

function createChunkTexture(): Texture {
  const size = CHUNK_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 250, 236, 1)');
    gradient.addColorStop(0.28, 'rgba(255, 206, 120, 1)');
    gradient.addColorStop(0.62, 'rgba(255, 138, 58, 0.82)');
    gradient.addColorStop(1, 'rgba(190, 56, 18, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function createMining(): Mining {
  const container = new Container();
  const grill = new Graphics();
  grill.blendMode = 'normal';
  container.addChild(grill);

  const texture = createChunkTexture();
  const chunks: Chunk[] = [];
  for (let index = 0; index < CHUNK_POOL_SIZE; index += 1) {
    const sprite = new Sprite({ texture, anchor: 0.5 });
    sprite.blendMode = 'add';
    sprite.visible = false;
    container.addChild(sprite);
    chunks.push({
      sprite,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      driftVx: 0,
      driftVy: 0,
      spin: 0,
      life: 0,
      active: false,
      tracted: false,
      barrel: -1,
    });
  }

  const beams = new Graphics();
  beams.blendMode = 'add';
  container.addChild(beams);

  const rng = createRng(0x0d1f_7a3b);
  const laserTimers = new Array<number>(LASER_BARRELS).fill(0);
  let cargo = 0;
  let flash = 0;

  const spawnChunk = (hit: Vec2, direction: Vec2, asteroid: MiningAsteroid): void => {
    const chunk = chunks.find((candidate) => !candidate.active);
    if (!chunk) return;
    const radius = Math.max(asteroid.radius, 1e-3);
    const normal = { x: (hit.x - asteroid.x) / radius, y: (hit.y - asteroid.y) / radius };
    // Molten metal leaves along the reflected laser direction, with a little
    // scatter so consecutive hits do not stack into one line.
    const reflected = reflectDirection(direction, normal);
    const angle =
      Math.atan2(reflected.y, reflected.x) + randomRange(rng, -CHUNK_SPREAD_RAD, CHUNK_SPREAD_RAD);
    const speed = randomRange(rng, CHUNK_MIN_SPEED, CHUNK_MAX_SPEED);

    chunk.active = true;
    chunk.tracted = false;
    chunk.barrel = -1;
    chunk.x = hit.x + normal.x * CHUNK_SIZE_M * 0.6;
    chunk.y = hit.y + normal.y * CHUNK_SIZE_M * 0.6;
    chunk.vx = Math.cos(angle) * speed;
    chunk.vy = Math.sin(angle) * speed;
    chunk.driftVx = chunk.vx;
    chunk.driftVy = chunk.vy;
    chunk.life = CHUNK_LIFETIME;
    chunk.spin = randomRange(rng, -3, 3);

    const size = CHUNK_SIZE_M * randomRange(rng, 0.75, 1.3) * PIXELS_PER_METER;
    chunk.sprite.width = size;
    chunk.sprite.height = size;
    chunk.sprite.rotation = randomRange(rng, 0, Math.PI * 2);
    chunk.sprite.alpha = 1;
    chunk.sprite.tint = METAL_COLOR;
    chunk.sprite.position.set(chunk.x * PIXELS_PER_METER, chunk.y * PIXELS_PER_METER);
    chunk.sprite.visible = true;
  };

  return {
    container,
    update(frame: MiningFrame): void {
      container.position.set(
        -frame.dustX * frame.width * frame.zoom + frame.width / 2,
        -frame.dustY * frame.height * frame.zoom + frame.height / 2,
      );
      container.scale.set(frame.zoom);

      const ship = frame.ship;
      const poses = frame.muzzles.map((muzzle) =>
        muzzleWorldPose(muzzle, ship.x, ship.y, ship.rotation, ship.metresPerShipPixel),
      );
      const grillX = ship.x;
      const grillY = ship.y;

      beams.clear();
      flash = Math.max(0, flash - frame.dt * 2.2);

      // Front pair: red mining lasers. Each barrel that bites the asteroid
      // melts a fragment off along the reflection angle.
      for (let barrel = 0; barrel < LASER_BARRELS; barrel += 1) {
        const pose = poses[barrel];
        if (!pose) continue;
        const direction = { x: Math.sin(pose.angle), y: -Math.cos(pose.angle) };
        const hit = rayCircleHit(
          pose,
          direction,
          LASER_RANGE_M,
          { x: frame.asteroid.x, y: frame.asteroid.y },
          frame.asteroid.radius,
        );
        const end = hit ?? {
          x: pose.x + direction.x * LASER_RANGE_M,
          y: pose.y + direction.y * LASER_RANGE_M,
        };

        if (frame.laserFiring) {
          beams
            .moveTo(pose.x * PIXELS_PER_METER, pose.y * PIXELS_PER_METER)
            .lineTo(end.x * PIXELS_PER_METER, end.y * PIXELS_PER_METER)
            .stroke({ color: LASER_COLOR, width: 5, alpha: 0.78 });
          beams
            .moveTo(pose.x * PIXELS_PER_METER, pose.y * PIXELS_PER_METER)
            .lineTo(end.x * PIXELS_PER_METER, end.y * PIXELS_PER_METER)
            .stroke({ color: LASER_CORE_COLOR, width: 1.6, alpha: 0.95 });

          laserTimers[barrel] = (laserTimers[barrel] ?? 0) + frame.dt;
          if (hit && laserTimers[barrel]! >= LASER_SPAWN_INTERVAL) {
            laserTimers[barrel] = laserTimers[barrel]! - LASER_SPAWN_INTERVAL;
            spawnChunk(hit, direction, frame.asteroid);
          }
        } else {
          laserTimers[barrel] = 0;
        }
      }

      // Rear six: autonomous green tractor beams drag nearby metal into the
      // centre grill. Capture only happens while the rig is equipped.
      for (const chunk of chunks) {
        if (!chunk.active) continue;
        if (!frame.tractorsActive) {
          if (chunk.tracted) {
            chunk.tracted = false;
            chunk.vx = chunk.driftVx;
            chunk.vy = chunk.driftVy;
          }
          continue;
        }

        if (!chunk.tracted) {
          let bestBarrel = -1;
          let bestDistance = TRACTOR_RANGE_M;
          for (let barrel = TRACTOR_FIRST_BARREL; barrel < poses.length; barrel += 1) {
            const pose = poses[barrel];
            if (!pose) continue;
            const reach = Math.hypot(pose.x - chunk.x, pose.y - chunk.y);
            if (reach <= bestDistance) {
              bestDistance = reach;
              bestBarrel = barrel;
            }
          }
          if (bestBarrel >= 0) {
            chunk.tracted = true;
            chunk.barrel = bestBarrel;
            chunk.driftVx = chunk.vx;
            chunk.driftVy = chunk.vy;
          }
        }

        if (!chunk.tracted) continue;

        const toGrill = distance(chunk, { x: grillX, y: grillY });
        if (toGrill <= GRILL_INTAKE_M) {
          chunk.active = false;
          chunk.sprite.visible = false;
          cargo += 1;
          flash = 1;
          continue;
        }
        const stepped = moveToward(
          { x: chunk.x, y: chunk.y },
          { x: grillX, y: grillY },
          TRACTOR_PULL_SPEED,
          frame.dt,
        );
        chunk.x = stepped.x;
        chunk.y = stepped.y;

        const emitter = poses[chunk.barrel];
        if (emitter) {
          const flicker = 0.5 + 0.12 * Math.sin(frame.now * 24 + chunk.barrel);
          beams
            .moveTo(emitter.x * PIXELS_PER_METER, emitter.y * PIXELS_PER_METER)
            .lineTo(chunk.x * PIXELS_PER_METER, chunk.y * PIXELS_PER_METER)
            .stroke({ color: TRACTOR_COLOR, width: 2.4, alpha: flicker });
        }
      }

      // Drift, age and draw the metal.
      for (const chunk of chunks) {
        if (!chunk.active) continue;
        if (!chunk.tracted) {
          chunk.x += chunk.vx * frame.dt;
          chunk.y += chunk.vy * frame.dt;
          chunk.life -= frame.dt;
          const tooFar = distance(chunk, { x: ship.x, y: ship.y }) > CHUNK_CULL_RADIUS_M;
          if (chunk.life <= 0 || tooFar) {
            chunk.active = false;
            chunk.sprite.visible = false;
            continue;
          }
        }
        chunk.sprite.position.set(chunk.x * PIXELS_PER_METER, chunk.y * PIXELS_PER_METER);
        chunk.sprite.rotation += chunk.spin * frame.dt;
        chunk.sprite.alpha = Math.min(1, Math.max(0, chunk.life / CHUNK_FADE_SECONDS));
      }

      // Centre cargo grill: a dark rectangle with glowing intake slats.
      const widthPx = GRILL_WIDTH_M * PIXELS_PER_METER;
      const heightPx = GRILL_HEIGHT_M * PIXELS_PER_METER;
      grill.position.set(grillX * PIXELS_PER_METER, grillY * PIXELS_PER_METER);
      grill.rotation = ship.rotation;
      grill.clear();
      grill
        .roundRect(-widthPx / 2, -heightPx / 2, widthPx, heightPx, 6)
        .fill({ color: 0x050d12, alpha: 0.92 });
      grill
        .roundRect(-widthPx / 2, -heightPx / 2, widthPx, heightPx, 6)
        .stroke({ color: TRACTOR_COLOR, width: 2, alpha: 0.45 + 0.45 * flash });
      for (let slat = 1; slat <= 3; slat += 1) {
        const x = -widthPx / 2 + (slat * widthPx) / 4 - 1;
        grill.rect(x, -heightPx / 2 + 5, 2, heightPx - 10).fill({
          color: 0x1a6b4c,
          alpha: 0.55 + 0.4 * flash,
        });
      }
    },
    getCargo(): number {
      return cargo;
    },
    destroy(): void {
      container.destroy({ children: true });
      texture.destroy(true);
    },
  };
}
