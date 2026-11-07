import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { createRng, randomRange } from '../utils/random';
import { PIXELS_PER_METER } from './world-scale';
import {
  arcToward,
  dampVelocity,
  distance,
  pointInRotatedRect,
  rayCircleHit,
  reflectDirection,
  steerToward,
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
// Curved fake carry: the chunk arcs to the hatch with a bounded heading change
// so a tractor barrel can keep its beam on it. P swaps in the physics model.
const CURVE_SPEED_PER_BEAM_MPS = 2.5;
const CURVE_MAX_SPEED_MPS = 8;
// Below the turret's own ~3.2 rad/s sustained slew, so the beam can track it.
const CURVE_MAX_TURN_RATE = 2.2;
const CURVE_EASE_DISTANCE_M = 0.2;
const CURVE_EASE_FLOOR = 0.7;

export type CarryMode = 'curved' | 'physics';
const PHYSICS_ACCEL_MPS2 = 6;
const PHYSICS_MAX_SPEED_MPS = 8;
const PHYSICS_ARRIVAL_SECONDS = 0.7;
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
  /** Physics (real acceleration) or fake (line slide) tractor carry. */
  getCarryMode(): CarryMode;
  toggleCarryMode(): CarryMode;
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
  // Sticky per-beam grips: a beam keeps its chunk until it is delivered/lost,
  // only hunting for a new (external-first) chunk when free.
  const barrelTargets = new Array<Chunk | null>(8).fill(null);
  let carryMode: CarryMode = 'curved';
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

      // One beam per chunk. A beam sticks with the chunk it already holds
      // (so cargo is reeled all the way in); a free beam claims the most
      // external chunk in reach — the freshest metal, likeliest to drift off.
      if (frame.tractorsActive) {
        // Pass 1: every beam keeps the chunk it already grips. Earlier barrels
        // win any impossible collision, so a grip is never stolen mid-delivery.
        const claimed = new Set<Chunk>();
        for (let barrel = TRACTOR_FIRST_BARREL; barrel < poses.length; barrel += 1) {
          const pose = poses[barrel];
          const held = barrelTargets[barrel] ?? null;
          if (
            !pose ||
            !held ||
            !held.active ||
            claimed.has(held) ||
            Math.hypot(pose.x - held.x, pose.y - held.y) > TRACTOR_RANGE_M
          ) {
            barrelTargets[barrel] = null;
            continue;
          }
          claimed.add(held);
        }

        // Pass 2: free beams claim the most external chunk in reach — the
        // freshest metal, likeliest to drift away.
        for (let barrel = TRACTOR_FIRST_BARREL; barrel < poses.length; barrel += 1) {
          if (barrelTargets[barrel]) continue;
          const pose = poses[barrel];
          if (!pose) continue;
          let bestChunk: Chunk | null = null;
          let bestExternality = -1;
          for (const chunk of chunks) {
            if (!chunk.active || claimed.has(chunk)) continue;
            if (Math.hypot(pose.x - chunk.x, pose.y - chunk.y) > TRACTOR_RANGE_M) continue;
            const externality = Math.hypot(chunk.x - ship.x, chunk.y - ship.y);
            if (externality > bestExternality) {
              bestExternality = externality;
              bestChunk = chunk;
            }
          }
          if (!bestChunk) continue;
          barrelTargets[barrel] = bestChunk;
          claimed.add(bestChunk);
        }

        for (let barrel = TRACTOR_FIRST_BARREL; barrel < poses.length; barrel += 1) {
          const held = barrelTargets[barrel];
          if (!held) continue;
          held.tracted = true;
          held.barrels.push(barrel);
          tractorTargets[barrel] = { x: held.x, y: held.y };
        }
      } else {
        barrelTargets.fill(null);
      }

      for (const chunk of chunks) {
        if (!chunk.active) continue;

        if (chunk.tracted) {
          if (carryMode === 'physics') {
            // Real-ish tractor: steer the chunk's velocity in the ship's frame
            // with a bounded acceleration, then integrate its momentum.
            const steered = steerToward(
              { x: chunk.x, y: chunk.y },
              { x: grillX, y: grillY },
              { x: chunk.vx - ship.vx, y: chunk.vy - ship.vy },
              frame.dt,
              {
                maxAccel: PHYSICS_ACCEL_MPS2,
                maxSpeed: PHYSICS_MAX_SPEED_MPS,
                arrivalSeconds: PHYSICS_ARRIVAL_SECONDS,
              },
            );
            chunk.vx = ship.vx + steered.x;
            chunk.vy = ship.vy + steered.y;
            chunk.x += chunk.vx * frame.dt;
            chunk.y += chunk.vy * frame.dt;
          } else {
            // Curved carry in the ship's frame: the chunk arcs to the hatch,
            // turning no faster than a tractor barrel can follow it and keeping
            // up with a moving ship. It can never overshoot the intake.
            const carried = arcToward(
              { x: chunk.x - ship.x, y: chunk.y - ship.y },
              { x: grillX - ship.x, y: grillY - ship.y },
              { x: chunk.vx - ship.vx, y: chunk.vy - ship.vy },
              frame.dt,
              chunk.barrels.length,
              {
                speedPerBeam: CURVE_SPEED_PER_BEAM_MPS,
                maxSpeed: CURVE_MAX_SPEED_MPS,
                maxTurnRate: CURVE_MAX_TURN_RATE,
                easeDistance: CURVE_EASE_DISTANCE_M,
                easeFloor: CURVE_EASE_FLOOR,
              },
            );
            chunk.x = ship.x + carried.x;
            chunk.y = ship.y + carried.y;
            chunk.vx = ship.vx + carried.vx;
            chunk.vy = ship.vy + carried.vy;
          }
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
    getCarryMode(): CarryMode {
      return carryMode;
    },
    toggleCarryMode(): CarryMode {
      carryMode = carryMode === 'curved' ? 'physics' : 'curved';
      return carryMode;
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
