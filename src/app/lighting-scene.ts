import type { Application, Ticker } from 'pixi.js';
import { Assets, Container, Graphics } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { joinBaseUrl } from '../utils/paths';
import { CAMERA_FOLLOW_RATE, createBackground } from './background';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import {
  applyShipImpulse,
  createFlightState,
  dampShipAngularVelocity,
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
import { gForceFromVelocityDelta } from './telemetry-model';
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
import type { ProjectileTuning } from './bullet-math';
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
import { createFractureRock } from './fracture-rock';
import type { FractureDebug } from './fracture-rock';
import {
  DEFAULT_AIM_MODE,
  DEFAULT_WEAPON_MODE,
  toggleWeaponMode,
  turretAimMode,
  weaponHint,
  gamepadHint,
} from './weapon-mode';
import type { AimMode, WeaponMode } from './weapon-mode';
import { createMining } from './mining';
import { createMiningTuning } from './mining-tuning';
import { colliderWorldPoints, resolveShipCollision, shipHull } from './asteroid-collision';
import type { AsteroidCollider, ShipHull, Vec2 } from './asteroid-collision';
import { createAsteroidField } from './asteroid-field';
import { createDock } from './dock';
import { dockAlignment } from './dock-alignment';
import type { DockAlignmentReadout } from './dock-alignment';
import { createDockTuner } from './dock-tuner';
import { DEFAULT_DOCK_TUNING } from './dock-tuning';
import { DEFAULT_ASTEROID_COUNT, generateAsteroidLayout } from './asteroid-layout';
import { createShipShield } from './ship-shield';
import { createInputSystem } from './input-system';
import type { InputSnapshot } from './input-system';
import { aimPointFromStick } from './input-model';
import { headingTurnInput } from './heading-steer';
import { createPlayerHud } from './player-hud';

export interface Scene {
  setMuted(muted: boolean): void;
  /** Read-only collider snapshot for the debug gizmo / agent inspection. */
  getColliders(): readonly AsteroidCollider[];
  /** Debug: weak-point state of the destructible test rock. */
  getFractureDebug(): FractureDebug;
  /** Debug: current mining targets (field rocks plus the exposed core). */
  getMiningTargets(): readonly AsteroidCollider[];
  /** Debug: current ship pose (world metres/radians) for staging screenshots. */
  getShipPose(): { x: number; y: number; rotation: number };
  /** Debug: latest merged input snapshot (keyboard + gamepad + touch). */
  getInputState(): InputSnapshot;
  /** Debug: current eased camera zoom (1 = closest). */
  getCameraZoom(): number;
  /** Debug: stage an extra asteroid at a world-metre position (screenshots/tests). */
  stageAsteroid(x: number, y: number, diameter: number, variant?: number): void;
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
/**
 * World art has a fixed pixel scale, chosen so the ship is ~48% of this
 * reference viewport at zoom 1. Window resizing reveals more/less world; it
 * does not resize the world.
 */
const WORLD_REFERENCE_HEIGHT = 900;
const SHAKE_DECAY_PER_SECOND = 4.5;

/** World-space lighting shared by the lit meshes. */
const lighting: LightingState = {
  ambient: [0.302, 0.329, 0.408],
  keyDirection: [0.7, -0.714],
  keyColor: [1, 0.949, 0.847],
  keyIntensity: 0.95,
  time: 0,
};

/**
 * Asteroids use unlit albedo maps and let the shader light them, so they need a
 * softer contrast than the ship: more ambient, a slightly weaker key.
 */
const asteroidLighting: LightingState = {
  ambient: [0.42, 0.45, 0.52],
  keyDirection: [0.7, -0.714],
  keyColor: [1, 0.949, 0.847],
  keyIntensity: 0.85,
  time: 0,
};

const assetUrl = (path: string): string => joinBaseUrl(import.meta.env.BASE_URL, path);

/**
 * Ship + asteroid lit by a small custom normal-map shader: one directional key
 * light from the top-right. WASD flies the ship; the cyan panels use a baked
 * emissive map plus a blurred glow map.
 */
/** Blender-rendered asteroid variants committed under assets/lighting/generated. */
const GENERATED_ASTEROID_VARIANTS = 8;

export interface SceneLoadProgress {
  loaded: number;
  total: number;
}

export async function createScene(
  app: Application,
  audio: AudioManager,
  onLoadProgress?: (progress: SceneLoadProgress) => void,
): Promise<Scene> {
  const background = createBackground(app);
  const totalTextures = 11 + GENERATED_ASTEROID_VARIANTS * 2;
  let loadedTextures = 0;
  const loadTexture = async (path: string): Promise<Texture> => {
    const texture = await Assets.load<Texture>(path);
    loadedTextures += 1;
    onLoadProgress?.({ loaded: loadedTextures, total: totalTextures });
    return texture;
  };

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
    dockColor,
    dockNormal,
  ] = await Promise.all([
    loadTexture(assetUrl('assets/lighting/ship-color.webp')),
    loadTexture(assetUrl('assets/lighting/ship-normal.webp')),
    loadTexture(assetUrl('assets/lighting/ship-emissive.webp')),
    loadTexture(assetUrl('assets/lighting/ship-glow.webp')),
    loadTexture(assetUrl('assets/lighting/asteroid-color.webp')),
    loadTexture(assetUrl('assets/lighting/asteroid-normal.webp')),
    loadTexture(assetUrl('assets/lighting/asteroid2-color.webp')),
    loadTexture(assetUrl('assets/lighting/asteroid2-normal.webp')),
    loadTexture(assetUrl('assets/lighting/turret.webp')),
    loadTexture(assetUrl('assets/lighting/dock-color.webp')),
    loadTexture(assetUrl('assets/lighting/dock-normal.webp')),
  ]);

  // Eight asteroid sprites baked offline with tools/asteroid-gen. Their colour
  // maps already carry painted lighting; the normal maps are attenuated for the
  // 2D shader and their silhouettes are traced once by the asteroid field.
  const generatedAsteroidVariants = await Promise.all(
    Array.from({ length: GENERATED_ASTEROID_VARIANTS }, (_, index) => {
      const id = String(index + 1).padStart(2, '0');
      return Promise.all([
        loadTexture(assetUrl(`assets/lighting/generated/asteroid-gen-${id}-color.webp`)),
        loadTexture(assetUrl(`assets/lighting/generated/asteroid-gen-${id}-normal.webp`)),
      ]);
    }),
  );

  const content = new Container();
  app.stage.addChild(content);

  const ground = createGroundGrid();
  const dockTuning = { ...DEFAULT_DOCK_TUNING };
  const dock = createDock(dockColor, dockNormal, dockTuning, shipColor);
  const exhaust = createEngineExhaust();
  const engineAudio = createEngineAudio(audio);
  const miningAudio = createMiningAudio(audio);
  const impactAudio = createImpactAudio(audio);
  content.addChild(ground.mesh, dock.container, exhaust.smoke);

  const ship: LitSprite = createLitSprite(shipColor, shipNormal, shipEmissive, shipGlow);
  // Two supplied hand-painted rocks plus the eight Blender variants.
  const asteroidArts = [
    { color: asteroidColor, normal: asteroidNormal },
    { color: asteroid2Color, normal: asteroid2Normal },
    ...generatedAsteroidVariants.map(([color, normal]) => ({ color, normal })),
  ];
  const asteroidField = createAsteroidField(asteroidArts);
  // One authored destructible test rock: shoot the weak point to open the shell.
  const fracture = createFractureRock(asteroidField, {
    x: 13,
    y: -5,
    diameter: 5.2,
    variant: 3,
    weakPointAngle: Math.atan2(5, -13),
  });
  const turrets = createTurrets(turretTexture);
  const bullets = createBullets();
  const projectile: ProjectileTuning = { speedMps: BULLET_SPEED_METERS_PER_SECOND };
  const miningTuning = createMiningTuning();
  const mining = createMining(miningTuning);
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
    fracture.container,
    mining.container,
    colliderGizmo,
  );

  const canvas = app.canvas as HTMLCanvasElement;
  const shipScreen = { x: 0, y: 0 };
  const aimScreen = { x: app.screen.width / 2, y: app.screen.height / 2 };
  /** Collider debug gizmo: hidden for normal play, F2 shows it for tuning. */
  let showColliders = false;

  // Keyboard, mouse, gamepad and touch all feed this one input source.
  const input = createInputSystem({
    canvas,
    getViewport: () => ({ width: app.screen.width, height: app.screen.height }),
    forceTouch: new URLSearchParams(window.location.search).get('touch') === '1',
    onActivity: () => {
      void audio.enable();
    },
  });
  let inputState: InputSnapshot = input.snapshot();

  // Mouse aim fires on click; all-forward fires the whole battery on Space.
  let weaponMode: WeaponMode = DEFAULT_WEAPON_MODE;
  /** Live telemetry state: smoothed/peak g and cumulative shield damage. */
  let currentGForce = 0;
  let maxGForce = 0;
  let shieldDamageJ = 0;
  let aimMode: AimMode = DEFAULT_AIM_MODE;
  // Mining lasers have their own aim mode, so switching guns does not silently
  // change how the rig cuts.
  let miningAimMode: AimMode = DEFAULT_AIM_MODE;
  let aimIsForward = false;
  let soundMuted = false;
  let cargo = 0;
  let bankedCargo = 0;
  let docked = true;
  // A docked ship sits a little lower into the pad, so it reads smaller.
  let shipDockScale = 0.86;
  let dockStatus: 'docked' | 'docking' | 'flying' = 'docked';
  let dockingReadout: DockAlignmentReadout | null = null;
  const gunFiring = (): boolean =>
    aimMode === 'mouse' ? inputState.fire : inputState.fireAll || inputState.fire;
  const miningFiring = (): boolean => inputState.fire || inputState.fireAll;
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
        flight.vx + Math.sin(pose.angle) * projectile.speedMps,
        flight.vy - Math.cos(pose.angle) * projectile.speedMps,
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
        ? clamp((aimScreen.x - shipScreen.x) / Math.max(app.screen.width * 0.35, 1), -0.7, 0.7)
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

  /** Field rocks plus the destructible test rock and its shards/core. */
  const rockColliders = (): readonly AsteroidCollider[] => [
    ...asteroidField.getColliders(),
    ...fracture.getColliders(),
  ];
  const rockMiningTargets = (): readonly AsteroidCollider[] => [
    ...asteroidField.getMiningTargets(),
    ...fracture.getMiningTargets(),
  ];

  const hud = createPlayerHud();
  let devUiVisible = new URLSearchParams(window.location.search).get('dev') === '1';
  document.body.classList.toggle('dev-ui', devUiVisible);
  let lastHintSource = inputState.source;
  let lastDockHintKey = '';
  const dockHint = (action: 'dock' | 'undock'): string => {
    const source = inputState.source;
    if (source === 'gamepad') {
      return action === 'dock' ? 'ALIGNED · D-pad ↓ to dock' : 'DOCKED · D-pad ↓ to undock';
    }
    if (source === 'touch') {
      return action === 'dock' ? 'ALIGNED · Tap DOCK to dock' : 'DOCKED · Tap DOCK to undock';
    }
    return action === 'dock' ? 'ALIGNED · Press Space to dock' : 'DOCKED · Press Space to undock';
  };
  const updateHint = (): void => {
    if (docked) {
      hud.setHint(dockHint('undock'), true);
      return;
    }
    if (dockingReadout?.aligned) {
      hud.setHint(dockHint('dock'), true);
      return;
    }
    hud.setHint(
      inputState.source === 'gamepad'
        ? gamepadHint(weaponMode, aimMode, soundMuted, miningAimMode)
        : weaponHint(weaponMode, aimMode, soundMuted, cargo, mining.getCarryMode(), miningAimMode),
    );
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
  let viewportChanged = false;

  const layout = (): void => {
    const { width, height } = app.screen;
    if (shipPlaced && width === laidOutWidth && height === laidOutHeight) return;
    laidOutWidth = width;
    laidOutHeight = height;
    viewportChanged = true;
    // Fixed world scale: neither width nor height resizes the art. The camera
    // viewport reveals more/less world at zoom 1.
    const shipScale = (WORLD_REFERENCE_HEIGHT * 0.48) / shipColor.height;
    const asteroidScale = (WORLD_REFERENCE_HEIGHT * 0.44) / asteroidColor.width;

    if (!shipPlaced) {
      // The ship's centre of mass is the world origin, so the camera starts
      // there too and the grid axes cross at the ship. The asteroid field is a
      // deterministic scatter around the same origin, keeping the y axis clear.
      flight.x = 0;
      flight.y = 0;
      rockDiameter = (asteroidColor.width * asteroidScale) / PIXELS_PER_METER;
      for (const rock of generateAsteroidLayout({
        count: DEFAULT_ASTEROID_COUNT,
        baseDiameter: rockDiameter,
        variantCount: asteroidArts.length,
      })) {
        asteroidField.add(rock.x, rock.y, rock.diameter, rock.variant);
      }
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
    // Camera lookahead is in fixed world metres; deriving it from the current
    // viewport made resizing shift the whole world around the ship.
    const baseOffsetMeters = (WORLD_REFERENCE_HEIGHT * LOOKAHEAD_BASE_OFFSET) / PIXELS_PER_METER;
    const maxOffsetMeters = (WORLD_REFERENCE_HEIGHT * LOOKAHEAD_MAX_OFFSET) / PIXELS_PER_METER;
    const shipHalfMeters = (shipColor.height * shipBaseScale) / (2 * PIXELS_PER_METER);
    const flameMeters = (FLAME_LOCAL_LENGTH * shipBaseScale) / PIXELS_PER_METER;
    const exhaustRoomMeters = Math.max(
      0,
      WORLD_REFERENCE_HEIGHT / (2 * PIXELS_PER_METER) -
        shipHalfMeters -
        flameMeters -
        90 / PIXELS_PER_METER,
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

    // The grid is a world-space mesh centred on the camera, so its zoom pivot is
    // the camera point and its lines stay locked to the dust/asteroid layer.
    ground.setView(dust.x * width, dust.y * height, dust.zoom, width, height);
    audio.setListenerGain(listenerGainForZoom(dust.zoom));

    const centre = shipCentre();
    const shipWorldX = centre.x * PIXELS_PER_METER;
    const shipWorldY = centre.y * PIXELS_PER_METER;

    const shipScreenX = (shipWorldX - dust.x * width) * dust.zoom + width / 2;
    const shipScreenY = (shipWorldY - dust.y * height) * dust.zoom + height / 2;
    shipScreen.x = shipScreenX;
    shipScreen.y = shipScreenY;

    // Pointer aim is absolute; stick aim is a direction that becomes a point
    // out from the ship. Both end up in turret screen space. Forward aim parks
    // the reticle out along the nose instead.
    const activeAimMode = weaponMode === 'mining' ? miningAimMode : aimMode;
    const aim = inputState.aim;
    const forwardAim = activeAimMode === 'forward';
    aimIsForward = forwardAim;
    if (forwardAim) {
      // Keep the forward reticle on screen rather than off in the distance.
      const reach = Math.min(width, height) * 0.24;
      aimScreen.x = shipScreenX + Math.sin(flight.rotation) * reach;
      aimScreen.y = shipScreenY - Math.cos(flight.rotation) * reach;
    } else if (aim.kind === 'stick') {
      const point = aimPointFromStick(
        shipScreenX,
        shipScreenY,
        aim.x,
        aim.y,
        Math.min(width, height) * 0.45,
      );
      aimScreen.x = point.x;
      aimScreen.y = point.y;
    } else {
      aimScreen.x = aim.x;
      aimScreen.y = aim.y;
    }

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
      shipScale: shipBaseScale * dust.zoom * shipDockScale,
      rotation: flight.rotation,
      mouseX: aimScreen.x,
      mouseY: aimScreen.y,
      mouseActive: inputState.aim.active,
      mode: turretAimMode(weaponMode, aimMode, miningAimMode),
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
      blockers: rockColliders(),
      onHit: (blocker, x, y) => fracture.handleBulletHit(blocker, x, y),
    });

    exhaust.update({
      shipWorldX,
      shipWorldY,
      shipScreenX,
      shipScreenY,
      shipBaseScale,
      shipScale: shipBaseScale * dust.zoom * shipDockScale,
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
      shipScale: shipBaseScale * dust.zoom * shipDockScale,
      width,
      linearInput: flight.linearInput,
      angularInput: flight.angularInput,
      engineMix,
      vx: flight.vx,
      vy: flight.vy,
      terminalSpeed: forwardTerminalSpeed(tuning, shipGeometry),
      dt: deltaSeconds,
    });

    ship.mesh.scale.set(shipBaseScale * dust.zoom * shipDockScale);
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
      scale: shipBaseScale * dust.zoom * shipDockScale,
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
    fracture.update({
      dustX: dust.x,
      dustY: dust.y,
      zoom: dust.zoom,
      width,
      height,
      dt: deltaSeconds,
      now: lighting.time,
    });
    const seat = dock.getSeat();
    dock.update({
      dustX: dust.x,
      dustY: dust.y,
      zoom: dust.zoom,
      width,
      height,
      dt: deltaSeconds,
      shipX: shipCentre().x,
      shipY: shipCentre().y,
      shipRotation: flight.rotation,
      shipScale: shipBaseScale * shipDockScale,
      docked,
      distanceM: Math.hypot(flight.x - seat.x, flight.y - seat.y),
    });
  };

  const updateLighting = (): void => {
    ship.setLighting(lighting);
    asteroidField.setLighting(asteroidLighting);
    fracture.setLighting(asteroidLighting);
    dock.setLighting(asteroidLighting);
  };

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = Math.min(ticker.deltaMS / 1000, MAX_DELTA_SECONDS);
    lighting.time += deltaSeconds;
    asteroidLighting.time = lighting.time;
    shipDockScale += ((docked ? 0.86 : 1) - shipDockScale) * Math.min(1, deltaSeconds * 6);

    input.update();
    inputState = input.snapshot();
    if (inputState.source !== lastHintSource) {
      lastHintSource = inputState.source;
      updateHint();
    }

    // Digital keys, touch sticks and gamepad triggers share the analog ramp.
    // Gamepad steering is heading-based: the left stick points the nose and a
    // PD loop turns the hull toward it; keyboard/touch turn stays direct.
    controls.thrustAxis = inputState.thrust;
    const gamepadTurn = inputState.gamepadHeading.active
      ? headingTurnInput(
          inputState.gamepadHeading.x,
          inputState.gamepadHeading.y,
          flight.rotation,
          flight.angularVelocity,
        )
      : 0;
    controls.turnAxis = inputState.turn !== 0 ? inputState.turn : gamepadTurn;
    controls.stabilize = inputState.stabilize;
    controls.forward = false;
    controls.reverse = false;
    controls.turnLeft = false;
    controls.turnRight = false;

    const dockPressed = input.consumeAction('dock');
    let undockedThisFrame = false;
    if (docked && dockPressed) {
      docked = false;
      undockedThisFrame = true;
      dock.pulse();
      updateHint();
    }
    // A docked ship is clamped to the pad: inputs and residual velocity do
    // nothing until Space releases it.
    if (docked) {
      controls.thrustAxis = 0;
      controls.turnAxis = 0;
      controls.stabilize = false;
      controls.forward = false;
      controls.reverse = false;
      controls.turnLeft = false;
      controls.turnRight = false;
      flight.vx = 0;
      flight.vy = 0;
      flight.angularVelocity = 0;
      impactSpin = 0;
    }

    if (input.consumeAction('toggleDevUi')) {
      devUiVisible = !devUiVisible;
      document.body.classList.toggle('dev-ui', devUiVisible);
    }
    if (input.consumeAction('colliders')) {
      showColliders = !showColliders;
      updateHint();
    }
    if (input.consumeAction('toggleWeapons')) {
      weaponMode = toggleWeaponMode(weaponMode);
      weaponTuner.setMining(weaponMode === 'mining');
      updateHint();
    }
    if (input.consumeAction('aimMouse')) {
      if (weaponMode === 'mining') miningAimMode = 'mouse';
      else aimMode = 'mouse';
      updateHint();
    }
    if (input.consumeAction('aimForward')) {
      if (weaponMode === 'mining') miningAimMode = 'forward';
      else aimMode = 'forward';
      updateHint();
    }
    if (input.consumeAction('aimCycle')) {
      if (weaponMode === 'mining') {
        miningAimMode = miningAimMode === 'mouse' ? 'forward' : 'mouse';
      } else {
        aimMode = aimMode === 'mouse' ? 'forward' : 'mouse';
      }
      updateHint();
    }
    if (input.consumeAction('carryMode') && weaponMode === 'mining') {
      mining.toggleCarryMode();
      updateHint();
    }
    if (input.consumeAction('mute')) {
      soundMuted = audio.toggleMute();
      updateHint();
    }
    const zoom = input.consumeZoom();
    if (zoom !== 1) background.zoomBy(zoom);

    const previousVx = flight.vx;
    const previousVy = flight.vy;

    engineMix = stepFlight(flight, controls, deltaSeconds, tuning, shipGeometry);
    // Collision spin is not player input: bleed it off so a hit cannot leave
    // the ship turning forever (the flight model only damps while input is on).
    const spinDecay = Math.exp(-IMPACT_SPIN_DAMPING * deltaSeconds);
    const spinRemaining = impactSpin * spinDecay;
    dampShipAngularVelocity(flight, impactSpin - spinRemaining);
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
      let impulseX = 0;
      let impulseY = 0;
      let angularImpulse = 0;
      for (const rock of rockColliders()) {
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
        impulseX += collision.impulseX;
        impulseY += collision.impulseY;
        angularImpulse += collision.angularImpulse;
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
        // Depenetration moves the hull out of the rock; the velocity change is
        // applied through the flight physics layer as a real impulse, never by
        // writing flight velocities directly from the collision solver.
        flight.x = pose.x - pivotAft * Math.sin(flight.rotation);
        flight.y = pose.y + pivotAft * Math.cos(flight.rotation);
        applyShipImpulse(flight, tuning, shipGeometry, impulseX, impulseY, angularImpulse);
        impactSpin = clamp(
          impactSpin + (flight.angularVelocity - previousAngular),
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
    shieldDamageJ += impactEnergy;
    const frameG = gForceFromVelocityDelta(
      flight.vx - previousVx,
      flight.vy - previousVy,
      deltaSeconds,
    );
    maxGForce = Math.max(maxGForce, frameG);
    currentGForce += (frameG - currentGForce) * Math.min(1, deltaSeconds * 12);
    telemetry.update();
    followCamera(viewportChanged);
    viewportChanged = false;
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
      asteroids: rockMiningTargets(),
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
    let mined = mining.getCargo();
    const shipSpeed = Math.hypot(flight.vx, flight.vy);
    const seat = dock.getSeat();
    const alignment = dockAlignment({
      // Alignment is measured at the flight body's centre of mass, which is
      // what the dock seat is defined against. Using the texture centre here
      // adds the ~1.4 m aft art offset and reads as false misalignment.
      shipX: flight.x,
      shipY: flight.y,
      shipRotation: flight.rotation,
      speedMps: shipSpeed,
      targetX: seat.x,
      targetY: seat.y,
      targetRotationRad: seat.rotation,
    });
    const inApproach = alignment.distanceM <= dock.getApproachRangeM();
    if (!docked && !undockedThisFrame && dockPressed && inApproach && alignment.aligned) {
      docked = true;
      flight.vx = 0;
      flight.vy = 0;
      flight.angularVelocity = 0;
      impactSpin = 0;
      dock.pulse();
      updateHint();
    }
    const dockingActive = !docked && inApproach;
    dockingReadout = dockingActive ? alignment : null;
    dockStatus = docked ? 'docked' : dockingActive ? 'docking' : 'flying';
    const dockHintKey = docked ? 'docked' : dockingReadout?.aligned ? 'aligned' : '';
    if (dockHintKey !== lastDockHintKey) {
      lastDockHintKey = dockHintKey;
      updateHint();
    }
    if (docked && mined > 0) {
      bankedCargo += mining.unloadCargo();
      mined = 0;
      dock.pulse();
    }
    if (mined > cargo) miningAudio.cargoDelivered();
    if (mined !== cargo) {
      cargo = mined;
      updateHint();
    }
    hud.update({
      mode: weaponMode,
      cargo,
      banked: bankedCargo,
      dockStatus,
      docking: dockingReadout
        ? {
            distanceM: dockingReadout.distanceM,
            headingDeg: (dockingReadout.headingErrorRad * 180) / Math.PI,
            speedMps: dockingReadout.speedMps,
            speedThresholdMps: 0.15,
            positionScore: dockingReadout.positionScore,
            headingScore: dockingReadout.headingScore,
            speedScore: dockingReadout.speedScore,
            aligned: dockingReadout.aligned,
          }
        : null,
      laserHeat: mining.getLaserHeat(),
      laserFocused: mining.getLaserFocus(),
      aim: {
        ...aimScreen,
        active: aimIsForward || inputState.aim.active,
        kind: inputState.aim.kind,
      },
      firing: inputState.fire || inputState.fireAll,
      touch: inputState.touchVisible,
    });
    miningAudio.update({
      dt: deltaSeconds,
      laserBeams: mining.getLaserBeamCount(),
      tractorBeams: mining.getTractorBeamCount(),
      laserHeat: mining.getLaserHeat(),
      laserFocused: mining.getLaserFocus(),
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
      for (const rock of rockColliders()) {
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

  const flightTuner = createFlightTuner(tuning);
  document.body.append(flightTuner.element);

  const weaponTuner = createWeaponTuner(weaponCooldowns, miningTuning, projectile);
  weaponTuner.setMining(weaponMode === 'mining');
  document.body.append(weaponTuner.element);
  const dockTuner = createDockTuner(dockTuning);
  document.body.append(dockTuner.element);

  const telemetry = createFlightTelemetry(flight, tuning, () => shipGeometry, {
    cargoHeld: () => mining.getCargo(),
    gForce: () => currentGForce,
    maxGForce: () => maxGForce,
    shieldDamageJ: () => shieldDamageJ,
  });
  document.body.append(telemetry.element);

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
      return rockColliders();
    },
    getFractureDebug(): FractureDebug {
      return fracture.getDebug();
    },
    getMiningTargets(): readonly AsteroidCollider[] {
      return rockMiningTargets();
    },
    getShipPose(): { x: number; y: number; rotation: number } {
      return { x: flight.x, y: flight.y, rotation: flight.rotation };
    },
    getInputState(): InputSnapshot {
      return input.snapshot();
    },
    getCameraZoom(): number {
      return background.getDustTransform().zoom;
    },
    stageAsteroid(x: number, y: number, diameter: number, variant?: number): void {
      asteroidField.add(x, y, diameter, variant);
    },
    destroy(): void {
      app.ticker.remove(tick);
      input.destroy();
      flightTuner.destroy();
      weaponTuner.destroy();
      dockTuner.destroy();
      telemetry.destroy();
      hud.destroy();
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
      dock.destroy();
      fracture.destroy();
      shield.destroy();
      background.destroy();
    },
  };
}
