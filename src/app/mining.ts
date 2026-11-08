import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { createRng, randomRange } from '../utils/random';
import { PIXELS_PER_METER } from './world-scale';
import { createMiningTuning } from './mining-tuning';
import type { MiningTuning } from './mining-tuning';
import {
  arcToward,
  dampVelocity,
  distance,
  hitsOverlap,
  pointInRotatedRect,
  pulsePhase,
  reflectDirection,
  relativeAngularRate,
  steerToward,
} from './mining-model';
import type { Vec2 } from './mining-model';
import { wrapAngle } from './turret-aim';
import { polygonHitNormal, rayPolygonHit } from './asteroid-collision';
import type { AsteroidCollider } from './asteroid-collision';
import { muzzleWorldPose } from './weapons';
import type { MuzzleAim } from './weapons';
import { createLaserHeatState, laserHeatReadout, stepLaserHeat } from './laser-heat';
import type { LaserHeatReadout } from './laser-heat';

export const CHUNK_POOL_SIZE = 256;
const CHUNK_SIZE_M = 0.35;
// Molten metal floats away slowly so the gentle tractors can reel it in.
const CHUNK_SPREAD_RAD = 0.3;
// Metal cools as it drifts, so a burst slows over a couple of seconds instead
// of sailing past the ship forever.
// Uncaptered molten metal cools and fades; captured chunks are not aged.
const CHUNK_CULL_RADIUS_M = 700;
const LASER_BARRELS = 2;
/** Seconds the laser must dwell on one spot before a chunk melts off. */
/** Aim drift tolerated while the beam is still heating the same spot (metres). */
/** Melted regions glowing on the rock, and how long a finished one cools off. */
const MELT_RADIUS_M = 0.26;
const MELT_DECAL_POOL = 24;
const MELT_COLOR = 0xff7a2e;
const MELT_CORE_COLOR = 0xffd9a0;
const MELT_RIM_COLOR = 0x351506;
/** Irregular molten-crater outline: unit-radius points with jittered radii. */
const MELT_SHAPE_COUNT = 4;
const MELT_SHAPE_SEGMENTS = 10;
const TRACTOR_FIRST_BARREL = 2;
/** Tractor reach, measured from the barrel that captured the chunk. */
/** A barrel drops cargo that would need more slew than this (rad/s). */
/** How long a dropped chunk is left alone by the barrel that dropped it. */
const TRACTOR_RELEASE_COOLDOWN = 0.4;
/** Aim error (radians) tolerated before a tractor beam is drawn. */
const BEAM_ALIGN_RAD = 0.22;
// Curved fake carry: the chunk arcs to the hatch with a bounded heading change
// so a tractor barrel can keep its beam on it. P swaps in the physics model.
const CURVE_SPEED_PER_BEAM_MPS = 2.5;
// Below the turret's own ~3.2 rad/s sustained slew, so the beam can track it.
const CURVE_EASE_DISTANCE_M = 0.2;
const CURVE_EASE_FLOOR = 0.7;

export type CarryMode = 'curved' | 'physics';
const PHYSICS_ACCEL_MPS2 = 6;
const CHUNK_TEXTURE_SIZE = 32;
// Two shapes keep the chunk sprites in two batches.
const CHUNK_TEXTURE_VARIANTS = 2;

// The grill is part of the hull texture: the slatted hatch between the two
// rearmost pairs. These are ship-texture pixels relative to the ship centre.
const GRILL_LOCAL_X_PX = -1;
const GRILL_LOCAL_Y_PX = 123;
const GRILL_HALF_W_PX = 23;
const GRILL_HALF_H_PX = 45;
/** Grow the intake by half a chunk so metal does not need pixel-perfect aim. */
const GRILL_PAD_M = 0.3;

// The visible cargo hatch — the blue bezel around the slats — in ship-texture
// px relative to the ship centre. The intake rings hug this outline.
const HATCH_LOCAL_X_PX = 0;
const HATCH_LOCAL_Y_PX = 112;
const HATCH_HALF_W_PX = 28;
const HATCH_HALF_H_PX = 40;

