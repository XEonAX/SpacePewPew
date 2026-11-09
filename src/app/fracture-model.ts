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

/** One polygon piece produced by a true polyline cut. */
export interface PolygonFragment {
  /** Closed outline in the parent rock's local metre space. */
  polygon: Vec2[];
  centroid: Vec2;
  area: number;
}

/** Two pieces sharing the exact cut path, plus the local crack polyline. */
export interface PolylineCut {
  cutPath: Vec2[];
  small: PolygonFragment;
  large: PolygonFragment;
}

function angularSpan(points: readonly Vec2[]): number {
  let span = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = Math.atan2(points[index - 1]!.y, points[index - 1]!.x);
    const b = Math.atan2(points[index]!.y, points[index]!.x);
    span += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  }
  return span;
}

function polygonAreaCentroid(points: readonly Vec2[]): { area: number; centroid: Vec2 } {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const area = twiceArea / 2;
  if (Math.abs(area) < 1e-9) {
    return { area: 0, centroid: centroidOf(points) };
  }
  return {
    area: Math.abs(area),
    centroid: { x: cx / (6 * area), y: cy / (6 * area) },
  };
}

/**
 * Cut the rock with a jagged polyline from one boundary vertex to another via
 * the centre. Unlike a straight wedge, the same polyline becomes both physical
 * fragment edges and the visible crack, so the split cannot be smoother than
 * the crack.
 */
export function planPolylineCut(
  points: readonly Vec2[],
  cutAngle: number,
  wedgeAngle: number,
): PolylineCut | null {
  if (points.length < 4) return null;
  const half = Math.max(0.05, Math.abs(wedgeAngle)) / 2;
  const angularDistance = (target: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const angle = Math.atan2(point.y, point.x);
      const distance = Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target)));
      if (distance < best) best = distance;
    }
    return best;
  };
  const nearestIndex = (target: number): number => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const angle = Math.atan2(point.y, point.x);
      const distance = Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target)));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  };
  // A wedge with no nearby vertices cannot form a meaningful cut.
  const firstIndex = nearestIndex(cutAngle - half);
  const secondIndex = nearestIndex(cutAngle + half);
  if (firstIndex === secondIndex) return null;
  if (angularDistance(cutAngle - half) > half * 0.7) return null;
  if (angularDistance(cutAngle + half) > half * 0.7) return null;

  const arc = (start: number, end: number): Vec2[] => {
    const result: Vec2[] = [];
    let index = start;
    for (let guard = 0; guard <= points.length; guard += 1) {
      result.push({ ...points[index]! });
      if (index === end) break;
      index = (index + 1) % points.length;
    }
    return result;
  };
  const arcAB = arc(firstIndex, secondIndex);
  const arcBA = arc(secondIndex, firstIndex);
  const shortArc = angularSpan(arcAB) <= angularSpan(arcBA) ? arcAB : arcBA;
  const longArc = angularSpan(arcAB) <= angularSpan(arcBA) ? arcBA : arcAB;

  const start = shortArc[0]!;
  const end = shortArc[shortArc.length - 1]!;
  let radius = 1;
  for (const point of points) radius = Math.max(radius, Math.hypot(point.x, point.y));
  const centre = { x: 0, y: 0 };
  const pathSection = (from: Vec2, to: Vec2, phase: number): Vec2[] => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / length, y: dy / length };
    const perp = { x: -dir.y, y: dir.x };
    const result: Vec2[] = [];
    const steps = 4;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const wobble =
        index === 0 || index === steps
          ? 0
          : Math.sin(index * 2.37 + phase) * radius * 0.045 * Math.sin(t * Math.PI);
      result.push({
        x: from.x + dx * t + perp.x * wobble,
        y: from.y + dy * t + perp.y * wobble,
      });
    }
    return result;
  };
  const cutPath = [...pathSection(start, centre, 0.7), ...pathSection(centre, end, 2.4).slice(1)];

  const smallPolygon = [...shortArc, ...cutPath.slice().reverse().slice(1, -1)];
  const longPolygon = [...longArc, ...cutPath.slice(1, -1)];
  const smallMetrics = polygonAreaCentroid(smallPolygon);
  const largeMetrics = polygonAreaCentroid(longPolygon);
  if (smallMetrics.area < 1e-6 || largeMetrics.area < 1e-6) return null;
  return {
    cutPath,
    small: { polygon: smallPolygon, centroid: smallMetrics.centroid, area: smallMetrics.area },
    large: { polygon: longPolygon, centroid: largeMetrics.centroid, area: largeMetrics.area },
  };
}

/** Shortest distance from a point to a closed/open polyline of segments. */
export function distanceToPolyline(point: Vec2, path: readonly Vec2[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared < 1e-9
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)));
  }
  return best;
}
