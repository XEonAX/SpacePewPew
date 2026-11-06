import type { Application, Ticker } from 'pixi.js';
import { Container, Sprite, TilingSprite } from 'pixi.js';
import { clamp, smoothstep } from '../utils/math';
import { createRng, randomRange } from '../utils/random';
import {
  NEBULA_TEXTURE_SIZE,
  STAR_TEXTURE_SIZE,
  createFlareTexture,
  createGalaxyTexture,
  createNebulaTexture,
  createStarTexture,
} from './background-textures';
import {
  STARFIELD_SEED,
  advanceStars,
  dustAlpha,
  generateDust,
  generateStars,
  layerZoom,
  projectPoint,
  projectStar,
  starAlpha,
} from './starfield-model';
import type { Star } from './starfield-model';

export interface DustTransform {
  /** Near-field dust camera offset, normalized to the viewport. */
  x: number;
  y: number;
  /** Current eased camera zoom. */
  zoom: number;
}

export interface Background {
  container: Container;
  /**
   * Sets the desired camera zoom. The background eases toward it, so gameplay
   * can drive this from ship velocity (higher velocity → zoom out).
   */
  setZoom(zoom: number): void;
  getZoom(): number;
  /** Transform of the nearest layer (stars/asteroid should ride with it). */
  getDustTransform(): DustTransform;
  /**
   * Smoothly pans the camera toward a normalized world point (the ship).
   * Call every frame; the background eases toward it for an arcade follow cam.
   */
  setFollowTarget(x: number, y: number, immediate?: boolean): void;
  resetView(): void;
  destroy(): void;
}

const MAX_DELTA_SECONDS = 0.05;
const HERO_STAR_COUNT = 14;

/** Hard camera limits: 50× zoom-out (0.02); 1× default is the max zoom-in. */
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 1;

const NEBULA_LAYERS = [
  { parallax: 0.03, alpha: 0.32, tileScaleFactor: 1.9 },
  { parallax: 0.055, alpha: 0.22, tileScaleFactor: 1.3 },
] as const;

const GALAXIES = [
  {
    x: 0.31,
    y: -0.23,
    parallax: 0.18,
    zoomResponse: 0.05,
    alpha: 0.62,
    scaleFactor: 0.56,
    rotation: -0.7,
    spin: 0.004,
  },
  {
    x: -0.34,
    y: 0.28,
    parallax: 0.26,
    zoomResponse: 0.05,
    alpha: 0.44,
    scaleFactor: 0.38,
    rotation: 2.2,
    spin: -0.003,
  },
] as const;

interface NebulaLayer {
  sprite: TilingSprite;
  parallax: number;
  offsetX: number;
  offsetY: number;
  tileScaleToViewport: number;
}

interface GalaxyLayer {
  sprite: Sprite;
  x: number;
  y: number;
  parallax: number;
  zoomResponse: number;
  rotation: number;
  spin: number;
  scaleFactor: number;
}

interface FlareLayer {
  sprite: Sprite;
  star: Star;
  spin: number;
}

interface DustLayer {
  sprite: Sprite;
  mote: ReturnType<typeof generateDust>[number];
}

/**
 * Layered procedural background for a 2.5D game: tileable fbm nebulas, distant
 * galaxies, a three-layer deterministic starfield, near-field dust, and hero
 * star flares.
 *
 * The far star layers keep their scale when the camera zooms (like a fixed
 * sky); the near dust layer takes the full pan + zoom. Zoom is exposed through
 * `setZoom` so gameplay can ease it out at higher ship velocities.
 *
 * Everything is baked texture / sprite based (no custom shaders or filters) and
 * batched by PixiJS.
 */
