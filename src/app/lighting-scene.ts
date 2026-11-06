import type { Application, Ticker } from 'pixi.js';
import { Assets, Container, Text } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { joinBaseUrl } from '../utils/paths';
import { createBackground } from './background';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import { createFlightState, stepFlight, DEFAULT_FLIGHT_TUNING } from './ship-flight';
import type { FlightControls } from './ship-flight';
import { createFlightTuner } from './flight-tuner';

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

const CONTROL_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

const assetUrl = (path: string): string => joinBaseUrl(import.meta.env.BASE_URL, path);

/**
 * Ship + asteroid lit by a small custom normal-map shader: one directional key
 * light from the top-right. WASD flies the ship; the cyan panels use a baked
 * emissive map plus a blurred glow map.
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
    text: 'W/S thrust · A/D turn · M: mute',
    style: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      fill: '#4f728c',
    },
  });
  hint.anchor.set(0.5);
  app.stage.addChild(hint);

  const flight = createFlightState();
  const tuning = { ...DEFAULT_FLIGHT_TUNING };
  const asteroidWorld = { x: 0, y: 0 };
  const controls: FlightControls = {
    forward: false,
    reverse: false,
    turnLeft: false,
    turnRight: false,
  };
  let shipPlaced = false;
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

    if (!shipPlaced) {
      // Flight uses zoom-1 screen pixels relative to the viewport centre so the
      // ship's heading and speed look the same in both axes.
      flight.x = shipScreenX - width / 2;
      flight.y = centerY - height / 2;
      shipPlaced = true;
    }

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
    ship.mesh.position.set(
      (flight.x - dust.x * width) * dust.zoom + width / 2,
      (flight.y - dust.y * height) * dust.zoom + height / 2,
    );
    ship.mesh.rotation = flight.rotation;

    asteroid.mesh.scale.set(asteroidBaseScale * dust.zoom);
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

    stepFlight(flight, controls, deltaSeconds, tuning);
    asteroid.mesh.rotation -= deltaSeconds * 0.22;

    layout();
    background.setFollowTarget(flight.x / app.screen.width, flight.y / app.screen.height);
    updateTransforms();
    updateLighting();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!CONTROL_CODES.has(event.code)) return;

    event.preventDefault();
    if (event.code === 'KeyW') controls.forward = true;
    if (event.code === 'KeyS') controls.reverse = true;
    if (event.code === 'KeyA') controls.turnLeft = true;
    if (event.code === 'KeyD') controls.turnRight = true;
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'KeyW') controls.forward = false;
    if (event.code === 'KeyS') controls.reverse = false;
    if (event.code === 'KeyA') controls.turnLeft = false;
    if (event.code === 'KeyD') controls.turnRight = false;
  };

  const onBlur = (): void => {
    controls.forward = false;
    controls.reverse = false;
    controls.turnLeft = false;
    controls.turnRight = false;
  };

  const flightTuner = createFlightTuner(tuning);
  document.body.append(flightTuner.element);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  app.ticker.add(tick);
  layout();
  background.setFollowTarget(flight.x / app.screen.width, flight.y / app.screen.height, true);
  updateTransforms();
  updateLighting();

  return {
    setMuted(muted: boolean): void {
      hint.text = muted ? 'W/S thrust · A/D turn · sound muted' : 'W/S thrust · A/D turn · M: mute';
    },
    destroy(): void {
      app.ticker.remove(tick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      flightTuner.destroy();
      ship.mesh.destroy({ children: true });
      asteroid.mesh.destroy({ children: true });
      hint.destroy();
      background.destroy();
    },
  };
}
