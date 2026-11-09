/** Pure docking alignment readout shared by the dock rules and the HUD. */
export interface DockAlignmentInput {
  shipX: number;
  shipY: number;
  shipRotation: number;
  speedMps: number;
  targetX: number;
  targetY: number;
  targetRotationRad: number;
  positionThresholdM?: number;
  headingThresholdRad?: number;
  speedThresholdMps?: number;
}

export interface DockAlignmentReadout {
  distanceM: number;
  headingErrorRad: number;
  speedMps: number;
  positionScore: number;
  headingScore: number;
  speedScore: number;
  aligned: boolean;
}

const DEFAULT_POSITION_THRESHOLD_M = 1.5;
const DEFAULT_HEADING_THRESHOLD_RAD = (10 * Math.PI) / 180;
const DEFAULT_SPEED_THRESHOLD_MPS = 0.15;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Shortest signed angle, in [-π, π]. */
export function normalizeAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

/**
 * Scores each alignment axis on a 0..1 "how close to perfect" scale. `aligned`
 * is deliberately all-or-nothing: every axis must be inside its threshold.
 */
export function dockAlignment(input: DockAlignmentInput): DockAlignmentReadout {
  const distanceM = Math.hypot(input.shipX - input.targetX, input.shipY - input.targetY);
  const headingErrorRad = Math.abs(normalizeAngle(input.shipRotation - input.targetRotationRad));
  const speedMps = Math.max(0, input.speedMps);
  const positionThreshold = input.positionThresholdM ?? DEFAULT_POSITION_THRESHOLD_M;
  const headingThreshold = input.headingThresholdRad ?? DEFAULT_HEADING_THRESHOLD_RAD;
  const speedThreshold = input.speedThresholdMps ?? DEFAULT_SPEED_THRESHOLD_MPS;

  return {
    distanceM,
    headingErrorRad,
    speedMps,
    // The bars show useful movement before the strict threshold is reached.
    positionScore: clamp01(1 - distanceM / Math.max(6, positionThreshold * 3)),
    headingScore: clamp01(
      1 - headingErrorRad / Math.max((45 * Math.PI) / 180, headingThreshold * 3),
    ),
    speedScore: clamp01(1 - speedMps / Math.max(6, speedThreshold * 3)),
    aligned:
      distanceM <= positionThreshold &&
      headingErrorRad <= headingThreshold &&
      speedMps <= speedThreshold,
  };
}
