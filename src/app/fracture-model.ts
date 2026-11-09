import type { Vec2 } from './asteroid-collision';

/** One fragment produced from the asteroid's triangulated silhouette. */
export interface FragmentPlan {
  /** Triangles in the parent's local metre space. */
  triangles: readonly (readonly Vec2[])[];
  /** Area centroid of all fragment vertices, local metres. */
  centroid: Vec2;
  /** Convex hull around the fragment, local metres, relative to the world centre. */
  hull: readonly Vec2[];
}

function cross(origin: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Monotonic-chain convex hull; input order does not matter. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  if (points.length <= 3) return points.map((point) => ({ ...point }));
  const sorted = points.map((point) => ({ ...point })).sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function centroidOf(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / Math.max(points.length, 1), y: y / Math.max(points.length, 1) };
}

function plansFromGroups(groups: readonly Vec2[][][]): FragmentPlan[] {
  const plans: FragmentPlan[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    const points = group.flat();
    const centroid = centroidOf(points);
    const hull = convexHull(points);
    if (hull.length < 3) continue;
    plans.push({ triangles: group, centroid, hull });
  }
  return plans;
}

/**
 * Split a triangulated rock into two halves with a straight line through its
 * centre. This is the "pie cut" used by the weak-point prototype: the line
 * passes through the weak point so the visible crack and the fracture seam are
 * the same line.
 */
export function planPieCut(
  triangles: readonly (readonly Vec2[])[],
  cutAngle: number,
): FragmentPlan[] {
  if (triangles.length === 0) return [];
  // Normal of the cut line; positive side is group 0, negative side group 1.
  const nx = -Math.sin(cutAngle);
  const ny = Math.cos(cutAngle);
  const groups: Vec2[][][] = [[], []];
  for (const triangle of triangles) {
    const centroid = centroidOf(triangle);
    const side = centroid.x * nx + centroid.y * ny >= 0 ? 0 : 1;
    groups[side]!.push(triangle.map((point) => ({ ...point })));
  }
  if (groups[0]!.length === 0 || groups[1]!.length === 0) {
    // Degenerate line: keep the pie cut deterministic by alternating triangles.
    groups[0] = [];
    groups[1] = [];
    triangles.forEach((triangle, index) => {
      groups[index % 2]!.push(triangle.map((point) => ({ ...point })));
    });
  }
  return plansFromGroups(groups);
}

/**
 * Split the rock into a small edge wedge and the larger remainder. The wedge
 * is the "cracked-out" pie piece; the remainder is the >180° piece that keeps
 * the core. Both cut faces meet at the centre, so the break is a V-notch rather
 * than a straight diameter.
 */
export function planWedgeCut(
  triangles: readonly (readonly Vec2[])[],
  cutAngle: number,
  wedgeAngle: number,
): FragmentPlan[] {
  if (triangles.length === 0) return [];
  const half = Math.max(0.01, Math.abs(wedgeAngle)) / 2;
  const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
  const groups: Vec2[][][] = [[], []];
  for (const triangle of triangles) {
    const centroid = centroidOf(triangle);
    const delta = wrap(Math.atan2(centroid.y, centroid.x) - cutAngle);
    const group = Math.abs(delta) <= half ? 0 : 1;
    groups[group]!.push(triangle.map((point) => ({ ...point })));
  }
  if (groups[0]!.length === 0 || groups[1]!.length === 0) {
    // Degenerate wedge: alternate triangles so both pieces still exist.
    groups[0] = [];
    groups[1] = [];
    triangles.forEach((triangle, index) => {
      groups[index % 2]!.push(triangle.map((point) => ({ ...point })));
    });
  }
  return plansFromGroups(groups);
}

/**
 * Split the triangulated silhouette into `count` wedge-like regions.
 *
 * This is deliberately small: the prototype only needs a deterministic handful
 * of plausible shards, not a physical Voronoi fracture. Triangles are assigned
 * to the nearest of `count` radial seeds, then each region gets its own centroid
 * and convex collider hull.
 */
export function planFragments(triangles: readonly (readonly Vec2[])[], count = 3): FragmentPlan[] {
  if (triangles.length === 0 || count <= 0) return [];
  const centre = centroidOf(triangles.flatMap((triangle) => triangle));
  let radius = 1;
  for (const triangle of triangles) {
    for (const point of triangle) {
      radius = Math.max(radius, Math.hypot(point.x - centre.x, point.y - centre.y));
    }
  }
  const seeds: Vec2[] = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      x: centre.x + Math.cos(angle) * radius * 0.55,
      y: centre.y + Math.sin(angle) * radius * 0.55,
    };
  });
  const groups: Vec2[][][] = Array.from({ length: count }, () => []);
  for (const triangle of triangles) {
    const centroid = centroidOf(triangle);
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index]!;
      const distance = Math.hypot(centroid.x - seed.x, centroid.y - seed.y);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    }
    groups[nearest]!.push(triangle.map((point) => ({ ...point })));
  }

  // A degenerate silhouette can leave a seed empty. Move a triangle from the
  // largest group so every fragment has geometry and a usable hull.
  for (let index = 0; index < groups.length; index += 1) {
    if (groups[index]!.length > 0) continue;
    let donor = 0;
    for (let candidate = 1; candidate < groups.length; candidate += 1) {
      if (groups[candidate]!.length > groups[donor]!.length) donor = candidate;
    }
    const moved = groups[donor]!.pop();
    if (moved) groups[index]!.push(moved);
  }

  const plans: FragmentPlan[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    const points = group.flat();
    const centroid = centroidOf(points);
    const hull = convexHull(points);
    if (hull.length < 3) continue;
    plans.push({
      triangles: group,
      centroid,
      hull,
    });
  }
  return plans;
}
