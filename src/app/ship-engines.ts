/**
 * The ship's drive as a set of force sources: every nozzle pushes along its
 * own axis at a position relative to the centre of mass, so a differential
 * throttle produces yaw as real torque instead of a scripted angular accel.
 *
 * Positions and directions are body-frame metres, with y down (the ship's nose
 * is -y). The art gives nozzle positions in ship-texture px, measured from the
 * texture centre; the centre of mass is aft of that, so the layout is shifted
 * by `SHIP_COM_AFT_PX` before scaling into metres.
 */
import { MAIN_ENGINE_LAYOUT, REVERSE_ENGINE_LAYOUT } from './engine-layout';

/** Physics centre of mass: the orange panel aft of the cargo hatch, texture px from the centre. */
export const SHIP_COM_AFT_PX = 171.5;

export type EngineGroup = 'main' | 'reverse';

export interface EngineMount {
  group: EngineGroup;
  /** Index within the group, matching the `EngineMix` output order. */
  index: number;
  /** Nozzle position relative to the centre of mass, body metres (y down). */
  x: number;
  y: number;
  /** Thrust direction in the body frame. Mains push the nose forward (-y). */
  dirX: number;
  dirY: number;
}

export interface ShipGeometry {
  engines: readonly EngineMount[];
  /** Radius of gyration about the centre of mass, metres (≈ 0.3 × hull length). */
  radiusOfGyrationM: number;
}

export interface ShipGeometrySpec {
  /** Ship-texture px to world metres (the current layout scale). */
  metresPerPixel: number;
  /** Hull length in metres; sets the moment of inertia. */
  hullLengthM: number;
}

/**
 * Build the drive geometry for the current ship scale. The nozzles come from
 * the baked engine layout so the force application points match the art.
 */
export function createShipGeometry({
  metresPerPixel,
  hullLengthM,
}: ShipGeometrySpec): ShipGeometry {
  const mainY = (MAIN_ENGINE_LAYOUT.yOffset - SHIP_COM_AFT_PX) * metresPerPixel;
  const reverseY = (REVERSE_ENGINE_LAYOUT.flameBaseY - SHIP_COM_AFT_PX) * metresPerPixel;

  const mains: EngineMount[] = MAIN_ENGINE_LAYOUT.xOffsets.map((xOffset, index) => ({
    group: 'main',
    index,
    x: xOffset * metresPerPixel,
    y: mainY,
    dirX: 0,
    dirY: -1,
  }));

  const reverses: EngineMount[] = REVERSE_ENGINE_LAYOUT.xOffsets.map((xOffset, index) => ({
    group: 'reverse',
    index,
    x: xOffset * metresPerPixel,
    y: reverseY,
    // Thrust reversers point aft, so they push the ship forward along +y.
    dirX: 0,
    dirY: 1,
  }));

  return { engines: [...mains, ...reverses], radiusOfGyrationM: 0.3 * hullLengthM };
}
