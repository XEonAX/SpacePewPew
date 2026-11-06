export type Rng = () => number;

/**
 * Small deterministic PRNG (mulberry32) used to generate procedural content.
 * The same seed always produces the same sequence.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function randomRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function pickOne<T>(rng: Rng, values: readonly T[]): T {
  const first = values[0];
  if (first === undefined) {
    throw new Error('pickOne requires at least one value');
  }

  const index = Math.min(values.length - 1, Math.floor(rng() * values.length));
  return values[index] ?? first;
}