export function createBackground(app: Application, seed: number = STARFIELD_SEED): Background {
  const rng = createRng(seed ^ 0x51ed270b);
  const starTexture = createStarTexture();
  const flareTexture = createFlareTexture();
  const galaxyTexture = createGalaxyTexture(seed ^ 0x9e3779b9);
  const nebulaTextures = [
    createNebulaTexture(seed ^ 0x1d3f5a7b, 0),
    createNebulaTexture(seed ^ 0x6b2c9a11, 1),
  ];

  const container = new Container();
  const camera = { x: 0, y: 0 };
  const dustCamera = { x: 0, y: 0 };
  let zoom = 1;
  let targetZoom = 1;
  let elapsed = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let activePointerId: number | null = null;
  let lastPointer = { x: 0, y: 0 };
  let followTarget: { x: number; y: number } | null = null;

  // Nebulas first so stars and galaxies sit in front of them.
  const nebulas: NebulaLayer[] = NEBULA_LAYERS.map((config, index) => {
    const sprite = new TilingSprite({
      texture: nebulaTextures[index] ?? nebulaTextures[0]!,
      width: app.screen.width,
      height: app.screen.height,
    });
    sprite.alpha = config.alpha;
    sprite.blendMode = 'add';
    container.addChild(sprite);

    return {
      sprite,
      parallax: config.parallax,
      offsetX: rng(),
      offsetY: rng(),
      tileScaleToViewport: config.tileScaleFactor,
    };
  });

  const galaxies: GalaxyLayer[] = GALAXIES.map((config) => {
    const sprite = new Sprite({ texture: galaxyTexture, anchor: 0.5 });
    sprite.alpha = config.alpha;
    sprite.blendMode = 'add';
    sprite.rotation = config.rotation;
    container.addChild(sprite);

    return {
      sprite,
      x: config.x,
      y: config.y,
      parallax: config.parallax,
      zoomResponse: config.zoomResponse,
      rotation: config.rotation,
      spin: config.spin,
      scaleFactor: config.scaleFactor,
    };
  });

  const stars = generateStars(seed);
  const starSprites = stars.map((star) => {
    const sprite = new Sprite({ texture: starTexture, anchor: 0.5, tint: star.tint });
    container.addChild(sprite);
    return sprite;
  });

  // Pick a deterministic set of brighter central stars to sparkle.
  const heroCandidates = stars
    .map((star, index) => ({ star, index }))
    .filter(({ star }) => star.radius > 1.3 && Math.abs(star.x) <= 0.5 && Math.abs(star.y) <= 0.5);
  const heroIndices = new Set<number>();
  while (heroIndices.size < Math.min(HERO_STAR_COUNT, heroCandidates.length)) {
    const candidate = heroCandidates[Math.floor(rng() * heroCandidates.length)];
    if (candidate) heroIndices.add(candidate.index);
  }
  const flares: FlareLayer[] = [...heroIndices].map((index) => {
    const star = stars[index]!;
    const sprite = new Sprite({ texture: flareTexture, anchor: 0.5, tint: star.tint });
    sprite.blendMode = 'add';
    container.addChild(sprite);
    return { sprite, star, spin: randomRange(rng, -0.35, 0.35) };
  });

  const dust = generateDust(seed);
  const dustSprites: DustLayer[] = dust.map((mote) => {
    const sprite = new Sprite({ texture: starTexture, anchor: 0.5, tint: mote.tint });
    sprite.blendMode = 'add';
    container.addChild(sprite);
    return { sprite, mote };
  });

  const layout = (): void => {
    const { width, height } = app.screen;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;

    for (const nebula of nebulas) {
      nebula.sprite.width = width;
      nebula.sprite.height = height;
    }
  };

  const project = (): void => {
    layout();
    const { width, height } = app.screen;

    const maxDimension = Math.max(width, height);
    const minDimension = Math.min(width, height);
    const dustVisibility = smoothstep(MIN_ZOOM, 0.3, zoom);

    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index]!;
      const sprite = starSprites[index]!;
      const point = projectStar(star, camera, { width, height }, zoom);
      const scale = layerZoom(star.zoomResponse, zoom);

      sprite.position.set(point.x, point.y);
      sprite.scale.set((star.radius / (STAR_TEXTURE_SIZE / 2)) * scale);
      sprite.alpha = starAlpha(star, elapsed);
    }

    for (const flare of flares) {
      const point = projectStar(flare.star, camera, { width, height }, zoom);
      const scale = layerZoom(flare.star.zoomResponse, zoom);

      flare.sprite.position.set(point.x, point.y);
      flare.sprite.scale.set(flare.star.radius * 0.24 * scale);
      flare.sprite.alpha = starAlpha(flare.star, elapsed) * 0.55;
      flare.sprite.rotation = elapsed * flare.spin;
    }

    for (const { sprite, mote } of dustSprites) {
      const point = projectPoint(mote, dustCamera, { width, height }, zoom, 1, 1);

      sprite.position.set(point.x, point.y);
      sprite.scale.set((mote.radius / (STAR_TEXTURE_SIZE / 2)) * zoom);
      sprite.alpha = dustAlpha(mote, elapsed) * dustVisibility;
    }

    for (const nebula of nebulas) {
      const tileSize = maxDimension * nebula.tileScaleToViewport;
      const panX = -camera.x * nebula.parallax * width;
      const panY = -camera.y * nebula.parallax * height;

      nebula.sprite.tileScale.set(tileSize / NEBULA_TEXTURE_SIZE);
      nebula.sprite.tilePosition.set(
        modulo(panX + nebula.offsetX * tileSize + width / 2, tileSize),
        modulo(panY + nebula.offsetY * tileSize + height / 2, tileSize),
      );
    }

    for (const galaxy of galaxies) {
      const scale = layerZoom(galaxy.zoomResponse, zoom);
      const galaxySize = minDimension * galaxy.scaleFactor * scale;

      galaxy.sprite.position.set(
        (galaxy.x - camera.x * galaxy.parallax) * width * scale + width / 2,
        (galaxy.y - camera.y * galaxy.parallax) * height * scale + height / 2,
      );
      galaxy.sprite.scale.set(galaxySize / galaxyTexture.width);
      galaxy.sprite.rotation = galaxy.rotation + elapsed * galaxy.spin;
    }
  };

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = Math.min(ticker.deltaMS / 1000, MAX_DELTA_SECONDS);
    elapsed += deltaSeconds;

    if (Math.abs(targetZoom - zoom) > 0.0001) {
      const smoothing = 1 - Math.exp(-deltaSeconds * 8);
      zoom += (targetZoom - zoom) * smoothing;
    } else {
      zoom = targetZoom;
    }

    if (followTarget) {
      const ease = 1 - Math.exp(-deltaSeconds * 7);
      camera.x += (followTarget.x - camera.x) * ease;
      camera.y += (followTarget.y - camera.y) * ease;
      dustCamera.x += (followTarget.x - dustCamera.x) * ease;
      dustCamera.y += (followTarget.y - dustCamera.y) * ease;
    }

    advanceStars(stars, deltaSeconds);
    // The near dust layer is the gameplay layer: keep it rigid so the ship and
    // asteroid never slide relative to it. Stars can keep their slow drift.
    project();
  };

  const canvas = app.canvas as HTMLCanvasElement;

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
    const deltaX = (clientX - lastPointer.x) / Math.max(width, 1);
    const deltaY = (clientY - lastPointer.y) / Math.max(height, 1);

    // The fixed sky pans gently with parallax; the near dust tracks the pointer
    // one-to-one so drag still feels direct at any zoom.
    camera.x -= deltaX;
    camera.y -= deltaY;
    dustCamera.x -= deltaX / zoom;
    dustCamera.y -= deltaY / zoom;
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

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.032 : 0.002));
    targetZoom = clamp(targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
  };

  const onDoubleClick = (): void => {
    camera.x = 0;
    camera.y = 0;
    dustCamera.x = 0;
    dustCamera.y = 0;
    zoom = 1;
    targetZoom = 1;
  };

  const setZoom = (nextZoom: number): void => {
    targetZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  };

  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDoubleClick);

  app.stage.addChild(container);
  app.ticker.add(tick);
  project();

  return {
    container,
    setZoom,
    getZoom: () => zoom,
    getDustTransform: () => ({ x: dustCamera.x, y: dustCamera.y, zoom }),
    setFollowTarget(x: number, y: number, immediate = false): void {
      followTarget = { x, y };
      if (immediate) {
        camera.x = x;
        camera.y = y;
        dustCamera.x = x;
        dustCamera.y = y;
      }
    },
    resetView: onDoubleClick,
    destroy(): void {
      app.ticker.remove(tick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerEnd);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);

      if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
      }

      activePointerId = null;
      canvas.style.cursor = '';
      container.destroy({ children: true });
      starTexture.destroy(true);
      flareTexture.destroy(true);
      galaxyTexture.destroy(true);
      for (const texture of nebulaTextures) texture.destroy(true);
    },
  };
}

function modulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
