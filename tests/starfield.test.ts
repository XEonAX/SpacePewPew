import { describe, expect, it } from 'vitest';
import {
  STARFIELD_SEED,
  advanceStars,
  generateStars,
  projectStar,
  starAlpha,
  wrap01,
} from '../src/app/starfield-model';
import type { Star } from '../src/app/starfield-model';

const viewport = { width: 100, height: 200 };

function fixedStar(overrides: Partial<Star> = {}): Star {
  return {
    x: 0.5,
    y: 0.5,
    radius: 1,
    alpha: 1,
    tint: 0xffffff,
    phase: 0,
    twinkleSpeed: 1,
    parallax: 1,
    drift: 0.01,
    ...overrides,
  };
}

describe('wrap01', () => {
  it('wraps values into [0, 1)', () => {
    expect(wrap01(0.25)).toBe(0.25);
    expect(wrap01(1.25)).toBeCloseTo(0.25);
    expect(wrap01(-0.25)).toBeCloseTo(0.75);
    expect(wrap01(-3.5)).toBeCloseTo(0.5);
  });
});

describe('generateStars', () => {
  it('is deterministic for the same seed', () => {
    expect(generateStars(STARFIELD_SEED)).toEqual(generateStars(STARFIELD_SEED));
  });

  it('changes with the seed', () => {
    expect(generateStars(1)).not.toEqual(generateStars(2));
  });

  it('produces valid stars', () => {
    for (const star of generateStars(STARFIELD_SEED)) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(1);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(1);
      expect(star.radius).toBeGreaterThan(0);
      expect(star.alpha).toBeGreaterThan(0);
      expect(star.alpha).toBeLessThanOrEqual(1);
      expect(star.parallax).toBeGreaterThan(0);
      expect(star.drift).toBeGreaterThan(0);
    }
  });
});

describe('advanceStars', () => {
  it('moves stars downward and wraps them', () => {
    const stars = [fixedStar({ y: 0.9, drift: 0.5 })];
    advanceStars(stars, 1);

    expect(stars[0]!.y).toBeCloseTo(0.4);
  });

  it('is deterministic', () => {
    const first = generateStars(3);
    const second = generateStars(3);

    advanceStars(first, 2.5);
    advanceStars(second, 2.5);

    expect(first).toEqual(second);
  });
});

describe('projectStar', () => {
  it('maps field coordinates into the viewport', () => {
    expect(projectStar(fixedStar(), { x: 0, y: 0 }, viewport)).toEqual({ x: 50, y: 100 });
  });

  it('applies camera parallax', () => {
    const star = fixedStar({ parallax: 0.5 });
    expect(projectStar(star, { x: 0.25, y: 0.25 }, viewport)).toEqual({
      x: 37.5,
      y: 75,
    });
  });

  it('keeps projecting inside the viewport for any camera position', () => {
    const star = fixedStar();
    const projected = projectStar(star, { x: -12_345.6, y: 78_901.2 }, viewport);

    expect(projected.x).toBeGreaterThanOrEqual(0);
    expect(projected.x).toBeLessThan(viewport.width);
    expect(projected.y).toBeGreaterThanOrEqual(0);
    expect(projected.y).toBeLessThan(viewport.height);
  });
});

describe('starAlpha', () => {
  it('stays within [0, 1]', () => {
    const star = fixedStar();

    for (const time of [0, 0.5, 1.5, 20]) {
      const alpha = starAlpha(star, time);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });

  it('twinkles over time', () => {
    const star = fixedStar();
    expect(starAlpha(star, 0)).not.toBeCloseTo(starAlpha(star, 0.8), 5);
  });
});
