import type { Application, Ticker } from 'pixi.js';
import { Assets, Container, Text } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { joinBaseUrl } from '../utils/paths';
import { CAMERA_FOLLOW_RATE, createBackground } from './background';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import {
  createFlightState,
  stepFlight,
  DEFAULT_FLIGHT_TUNING,
  forwardTerminalSpeed,
} from './ship-flight';
import type { FlightControls } from './ship-flight';
import { createFlightTuner } from './flight-tuner';
import { createFlightTelemetry } from './flight-telemetry';
import { createGroundGrid } from './ground-grid';
import { FLAME_LOCAL_LENGTH, createEngineExhaust } from './engine-exhaust';
import { createEngineAudio } from './engine-audio';
import { PIXELS_PER_METER } from './world-scale';
import { clamp } from '../utils/math';
import type { AudioManager } from '../audio/audio';
import { listenerGainForZoom } from '../audio/listener-gain';
import { createTurrets } from './turrets';
import { createBullets } from './bullets';
import { BULLET_SPEED_METERS_PER_SECOND } from './bullet-math';
import {
  WEAPON_PAIRS,
  WEAPON_SHOT_DELAYS,
  advanceShots,
  commitShot,
  muzzleWorldPose,
  muzzlesForPair,
  nextPairVariant,
} from './weapons';
import type { MuzzleAim, PendingShot } from './weapons';
import { createWeaponTuner } from './weapon-tuner';
import {
  AIM_MODE_KEY_CODES,
  DEFAULT_AIM_MODE,
  DEFAULT_WEAPON_MODE,
  WEAPON_MODE_KEY_CODE,
  aimModeForKey,
  toggleWeaponMode,
  turretAimMode,
  weaponHint,
} from './weapon-mode';
import type { AimMode, WeaponMode } from './weapon-mode';
import { createMining } from './mining';

export interface Scene {
  setMuted(muted: boolean): void;
  destroy(): void;
}

const MAX_DELTA_SECONDS = 0.05;