// Three rings ride inward onto the hatch whenever the mining rig is equipped:
// each starts just outside the hatch outline and scales down through it, like
// a movie space-elevator beam reeling something up. They brighten and speed up
// while cargo is actually inbound, and flash when a chunk lands.
const INTAKE_RING_COUNT = 3;
const INTAKE_RING_PERIOD_S = 1.15;
/** Largest ring, as a multiple of the hatch outline (never more than 1.2). */
const INTAKE_RING_START_SCALE = 1.2;
/** Rings keep shrinking through the hatch before fading out inside it. */
const INTAKE_RING_END_SCALE = 0.7;
/** Corner radius of the rings, as a fraction of the hatch half-width. */
const INTAKE_RING_RADIUS_RATIO = 0.4;
const INTAKE_RING_IDLE_ALPHA = 0.4;
const INTAKE_RING_PULL_ALPHA = 0.95;
/** Sweep-speed multiplier while cargo is inbound. */
const INTAKE_RING_PULL_SPEED = 1.7;
const INTAKE_DELIVERY_FLASH_S = 0.35;
// Same green as the tractors, so the glow ties to the beams feeding the hatch.
// Keep the blue channel low: add-blending over the blue hull otherwise reads
// the glow as cyan.
const INTAKE_RING_COLOR = 0x2eff4f;
const INTAKE_RING_CORE_COLOR = 0xaaffb4;
/** Time a chunk spends shrinking into the intake before it becomes cargo. */
const INTAKE_SWALLOW_S = 0.28;

const LASER_COLOR = 0xff5340;
const LASER_CORE_COLOR = 0xffd9c2;
const TRACTOR_COLOR = 0x2eff33;

