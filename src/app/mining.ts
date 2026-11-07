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
  relativeAngularRate,
  steerToward,
} from './mining-model';
import type { Vec2 } from './mining-model';
import { wrapAngle } from './turret-aim';
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
/** A barrel drops cargo that would need more slew than this (rad/s). */
const TRACTOR_TRACK_RATE_LIMIT = 3;
/** How long a dropped chunk is left alone by the barrel that dropped it. */
const TRACTOR_RELEASE_COOLDOWN = 0.4;
/** Aim error (radians) tolerated before a tractor beam is drawn. */
const BEAM_ALIGN_RAD = 0.22;
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
const CHUNK_TEXTURE_SIZE = 64;
const CHUNK_TEXTURE_VARIANTS = 8;

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
  /** Barrel that dropped this chunk for being untrackable, and until when. */
  releaseBy: number;
  releaseUntil: number;
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

/** Simple solid chunks: square, rectangle or triangle, each with a glow. */
function createChunkTexture(variant: number): Texture {
  const size = CHUNK_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = createRng(0x9e37_79b9 ^ (variant * 0x85eb_ca6b));
  if (ctx) {
    const half = size / 2;

    // Soft glow halo behind the chunk.
    const halo = ctx.createRadialGradient(half, half, half * 0.3, half, half, half);
    halo.addColorStop(0, 'rgba(255, 146, 66, 0.5)');
    halo.addColorStop(0.55, 'rgba(255, 92, 30, 0.2)');
    halo.addColorStop(1, 'rgba(255, 70, 20, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    const reach = 18 + rng() * 4;
    const shape = variant % 3;
    const path = new Path2D();
    if (shape === 2) {
      // Triangle.
      path.moveTo(0, -reach);
      path.lineTo(reach * 0.95, reach * 0.8);
      path.lineTo(-reach * 0.95, reach * 0.8);
    } else {
      // Square or rectangle.
      const halfWidth = shape === 1 ? reach * 1.25 : reach;
      const halfHeight = shape === 1 ? reach * 0.72 : reach;
      path.rect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
    }
    path.closePath();

    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(rng() * Math.PI * 2);

    // Solid, heat-shaded body so the chunk reads as real metal.
    const body = ctx.createLinearGradient(-20, -22, 22, 24);
    body.addColorStop(0, '#8a5a3c');
    body.addColorStop(0.45, '#e08a45');
    body.addColorStop(0.75, '#ffcf8c');
    body.addColorStop(1, '#ff9a4e');
    ctx.fillStyle = body;
    ctx.fill(path);

    // Rim keeps the edge crisp against the halo.
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(255, 214, 150, 0.9)';
    ctx.stroke(path);
    ctx.restore();
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function createMining(): Mining {
  const container = new Container();
  const textures = Array.from({ length: CHUNK_TEXTURE_VARIANTS }, (_, variant) =>
    createChunkTexture(variant),
  );
  const chunks: Chunk[] = [];
  for (let index = 0; index < CHUNK_POOL_SIZE; index += 1) {
    const sprite = new Sprite({
      texture: textures[index % textures.length]!,
      anchor: 0.5,
    });
    sprite.blendMode = 'normal';
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
      releaseBy: -1,
      releaseUntil: 0,
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
    chunk.releaseBy = -1;
    chunk.releaseUntil = 0;
    chunk.x = hit.x + normal.x * CHUNK_SIZE_M * 0.6;
    chunk.y = hit.y + normal.y * CHUNK_SIZE_M * 0.6;
    chunk.vx = Math.cos(angle) * speed;
    chunk.vy = Math.sin(angle) * speed;
    chunk.life = CHUNK_LIFETIME;
    chunk.spin = randomRange(rng, -3, 3);

    // The drawn shard fills roughly half its texture, so oversize the sprite
    // to keep the metal itself around CHUNK_SIZE_M across.
    const size = CHUNK_SIZE_M * randomRange(rng, 0.75, 1.3) * PIXELS_PER_METER * 1.6;
    chunk.sprite.width = size;
    chunk.sprite.height = size;
    chunk.sprite.rotation = randomRange(rng, 0, Math.PI * 2);
    chunk.sprite.alpha = 1;
    chunk.sprite.tint = 0xffffff;
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
        // A chunk that swings faster than a barrel can slew is dropped so a
        // different tractor (or this one later) can pick it up.
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
          const swingRate = relativeAngularRate(held, pose, {
            x: held.vx - ship.vx,
            y: held.vy - ship.vy,
          });
          if (swingRate > TRACTOR_TRACK_RATE_LIMIT) {
            held.releaseBy = barrel;
            held.releaseUntil = frame.now + TRACTOR_RELEASE_COOLDOWN;
            barrelTargets[barrel] = null;
            continue;
          }
          claimed.add(held);
        }

        // Pass 2: free beams claim the most external chunk in reach — the
        // freshest metal, likeliest to drift away. A chunk this barrel just
        // dropped is skipped briefly so another beam can take it instead.
        for (let barrel = TRACTOR_FIRST_BARREL; barrel < poses.length; barrel += 1) {
          if (barrelTargets[barrel]) continue;
          const pose = poses[barrel];
          if (!pose) continue;
          let bestChunk: Chunk | null = null;
          let bestExternality = -1;
          for (const chunk of chunks) {
            if (!chunk.active || claimed.has(chunk)) continue;
            if (chunk.releaseBy === barrel && frame.now < chunk.releaseUntil) continue;
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

        // A tractor only reels its cargo in once the beam is visually
        // connected: barrels still swinging onto a fresh chunk do not move it.
        const engaged: { barrel: number; emitter: { x: number; y: number } }[] = [];
        for (const barrel of chunk.barrels) {
          const emitter = poses[barrel];
          if (!emitter) continue;
          const toChunk = Math.atan2(chunk.x - emitter.x, -(chunk.y - emitter.y));
          if (Math.abs(wrapAngle(toChunk - emitter.angle)) <= BEAM_ALIGN_RAD) {
            engaged.push({ barrel, emitter });
          }
        }

        if (engaged.length > 0) {
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
              engaged.length,
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
          // No beam is connected yet (or the beam just broke): keep drifting,
          // and only age free metal.
          const damped = dampVelocity(
            { x: chunk.vx, y: chunk.vy },
            CHUNK_DAMPING_PER_SECOND,
            frame.dt,
          );
          chunk.vx = damped.x;
          chunk.vy = damped.y;
          chunk.x += chunk.vx * frame.dt;
          chunk.y += chunk.vy * frame.dt;
          if (!chunk.tracted) chunk.life -= frame.dt;
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

        for (const { barrel, emitter } of engaged) {
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
      for (const texture of textures) texture.destroy(true);
    },
  };
}
