import { describe, expect, it } from 'vitest';
import {
  STARFIELD_SEED,
  advanceDust,
  advanceLayerPan,
  advanceStars,
  dustAlpha,
  generateDust,
  generateStars,
  projectStar,
  starAlpha,
  wrapField,
} from '../src/app/starfield-model';
import type { Star } from '../src/app/starfield-model';

const viewport = { width: 100, height: 200 };

function fixedStar(overrides: Partial<Star> = {}): Star {
  return {
    x: 0,
    y: 0,
    radius: 1,
    alpha: 1,
    tint: 0xffffff,
    phase: 0,
    twinkleSpeed: 1,
    parallax: 1,
    zoomResponse: 1,
    drift: 0.01,
    ...overrides,
  };
}

describe('wrapField', () => {
  it('wraps values into [-1, 1)', () => {
    expect(wrapField(0.25)).toBe(0.25);
    expect(wrapField(-0.25)).toBeCloseTo(-0.25);
    expect(wrapField(1.25)).toBeCloseTo(-0.75);
    expect(wrapField(-1.5)).toBeCloseTo(0.5);
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
      expect(star.x).toBeGreaterThanOrEqual(-1);
      expect(star.x).toBeLessThan(1);
      expect(star.y).toBeGreaterThanOrEqual(-1);
      expect(star.y).toBeLessThan(1);
      expect(star.radius).toBeGreaterThan(0);
      expect(star.alpha).toBeGreaterThan(0);
      expect(star.alpha).toBeLessThanOrEqual(1);
      expect(star.parallax).toBeGreaterThan(0);
      expect(star.zoomResponse).toBeGreaterThanOrEqual(0);
      expect(star.zoomResponse).toBeLessThanOrEqual(1);
      expect(star.drift).toBeGreaterThan(0);
    }
  });
});

describe('advanceStars', () => {
  it('moves stars downward and wraps them', () => {
    const stars = [fixedStar({ y: 0.9, drift: 0.5 })];
    advanceStars(stars, 1);

    expect(stars[0]!.y).toBeCloseTo(-0.6);
  });

  it('is deterministic', () => {
    const first = generateStars(3);
    const second = generateStars(3);

    advanceStars(first, 2.5);
    advanceStars(second, 2.5);

    expect(first).toEqual(second);
  });
});

describe('generateDust', () => {
  it('is deterministic for the same seed', () => {
    expect(generateDust(STARFIELD_SEED)).toEqual(generateDust(STARFIELD_SEED));
  });

  it('produces valid motes', () => {
    for (const mote of generateDust(STARFIELD_SEED)) {
      expect(mote.x).toBeGreaterThanOrEqual(-1);
      expect(mote.x).toBeLessThan(1);
      expect(mote.y).toBeGreaterThanOrEqual(-1);
      expect(mote.y).toBeLessThan(1);
      expect(mote.radius).toBeGreaterThan(0);
      expect(mote.alpha).toBeGreaterThan(0);
      expect(mote.alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe('advanceDust', () => {
  it('drifts and wraps motes', () => {
    const motes = [{ ...generateDust(1)[0]!, y: 0.99, drift: 0.5 }];
    advanceDust(motes, 1);

    expect(motes[0]!.y).toBeCloseTo(-0.51);
  });
});

describe('projectStar', () => {
  it('centers the origin in the viewport', () => {
    expect(projectStar(fixedStar(), { x: 0, y: 0 }, viewport)).toEqual({ x: 50, y: 100 });
  });

  it('maps field coordinates into the viewport', () => {
    expect(projectStar(fixedStar({ x: 0.25, y: -0.25 }), { x: 0, y: 0 }, viewport)).toEqual({
      x: 75,
      y: 50,
    });
  });

  it('applies the layer pan', () => {
    const star = fixedStar();
    expect(projectStar(star, { x: 0.25, y: 0.25 }, viewport)).toEqual({
      x: 25,
      y: 50,
    });
  });

  it('applies zoom around the viewport center', () => {
    const star = fixedStar({ x: 0.25, y: -0.25 });
    expect(projectStar(star, { x: 0, y: 0 }, viewport, 2)).toEqual({
      x: 100,
      y: 0,
    });
  });

  it('keeps the far sky fixed when zooming', () => {
    const star = fixedStar({ x: 0.25, y: -0.25, zoomResponse: 0 });
    const pan = { x: 0.4, y: -0.6 };
    expect(projectStar(star, pan, viewport, 8)).toEqual(projectStar(star, pan, viewport, 1));
  });

  it('does not translate when zooming after a long flight', () => {
    // Regression: the old camera × parallax × zoom form slid every layer by
    // camera × parallax × Δzoom, which after a few hundred metres of flight
    // moved the whole sky many screen heights per wheel notch.
    const star = fixedStar({ x: 0.1, y: -0.2, zoomResponse: 0.25 });
    const pan = { x: 100, y: -310 };
    const wide = projectStar(star, pan, viewport, 1);
    const zoomed = projectStar(star, pan, viewport, 0.2);
    const scaleRatio = 1 + (0.2 - 1) * 0.25;

    expect(zoomed.x - viewport.width / 2).toBeCloseTo(
      (wide.x - viewport.width / 2) * scaleRatio,
      6,
    );
    expect(zoomed.y - viewport.height / 2).toBeCloseTo(
      (wide.y - viewport.height / 2) * scaleRatio,
      6,
    );
  });
});

describe('advanceLayerPan', () => {
  it('pans the screen at parallax × zoom × camera distance', () => {
    const star = fixedStar({ parallax: 1, zoomResponse: 0.5 });
    const pan = { x: 0, y: 0 };
    const start = projectStar(star, pan, viewport, 0.5);

    advanceLayerPan(pan, { x: 0.1, y: 0 }, 1, 0.5, 0.5);

    const panned = projectStar(star, pan, viewport, 0.5);
    // Screen pan = parallax × zoom × viewport width × camera distance.
    expect(start.x - panned.x).toBeCloseTo(5, 6);
  });

  it('leaves the accumulated pan untouched when the camera is still', () => {
    const pan = { x: 12.5, y: -31.2 };
    const before = { ...pan };

    advanceLayerPan(pan, { x: 0, y: 0 }, 0.5, 0.2, 0.25);

    expect(pan).toEqual(before);
  });
});

describe('wrap bounds', () => {
  it('keeps projections inside the field bounds for any camera position', () => {
    const star = fixedStar();
    const projected = projectStar(star, { x: -12_345.6, y: 78_901.2 }, viewport);

    expect(projected.x).toBeGreaterThanOrEqual(-viewport.width / 2);
    expect(projected.x).toBeLessThan(viewport.width * 1.5);
    expect(projected.y).toBeGreaterThanOrEqual(-viewport.height / 2);
    expect(projected.y).toBeLessThan(viewport.height * 1.5);
  });
});

describe('alpha helpers', () => {
  it('keep star alpha within [0, 1]', () => {
    const star = fixedStar();

    for (const time of [0, 0.5, 1.5, 20]) {
      const alpha = starAlpha(star, time);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });

  it('twinkles stars over time', () => {
    const star = fixedStar();
    expect(starAlpha(star, 0)).not.toBeCloseTo(starAlpha(star, 0.8), 5);
  });

  it('keep dust alpha within [0, 1]', () => {
    const [mote] = generateDust(1);
    expect(mote).toBeDefined();

    for (const time of [0, 0.5, 1.5, 20]) {
      const alpha = dustAlpha(mote!, time);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });
});
