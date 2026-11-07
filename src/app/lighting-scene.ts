import type { Application, Ticker } from 'pixi.js';
import { Assets, Container, Graphics, Text } from 'pixi.js';
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
  shipInertiaKgM2,
} from './ship-flight';
import type { FlightControls } from './ship-flight';
import { createShipGeometry, SHIP_COM_AFT_PX } from './ship-engines';
import type { EngineMix } from './engine-mix';
import { createFlightTuner } from './flight-tuner';
import { createFlightTelemetry } from './flight-telemetry';
import { createGroundGrid } from './ground-grid';
import { FLAME_LOCAL_LENGTH, createEngineExhaust } from './engine-exhaust';
import { createEngineAudio } from './engine-audio';
import { createMiningAudio } from './mining-audio';
import { createImpactAudio } from './impact-audio';
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
import { colliderWorldPoints, resolveShipCollision, shipHull } from './asteroid-collision';
import type { AsteroidCollider, ShipHull, Vec2 } from './asteroid-collision';
import { createAsteroidField } from './asteroid-field';
import { createShipShield } from './ship-shield';

export interface Scene {
  setMuted(muted: boolean): void;
  /** Read-only collider snapshot for the debug gizmo / agent inspection. */
  getColliders(): readonly AsteroidCollider[];
  destroy(): void;
}

const MAX_DELTA_SECONDS = 0.05;

// Lookahead is an offset of the ship from screen centre, as a fraction of the
// short viewport edge. It eases in quadratically with speed and grows when the
// camera is zoomed out.
const LOOKAHEAD_BASE_OFFSET = 0.07;
const LOOKAHEAD_MAX_OFFSET = 0.11;

/** Shield surface: how much of the hit bounces back, and its tangential grip. */
const SHIELD_RESTITUTION = 0.22;
const SHIELD_FRICTION = 0.5;
/** Collision spin bleeds off separately from the flight model's input turn. */
const IMPACT_SPIN_DAMPING = 1.2;
const IMPACT_SPIN_LIMIT = 1.2;
/** Camera shake: hit energy that saturates it, peak offset, and decay. */
const SHAKE_ENERGY_REFERENCE_J = 90_000;
const SHAKE_PEAK_PIXELS = 9;
const SHAKE_DECAY_PER_SECOND = 4.5;
/** The second asteroid starts this many metres dead ahead of the ship's nose. */
const ASTEROID_AHEAD_METERS = 20;
/** The new rock is a big one: this many times the base rock diameter. */
const ASTEROID_AHEAD_SCALE = 3;

/** World-space lighting shared by the lit meshes. */
const lighting: LightingState = {
  ambient: [0.302, 0.329, 0.408],
  keyDirection: [0.7, -0.714],
  keyColor: [1, 0.949, 0.847],
  keyIntensity: 0.95,
  time: 0,
};

