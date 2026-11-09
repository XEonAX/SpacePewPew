/** A circular landing/unloading zone around the dock's central pad. */
export interface DockZone {
  x: number;
  y: number;
  radiusM: number;
}

/** True while the ship's centre is over the pad and it is slow enough to dock. */
export function isInDockZone(
  shipX: number,
  shipY: number,
  speedMps: number,
  zone: DockZone,
  maxDockSpeedMps = 2,
): boolean {
  if (speedMps > maxDockSpeedMps) return false;
  return Math.hypot(shipX - zone.x, shipY - zone.y) <= zone.radiusM;
}
