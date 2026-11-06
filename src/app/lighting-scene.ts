import type { Application, Ticker } from 'pixi.js';
import { Assets, Container, Text, extensions } from 'pixi.js';
import type { Texture } from 'pixi.js';
import {
  AmbientLight,
  LightSprite,
  LightSpritePipe,
  PointLight,
  light2DSystem,
  shadowSystem,
} from 'pixijs-light2d';
import { joinBaseUrl } from '../utils/paths';
import { createBackground } from './background';

// Must be registered before the Application is created (module import order).
extensions.add(LightSpritePipe);

export interface Scene {
  setMuted(muted: boolean): void;
  destroy(): void;
}

const assetUrl = (path: string): string => joinBaseUrl(import.meta.env.BASE_URL, path);

/**
 * Lighting demo: the reference ship and asteroid lit by a strong key light from
 * the top-right (approximated by a distant point light) and an omni light that
 * follows the pointer. The procedural background sits behind them.
 */
export async function createScene(app: Application): Promise<Scene> {
  const background = createBackground(app);

  const [shipColor, shipNormal, asteroidColor, asteroidNormal] = await Promise.all([
    Assets.load<Texture>(assetUrl('assets/lighting/ship-color.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/ship-normal.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid-color.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid-normal.png')),
  ]);

  const content = new Container();

  const ship = new LightSprite({
    texture: shipColor,
    normalMap: shipNormal,
    anchor: 0.5,
  });

  const asteroid = new LightSprite({
    texture: asteroidColor,
    normalMap: asteroidNormal,
    anchor: 0.5,
  });

  content.addChild(ship, asteroid);
  app.stage.addChild(content);

  const hint = new Text({
    text: 'directional light: top-right · omni light: move mouse · M: mute',
    style: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      fill: '#4f728c',
    },
  });
  hint.anchor.set(0.5);
  app.stage.addChild(hint);

  const ambient = new AmbientLight({ color: 0x9aa8d0, intensity: 0.5 });
  light2DSystem.addAmbientLight(ambient);

  // A distant, very wide point light approximates a directional key light.
  const keyLight = new PointLight({
    color: 0xfff2d8,
    intensity: 1.7,
    radius: 5000,
  });

  const pointerLight = new PointLight({
    color: 0x9fe0ff,
    intensity: 1.8,
    radius: 500,
  });

  app.stage.addChild(keyLight, pointerLight);
  light2DSystem.addLight(keyLight);
  light2DSystem.addLight(pointerLight);

  const canvas = app.canvas as HTMLCanvasElement;
  let pointerLightPlaced = false;

  const layout = (): void => {
    const { width, height } = app.screen;
    const gap = Math.max(24, width * 0.045);

    let shipScale = Math.min(height * 0.7, width * 0.62) / shipColor.height;
    let asteroidScale = Math.min(height * 0.54, width * 0.34) / asteroidColor.width;

    let shipWidth = shipColor.width * shipScale;
    let asteroidWidth = asteroidColor.width * asteroidScale;
    const fit = Math.min(1, (width * 0.86) / (shipWidth + asteroidWidth + gap));
    shipScale *= fit;
    asteroidScale *= fit;
    shipWidth *= fit;
    asteroidWidth *= fit;

    const centerX = width / 2;
    const centerY = height * 0.5;

    ship.scale.set(shipScale);
    asteroid.scale.set(asteroidScale);
    ship.position.set(centerX - gap / 2 - shipWidth / 2, centerY);
    asteroid.position.set(centerX + gap / 2 + asteroidWidth / 2, centerY);

    keyLight.position.set(width * 0.95, -height * 0.05);
    keyLight.radius = Math.max(width, height) * 6;
    pointerLight.radius = Math.min(width, height) * 0.55;

    if (!pointerLightPlaced) {
      pointerLight.position.set(width * 0.5, height * 0.45);
    }

    hint.position.set(width / 2, height - 28);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * app.screen.width;
    const y = ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * app.screen.height;
    pointerLight.position.set(x, y);
    pointerLightPlaced = true;
  };

  const updateShadowMap = (): void => {
    shadowSystem.update(
      app.renderer,
      light2DSystem.lights.map((light) => ({ position: light.position, radius: light.radius })),
    );
  };

  const tick = (ticker: Ticker): void => {
    void ticker;
    layout();
    // With no casters the shadow map is a constant "unoccluded" map, so bake it
    // once. Once casters exist it must be refreshed each frame.
    if (shadowSystem.casters.length > 0) updateShadowMap();
  };

  const onResize = (): void => {
    layout();
  };

  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointermove', onPointerMove);
  app.ticker.add(tick);
  layout();
  updateShadowMap();

  return {
    setMuted(muted: boolean): void {
      hint.text = muted
        ? 'directional light: top-right · omni light: move mouse · sound muted'
        : 'directional light: top-right · omni light: move mouse · M: mute';
    },
    destroy(): void {
      app.ticker.remove(tick);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointermove', onPointerMove);

      light2DSystem.lights = light2DSystem.lights.filter(
        (light) => light !== keyLight && light !== pointerLight,
      );
      light2DSystem.ambientLights = light2DSystem.ambientLights.filter(
        (light) => light !== ambient,
      );

      app.stage.removeChild(keyLight, pointerLight);
      keyLight.destroy();
      pointerLight.destroy();
      ambient.destroy();

      content.destroy({ children: true });
      hint.destroy();
      background.destroy();
    },
  };
}
