import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { createRng, randomRange } from '../utils/random';
import { PIXELS_PER_METER } from './world-scale';
import {
  carryToward,
  dampVelocity,
  distance,
  pointInRotatedRect,
  rayCircleHit,
  reflectDirection,
} from './mining-model';
import type { Vec2 } from './mining-model';
import { muzzleWorldPose } from './weapons';
import type { MuzzleAim } from './weapons';

export const CHUNK_POOL_SIZE = 256;
const CHUNK_SIZE_M = 0.6;
// Molten metal floats away slowly so the gentle tractors can reel it in.
const CHUNK_MIN_SPEED = 1.2;
const CHUNK_MAX_SPEED = 2.8;
const CHUNK_SPREAD_RAD = 0.3;
// Metal cools as it drifts, so a burst slows over a couple of seconds instead
// of sailing past the ship forever.
const CHUNK_DAMPING_PER_SECOND = 0.55;
// Uncaptered molten metal cools and fades; captured chunks are not aged.
const CHUNK_LIFETIME = 8;
const CHUNK_FADE_SECONDS = 3;
const CHUNK_CULL_RADIUS_M = 700;
const LASER_RANGE_M = 220;
const LASER_SPAWN_INTERVAL = 0.1;
const LASER_BARRELS = 2;
const TRACTOR_FIRST_BARREL = 2;
/** Tractor reach, measured from the barrel that captured the chunk. */
const TRACTOR_RANGE_M = 5;
// Carrying is deliberately faked: grip the chunk, slide it at the hatch, slow
// near the intake. More beams on one chunk drag it in faster.
const PULL_SPEED_PER_BEAM_MPS = 2.5;
const PULL_MAX_SPEED_MPS = 9;
const PULL_ARRIVAL_SECONDS = 0.9;
const CHUNK_TEXTURE_SIZE = 32;

// The grill is part of the hull texture: the slatted hatch between the two
// rearmost pairs. These are ship-texture pixels relative to the ship centre.
const GRILL_LOCAL_X_PX = -1;
const GRILL_LOCAL_Y_PX = 123;
const GRILL_HALF_W_PX = 23;
const GRILL_HALF_H_PX = 45;
/** Grow the intake by half a chunk so metal does not need pixel-perfect aim. */
const GRILL_PAD_M = CHUNK_SIZE_M * 0.5;

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
  spin: number;
  life: number;
  active: boolean;
  tracted: boolean;
  /** Every tractor barrel currently locked onto this chunk (more = faster). */
  barrels: number[];
}

