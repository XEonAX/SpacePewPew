import type { Application, Ticker } from 'pixi.js';
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import {
  STARFIELD_SEED,
  advanceStars,
  generateStars,
  projectStar,
  starAlpha,
} from './starfield-model';

export interface Starfield {
  container: Container;
  destroy(): void;
}

const STAR_TEXTURE_SIZE = 32;
const MAX_DELTA_SECONDS = 0.05;

/**
 * Deterministic parallax starfield that can be panned infinitely by dragging.
 * Stars live in a normalized field and wrap at the viewport edges.
 */
export function createStarfield(app: Application, seed: number = STARFIELD_SEED): Starfield {
  const texture = createStarTexture();
  const container = new Container();
  const stars = generateStars(seed);
  const sprites = stars.map((star) => {
    const sprite = new Sprite({ texture, anchor: 0.5, tint: star.tint });
    sprite.scale.set(star.radius / (STAR_TEXTURE_SIZE / 2));
    container.addChild(sprite);
    return sprite;
  });

  const canvas = app.canvas as HTMLCanvasElement;
  const camera = { x: 0, y: 0 };
  let elapsed = 0;
  let activePointerId: number | null = null;
  let lastPointer = { x: 0, y: 0 };

  const project = (): void => {
    const { width, height } = app.screen;

    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index]!;
      const sprite = sprites[index]!;
      const point = projectStar(star, camera, { width, height });
      sprite.position.set(point.x, point.y);
      sprite.alpha = starAlpha(star, elapsed);
    }
  };

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = Math.min(ticker.deltaMS / 1000, MAX_DELTA_SECONDS);
    elapsed += deltaSeconds;
    advanceStars(stars, deltaSeconds);
    project();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || activePointerId !== null) return;

    activePointerId = event.pointerId;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;

    const { clientX, clientY } = event;
    const { width, height } = app.screen;
    camera.x -= (clientX - lastPointer.x) / Math.max(width, 1);
    camera.y -= (clientY - lastPointer.y) / Math.max(height, 1);
    lastPointer = { x: clientX, y: clientY };
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;

    activePointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    canvas.style.cursor = 'grab';
  };

  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);

  app.stage.addChild(container);
  app.ticker.add(tick);
  project();

  return {
    container,
    destroy(): void {
      app.ticker.remove(tick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);

      if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
      }

      activePointerId = null;
      canvas.style.cursor = '';
      container.destroy({ children: true });
      texture.destroy(true);
    },
  };
}

function createStarTexture(): Texture {
  const size = STAR_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable for the starfield texture');

  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.65, 'rgba(255, 255, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}
