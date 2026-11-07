export const BULLET_RANGE_METERS = 300;
export const BULLET_FADE_METERS = 50;
export const BULLET_SPEED_METERS_PER_SECOND = 55;

/** Alpha over travelled distance: 1 until the fade window, then fades to 0. */
export function bulletAlpha(distanceMeters: number): number {
  if (distanceMeters >= BULLET_RANGE_METERS) return 0;
  const fadeStart = BULLET_RANGE_METERS - BULLET_FADE_METERS;
  if (distanceMeters <= fadeStart) return 1;
  return (BULLET_RANGE_METERS - distanceMeters) / BULLET_FADE_METERS;
}
