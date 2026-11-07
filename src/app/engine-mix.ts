export interface EngineMix {
  /** Left, center, right main engines. */
  main: [number, number, number];
  /** Left, right reverse engines. */
  reverse: [number, number];
}

/**
 * Per-group scale for the turn couple. The couple pushes forward on one side
 * and aft on the other; the pair must be equal in force, so the stronger
 * thruster is throttled down to what the weaker one can deliver.
 */
export interface EngineTurnBalance {
  main: number;
  reverse: number;
}

/** No throttling: both thruster groups deliver the same thrust. */
export const FULL_TURN_BALANCE: EngineTurnBalance = { main: 1, reverse: 1 };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * The force each side of a turn can deliver is the weaker engine's thrust. A
 * turn must never translate, so the stronger group is scaled down to match:
 * scale = pairThrust / groupThrust.
 */
export function turnThrustBalance(mainThrustN: number, reverseThrustN: number): EngineTurnBalance {
  const main = Math.max(mainThrustN, 0.001);
  const reverse = Math.max(reverseThrustN, 0.001);
  const pair = Math.min(main, reverse);
  return { main: pair / main, reverse: pair / reverse };
}

/**
 * Mix engine output from ramped inputs.
 *
 * - W lights all three main engines.
 * - S lights both reverse engines.
 * - Turning left adds the left reverse + right main and cuts the left main.
 * - Turning right mirrors that.
 *
 * `turnBalance` scales the turn-only component so the yaw couple is
 * force-balanced even when the engine groups have different thrust. It does
 * not touch the throttle component: braking and thrust remain the groups' own
 * thrust.
 */
export function computeEngineOutputs(
  linearInput: number,
  angularInput: number,
  turnBalance: EngineTurnBalance = FULL_TURN_BALANCE,
): EngineMix {
  const forward = clamp01(linearInput);
  const reverse = clamp01(-linearInput);
  const turnLeft = clamp01(-angularInput);
  const turnRight = clamp01(angularInput);

  return {
    main: [
      Math.max(forward * (1 - turnLeft), turnRight * turnBalance.main),
      forward,
      Math.max(forward * (1 - turnRight), turnLeft * turnBalance.main),
    ],
    reverse: [
      Math.max(reverse, turnLeft * turnBalance.reverse),
      Math.max(reverse, turnRight * turnBalance.reverse),
    ],
  };
}
