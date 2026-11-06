import type { Application, Ticker } from 'pixi.js';
import { Assets, Container, Text } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { joinBaseUrl } from '../utils/paths';
import { createBackground } from './background';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';

export interface Scene {
  setMuted(muted: boolean): void;
  destroy(): void;
}

const MAX_DELTA_SECONDS = 0.05;

/** World-space lighting shared by the lit meshes. */
const lighting: LightingState = {
  ambient: [0.302, 0.329, 0.408],
  keyDirection: [0.7, -0.714],
  keyColor: [1, 0.949, 0.847],
  keyIntensity: 0.95,
  time: 0,
};

const assetUrl = (path: string): string => joinBaseUrl(import.meta.env.BASE_URL, path);

/**
 * Ship + asteroid lit by a small custom normal-map shader: one directional key
 * light from the top-right. The cyan ship panels use a baked emissive map plus
 * a blurred glow map.
 */
export async function createScene(app: Application): Promise<Scene> {
  const background = createBackground(app);

  const [shipColor, shipNormal, shipEmissive, shipGlow, asteroidColor, asteroidNormal] =
    await Promise.all([
      Assets.load<Texture>(assetUrl('assets/lighting/ship-color.png')),
      Assets.load<Texture>(assetUrl('assets/lighting/ship-normal.png')),
      Assets.load<Texture>(assetUrl('assets/lighting/ship-emissive.png')),
      Assets.load<Texture>(assetUrl('assets/lighting/ship-glow.png')),
      Assets.load<Texture>(assetUrl('assets/lighting/asteroid-color.png')),
      Assets.load<Texture>(assetUrl('assets/lighting/asteroid-normal.png')),
    ]);

  const content = new Container();
  app.stage.addChild(content);

  const ship: LitSprite = createLitSprite(shipColor, shipNormal, shipEmissive, shipGlow);
  const asteroid: LitSprite = createLitSprite(asteroidColor, asteroidNormal);
  content.addChild(ship.mesh, asteroid.mesh);

  const hint = new Text({
    text: 'directional light: top-right · M: mute',
    style: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      fill: '#4f728c',
    },
  });
  hint.anchor.set(0.5);
  app.stage.addChild(hint);

  const shipWorld = { x: 0, y: 0 };
  const asteroidWorld = { x: 0, y: 0 };
  let shipBaseScale = 1;
  let asteroidBaseScale = 1;

  const layout = (): void => {
    const { width, height } = app.screen;
    const gap = Math.max(24, width * 0.045);

    let shipScale = Math.min(height * 0.7, width * 0.62) / shipColor.height;
    let asteroidScale = Math.min(height * 0.54, width * 0.34) / asteroidColor.width;

    const shipWidth = shipColor.width * shipScale;
    const asteroidWidth = asteroidColor.width * asteroidScale;
    const fit = Math.min(1, (width * 0.86) / (shipWidth + asteroidWidth + gap));
    shipScale *= fit;
    asteroidScale *= fit;

    const centerX = width / 2;
    const centerY = height * 0.5;
    const shipScreenX = centerX - gap / 2 - (shipColor.width * shipScale) / 2;
    const asteroidScreenX = centerX + gap / 2 + (asteroidColor.width * asteroidScale) / 2;

    // Convert the layout into dust-camera world space (camera 0,0 = zoom 1).
    shipWorld.x = (shipScreenX - width / 2) / width;
    shipWorld.y = (centerY - height / 2) / height;
    asteroidWorld.x = (asteroidScreenX - width / 2) / width;
    asteroidWorld.y = (centerY - height / 2) / height;

    shipBaseScale = shipScale;
    asteroidBaseScale = asteroidScale;
    hint.position.set(centerX, height - 28);
  };

  const updateTransforms = (): void => {
    const { width, height } = app.screen;
    const dust = background.getDustTransform();

    ship.mesh.scale.set(shipBaseScale * dust.zoom);
    asteroid.mesh.scale.set(asteroidBaseScale * dust.zoom);
    ship.mesh.position.set(
      (shipWorld.x - dust.x) * width * dust.zoom + width / 2,
      (shipWorld.y - dust.y) * height * dust.zoom + height / 2,
    );
    asteroid.mesh.position.set(
      (asteroidWorld.x - dust.x) * width * dust.zoom + width / 2,
      (asteroidWorld.y - dust.y) * height * dust.zoom + height / 2,
    );
  };

  const updateLighting = (): void => {
    ship.setLighting(lighting);
    asteroid.setLighting(lighting);
  };

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = Math.min(ticker.deltaMS / 1000, MAX_DELTA_SECONDS);
    lighting.time += deltaSeconds;

    ship.mesh.rotation += deltaSeconds * 0.28;
    asteroid.mesh.rotation -= deltaSeconds * 0.22;

    layout();
    updateTransforms();
    updateLighting();
  };

  app.ticker.add(tick);
  layout();
  updateTransforms();
  updateLighting();

  return {
    setMuted(muted: boolean): void {
      hint.text = muted
        ? 'directional light: top-right · sound muted'
        : 'directional light: top-right · M: mute';
    },
    destroy(): void {
      app.ticker.remove(tick);
      ship.mesh.destroy({ children: true });
      asteroid.mesh.destroy({ children: true });
      hint.destroy();
      background.destroy();
    },
  };
}