interface Chunk {
  sprite: Sprite;
  /** White silhouette behind the sprite; tinted green while tractored. */
  outline: Sprite;
  /** Soft additive green halo while tractored. */
  glow: Sprite;
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
  /** Seconds left shrinking into the hatch; >0 while it is being swallowed. */
  takingIn: number;
  /** Sprite edge length at spawn, so the swallow can shrink it to nothing. */
  baseSize: number;
  /** Where it crossed into the hatch: the start of the swallow. */
  enterX: number;
  enterY: number;
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

/** Rocks are polygon colliders that turn with their art. */
export type MiningAsteroid = AsteroidCollider;

export interface MiningFrame {
  dt: number;
  now: number;
  ship: MiningShip;
  /** Every rock the lasers can bite, in world metres. */
  asteroids: readonly MiningAsteroid[];
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
  /** Which barrels are currently emitting a beam, indexed by mount. */
  getActiveBeams(): readonly boolean[];
  /** Active laser barrels (front pair). */
  getLaserBeamCount(): number;
  /** Per-barrel heat readout (front pair, in mount order). */
  getLaserHeat(): readonly LaserHeatReadout[];
  /** Both barrels are cutting the same small spot this frame. */
  getLaserFocus(): boolean;
  /** Active tractor barrels (all mounts after the front pair). */
  getTractorBeamCount(): number;
  destroy(): void;
}

/** Small flat-solid chunk: a square or a triangle with a light glow rim. */
function createChunkTexture(variant: number): Texture {
  const size = CHUNK_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;

    // Cool blue-grey metal, not molten orange: the shard has already set.
    const halo = ctx.createRadialGradient(half, half, half * 0.35, half, half, half);
    halo.addColorStop(0, 'rgba(150, 200, 255, 0.35)');
    halo.addColorStop(1, 'rgba(120, 170, 230, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    const path = chunkShapePath(variant, size);

    // The shape is drawn around the origin, so translate it to the texture
    // centre: otherwise the solid body sits in the top-left corner and the
    // glow halo is centred elsewhere.
    ctx.save();
    ctx.translate(half, half);

    // Flat solid body: no gradient, cheap and readable at this size.
    ctx.fillStyle = variant === 1 ? '#8a9cb0' : '#9fb2c6';
    ctx.fill(path);

    // Thin dark rim keeps the silhouette crisp against the glow.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(42, 58, 76, 0.9)';
    ctx.stroke(path);
    ctx.restore();
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

/** The solid chip silhouette, centred on the origin. */
function chunkShapePath(variant: number, size: number): Path2D {
  const half = size / 2;
  const reach = half - 4;
  const path = new Path2D();
  if (variant === 1) {
    path.moveTo(0, -reach);
    path.lineTo(reach, reach * 0.8);
    path.lineTo(-reach, reach * 0.8);
  } else {
    path.rect(-reach * 0.8, -reach * 0.8, reach * 1.6, reach * 1.6);
  }
  path.closePath();
  return path;
}

/** White silhouette used as a tinted outline behind a held chunk. */
function createChunkSilhouetteTexture(variant: number): Texture {
  const size = CHUNK_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill(chunkShapePath(variant, size));
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

/** Soft additive halo for a chunk held in a tractor beam. */
function createChunkGlowTexture(): Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    glow.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

/** Hide a pooled chunk and every helper layer it owns. */
function hideChunk(chunk: Chunk): void {
  chunk.active = false;
  chunk.tracted = false;
  chunk.sprite.visible = false;
  chunk.outline.visible = false;
  chunk.glow.visible = false;
}

export function createMining(tuning: MiningTuning = createMiningTuning()): Mining {
  const container = new Container();
  const textures = Array.from({ length: CHUNK_TEXTURE_VARIANTS }, (_, variant) =>
    createChunkTexture(variant),
  );
  const outlineTextures = Array.from({ length: CHUNK_TEXTURE_VARIANTS }, (_, variant) =>
    createChunkSilhouetteTexture(variant),
  );
  const glowTexture = createChunkGlowTexture();
  const chunks: Chunk[] = [];
  for (let index = 0; index < CHUNK_POOL_SIZE; index += 1) {
    const variant = index % CHUNK_TEXTURE_VARIANTS;
    const glow = new Sprite({ texture: glowTexture, anchor: 0.5 });
    glow.blendMode = 'add';
    glow.tint = 0x2eff4f;
    glow.visible = false;
    const outline = new Sprite({ texture: outlineTextures[variant]!, anchor: 0.5 });
    outline.tint = 0x5dff8a;
    outline.visible = false;
    const sprite = new Sprite({
      texture: textures[variant]!,
      anchor: 0.5,
    });
    sprite.blendMode = 'normal';
    sprite.visible = false;
    container.addChild(glow, outline, sprite);
    chunks.push({
      sprite,
      outline,
      glow,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      spin: 0,
      life: 0,
      active: false,
      tracted: false,
      barrels: [],
      takingIn: 0,
      baseSize: 0,
      enterX: 0,
      enterY: 0,
      releaseBy: -1,
      releaseUntil: 0,
    });
  }

  const beams = new Graphics();
  beams.blendMode = 'add';
  container.addChild(beams);

  // Melted patches on the rock use normal blending so the orange reads as
  // orange instead of washing out against the brightly lit asteroid.
  const melt = new Graphics();
  melt.blendMode = 'normal';
  container.addChildAt(melt, 1);

  // Intake waves sit under the beams and chunks, centred on the hull's hatch.
  const intakePulse = new Container();
  intakePulse.visible = false;
  const intakeRings = new Graphics();
  // Normal blending, not additive: the hull under the hatch is blue, so an
  // additive green glow composites to cyan. Normal keeps the rings green.
  intakeRings.blendMode = 'normal';
  intakePulse.addChild(intakeRings);
  container.addChildAt(intakePulse, 0);

  const rng = createRng(0x0d1f_7a3b);
  // A handful of irregular crater outlines so every molten patch looks torn
  // open rather than like a perfect circle.
  const meltShapeRng = createRng(0x3b1d_9c2a);
  const meltShapes = Array.from({ length: MELT_SHAPE_COUNT }, () =>
    Array.from({ length: MELT_SHAPE_SEGMENTS }, (_, index) => {
      const angle = (index / MELT_SHAPE_SEGMENTS) * Math.PI * 2;
      const radius = randomRange(meltShapeRng, 0.68, 1.22);
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }),
  );
  /** Per-barrel heat: builds while firing, vents fast on release. */
  const laserHeat = Array.from({ length: LASER_BARRELS }, () => createLaserHeatState());
  let laserFocused = false;
  /** Seconds of dwell per laser barrel, and the spot each beam is heating. */
  const meltHeat = new Array<number>(LASER_BARRELS).fill(0);
  const meltSpot = new Array<{ x: number; y: number } | null>(LASER_BARRELS).fill(null);
  const meltRock = new Array<MiningAsteroid | null>(LASER_BARRELS).fill(null);
  /** Which crater outline is being burned, plus its flicker phase. */
  const meltShape = new Array<number>(LASER_BARRELS).fill(0);
  const meltPhase = new Array<number>(LASER_BARRELS).fill(0);
  // Orange melt regions on the rock: they mark where metal was melted and cool
  // off over a couple of seconds. Each finished melt also spawns a chunk.
  const meltRegions = Array.from({ length: MELT_DECAL_POOL }, () => ({
    localX: 0,
    localY: 0,
    rock: null as MiningAsteroid | null,
    shape: 0,
    phase: 0,
    life: 0,
    active: false,
  }));
  const tractorTargets: ({ x: number; y: number } | null)[] = new Array(8).fill(null);
  const beamActivity: boolean[] = new Array(8).fill(false);
  // Sticky per-beam grips: a beam keeps its chunk until it is delivered/lost,
  // only hunting for a new (external-first) chunk when free.
  const barrelTargets = new Array<Chunk | null>(8).fill(null);
  let carryMode: CarryMode = 'physics';
  let cargo = 0;
  /** Decays after a chunk lands, briefly flaring the intake. */
  let deliveryFlash = 0;

  const spawnChunk = (hit: Vec2, direction: Vec2, asteroid: MiningAsteroid): void => {
    const chunk = chunks.find((candidate) => !candidate.active);
    if (!chunk) return;
    const normal = polygonHitNormal(asteroid, hit);
    // Molten metal leaves along the reflected laser direction, with a little
    // scatter so consecutive hits do not stack into one line.
    const reflected = reflectDirection(direction, normal);
    const angle =
      Math.atan2(reflected.y, reflected.x) + randomRange(rng, -CHUNK_SPREAD_RAD, CHUNK_SPREAD_RAD);
    const speed = randomRange(rng, tuning.chunkMinSpeedMps, tuning.chunkMaxSpeedMps);

    chunk.active = true;
    chunk.tracted = false;
    chunk.barrels = [];
    chunk.takingIn = 0;
    chunk.releaseBy = -1;
    chunk.releaseUntil = 0;
    chunk.x = hit.x + normal.x * CHUNK_SIZE_M * 0.6;
    chunk.y = hit.y + normal.y * CHUNK_SIZE_M * 0.6;
    chunk.vx = Math.cos(angle) * speed;
    chunk.vy = Math.sin(angle) * speed;
    chunk.life = tuning.chunkLifetimeSeconds;
    chunk.spin = randomRange(rng, -3, 3);

    // The shape fills most of its texture; a small sprite is all a chunk needs.
    const size = CHUNK_SIZE_M * randomRange(rng, 0.8, 1.15) * PIXELS_PER_METER * 1.45;
    chunk.baseSize = size;
    chunk.sprite.width = size;
    chunk.sprite.height = size;
    chunk.sprite.rotation = randomRange(rng, 0, Math.PI * 2);
    chunk.sprite.alpha = 1;
    chunk.sprite.tint = 0xffffff;
    chunk.sprite.position.set(chunk.x * PIXELS_PER_METER, chunk.y * PIXELS_PER_METER);
    chunk.sprite.visible = true;
    chunk.outline.visible = false;
    chunk.glow.visible = false;
  };

  /**
   * Paint one molten crater: an irregular dark-rimmed pool with a hot core and
   * an additive bloom, flickering slightly like a live melt rather than a
   * clean circle.
   */
  const drawMeltPatch = (
    x: number,
    y: number,
    radiusPx: number,
    shapeIndex: number,
    phase: number,
    intensity: number,
    now: number,
  ): void => {
    if (radiusPx <= 0 || intensity <= 0.01) return;
    const shape = meltShapes[shapeIndex] ?? meltShapes[0]!;
    const wobble = 1 + 0.06 * Math.sin(now * 23 + phase) + 0.03 * Math.sin(now * 41 + phase * 2.3);
    const scale = radiusPx * wobble;
    const outline = (factor: number): { x: number; y: number }[] =>
      shape.map((point) => ({ x: x + point.x * scale * factor, y: y + point.y * scale * factor }));

    beams.poly(outline(1.9)).fill({ color: MELT_COLOR, alpha: 0.06 * intensity });
    beams.poly(outline(1.3)).fill({ color: MELT_COLOR, alpha: 0.12 * intensity });
    // Dark, torn crater rim first, then the molten pool and its hot centre.
    melt.poly(outline(1)).fill({ color: MELT_RIM_COLOR, alpha: 0.6 * intensity });
    melt.poly(outline(0.74)).fill({ color: MELT_COLOR, alpha: 0.85 * intensity });
    melt.poly(outline(0.36)).fill({ color: MELT_CORE_COLOR, alpha: 0.9 * intensity });
    beams.circle(x, y, Math.max(1.5, scale * 0.16)).fill({
      color: 0xfff6ea,
      alpha: 0.55 + 0.4 * intensity,
    });
    // A few drifting embers, so a live melt looks like it is spitting metal.
    if (intensity > 0.55) {
      for (let spark = 0; spark < 3; spark += 1) {
        const drift = now * 2.4 + phase + spark * 2.1;
        const distance = scale * (0.55 + 0.55 * (0.5 + 0.5 * Math.sin(drift)));
        const angle = phase + spark * 2.4 + Math.sin(now * 1.9 + spark) * 0.7;
        beams
          .circle(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 1.3)
          .fill({ color: 0xffb066, alpha: 0.32 * intensity });
      }
    }
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

      // The rings centre on the visible hatch art, not the padded intake box.
      const hatchLocalX = HATCH_LOCAL_X_PX * metres;
      const hatchLocalY = HATCH_LOCAL_Y_PX * metres;
      const hatchX = ship.x + hatchLocalX * cos - hatchLocalY * sin;
      const hatchY = ship.y + hatchLocalX * sin + hatchLocalY * cos;

      beams.clear();
      melt.clear();
      beamActivity.fill(false);

      // Front pair: red mining lasers. Each barrel has its own heat bank and
      // may lock out independently; two beams focused on one small spot melt
      // faster. Heat is advanced before drawing so an overheat cuts the beam
      // on the same frame.
      interface LaserBeam {
        pose: MuzzleAim;
        direction: Vec2;
        hit: Vec2 | null;
        hitRock: MiningAsteroid | null;
        end: Vec2;
        beamOn: boolean;
      }

      const laserBeams: (LaserBeam | null)[] = [];
      for (let barrel = 0; barrel < LASER_BARRELS; barrel += 1) {
        const pose = poses[barrel];
        if (!pose) {
          laserBeams.push(null);
          continue;
        }
        const direction = { x: Math.sin(pose.angle), y: -Math.cos(pose.angle) };
        // The nearest rock the beam bites wins, so a field of asteroids works
        // without special-casing which one is "the" target.
        let hit: Vec2 | null = null;
        let hitRock: MiningAsteroid | null = null;
        let hitDistance = Infinity;
        for (const rock of frame.asteroids) {
          const candidate = rayPolygonHit(pose, direction, tuning.laserRangeM, rock);
          if (!candidate) continue;
          const distance = Math.hypot(candidate.x - pose.x, candidate.y - pose.y);
          if (distance < hitDistance) {
            hitDistance = distance;
            hit = candidate;
            hitRock = rock;
          }
        }
        laserBeams.push({
          pose,
          direction,
          hit,
          hitRock,
          end: hit ?? {
            x: pose.x + direction.x * tuning.laserRangeM,
            y: pose.y + direction.y * tuning.laserRangeM,
          },
          beamOn: stepLaserHeat(laserHeat[barrel]!, frame.laserFiring, frame.dt, tuning),
        });
      }

      // Focused cut: both beams are live, biting the same rock, close enough
      // that the melt zones overlap. Focus multiplies each barrel's dwell.
      const focused = laserBeams.map((beam, barrel) => {
        const other = laserBeams[LASER_BARRELS - 1 - barrel] ?? null;
        return !!(
          beam?.beamOn &&
          other?.beamOn &&
          beam.hit &&
          other.hit &&
          beam.hitRock === other.hitRock &&
          hitsOverlap(beam.hit, other.hit, tuning.meltOverlapRadiusM)
        );
      });

      laserFocused = focused[0] === true;

      for (let barrel = 0; barrel < LASER_BARRELS; barrel += 1) {
        const beam = laserBeams[barrel] ?? null;
        if (!beam) continue;
        const { pose, direction, hit, hitRock, end } = beam;

        if (beam.beamOn) {
          beamActivity[barrel] = true;
          if (hit && hitRock) {
            // Melting takes dwell time on one spot: sweeping the beam across
            // the rock resets the charge instead of spraying chunks.
            const previous = meltSpot[barrel] ?? null;
            const sameSpot =
              previous !== null &&
              meltRock[barrel] === hitRock &&
              Math.hypot(hit.x - previous.x, hit.y - previous.y) <= tuning.meltSpotRadiusM;
            if (!sameSpot) {
              meltSpot[barrel] = { x: hit.x, y: hit.y };
              meltRock[barrel] = hitRock;
              meltHeat[barrel] = 0;
              meltShape[barrel] = Math.floor(rng() * MELT_SHAPE_COUNT);
              meltPhase[barrel] = rng() * Math.PI * 2;
            }
            const focus = focused[barrel] === true;
            const meltRate = frame.dt * (focus ? tuning.meltFocusMultiplier : 1);
            meltHeat[barrel] = Math.min(tuning.meltSeconds, meltHeat[barrel]! + meltRate);

            // The beam keeps boring at one world point (that is where the
            // barrels point); the scar it leaves behind is attached to the
            // rock's spinning surface, so it turns away with the art.
            const surfaceNormal = polygonHitNormal(hitRock, hit);
            const normalX = surfaceNormal.x;
            const normalY = surfaceNormal.y;
            const heat = meltHeat[barrel]! / tuning.meltSeconds;
            const heatRadius = (0.1 + 0.26 * heat) * PIXELS_PER_METER;
            const focusBoost = focus ? 0.12 : 0;
            const heatX = (hit.x - normalX * 0.1) * PIXELS_PER_METER;
            const heatY = (hit.y - normalY * 0.1) * PIXELS_PER_METER;
            drawMeltPatch(
              heatX,
              heatY,
              heatRadius * (1 + focusBoost),
              meltShape[barrel]!,
              meltPhase[barrel]!,
              0.4 + 0.6 * heat,
              frame.now,
            );

            if (meltHeat[barrel]! >= tuning.meltSeconds) {
              // The melted region lets go of a chunk.
              spawnChunk(hit, direction, hitRock);
              meltHeat[barrel] = 0;
              const region =
                meltRegions.find((candidate) => !candidate.active) ??
                meltRegions.reduce((oldest, candidate) =>
                  candidate.life < oldest.life ? candidate : oldest,
                );
              const offsetX = hit.x - hitRock.x;
              const offsetY = hit.y - hitRock.y;
              const cosRock = Math.cos(hitRock.rotation);
              const sinRock = Math.sin(hitRock.rotation);
              region.active = true;
              region.life = tuning.meltCoolSeconds;
              region.rock = hitRock;
              region.localX = offsetX * cosRock + offsetY * sinRock;
              region.localY = -offsetX * sinRock + offsetY * cosRock;
              region.shape = meltShape[barrel]!;
              region.phase = meltPhase[barrel]!;
            }
          } else {
            meltHeat[barrel] = 0;
            meltSpot[barrel] = null;
            meltRock[barrel] = null;
          }

          const focus = focused[barrel] === true;
          beams
            .moveTo(pose.x * PIXELS_PER_METER, pose.y * PIXELS_PER_METER)
            .lineTo(end.x * PIXELS_PER_METER, end.y * PIXELS_PER_METER)
            .stroke({ color: LASER_COLOR, width: focus ? 7 : 5, alpha: focus ? 0.95 : 0.78 });
          beams
            .moveTo(pose.x * PIXELS_PER_METER, pose.y * PIXELS_PER_METER)
            .lineTo(end.x * PIXELS_PER_METER, end.y * PIXELS_PER_METER)
            .stroke({
              color: focus ? 0xffffff : LASER_CORE_COLOR,
              width: focus ? 2.4 : 1.6,
              alpha: 0.95,
            });
        } else {
          meltHeat[barrel] = 0;
          meltSpot[barrel] = null;
          meltRock[barrel] = null;
        }
      }

      // Cooling melt regions, drawn on the rock before beams and chunks.
      for (const region of meltRegions) {
        if (!region.active) continue;
        region.life -= frame.dt;
        if (region.life <= 0) {
          region.active = false;
          continue;
        }
        const rock = region.rock;
        if (!rock) continue;
        const cosRock = Math.cos(rock.rotation);
        const sinRock = Math.sin(rock.rotation);
        const x = rock.x + region.localX * cosRock - region.localY * sinRock;
        const y = rock.y + region.localX * sinRock + region.localY * cosRock;
        const fade = region.life / tuning.meltCoolSeconds;
        drawMeltPatch(
          x * PIXELS_PER_METER,
          y * PIXELS_PER_METER,
          MELT_RADIUS_M * PIXELS_PER_METER,
          region.shape,
          region.phase,
          fade,
          frame.now,
        );
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
            held.takingIn > 0 ||
            claimed.has(held) ||
            Math.hypot(pose.x - held.x, pose.y - held.y) > tuning.tractorRangeM
          ) {
            barrelTargets[barrel] = null;
            continue;
          }
          const swingRate = relativeAngularRate(held, pose, {
            x: held.vx - ship.vx,
            y: held.vy - ship.vy,
          });
          if (swingRate > tuning.tractorTrackRateLimit) {
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
            if (!chunk.active || chunk.takingIn > 0 || claimed.has(chunk)) continue;
            if (chunk.releaseBy === barrel && frame.now < chunk.releaseUntil) continue;
            if (Math.hypot(pose.x - chunk.x, pose.y - chunk.y) > tuning.tractorRangeM) continue;
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
          // A gripped chunk is cargo in transit, not debris: keep its clock
          // full so it can never cool away between the beam and the hatch.
          held.life = tuning.chunkLifetimeSeconds;
          held.barrels.push(barrel);
          tractorTargets[barrel] = { x: held.x, y: held.y };
        }
      } else {
        barrelTargets.fill(null);
      }

      let inboundBeams = 0;
      for (const chunk of chunks) {
        if (!chunk.active) continue;

        // A chunk that crossed into the hatch is swallowed: it sinks the rest
        // of the way in and shrinks to nothing, then counts as cargo. This is
        // the only place the shrink is driven, so it always finishes.
        if (chunk.takingIn > 0) {
          chunk.outline.visible = false;
          chunk.glow.visible = false;
          chunk.takingIn = Math.max(0, chunk.takingIn - frame.dt);
          const progress = 1 - chunk.takingIn / INTAKE_SWALLOW_S;
          const sink = progress * progress;
          chunk.x = chunk.enterX + (grillX - chunk.enterX) * sink;
          chunk.y = chunk.enterY + (grillY - chunk.enterY) * sink;
          const size = chunk.baseSize * (1 - progress);
          chunk.sprite.width = size;
          chunk.sprite.height = size;
          chunk.sprite.position.set(chunk.x * PIXELS_PER_METER, chunk.y * PIXELS_PER_METER);
          chunk.sprite.rotation += chunk.spin * frame.dt;
          if (chunk.takingIn <= 0) {
            hideChunk(chunk);
            cargo += 1;
            deliveryFlash = 1;
          }
          continue;
        }

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
          inboundBeams += engaged.length;
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
                maxSpeed: tuning.carrierMaxSpeedMps,
                arrivalSeconds: tuning.carrierArrivalSeconds,
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
                maxSpeed: tuning.carrierMaxSpeedMps,
                maxTurnRate: tuning.carrierTurnRate,
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
            tuning.chunkDampingPerSecond,
            frame.dt,
          );
          chunk.vx = damped.x;
          chunk.vy = damped.y;
          chunk.x += chunk.vx * frame.dt;
          chunk.y += chunk.vy * frame.dt;
          if (!chunk.tracted) chunk.life -= frame.dt;
        }

        if (chunk.life <= 0) {
          hideChunk(chunk);
          continue;
        }

        if (!chunk.tracted && distance(chunk, ship) > CHUNK_CULL_RADIUS_M) {
          hideChunk(chunk);
          continue;
        }

        if (
          pointInRotatedRect(chunk, { x: grillX, y: grillY }, ship.rotation, grillHalfW, grillHalfH)
        ) {
          // The intake swallows any metal that drifts into it, whether or not
          // a tractor is holding it: hand the chunk to the swallow animation
          // instead of snapping it away, so it visibly disappears into the
          // hatch. Cargo that is being reeled in can arrive before its beam.
          chunk.takingIn = INTAKE_SWALLOW_S;
          chunk.enterX = chunk.x;
          chunk.enterY = chunk.y;
          continue;
        }

        for (const { barrel, emitter } of engaged) {
          beamActivity[barrel] = true;
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
          : Math.min(1, Math.max(0, chunk.life / tuning.chunkFadeSeconds));

        // Only an actually connected tractor beam marks the cargo. A barrel
        // that has claimed a chunk but is still swinging onto it draws nothing.
        const held = engaged.length > 0;
        chunk.outline.visible = held;
        chunk.glow.visible = held;
        if (held) {
          const size = chunk.sprite.width;
          chunk.outline.width = size * 1.18;
          chunk.outline.height = size * 1.18;
          chunk.outline.position.copyFrom(chunk.sprite.position);
          chunk.outline.rotation = chunk.sprite.rotation;
          chunk.outline.alpha = 0.95;

          chunk.glow.width = size * 2.2;
          chunk.glow.height = size * 2.2;
          chunk.glow.position.copyFrom(chunk.sprite.position);
          chunk.glow.alpha = 0.36 + 0.08 * Math.sin(frame.now * 8 + chunk.x * 5 + chunk.y * 3);
        }
      }

      // Intake waves: three round-cornered rings start wide and scale down
      // onto the cargo hatch, brightening as they close and fading as they
      // land — the pulled-in look of a movie space-elevator beam. They quicken
      // and flare harder while cargo is inbound, and flash when a chunk lands.
      intakePulse.visible = frame.tractorsActive;
      if (frame.tractorsActive) {
        deliveryFlash = Math.max(0, deliveryFlash - frame.dt / INTAKE_DELIVERY_FLASH_S);
        const pull = Math.min(1, inboundBeams * 0.3 + deliveryFlash);
        const speed = 1 + pull * (INTAKE_RING_PULL_SPEED - 1);
        intakePulse.position.set(hatchX * PIXELS_PER_METER, hatchY * PIXELS_PER_METER);
        intakePulse.rotation = ship.rotation;
        intakeRings.clear();
        // Rings are the hatch outline itself, scaled: 1.2x at spawn, shrinking
        // to 0.7x so they visibly cross the hatch boundary on the way in.
        const baseHalfW = HATCH_HALF_W_PX * metres * PIXELS_PER_METER;
        const baseHalfH = HATCH_HALF_H_PX * metres * PIXELS_PER_METER;
        const radius = Math.min(baseHalfW, baseHalfH) * INTAKE_RING_RADIUS_RATIO;
        const alpha =
          INTAKE_RING_IDLE_ALPHA + (INTAKE_RING_PULL_ALPHA - INTAKE_RING_IDLE_ALPHA) * pull;
        for (let ring = 0; ring < INTAKE_RING_COUNT; ring += 1) {
          const phase = pulsePhase(
            frame.now,
            speed,
            ring / INTAKE_RING_COUNT,
            INTAKE_RING_PERIOD_S,
          );
          const scale =
            INTAKE_RING_START_SCALE + (INTAKE_RING_END_SCALE - INTAKE_RING_START_SCALE) * phase;
          // Stay bright on the way in, fade in as it spawns and vanish quickly
          // as it lands, so each ring reads as closing on the hatch.
          const fade = Math.min(1, phase * 8) * Math.min(1, (1 - phase) * 6);
          const ringAlpha = alpha * fade;
          if (ringAlpha <= 0.002) continue;
          const halfW = baseHalfW * scale;
          const halfH = baseHalfH * scale;
          const corner = radius * scale;
          intakeRings
            .roundRect(-halfW, -halfH, halfW * 2, halfH * 2, corner)
            .stroke({ color: INTAKE_RING_COLOR, width: 6, alpha: ringAlpha * 0.3 });
          intakeRings
            .roundRect(-halfW, -halfH, halfW * 2, halfH * 2, corner)
            .stroke({ color: INTAKE_RING_CORE_COLOR, width: 1.8, alpha: ringAlpha });
        }
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
    getActiveBeams(): readonly boolean[] {
      return beamActivity;
    },
    getLaserBeamCount(): number {
      let count = 0;
      for (let barrel = 0; barrel < LASER_BARRELS; barrel += 1) {
        if (beamActivity[barrel]) count += 1;
      }
      return count;
    },
    getLaserHeat(): readonly LaserHeatReadout[] {
      return laserHeat.map((state) => laserHeatReadout(state, tuning));
    },
    getLaserFocus(): boolean {
      return laserFocused;
    },
    getTractorBeamCount(): number {
      let count = 0;
      for (let barrel = TRACTOR_FIRST_BARREL; barrel < beamActivity.length; barrel += 1) {
        if (beamActivity[barrel]) count += 1;
      }
      return count;
    },
    destroy(): void {
      container.destroy({ children: true });
      for (const texture of textures) texture.destroy(true);
      for (const texture of outlineTextures) texture.destroy(true);
      glowTexture.destroy(true);
    },
  };
}
