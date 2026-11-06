import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { BULLET_RANGE_METERS, bulletAlpha } from './bullet-math';
import { PIXELS_PER_METER } from './world-scale';

const BULLET_TEXTURE_WIDTH = 128;
const BULLET_TEXTURE_HEIGHT = 32;
// One metre of world-space tracer, so bullets stay legible when zoomed out.
const BULLET_LENGTH_WORLD = PIXELS_PER_METER;
const BULLET_WIDTH_WORLD = 4;
const BULLET_POOL_SIZE = 128;

interface Bullet {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  travelled: number;
  active: boolean;
}

export interface BulletFrame {
  dustX: number;
  dustY: number;
  zoom: number;
  width: number;
  height: number;
  dt: number;
}

export interface Bullets {
  container: Container;
  spawn(x: number, y: number, vx: number, vy: number): void;
  update(frame: BulletFrame): void;
  destroy(): void;
}

function createBulletTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = BULLET_TEXTURE_WIDTH;
  canvas.height = BULLET_TEXTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.globalCompositeOperation = 'lighter';
    const cy = BULLET_TEXTURE_HEIGHT / 2;
    const horizontal = ctx.createLinearGradient(8, 0, BULLET_TEXTURE_WIDTH - 8, 0);
    horizontal.addColorStop(0, 'rgba(40, 190, 255, 0)');
    horizontal.addColorStop(0.18, 'rgba(75, 225, 255, 0.34)');
    horizontal.addColorStop(0.5, 'rgba(230, 255, 255, 1)');
    horizontal.addColorStop(0.82, 'rgba(75, 225, 255, 0.34)');
    horizontal.addColorStop(1, 'rgba(40, 190, 255, 0)');
    ctx.fillStyle = horizontal;

    // Wide soft halo.
    ctx.shadowColor = 'rgba(70, 225, 255, 0.9)';
    ctx.shadowBlur = 12;
    ctx.fillRect(8, cy - 7, BULLET_TEXTURE_WIDTH - 16, 14);

    // Mid glow.
    ctx.shadowBlur = 6;
    ctx.fillRect(12, cy - 3, BULLET_TEXTURE_WIDTH - 24, 6);

    // Hot core.
    ctx.shadowBlur = 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fillRect(18, cy - 1, BULLET_TEXTURE_WIDTH - 36, 2);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

export function createBullets(): Bullets {
  const texture = createBulletTexture();
  const container = new Container();
  const bullets: Bullet[] = [];

  for (let index = 0; index < BULLET_POOL_SIZE; index += 1) {
    const sprite = new Sprite({ texture, anchor: 0.5 });
    sprite.width = BULLET_LENGTH_WORLD;
    sprite.height = BULLET_WIDTH_WORLD;
    sprite.blendMode = 'add';
    sprite.visible = false;
    container.addChild(sprite);
    bullets.push({ sprite, x: 0, y: 0, vx: 0, vy: 0, travelled: 0, active: false });
  }

  return {
    container,
    spawn(x: number, y: number, vx: number, vy: number): void {
      const bullet = bullets.find((candidate) => !candidate.active);
      if (!bullet) return;
      bullet.active = true;
      bullet.x = x;
      bullet.y = y;
      bullet.vx = vx;
      bullet.vy = vy;
      bullet.travelled = 0;
      bullet.sprite.position.set(x * PIXELS_PER_METER, y * PIXELS_PER_METER);
      bullet.sprite.rotation = Math.atan2(vy, vx);
      bullet.sprite.alpha = 1;
      bullet.sprite.visible = true;
    },
    update(frame: BulletFrame): void {
      container.position.set(
        -frame.dustX * frame.width * frame.zoom + frame.width / 2,
        -frame.dustY * frame.height * frame.zoom + frame.height / 2,
      );
      container.scale.set(frame.zoom);

      for (const bullet of bullets) {
        if (!bullet.active) continue;

        bullet.travelled += Math.hypot(bullet.vx, bullet.vy) * frame.dt;
        if (bullet.travelled >= BULLET_RANGE_METERS) {
          bullet.active = false;
          bullet.sprite.visible = false;
          continue;
        }

        bullet.x += bullet.vx * frame.dt;
        bullet.y += bullet.vy * frame.dt;
        bullet.sprite.position.set(bullet.x * PIXELS_PER_METER, bullet.y * PIXELS_PER_METER);
        // Keep the glow width legible when the camera zooms out; length stays 1 m.
        bullet.sprite.height = BULLET_WIDTH_WORLD / frame.zoom;
        bullet.sprite.alpha = bulletAlpha(bullet.travelled);
      }
    },
    destroy(): void {
      bullets.length = 0;
      container.destroy({ children: true });
      texture.destroy(true);
    },
  };
}