// Lookahead is an offset of the ship from screen centre, as a fraction of the
// short viewport edge. It eases in quadratically with speed and grows when the
// camera is zoomed out.
const LOOKAHEAD_BASE_OFFSET = 0.07;
const LOOKAHEAD_MAX_OFFSET = 0.11;
const LOOKAHEAD_ZOOM_BOOST = 1.5;

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
export async function createScene(app: Application, audio: AudioManager): Promise<Scene> {
  const background = createBackground(app);

  const [
    shipColor,
    shipNormal,
    shipEmissive,
    shipGlow,
    asteroidColor,
    asteroidNormal,
    turretTexture,
  ] = await Promise.all([
    Assets.load<Texture>(assetUrl('assets/lighting/ship-color.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/ship-normal.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/ship-emissive.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/ship-glow.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid-color.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid-normal.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/turret.png')),
  ]);

  const content = new Container();
  app.stage.addChild(content);

  const ground = createGroundGrid();
  const exhaust = createEngineExhaust();
  const engineAudio = createEngineAudio(audio);
  content.addChild(ground.mesh, exhaust.smoke);

  const ship: LitSprite = createLitSprite(shipColor, shipNormal, shipEmissive, shipGlow);
  const asteroid: LitSprite = createLitSprite(asteroidColor, asteroidNormal);
  const turrets = createTurrets(turretTexture);
  const bullets = createBullets();
  const mining = createMining();
  content.addChild(
    ship.mesh,
    turrets.container,
    exhaust.flames,
    bullets.container,
    asteroid.mesh,
    mining.container,
  );

  const canvas = app.canvas as HTMLCanvasElement;
  const pointer = { x: app.screen.width / 2, y: app.screen.height / 2, active: false };
  const shipScreen = { x: 0, y: 0 };
  const updatePointer = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * app.screen.width;
    pointer.y = ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * app.screen.height;
    pointer.active = true;
  };
  const onPointerMove = (event: PointerEvent): void => updatePointer(event);

  // Mouse aim fires on click; all-forward fires the whole battery on Space.
  let weaponMode: WeaponMode = DEFAULT_WEAPON_MODE;
  let aimMode: AimMode = DEFAULT_AIM_MODE;
  let pointerDown = false;
  let spaceDown = false;
  let soundMuted = false;
  let cargo = 0;
  const gunFiring = (): boolean => (aimMode === 'mouse' ? pointerDown : spaceDown);
  const miningFiring = (): boolean => pointerDown || spaceDown;
  const pairCooldowns = [0, 0, 0, 0];
  const weaponCooldowns = WEAPON_PAIRS.map((pair) => pair.cooldown);
  const pairCursors = [0, 0, 0, 0];
  const pendingShots: PendingShot[] = [];

  const spawnBullets = (muzzles: readonly MuzzleAim[]): void => {
    // Muzzle poses were captured when the trigger was pulled; only the ship
    // transform is read live, so a shot that left the arc still flies.
    const localToMeters = shipBaseScale / PIXELS_PER_METER;
    for (const muzzle of muzzles) {
      const pose = muzzleWorldPose(muzzle, flight.x, flight.y, flight.rotation, localToMeters);
      bullets.spawn(
        pose.x,
        pose.y,
        flight.vx + Math.sin(pose.angle) * BULLET_SPEED_METERS_PER_SECOND,
        flight.vy - Math.cos(pose.angle) * BULLET_SPEED_METERS_PER_SECOND,
        pose.angle - Math.PI / 2,
      );
    }
  };

  const fireWeapon = (pairIndex: number): void => {
    const pair = WEAPON_PAIRS[pairIndex];
    if (!pair) return;
    const next = nextPairVariant(pair, pairCursors[pairIndex] ?? 0);
    const delay = WEAPON_SHOT_DELAYS[next.sound] ?? 0;
    const muzzles = muzzlesForPair(turrets.getMuzzles(), pairIndex);
    // Commit the shot before the mouse can leave the cone: the charge sound
    // and its projectile belong to the same trigger pull.
    if (!commitShot(pendingShots, pairIndex, muzzles, delay)) return;
    pairCursors[pairIndex] = next.cursor;

    // Keyboard fire has no crosshair; keep those shots centred.
    const pan =
      aimMode === 'mouse'
        ? clamp((pointer.x - shipScreen.x) / Math.max(app.screen.width * 0.35, 1), -0.7, 0.7)
        : 0;
    const volume = pair.volume * (0.92 + Math.random() * 0.16);

    if (pairIndex === 0) {
      // The front pair has two barrels: two slightly detuned voices panned
      // apart avoid the "same sample every shot" effect.
      audio.play(next.sound, {
        rate: 0.965 + Math.random() * 0.02,
        volume: volume * 0.72,
        pan: clamp(pan - 0.22, -1, 1),
      });
      audio.play(next.sound, {
        rate: 1.015 + Math.random() * 0.025,
        volume: volume * 0.68,
        pan: clamp(pan + 0.22, -1, 1),
      });
      return;
    }

    audio.play(next.sound, { rate: 0.97 + Math.random() * 0.06, volume, pan });
  };

  const updateWeapons = (dt: number): void => {
    advanceShots(pendingShots, dt, (shot) => spawnBullets(shot.muzzles));
    // The mining rig replaces the gun battery entirely.
    if (weaponMode !== 'guns') return;

    const active = turrets.getActivePairs();
    for (let index = 0; index < WEAPON_PAIRS.length; index += 1) {
      pairCooldowns[index] = Math.max(0, (pairCooldowns[index] ?? 0) - dt);
      if (!gunFiring() || !active[index] || (pairCooldowns[index] ?? 0) > 0) continue;
      fireWeapon(index);
      const cooldown = weaponCooldowns[index] ?? 1;
      pairCooldowns[index] = cooldown * (0.94 + Math.random() * 0.12);
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    updatePointer(event);
    pointerDown = true;
    void audio.enable();
  };
  const stopFiring = (): void => {
    pointerDown = false;
  };

  const hint = new Text({
    text: weaponHint(DEFAULT_WEAPON_MODE, DEFAULT_AIM_MODE, false),
    style: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      fill: '#4f728c',
    },
  });
  hint.anchor.set(0.5);
  app.stage.addChild(hint);
  const updateHint = (): void => {
    hint.text = weaponHint(weaponMode, aimMode, soundMuted, cargo);
  };

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
  let laidOutWidth = -1;
  let laidOutHeight = -1;

  const layout = (): void => {
    const { width, height } = app.screen;
    if (shipPlaced && width === laidOutWidth && height === laidOutHeight) return;
    laidOutWidth = width;
    laidOutHeight = height;
    const gap = Math.max(24, width * 0.045);

    let shipScale = Math.min(height * 0.48, width * 0.52) / shipColor.height;
    let asteroidScale = Math.min(height * 0.44, width * 0.3) / asteroidColor.width;

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
      // Flight is in metres relative to the viewport centre; rendering converts
      // metres to screen pixels with PIXELS_PER_METER.
      flight.x = (shipScreenX - width / 2) / PIXELS_PER_METER;
      flight.y = (centerY - height / 2) / PIXELS_PER_METER;
      shipPlaced = true;
    }

    asteroidWorld.x = (asteroidScreenX - width / 2) / width;
    asteroidWorld.y = (centerY - height / 2) / height;
    shipBaseScale = shipScale;
    asteroidBaseScale = asteroidScale;
    hint.position.set(centerX, height - 28);
  };

  const followCamera = (immediate = false): void => {
    const { width, height } = app.screen;
    const speed = Math.hypot(flight.vx, flight.vy);
    const directionX = speed > 0 ? flight.vx / speed : 0;
    const directionY = speed > 0 ? flight.vy / speed : 0;

    const terminalW = forwardTerminalSpeed(tuning);
    const speedFraction = terminalW > 0 ? Math.min(1, speed / terminalW) : 0;
    const curve = speedFraction * speedFraction;

    const dust = background.getDustTransform();
    const shortEdge = Math.min(width, height);
    const baseOffsetPx = shortEdge * LOOKAHEAD_BASE_OFFSET;
    const maxOffsetPx = shortEdge * LOOKAHEAD_MAX_OFFSET;
    const zoomBoost = 1 + (1 - dust.zoom) * LOOKAHEAD_ZOOM_BOOST;
    const shipHalf = (shipColor.height * shipBaseScale * dust.zoom) / 2;
    const flameScreen = FLAME_LOCAL_LENGTH * shipBaseScale * dust.zoom;
    const exhaustRoom = Math.max(0, height / 2 - shipHalf - flameScreen - 90);
    const offsetPx = Math.min(maxOffsetPx, baseOffsetPx * curve * zoomBoost, exhaustRoom);
    const offsetMeters = offsetPx / (PIXELS_PER_METER * dust.zoom);

    // Cancel the follow camera's steady-state lag, then add the desired
    // lookahead offset. Moving up puts the target above the ship, so the ship
    // ends up below screen centre.
    const lagMeters = speed / CAMERA_FOLLOW_RATE;
    const lead = lagMeters + offsetMeters;

    background.setFollowTarget(
      ((flight.x + directionX * lead) * PIXELS_PER_METER) / width,
      ((flight.y + directionY * lead) * PIXELS_PER_METER) / height,
      immediate,
    );
  };

  const updateTransforms = (deltaSeconds: number): void => {
    const { width, height } = app.screen;
    const dust = background.getDustTransform();

    ground.setView(dust.x, dust.y, dust.zoom, width, height);
    audio.setListenerGain(listenerGainForZoom(dust.zoom));

    const shipWorldX = flight.x * PIXELS_PER_METER;
    const shipWorldY = flight.y * PIXELS_PER_METER;

    const shipScreenX = (shipWorldX - dust.x * width) * dust.zoom + width / 2;
    const shipScreenY = (shipWorldY - dust.y * height) * dust.zoom + height / 2;
    shipScreen.x = shipScreenX;
    shipScreen.y = shipScreenY;
    // Mining targets arrive in world metres; turret aiming works in screen px.
    const tractorTargets = mining.getTractorTargets().map((target) =>
      target
        ? {
            x: (target.x * PIXELS_PER_METER - dust.x * width) * dust.zoom + width / 2,
            y: (target.y * PIXELS_PER_METER - dust.y * height) * dust.zoom + height / 2,
          }
        : null,
    );
    turrets.update({
      shipScreenX,
      shipScreenY,
      shipScale: shipBaseScale * dust.zoom,
      rotation: flight.rotation,
      mouseX: pointer.x,
      mouseY: pointer.y,
      mouseActive: pointer.active,
      mode: turretAimMode(weaponMode, aimMode),
      tractorTargets,
      dt: deltaSeconds,
      now: lighting.time,
    });

    bullets.update({
      dustX: dust.x,
      dustY: dust.y,
      zoom: dust.zoom,
      width,
      height,
      dt: deltaSeconds,
    });

    exhaust.update({
      shipWorldX,
      shipWorldY,
      shipScreenX,
      shipScreenY,
      shipBaseScale,
      shipScale: shipBaseScale * dust.zoom,
      rotation: flight.rotation,
      dustX: dust.x,
      dustY: dust.y,
      zoom: dust.zoom,
      width,
      height,
      linearInput: flight.linearInput,
      angularInput: flight.angularInput,
      shipVx: flight.vx * PIXELS_PER_METER,
      shipVy: flight.vy * PIXELS_PER_METER,
      dt: deltaSeconds,
      now: lighting.time,
    });

    engineAudio.update({
      shipScreenX,
      rotation: flight.rotation,
      shipScale: shipBaseScale * dust.zoom,
      width,
      linearInput: flight.linearInput,
      angularInput: flight.angularInput,
      vx: flight.vx,
      vy: flight.vy,
      terminalSpeed: forwardTerminalSpeed(tuning),
      dt: deltaSeconds,
    });

    ship.mesh.scale.set(shipBaseScale * dust.zoom);
    ship.mesh.position.set(shipScreenX, shipScreenY);
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
    telemetry.update();
    followCamera();
    updateTransforms(deltaSeconds);
    updateWeapons(deltaSeconds);

    const dust = background.getDustTransform();
    const { width, height } = app.screen;
    mining.update({
      dt: deltaSeconds,
      now: lighting.time,
      ship: {
        x: flight.x,
        y: flight.y,
        rotation: flight.rotation,
        vx: flight.vx,
        vy: flight.vy,
        metresPerShipPixel: shipBaseScale / PIXELS_PER_METER,
      },
      asteroid: {
        x: (asteroidWorld.x * width) / PIXELS_PER_METER,
        y: (asteroidWorld.y * height) / PIXELS_PER_METER,
        radius: (asteroidColor.width * asteroidBaseScale) / 2 / PIXELS_PER_METER,
      },
      muzzles: turrets.getAimPoses(),
      laserFiring: weaponMode === 'mining' && miningFiring(),
      tractorsActive: weaponMode === 'mining',
      dustX: dust.x,
      dustY: dust.y,
      zoom: dust.zoom,
      width,
      height,
    });
    if (weaponMode === 'mining') {
      const mined = mining.getCargo();
      if (mined !== cargo) {
        cargo = mined;
        updateHint();
      }
    }

    const glowLevels = pairCooldowns.map((cooldown, pairIndex) => {
      // Only the three rear/charge pairs ramp their glow; the front beam pair
      // keeps the normal charged/empty state.
      if (pairIndex === 0) return cooldown <= 0 ? 1 : 0;
      const pending = pendingShots.find((shot) => shot.pairIndex === pairIndex);
      if (pending) {
        const progress = pending.total > 0 ? 1 - pending.remaining / pending.total : 1;
        return 1 + 0.9 * Math.max(0, Math.min(1, progress));
      }
      return cooldown <= 0 ? 1 : 0;
    });
    turrets.setGlowLevels(glowLevels);
    updateLighting();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === WEAPON_MODE_KEY_CODE) {
      event.preventDefault();
      weaponMode = toggleWeaponMode(weaponMode);
      updateHint();
      return;
    }

    if (AIM_MODE_KEY_CODES.has(event.code)) {
      event.preventDefault();
      const mode = aimModeForKey(event.code);
      if (mode) {
        aimMode = mode;
        updateHint();
      }
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      spaceDown = true;
      void audio.enable();
      return;
    }

    if (!CONTROL_CODES.has(event.code)) return;

    event.preventDefault();
    if (event.code === 'KeyW') controls.forward = true;
    if (event.code === 'KeyS') controls.reverse = true;
    if (event.code === 'KeyA') controls.turnLeft = true;
    if (event.code === 'KeyD') controls.turnRight = true;
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceDown = false;
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
    pointerDown = false;
    spaceDown = false;
  };

  const flightTuner = createFlightTuner(tuning);
  document.body.append(flightTuner.element);

  const weaponTuner = createWeaponTuner(weaponCooldowns);
  document.body.append(weaponTuner.element);

  const telemetry = createFlightTelemetry(flight, tuning);
  document.body.append(telemetry.element);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopFiring);
  window.addEventListener('pointercancel', stopFiring);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  app.ticker.add(tick);
  layout();
  telemetry.update();
  followCamera(true);
  updateTransforms(0);
  updateLighting();

  return {
    setMuted(muted: boolean): void {
      soundMuted = muted;
      updateHint();
    },
    destroy(): void {
      app.ticker.remove(tick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopFiring);
      window.removeEventListener('pointercancel', stopFiring);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      flightTuner.destroy();
      weaponTuner.destroy();
      telemetry.destroy();
      turrets.destroy();
      bullets.destroy();
      mining.destroy();
      exhaust.destroy();
      engineAudio.destroy();
      ground.destroy();
      ship.mesh.destroy({ children: true });
      asteroid.mesh.destroy({ children: true });
      hint.destroy();
      background.destroy();
    },
  };
}
