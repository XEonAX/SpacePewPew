import { describe, expect, it } from 'vitest';
import {
  fitClosedPolygon,
  maxDeviation,
  maxSymmetricDeviation,
  simplifyClosedPolygon,
} from '../src/app/polygon-fit';
import type { Vec2 } from '../src/app/polygon-fit';

const square: Vec2[] = [
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 10, y: 10 },
  { x: 5, y: 10 },
  { x: 0, y: 10 },
  { x: 0, y: 5 },
];

describe('closed polygon simplification', () => {
  it('drops collinear samples down to the corners', () => {
    const simplified = simplifyClosedPolygon(square, 0.01);
    expect(simplified).toHaveLength(4);
    expect(simplified).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    );
  });

  it('keeps the outline closed with unique vertices', () => {
    const simplified = simplifyClosedPolygon(square, 0.01);
    expect(simplified[0]).not.toEqual(simplified[simplified.length - 1]);
  });

  it('keeps more detail at a smaller tolerance', () => {
    const circle = Array.from({ length: 128 }, (_, index) => {
      const angle = (index / 128) * Math.PI * 2;
      return { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 };
    });
    const coarse = simplifyClosedPolygon(circle, 1.5);
    const fine = simplifyClosedPolygon(circle, 0.2);
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(maxDeviation(circle, fine)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('reports zero deviation when nothing is removed', () => {
    expect(maxDeviation(square, square)).toBeCloseTo(0);
    expect(maxSymmetricDeviation(square, square)).toBeCloseTo(0);
  });
});

describe('fitting to a vertex budget', () => {
  it('caps vertices and stays within a small fraction of the radius', () => {
    const circle = Array.from({ length: 128 }, (_, index) => {
      const angle = (index / 128) * Math.PI * 2;
      return { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 };
    });
    const fitted = fitClosedPolygon(circle, { maxVertices: 16, tolerance: 0.2 });
    expect(fitted.points.length).toBeLessThanOrEqual(16);
    expect(fitted.points.length).toBeGreaterThanOrEqual(3);
    // A 16-gon on a 10 m circle falls short by R(1 - cos(pi/16)) ≈ 0.19 m.
    expect(maxDeviation(circle, fitted.points)).toBeLessThan(0.3);
    expect(maxSymmetricDeviation(circle, fitted.points)).toBeLessThan(0.3);
  });

  it('does not simplify below a triangle', () => {
    const fitted = fitClosedPolygon(square, { maxVertices: 2, tolerance: 100 });
    expect(fitted.points.length).toBeGreaterThanOrEqual(3);
  });
});
