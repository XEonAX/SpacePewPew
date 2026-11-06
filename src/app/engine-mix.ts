export interface EngineMix {
  /** Left, center, right main engines. */
  main: [number, number, number];
  /** Left, right reverse engines. */
  reverse: [number, number];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Mix engine output from ramped inputs.
 *
 * - W lights all three main engines.
 * - S lights both reverse engines.
 * - Turning left adds the left reverse + right main and cuts the left main.
 * - Turning right mirrors that.
 */
export function computeEngineOutputs(linearInput: number, angularInput: number): EngineMix {
  const forward = clamp01(linearInput);
  const reverse = clamp01(-linearInput);
  const turnLeft = clamp01(-angularInput);
  const turnRight = clamp01(angularInput);

  return {
    main: [
      Math.max(forward * (1 - turnLeft), turnRight),
      forward,
      Math.max(forward * (1 - turnRight), turnLeft),
    ],
    reverse: [Math.max(reverse, turnLeft), Math.max(reverse, turnRight)],
  };
}
