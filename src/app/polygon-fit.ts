/**
 * Fitting a low-polygon collider to a traced silhouette.
 *
 * The art is faceted pixel art, but the alpha edge still carries hundreds of
 * sample points (anti-aliasing, small scallops). Physics only needs the shape to
 * within a small tolerance, so the closed outline is reduced with
 * Ramer–Douglas–Peucker until it fits a vertex budget. Fewer vertices means
 * fewer separating-axis pieces, ray clips and tracer edge tests per query.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Distance from `point` to the segment `a → b`. */
function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 1e-12
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
      : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/** Ramer–Douglas–Peucker for an open polyline. Returns the kept endpoints. */
function simplifyOpen(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let worst = -1;
  let worstIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = segmentDistance(points[index]!, first, last);
    if (distance > worst) {
      worst = distance;
      worstIndex = index;
    }
  }
  if (worst <= tolerance) return [{ ...first }, { ...last }];
  const left = simplifyOpen(points.slice(0, worstIndex + 1), tolerance);
  const right = simplifyOpen(points.slice(worstIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

/**
 * Simplify a closed polygon. The loop is split at the vertex farthest from the
 * first one, each half is simplified as an open polyline, and the joints are
 * dropped so the result stays closed without duplicated vertices.
 */
export function simplifyClosedPolygon(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 3) return points.map((point) => ({ ...point }));
  let farthest = 0;
  let farthestDistance = -1;
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index]!.x - points[0]!.x;
    const dy = points[index]!.y - points[0]!.y;
    const distance = dx * dx + dy * dy;
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthest = index;
    }
  }
  const firstHalf = simplifyOpen(points.slice(0, farthest + 1), tolerance);
  const secondHalf = simplifyOpen(points.slice(farthest).concat([points[0]!]), tolerance);
  return firstHalf.slice(0, -1).concat(secondHalf.slice(0, -1));
}

/** Largest distance from any source point to the simplified outline. */
export function maxDeviation(points: readonly Vec2[], simplified: readonly Vec2[]): number {
  if (simplified.length < 2) return Infinity;
  let worst = 0;
  for (const point of points) {
    let nearest = Infinity;
    for (let index = 0; index < simplified.length; index += 1) {
      const a = simplified[index]!;
      const b = simplified[(index + 1) % simplified.length]!;
      const distance = segmentDistance(point, a, b);
      if (distance < nearest) nearest = distance;
    }
    if (nearest > worst) worst = nearest;
  }
  return worst;
}

/** Largest deviation in both directions between the outline and the fit. */
export function maxSymmetricDeviation(
  points: readonly Vec2[],
  simplified: readonly Vec2[],
): number {
  return Math.max(maxDeviation(points, simplified), maxDeviation(simplified, points));
}

export interface FitClosedPolygonOptions {
  /** Hard vertex budget for the collider outline. */
  maxVertices: number;
  /** Initial Douglas–Peucker tolerance, in the same units as the points. */
  tolerance: number;
  /** Tolerance multiplier applied until the budget is met. */
  growth?: number;
}

/**
 * Reduce a closed outline to at most `maxVertices` points, growing the
 * simplification tolerance until it fits. Returns the simplified outline plus
 * the tolerance actually used (useful for logging or tests).
 */
export function fitClosedPolygon(
  points: readonly Vec2[],
  options: FitClosedPolygonOptions,
): { points: Vec2[]; tolerance: number } {
  const growth = options.growth ?? 1.5;
  const limit = Math.max(3, Math.floor(options.maxVertices));
  let tolerance = Math.max(options.tolerance, 1e-6);
  let simplified = simplifyClosedPolygon(points, tolerance);
  let guard = 0;
  while (simplified.length > limit && guard < 24) {
    tolerance *= growth;
    simplified = simplifyClosedPolygon(points, tolerance);
    guard += 1;
  }
  // Degenerate traces: fall back to an even angular sample of the outline.
  if (simplified.length < 3) {
    simplified = points.filter((_, index) => index % Math.ceil(points.length / 3) === 0);
  }
  return { points: simplified, tolerance };
}