export interface MiningShip {
  x: number;
  y: number;
  rotation: number;
  /** Ship velocity in metres/second, so carried metal keeps up with a flyer. */
  vx: number;
  vy: number;
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
  /** World position of the chunk each barrel holds (front barrels are null). */
  getTractorTargets(): readonly ({ x: number; y: number } | null)[];
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
      spin: 0,
      life: 0,
      active: false,
      tracted: false,
      barrels: [],
    });
  }

  const beams = new Graphics();
  beams.blendMode = 'add';
  container.addChild(beams);

  const rng = createRng(0x0d1f_7a3b);
  const laserTimers = new Array<number>(LASER_BARRELS).fill(0);
  const tractorTargets: ({ x: number; y: number } | null)[] = new Array(8).fill(null);
  let cargo = 0;

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
    chunk.barrels = [];
    chunk.x = hit.x + normal.x * CHUNK_SIZE_M * 0.6;
    chunk.y = hit.y + normal.y * CHUNK_SIZE_M * 0.6;
    chunk.vx = Math.cos(angle) * speed;
    chunk.vy = Math.sin(angle) * speed;
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
      const metres = ship.metresPerShipPixel;
      const cos = Math.cos(ship.rotation);
      const sin = Math.sin(ship.rotation);
      const poses = frame.muzzles.map((muzzle) =>
        muzzleWorldPose(muzzle, ship.x, ship.y, ship.rotation, metres),
      );

      // Intake is the hull's own slatted hatch, so no grill graphic is drawn.
      const grillLocalX = GRILL_LOCAL_X_PX * metres;
      const grillLocalY = GRILL_LOCAL_Y_PX * metres;
      const grillX = ship.x + grillLocalX * cos - grillLocalY * sin;
      const grillY = ship.y + grillLocalX * sin + grillLocalY * cos;
      const grillHalfW = GRILL_HALF_W_PX * metres + GRILL_PAD_M;
      const grillHalfH = GRILL_HALF_H_PX * metres + GRILL_PAD_M;

      beams.clear();

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

      for (const chunk of chunks) {
        chunk.tracted = false;
        chunk.barrels = [];
      }
      tractorTargets.fill(null);

      // One beam per chunk: a beam takes the most external free chunk in its
      // reach (furthest from the hull = freshest/likeliest to drift off), then
      // reels it in. Spare beams stay idle rather than piling onto one chunk.
      if (frame.tractorsActive) {
        const claimed = new Set<Chunk>();
        for (let barrel = TRACTOR_FIRST_BARREL; barrel < poses.length; barrel += 1) {
          const pose = poses[barrel];
          if (!pose) continue;
          let target: Chunk | null = null;
          let bestExternality = -1;
          for (const chunk of chunks) {
            if (!chunk.active || claimed.has(chunk)) continue;
            if (Math.hypot(pose.x - chunk.x, pose.y - chunk.y) > TRACTOR_RANGE_M) continue;
            const externality = Math.hypot(chunk.x - ship.x, chunk.y - ship.y);
            if (externality > bestExternality) {
              bestExternality = externality;
              target = chunk;
            }
          }
          if (!target) continue;
          claimed.add(target);
          target.tracted = true;
          target.barrels.push(barrel);
          tractorTargets[barrel] = { x: target.x, y: target.y };
        }
      }

      for (const chunk of chunks) {
        if (!chunk.active) continue;

        if (chunk.tracted) {
          // Fake carry in the ship's frame: the chunk is dragged along with the
          // ship as well as toward the hatch, so a flying ship never outruns it.
          // Speed scales per beam and is capped by the remaining distance, so it
          // cannot overshoot the intake.
          const carried = carryToward(
            { x: chunk.x + ship.vx * frame.dt, y: chunk.y + ship.vy * frame.dt },
            { x: grillX, y: grillY },
            frame.dt,
            chunk.barrels.length,
            {
              speedPerBeam: PULL_SPEED_PER_BEAM_MPS,
              maxSpeed: PULL_MAX_SPEED_MPS,
              arrivalSeconds: PULL_ARRIVAL_SECONDS,
            },
          );
          chunk.x = carried.x;
          chunk.y = carried.y;
          // Released metal keeps the ship's motion instead of hanging in space.
          chunk.vx = ship.vx;
          chunk.vy = ship.vy;
        } else {
          const damped = dampVelocity(
            { x: chunk.vx, y: chunk.vy },
            CHUNK_DAMPING_PER_SECOND,
            frame.dt,
          );
          chunk.vx = damped.x;
          chunk.vy = damped.y;
          chunk.x += chunk.vx * frame.dt;
          chunk.y += chunk.vy * frame.dt;
          chunk.life -= frame.dt;
        }

        if (chunk.life <= 0) {
          chunk.active = false;
          chunk.sprite.visible = false;
          continue;
        }

        if (!chunk.tracted && distance(chunk, ship) > CHUNK_CULL_RADIUS_M) {
          chunk.active = false;
          chunk.sprite.visible = false;
          continue;
        }

        if (
          chunk.tracted &&
          pointInRotatedRect(chunk, { x: grillX, y: grillY }, ship.rotation, grillHalfW, grillHalfH)
        ) {
          chunk.active = false;
          chunk.sprite.visible = false;
          cargo += 1;
          continue;
        }

        for (const barrel of chunk.barrels) {
          const emitter = poses[barrel];
          if (!emitter) continue;
          const flicker = 0.5 + 0.12 * Math.sin(frame.now * 24 + barrel);
          beams
            .moveTo(emitter.x * PIXELS_PER_METER, emitter.y * PIXELS_PER_METER)
            .lineTo(chunk.x * PIXELS_PER_METER, chunk.y * PIXELS_PER_METER)
            .stroke({ color: TRACTOR_COLOR, width: 2.4, alpha: flicker });
        }

        chunk.sprite.position.set(chunk.x * PIXELS_PER_METER, chunk.y * PIXELS_PER_METER);
        chunk.sprite.rotation += chunk.spin * frame.dt;
        chunk.sprite.alpha = chunk.tracted
          ? 1
          : Math.min(1, Math.max(0, chunk.life / CHUNK_FADE_SECONDS));
      }
    },
    getCargo(): number {
      return cargo;
    },
    getTractorTargets(): readonly ({ x: number; y: number } | null)[] {
      return tractorTargets;
    },
    destroy(): void {
      container.destroy({ children: true });
      texture.destroy(true);
    },
  };
}
