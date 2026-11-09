import { Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { DEFAULT_DOCK_TUNING } from './dock-tuning';
import type { DockTuning } from './dock-tuning';
import { createLitSprite } from './lit-sprite';
import type { LightingState } from './lit-sprite';
import { PIXELS_PER_METER } from './world-scale';

const DOCK_PAD_RADIUS_M = 5;
/** The rear seat target is this far behind the pad centre. */
const DOCK_SEAT_OFFSET_M = 2;
const DOCK_APPROACH_RANGE_M = 9;
/** The station recedes by scaling down, then rises back up on approach. */
const DOCK_MAX_RECEDE_SCALE = 0.32;
/** How far the fake shadow slides away as the ship gains altitude. */
const DOCK_SHADOW_OFFSET_M = 1.5;

export interface DockFrame {
  dustX: number;
  dustY: number;
  zoom: number;
  width: number;
  height: number;
  dt: number;
  /** Ship texture-centre pose and scale, used for the fake pad shadow. */
  shipX: number;
  shipY: number;
  shipRotation: number;
  shipScale: number;
  docked: boolean;
  distanceM: number;
}

export interface Dock {
  container: Container;
  update(frame: DockFrame): void;
  setLighting(state: LightingState): void;
  /** The docking target, offset toward the rear seat of the pad. */
  getSeat(): { x: number; y: number; rotation: number };
  /** Outer radius in metres at which the alignment HUD appears. */
  getApproachRangeM(): number;
  /** Flash the pad after a cargo transfer. */
  pulse(): void;
  destroy(): void;
}

export function createDock(
  color: Texture,
  normal: Texture,
  tuning: DockTuning = DEFAULT_DOCK_TUNING,
  shipColor: Texture,
): Dock {
  const container = new Container();
  container.name = 'dock';
  const sprite = createLitSprite(color, normal);
  const shadow = new Sprite(shipColor);
  shadow.anchor.set(0.5);
  shadow.tint = 0x04070d;
  const landingRing = new Graphics();
  container.addChild(sprite.mesh, shadow, landingRing);

  const zone = { x: 0, y: 0, radiusM: DOCK_PAD_RADIUS_M };
  let pulse = 0;
  let recede = 0;
  const worldToScreen = (x: number, y: number, frame: DockFrame): { x: number; y: number } => ({
    x: (x * PIXELS_PER_METER - frame.dustX * frame.width) * frame.zoom + frame.width / 2,
    y: (y * PIXELS_PER_METER - frame.dustY * frame.height) * frame.zoom + frame.height / 2,
  });

  return {
    container,
    update(frame: DockFrame): void {
      zone.x = tuning.xM;
      zone.y = tuning.yM;
      zone.radiusM = DOCK_PAD_RADIUS_M * (tuning.heightM / DEFAULT_DOCK_TUNING.heightM);
      // With no Z axis, fake the station's distance by scaling it: it recedes
      // on takeoff and grows back as the ship lines up to land.
      const recedeTarget = frame.docked ? 0 : Math.min(1, frame.distanceM / DOCK_APPROACH_RANGE_M);
      recede += (recedeTarget - recede) * Math.min(1, frame.dt * 3.5);
      const visualY = tuning.yM;
      const recedeScale = 1 - recede * DOCK_MAX_RECEDE_SCALE;
      const scale = (tuning.heightM * PIXELS_PER_METER) / color.height;
      sprite.mesh.scale.set(scale * frame.zoom * recedeScale);
      sprite.mesh.alpha = 1 - recede * 0.22;
      const dockScreen = worldToScreen(tuning.xM, visualY, frame);
      sprite.mesh.position.set(dockScreen.x, dockScreen.y);

      // Fake pad shadow: it stays on the seat, fades and spreads as the ship
      // climbs away, and tightens under the hull when docked.
      const seat = { x: tuning.xM, y: visualY + DOCK_SEAT_OFFSET_M };
      const height = frame.docked
        ? 0
        : Math.min(1, frame.distanceM / Math.max(1, DOCK_APPROACH_RANGE_M));
      // Light is up-left, so a climbing ship throws its shadow down-right.
      const shadowScreen = worldToScreen(
        seat.x + height * DOCK_SHADOW_OFFSET_M,
        seat.y + height * DOCK_SHADOW_OFFSET_M * 0.85,
        frame,
      );
      shadow.position.set(shadowScreen.x, shadowScreen.y);
      shadow.rotation = frame.docked ? frame.shipRotation : 0;
      shadow.scale.set(
        frame.shipScale * frame.zoom * recedeScale * (frame.docked ? 1 : 1 + height * 0.32),
      );
      shadow.alpha = frame.docked ? 0.5 : Math.max(0.08, 0.38 - height * 0.3);

      pulse = Math.max(0, pulse - frame.dt * 1.8);
      landingRing.clear();
      if (pulse > 0) {
        const ringPoint = worldToScreen(tuning.xM, visualY, frame);
        const radius =
          zone.radiusM * PIXELS_PER_METER * frame.zoom * recedeScale * (1.1 + (1 - pulse));
        landingRing
          .circle(ringPoint.x, ringPoint.y, radius)
          .stroke({ color: 0xffc15c, width: 3, alpha: 0.7 * pulse });
      }
    },
    setLighting(state: LightingState): void {
      sprite.setLighting(state);
    },
    getSeat(): { x: number; y: number; rotation: number } {
      return { x: tuning.xM, y: tuning.yM + DOCK_SEAT_OFFSET_M, rotation: 0 };
    },
    getApproachRangeM(): number {
      return DOCK_APPROACH_RANGE_M;
    },
    pulse(): void {
      pulse = 1;
    },
    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