const CONTROL_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX']);

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
    asteroid2Color,
    asteroid2Normal,
    turretTexture,
  ] = await Promise.all([
    Assets.load<Texture>(assetUrl('assets/lighting/ship-color.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/ship-normal.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/ship-emissive.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/ship-glow.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid-color.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid-normal.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid2-color.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/asteroid2-normal.png')),
    Assets.load<Texture>(assetUrl('assets/lighting/turret.png')),
  ]);

  const content = new Container();
  app.stage.addChild(content);

  const ground = createGroundGrid();
  const exhaust = createEngineExhaust();
  const engineAudio = createEngineAudio(audio);
  const miningAudio = createMiningAudio(audio);
  const impactAudio = createImpactAudio(audio);
  content.addChild(ground.mesh, exhaust.smoke);

  const ship: LitSprite = createLitSprite(shipColor, shipNormal, shipEmissive, shipGlow);
  const asteroidField = createAsteroidField([
    { color: asteroidColor, normal: asteroidNormal },
    { color: asteroid2Color, normal: asteroid2Normal },
  ]);
  const turrets = createTurrets(turretTexture);
  const bullets = createBullets();
  const mining = createMining();
  // The shield is the ship's collider, so it wraps the hull and turrets.
  const shield = createShipShield(shipHull(shipColor.width, shipColor.height));
  // Debug gizmo: outlines the real collision shapes (F2 toggles).
  const colliderGizmo = new Graphics();
  content.addChild(
    ship.mesh,
    turrets.container,
    shield.container,
    exhaust.flames,
    bullets.container,
    asteroidField.container,
    mining.container,
    colliderGizmo,
  );

  const canvas = app.canvas as HTMLCanvasElement;
  const pointer = { x: app.screen.width / 2, y: app.screen.height / 2, active: false };
  const shipScreen = { x: 0, y: 0 };
  /** Collider debug gizmo: hidden for normal play, F2 shows it for tuning. */
  let showColliders = false;
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
    const centre = shipCentre();
    for (const muzzle of muzzles) {
      const pose = muzzleWorldPose(muzzle, centre.x, centre.y, flight.rotation, localToMeters);
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
    hint.text =
      weaponHint(weaponMode, aimMode, soundMuted, cargo, mining.getCarryMode()) +
      ' · X stabilize' +
      (showColliders ? ' · F2 hide colliders' : ' · F2 colliders');
  };
  updateHint();

  const flight = createFlightState();
  /**
   * Ship texture-centre position in metres. The flight state lives at the
   * centre of mass (aft of the texture centre), so rendering, turrets, mining
   * and the shield all read the hull's own centre from here.
   */
  const shipCentre = (): { x: number; y: number } => {
    const aft = (SHIP_COM_AFT_PX * shipBaseScale) / PIXELS_PER_METER;
    return {
      x: flight.x + aft * Math.sin(flight.rotation),
      y: flight.y - aft * Math.cos(flight.rotation),
    };
  };
  const tuning = { ...DEFAULT_FLIGHT_TUNING };
  const controls: FlightControls = {
    forward: false,
    reverse: false,
    turnLeft: false,
    turnRight: false,
    stabilize: false,
  };
  /** Per-nozzle outputs from the last flight step, shared with exhaust/audio. */
  let engineMix: EngineMix = { main: [0, 0, 0], reverse: [0, 0] };
  let shipPlaced = false;
  let shipBaseScale = 1;
  /** Art width of the world rocks, metres; set when the world is first seeded. */
  let rockDiameter = 6;
  /** Hull bubble in metres, refreshed on layout; drawn by the shield too. */
  let shipCollider: ShipHull = { points: [], radius: 0 };
  /** Engine mounts and inertia scale, refreshed with the ship's layout scale. */
  let shipGeometry = createShipGeometry({ metresPerPixel: 1 / PIXELS_PER_METER, hullLengthM: 6 });
  /** Spin added by collisions, bled off separately from player turning. */
  let impactSpin = 0;
  /** 0..1 camera shake from the last impact. */
  let impactShake = 0;
  /** Impact speed and contact point handed to the shield, cleared each frame. */
  let shieldImpact = 0;
  let shieldImpactWorldX = 0;
  let shieldImpactWorldY = 0;
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
    const shipScreenX = centerX - gap / 2 - shipWidth / 2;
    const asteroidScreenX = centerX + gap / 2 + asteroidWidth / 2;

    if (!shipPlaced) {
      // Flight is in metres relative to the viewport centre; rendering converts
      // metres to screen pixels with PIXELS_PER_METER. The pivot is aft of the
      // texture centre, so the centre of mass starts one pivot offset behind
      // the layout position.
      flight.x = (shipScreenX - width / 2) / PIXELS_PER_METER;
      flight.y =
        (centerY - height / 2) / PIXELS_PER_METER +
        (SHIP_COM_AFT_PX * shipScale) / PIXELS_PER_METER;
      // Populate the world: the demo rock beside the pad, plus a new rock in
      // world space dead ahead of the hull's centre.
      rockDiameter = (asteroidColor.width * asteroidScale) / PIXELS_PER_METER;
      const padCentreY = (centerY - height / 2) / PIXELS_PER_METER;
      asteroidField.add((asteroidScreenX - width / 2) / PIXELS_PER_METER, padCentreY, rockDiameter);
      asteroidField.add(
        (shipScreenX - width / 2) / PIXELS_PER_METER,
        padCentreY - ASTEROID_AHEAD_METERS,
        rockDiameter * ASTEROID_AHEAD_SCALE,
        1,
      );
      shipPlaced = true;
    }

    shipBaseScale = shipScale;
    const hull = shipHull(shipColor.width, shipColor.height);
    const hullScale = shipScale / PIXELS_PER_METER;
    shipCollider = {
      points: hull.points.map((point) => ({ x: point.x * hullScale, y: point.y * hullScale })),
      radius: hull.radius * hullScale,
    };
    // Uniform-ish hull: radius of gyration ≈ 0.3 × length. The drive geometry
    // shares the same scale, so nozzle arms are the real ones from the art.
    const hullLengthM = (shipColor.height * shipScale) / PIXELS_PER_METER;
    shipGeometry = createShipGeometry({
      metresPerPixel: shipScale / PIXELS_PER_METER,
      hullLengthM,
    });
    hint.position.set(centerX, height - 28);
  };

  const followCamera = (immediate = false): void => {
    const { width, height } = app.screen;
    const speed = Math.hypot(flight.vx, flight.vy);
    const directionX = speed > 0 ? flight.vx / speed : 0;
    const directionY = speed > 0 ? flight.vy / speed : 0;

    const terminalW = forwardTerminalSpeed(tuning, shipGeometry);
    const speedFraction = terminalW > 0 ? Math.min(1, speed / terminalW) : 0;
    const curve = speedFraction * speedFraction;

    // The lookahead is a world-space offset, deliberately independent of zoom:
    // if it grew when zoomed out, every wheel notch would move the camera and
    // slide the near dust/grid layer (the old parallax pan bug). Scaling the
    // screen offset down as the camera pulls back keeps the world still.
    const shortEdge = Math.min(width, height);
    const baseOffsetMeters = (shortEdge * LOOKAHEAD_BASE_OFFSET) / PIXELS_PER_METER;
    const maxOffsetMeters = (shortEdge * LOOKAHEAD_MAX_OFFSET) / PIXELS_PER_METER;
    const shipHalfMeters = (shipColor.height * shipBaseScale) / (2 * PIXELS_PER_METER);
    const flameMeters = (FLAME_LOCAL_LENGTH * shipBaseScale) / PIXELS_PER_METER;
    const exhaustRoomMeters = Math.max(
      0,
      height / (2 * PIXELS_PER_METER) - shipHalfMeters - flameMeters - 90 / PIXELS_PER_METER,
    );
    const offsetMeters = Math.min(maxOffsetMeters, baseOffsetMeters * curve, exhaustRoomMeters);

    // Cancel the follow camera's steady-state lag, then add the desired
    // lookahead offset. Moving up puts the target above the ship, so the ship
    // ends up below screen centre.
    const lagMeters = speed / CAMERA_FOLLOW_RATE;
    const lead = lagMeters + offsetMeters;

    // The camera tracks the centre of mass, so the hull visibly pivots about
    // the orange panel behind the cargo hatch instead of its texture centre.
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

    const centre = shipCentre();
    const shipWorldX = centre.x * PIXELS_PER_METER;
    const shipWorldY = centre.y * PIXELS_PER_METER;

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
      miningBeams: mining.getActiveBeams(),
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
      blockers: asteroidField.getColliders(),
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
      engineMix,
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
      engineMix,
      vx: flight.vx,
      vy: flight.vy,
      terminalSpeed: forwardTerminalSpeed(tuning, shipGeometry),
      dt: deltaSeconds,
    });

    ship.mesh.scale.set(shipBaseScale * dust.zoom);
    ship.mesh.position.set(shipScreenX, shipScreenY);
    ship.mesh.rotation = flight.rotation;

    // The shield highlights the contact patch, so the hit point is converted
    // from world metres into ship-texture px (the shield's local space).
    const metresPerShipPixel = shipBaseScale / PIXELS_PER_METER;
    const contactDx = shieldImpactWorldX - centre.x;
    const contactDy = shieldImpactWorldY - centre.y;
    const contactCos = Math.cos(flight.rotation);
    const contactSin = Math.sin(flight.rotation);
    shield.update({
      x: shipScreenX,
      y: shipScreenY,
      rotation: flight.rotation,
      scale: shipBaseScale * dust.zoom,
      dt: deltaSeconds,
      impact: shieldImpact,
      impactX: (contactDx * contactCos + contactDy * contactSin) / metresPerShipPixel,
      impactY: (-contactDx * contactSin + contactDy * contactCos) / metresPerShipPixel,
    });
    shieldImpact = 0;

    asteroidField.update({
      dustX: dust.x,
      dustY: dust.y,
      zoom: dust.zoom,
      width,
      height,
      dt: deltaSeconds,
    });
  };

  const updateLighting = (): void => {
    ship.setLighting(lighting);
    asteroidField.setLighting(lighting);
  };

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = Math.min(ticker.deltaMS / 1000, MAX_DELTA_SECONDS);
    lighting.time += deltaSeconds;

    engineMix = stepFlight(flight, controls, deltaSeconds, tuning, shipGeometry);
    // Collision spin is not player input: bleed it off so a hit cannot leave
    // the ship turning forever (the flight model only damps while input is on).
    const spinDecay = Math.exp(-IMPACT_SPIN_DAMPING * deltaSeconds);
    const spinRemaining = impactSpin * spinDecay;
    flight.angularVelocity -= impactSpin - spinRemaining;
    impactSpin = spinRemaining;
    layout();
    // The rock is solid: push the ship's shield capsule out of it and bounce
    // the part of its velocity heading inward, so it cannot fly through.
    let impactSpeed = 0;
    let impactEnergy = 0;
    let scrapeSpeed = 0;
    if (shipCollider.points.length > 0) {
      const centre = shipCentre();
      const pivotAft = (SHIP_COM_AFT_PX * shipBaseScale) / PIXELS_PER_METER;
      const body = {
        mass: tuning.massKg,
        inertia: shipInertiaKgM2(tuning, shipGeometry),
        restitution: SHIELD_RESTITUTION,
        friction: SHIELD_FRICTION,
        pivotX: 0,
        pivotY: pivotAft,
      };
      let pose = {
        x: centre.x,
        y: centre.y,
        vx: flight.vx,
        vy: flight.vy,
        rotation: flight.rotation,
        angularVelocity: flight.angularVelocity,
      };
      const previousAngular = flight.angularVelocity;
      let touched = false;
      let strongest = 0;
      for (const rock of asteroidField.getColliders()) {
        const collision = resolveShipCollision(pose, shipCollider, rock, body);
        if (!collision.hit) continue;
        pose = {
          x: collision.x,
          y: collision.y,
          vx: collision.vx,
          vy: collision.vy,
          rotation: pose.rotation,
          angularVelocity: collision.angularVelocity,
        };
        touched = true;
        scrapeSpeed = Math.max(scrapeSpeed, collision.slideSpeed);
        if (collision.hitEnergy >= impactEnergy) {
          impactEnergy = collision.hitEnergy;
          impactSpeed = collision.impactSpeed;
        }
        if (collision.hitEnergy >= strongest) {
          strongest = collision.hitEnergy;
          shieldImpact = collision.impactSpeed;
          shieldImpactWorldX = collision.contactX;
          shieldImpactWorldY = collision.contactY;
        }
        impactShake = Math.min(
          1,
          Math.max(impactShake, collision.hitEnergy / SHAKE_ENERGY_REFERENCE_J),
        );
      }
      if (touched) {
        // The collider resolves the hull's centre; write the result back to the
        // centre of mass the flight model integrates.
        flight.x = pose.x - pivotAft * Math.sin(flight.rotation);
        flight.y = pose.y + pivotAft * Math.cos(flight.rotation);
        flight.vx = pose.vx;
        flight.vy = pose.vy;
        flight.angularVelocity = pose.angularVelocity;
        impactSpin = clamp(
          impactSpin + (pose.angularVelocity - previousAngular),
          -IMPACT_SPIN_LIMIT,
          IMPACT_SPIN_LIMIT,
        );
      }
    }
    impactAudio.update({
      dt: deltaSeconds,
      impactSpeed,
      hitEnergy: impactEnergy,
      slideSpeed: scrapeSpeed,
    });
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
        x: shipCentre().x,
        y: shipCentre().y,
        rotation: flight.rotation,
        vx: flight.vx,
        vy: flight.vy,
        metresPerShipPixel: shipBaseScale / PIXELS_PER_METER,
      },
      asteroids: asteroidField.getMiningTargets(),
      muzzles: turrets.getAimPoses(),
      laserFiring: weaponMode === 'mining' && miningFiring(),
      tractorsActive: weaponMode === 'mining',
      dustX: dust.x,
      dustY: dust.y,
      zoom: dust.zoom,
      width,
      height,
    });
    // Cargo is polled every frame (not just in mining mode) so a delivery that
    // finishes after switching weapons still gets its latch sound.
    const mined = mining.getCargo();
    if (mined > cargo) miningAudio.cargoDelivered();
    if (mined !== cargo) {
      cargo = mined;
      updateHint();
    }
    miningAudio.update({
      dt: deltaSeconds,
      laserBeams: mining.getLaserBeamCount(),
      tractorBeams: mining.getTractorBeamCount(),
    });

    // Collider gizmo: the dust-world outline the physics actually uses.
    colliderGizmo.visible = showColliders;
    if (showColliders) {
      colliderGizmo.position.set(
        -dust.x * width * dust.zoom + width / 2,
        -dust.y * height * dust.zoom + height / 2,
      );
      colliderGizmo.scale.set(dust.zoom);
      colliderGizmo.clear();
      const line = 1.6 / dust.zoom;
      for (const rock of asteroidField.getColliders()) {
        const world = colliderWorldPoints(rock);
        const flat: number[] = [];
        for (const point of world)
          flat.push(point.x * PIXELS_PER_METER, point.y * PIXELS_PER_METER);
        colliderGizmo.poly(flat).stroke({ color: 0x66ff99, width: line, alpha: 0.95 });
        colliderGizmo
          .circle(
            rock.x * PIXELS_PER_METER,
            rock.y * PIXELS_PER_METER,
            rock.radius * PIXELS_PER_METER,
          )
          .stroke({ color: 0x66ff99, width: line * 0.7, alpha: 0.3 });
        for (const point of world) {
          colliderGizmo
            .circle(point.x * PIXELS_PER_METER, point.y * PIXELS_PER_METER, line * 2)
            .fill({ color: 0xbaffd0, alpha: 0.9 });
        }
      }

      // Ship hull bubble: outline plus the bubble radius at each hull vertex.
      const centre = shipCentre();
      const cosRotation = Math.cos(flight.rotation);
      const sinRotation = Math.sin(flight.rotation);
      const hullWorld: Vec2[] = shipCollider.points.map((point) => ({
        x: centre.x + point.x * cosRotation - point.y * sinRotation,
        y: centre.y + point.x * sinRotation + point.y * cosRotation,
      }));
      const hullFlat: number[] = [];
      for (const point of hullWorld) {
        hullFlat.push(point.x * PIXELS_PER_METER, point.y * PIXELS_PER_METER);
      }
      colliderGizmo.poly(hullFlat).stroke({ color: 0x7fdcff, width: line, alpha: 0.9 });
      for (const point of hullWorld) {
        colliderGizmo
          .circle(
            point.x * PIXELS_PER_METER,
            point.y * PIXELS_PER_METER,
            shipCollider.radius * PIXELS_PER_METER,
          )
          .stroke({ color: 0x7fdcff, width: line * 0.6, alpha: 0.22 });
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

    // Weighty hits: a short deterministic camera shake scaled by hit energy.
    impactShake = Math.max(0, impactShake - deltaSeconds * SHAKE_DECAY_PER_SECOND);
    const shakePixels = impactShake * SHAKE_PEAK_PIXELS;
    content.position.set(
      Math.sin(lighting.time * 73) * shakePixels,
      Math.cos(lighting.time * 59) * shakePixels * 0.7,
    );
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === 'F2') {
      event.preventDefault();
      showColliders = !showColliders;
      updateHint();
      return;
    }

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

    if (event.code === 'KeyP' && weaponMode === 'mining') {
      event.preventDefault();
      mining.toggleCarryMode();
      updateHint();
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
    if (event.code === 'KeyX') controls.stabilize = true;
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceDown = false;
    if (event.code === 'KeyW') controls.forward = false;
    if (event.code === 'KeyS') controls.reverse = false;
    if (event.code === 'KeyA') controls.turnLeft = false;
    if (event.code === 'KeyD') controls.turnRight = false;
    if (event.code === 'KeyX') controls.stabilize = false;
  };

  const onBlur = (): void => {
    controls.forward = false;
    controls.reverse = false;
    controls.turnLeft = false;
    controls.turnRight = false;
    controls.stabilize = false;
    pointerDown = false;
    spaceDown = false;
  };

  const flightTuner = createFlightTuner(tuning);
  document.body.append(flightTuner.element);

  const weaponTuner = createWeaponTuner(weaponCooldowns);
  document.body.append(weaponTuner.element);

  const telemetry = createFlightTelemetry(flight, tuning, () => shipGeometry);
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
    getColliders(): readonly AsteroidCollider[] {
      return asteroidField.getColliders();
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
      miningAudio.destroy();
      impactAudio.destroy();
      ground.destroy();
      ship.mesh.destroy({ children: true });
      asteroidField.destroy();
      shield.destroy();
      hint.destroy();
      background.destroy();
    },
  };
}
