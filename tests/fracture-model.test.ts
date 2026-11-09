import { describe, expect, it } from 'vitest';
import {
  convexHull,
  planFragments,
  planPieCut,
  planPolylineCut,
  planWedgeCut,
} from '../src/app/fracture-model';

const square = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

describe('convexHull', () => {
  it('drops interior points and returns the enclosing outline', () => {
    const hull = convexHull([...square, { x: 0, y: 0 }]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(
      expect.arrayContaining([
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ]),
    );
  });

  it('is deterministic for shuffled input', () => {
    expect(convexHull([...square].reverse())).toEqual(convexHull(square));
  });
});

describe('planFragments', () => {
  const triangles = [
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ],
    [
      { x: 2, y: 0 },
      { x: 3, y: 1 },
      { x: 1, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
    ],
    [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 2, y: 2 },
    ],
  ];

  it('splits every triangle into a fragment', () => {
    const plans = planFragments(triangles, 3);
    expect(plans).toHaveLength(3);
    expect(plans.reduce((total, plan) => total + plan.triangles.length, 0)).toBe(4);
    for (const plan of plans) {
      expect(plan.hull.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(plan.centroid.x)).toBe(true);
      expect(Number.isFinite(plan.centroid.y)).toBe(true);
    }
  });

  it('is deterministic and handles a requested count larger than the mesh', () => {
    expect(planFragments(triangles, 3)).toEqual(planFragments(triangles, 3));
    const plans = planFragments(triangles, 8);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.length).toBeLessThanOrEqual(8);
  });

  it('returns nothing for an empty mesh', () => {
    expect(planFragments([], 3)).toEqual([]);
  });
});

describe('planPieCut', () => {
  const triangles = [
    [
      { x: -2, y: -1 },
      { x: 0, y: -1 },
      { x: -1, y: 1 },
    ],
    [
      { x: 0, y: -1 },
      { x: 2, y: -1 },
      { x: 1, y: 1 },
    ],
    [
      { x: -2, y: 1 },
      { x: -1, y: 1 },
      { x: -0.5, y: 2 },
    ],
    [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 0.5, y: 2 },
    ],
  ];

  it('makes exactly two halves with every triangle assigned', () => {
    const plans = planPieCut(triangles, Math.PI / 2);
    expect(plans).toHaveLength(2);
    expect(plans.reduce((total, plan) => total + plan.triangles.length, 0)).toBe(4);
    for (const plan of plans) expect(plan.hull.length).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic and tolerates a degenerate cut', () => {
    expect(planPieCut(triangles, Math.PI / 2)).toEqual(planPieCut(triangles, Math.PI / 2));
    expect(planPieCut([], 0)).toEqual([]);
  });
});

describe('planWedgeCut', () => {
  const triangles = [
    [
      { x: -2, y: -1 },
      { x: 0, y: -1 },
      { x: -1, y: 1 },
    ],
    [
      { x: 0, y: -1 },
      { x: 2, y: -1 },
      { x: 1, y: 1 },
    ],
    [
      { x: -2, y: 1 },
      { x: -1, y: 1 },
      { x: -0.5, y: 2 },
    ],
    [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 0.5, y: 2 },
    ],
  ];

  it('makes a small wedge and a larger remainder', () => {
    const plans = planWedgeCut(triangles, Math.PI / 2, Math.PI / 2);
    expect(plans).toHaveLength(2);
    expect(plans.reduce((total, plan) => total + plan.triangles.length, 0)).toBe(4);
  });

  it('is deterministic and handles a degenerate wedge', () => {
    expect(planWedgeCut(triangles, 0, 1)).toEqual(planWedgeCut(triangles, 0, 1));
    expect(planWedgeCut([], 0, 1)).toEqual([]);
  });
});

describe('planPolylineCut', () => {
  const rock = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    return { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 };
  });

  it('makes two polygons with a shared non-straight cut path', () => {
    const cut = planPolylineCut(rock, 0, Math.PI * 0.55);
    expect(cut).not.toBeNull();
    expect(cut!.cutPath.length).toBeGreaterThan(4);
    expect(cut!.small.polygon.length).toBeGreaterThan(3);
    expect(cut!.large.polygon.length).toBeGreaterThan(3);
    const total = cut!.small.area + cut!.large.area;
    expect(total).toBeCloseTo(27, 0);
  });

  it('is deterministic', () => {
    expect(planPolylineCut(rock, 0, 1.7)).toEqual(planPolylineCut(rock, 0, 1.7));
  });
});
