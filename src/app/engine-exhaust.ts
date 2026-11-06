import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { createRng, randomRange } from '../utils/random';
import { PIXELS_PER_METER } from './world-scale';

const ENGINE_X_OFFSETS = [-80, 0, 80] as const;
const ENGINE_Y_OFFSET = 410;
const FLAME_WIDTH = 44;
const FLAME_BASE_HEIGHT = 190;
const SMOKE_LIFETIME = 10;
const SMOKE_POOL_SIZE = 360;
const SMOKE_TEXTURE_SIZE = 128;
const SMOKE_TINTS = [0xa8c6cc, 0x91b6bf, 0xcce1e4] as const;

interface ExhaustFrame {
  /** Ship position in dust-world pixels at zoom 1. */
  shipWorldX: number;
  shipWorldY: number;
  /** Ship position on screen, in CSS pixels. */
  shipScreenX: number;
  shipScreenY: number;
  /** Ship display scale at zoom 1, before the dust-camera zoom. */
  shipBaseScale: number;
  /** Ship display scale including the dust-camera zoom. */
  shipScale: number;
  rotation: number;
  dustX: number;
  dustY: number;
  zoom: number;
  width: number;
  height: number;
  /** Ramped linear input magnitude, 0..1. */
  thrust: number;
  shipVx: number;
  shipVy: number;
  dt: number;
  now: number;
}

interface SmokeParticle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  growth: number;
  rotationSpeed: number;
  baseAlpha: number;
  active: boolean;
}

export interface EngineExhaust {
  smoke: Container;
  flames: Container;
  update(frame: ExhaustFrame): void;
  destroy(): void;
}

function createFlameTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Droplet: rounded at the nozzle, tapering to a point.
    const gradient = ctx.createLinearGradient(0, 0, 0, 192);
    gradient.addColorStop(0, 'rgba(235, 255, 255, 0.98)');
    gradient.addColorStop(0.18, 'rgba(135, 248, 255, 0.92)');
    gradient.addColorStop(0.62, 'rgba(40, 175, 225, 0.42)');
    gradient.addColorStop(1, 'rgba(0, 30, 55, 0)');
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(90, 240, 255, 0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.bezierCurveTo(2, 24, 12, 92, 32, 184);
    ctx.quadraticCurveTo(36, 192, 40, 184);
    ctx.bezierCurveTo(60, 92, 70, 24, 52, 0);
    ctx.closePath();
    ctx.fill();

    // Brighter inner core.
    const core = ctx.createLinearGradient(0, 0, 0, 170);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    core.addColorStop(0.35, 'rgba(190, 255, 255, 0.75)');
    core.addColorStop(1, 'rgba(70, 220, 255, 0)');
    ctx.shadowBlur = 0;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(23, 0);
    ctx.bezierCurveTo(18, 28, 24, 88, 32, 166);
    ctx.quadraticCurveTo(37, 88, 43, 28);
    ctx.quadraticCurveTo(42, 10, 41, 0);
    ctx.closePath();
    ctx.fill();
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function createSmokeTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SMOKE_TEXTURE_SIZE;
  canvas.height = SMOKE_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const rng = createRng(0x51ed_270b);
    for (let index = 0; index < 12; index += 1) {
      const x = randomRange(rng, 26, SMOKE_TEXTURE_SIZE - 26);
      const y = randomRange(rng, 26, SMOKE_TEXTURE_SIZE - 26);
      const radius = randomRange(rng, 16, 42);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
      gradient.addColorStop(0.55, 'rgba(240, 255, 255, 0.26)');
      gradient.addColorStop(1, 'rgba(220, 250, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function createEngineExhaust(): EngineExhaust {
  const flameTexture = createFlameTexture();
  const smokeTexture = createSmokeTexture();

  const flames = new Container();
  const flameSprites = ENGINE_X_OFFSETS.map((offset) => {
    const sprite = new Sprite({ texture: flameTexture, anchor: { x: 0.5, y: 0 } });
    sprite.x = offset;
    sprite.y = ENGINE_Y_OFFSET;
    sprite.width = FLAME_WIDTH;
    sprite.height = FLAME_BASE_HEIGHT;
    sprite.blendMode = 'add';
    flames.addChild(sprite);
    return sprite;
  });

  const smoke = new Container();
  const particles: SmokeParticle[] = [];
  for (let index = 0; index < SMOKE_POOL_SIZE; index += 1) {
    const sprite = new Sprite({ texture: smokeTexture, anchor: 0.5 });
    sprite.visible = false;
    smoke.addChild(sprite);
    particles.push({
      sprite,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: SMOKE_LIFETIME,
      size: 1,
      growth: 0,
      rotationSpeed: 0,
      baseAlpha: 0,
      active: false,
    });
  }

  const flameLengths = ENGINE_X_OFFSETS.map(() => FLAME_BASE_HEIGHT);
  const rng = createRng(0x51ed_270b ^ 0x9e37_79b9);
  let smokeAccumulator = 0;
  let nextEngine = 0;

  const spawnSmoke = (engineIndex: number, frame: ExhaustFrame): void => {
    const particle = particles.find((candidate) => !candidate.active);
    if (!particle) return;

    const localX = ENGINE_X_OFFSETS[engineIndex]!;
    const localY = ENGINE_Y_OFFSET + flameLengths[engineIndex]!;
    const cos = Math.cos(frame.rotation);
    const sin = Math.sin(frame.rotation);
    const worldX = frame.shipWorldX + (localX * cos - localY * sin) * frame.shipBaseScale;
    const worldY = frame.shipWorldY + (localX * sin + localY * cos) * frame.shipBaseScale;
    const backX = -sin;
    const backY = cos;

    particle.active = true;
    particle.life = SMOKE_LIFETIME;
    particle.maxLife = SMOKE_LIFETIME;
    particle.size = randomRange(rng, 10, 24);
    particle.growth = randomRange(rng, 6, 16);
    particle.baseAlpha = randomRange(rng, 0.2, 0.34);
    particle.rotationSpeed = randomRange(rng, -0.18, 0.18);
    particle.sprite.position.set(
      worldX + randomRange(rng, -4, 4),
      worldY + randomRange(rng, -4, 4),
    );
    particle.sprite.rotation = randomRange(rng, 0, Math.PI * 2);
    particle.sprite.tint = SMOKE_TINTS[Math.floor(rng() * SMOKE_TINTS.length)] ?? SMOKE_TINTS[0]!;
    particle.sprite.alpha = particle.baseAlpha;
    const scale = particle.size / SMOKE_TEXTURE_SIZE;
    particle.sprite.scale.set(scale);
    particle.sprite.visible = true;
    particle.vx =
      frame.shipVx * 0.12 + backX * randomRange(rng, 18, 62) + randomRange(rng, -18, 18);
    particle.vy =
      frame.shipVy * 0.12 + backY * randomRange(rng, 18, 62) + randomRange(rng, -18, 18);
  };

  return {
    smoke,
    flames,
    update(frame: ExhaustFrame): void {
      flames.position.set(frame.shipScreenX, frame.shipScreenY);
      flames.rotation = frame.rotation;
      flames.scale.set(frame.shipScale);

      const thrust = Math.max(0, Math.min(1, frame.thrust));
      for (let index = 0; index < flameSprites.length; index += 1) {
        const sprite = flameSprites[index]!;
        const flicker =
          0.94 +
          0.05 * Math.sin(frame.now * 70 + index * 1.7) +
          0.02 * Math.sin(frame.now * 113 + index * 2.1);
        const length = FLAME_BASE_HEIGHT * flicker * (0.45 + 0.55 * thrust);
        flameLengths[index] = length;
        sprite.height = length;
        sprite.alpha = thrust > 0.02 ? 0.45 + 0.55 * thrust : 0;
      }

      smoke.position.set(
        -frame.dustX * frame.width * frame.zoom + frame.width / 2,
        -frame.dustY * frame.height * frame.zoom + frame.height / 2,
      );
      smoke.scale.set(frame.zoom);

      // Keep the smoke stream continuous when the throttle is cut: residual gas
      // keeps flowing from the cone tips while the ship still has speed.
      const speed = Math.hypot(frame.shipVx, frame.shipVy) / PIXELS_PER_METER;
      const emission = Math.max(thrust, Math.min(1, speed / 12));
      if (emission > 0.02 && frame.dt > 0) {
        smokeAccumulator += frame.dt * emission * 30;
        while (smokeAccumulator >= 1) {
          spawnSmoke(nextEngine, frame);
          nextEngine = (nextEngine + 1) % ENGINE_X_OFFSETS.length;
          smokeAccumulator -= 1;
        }
      }

      for (const particle of particles) {
        if (!particle.active) continue;
        particle.life -= frame.dt;
        if (particle.life <= 0) {
          particle.active = false;
          particle.sprite.visible = false;
          continue;
        }

        const progress = 1 - particle.life / particle.maxLife;
        particle.sprite.position.x += particle.vx * frame.dt;
        particle.sprite.position.y += particle.vy * frame.dt;
        particle.vx *= Math.exp(-0.35 * frame.dt);
        particle.vy *= Math.exp(-0.35 * frame.dt);
        particle.size += particle.growth * frame.dt;
        particle.sprite.rotation += particle.rotationSpeed * frame.dt;
        particle.sprite.scale.set(particle.size / SMOKE_TEXTURE_SIZE);
        particle.sprite.alpha =
          particle.baseAlpha * Math.min(1, progress * 12) * Math.pow(1 - progress, 2.2);
      }
    },
    destroy(): void {
      particles.length = 0;
      smoke.destroy({ children: true });
      flames.destroy({ children: true });
      flameTexture.destroy(true);
      smokeTexture.destroy(true);
    },
  };
}
