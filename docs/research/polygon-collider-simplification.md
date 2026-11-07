# Polygon collider simplification

Research note (2026-11-07) behind the low-poly replacement of the 128-ray silhouette collider in
`src/app/asteroid-field.ts`. Vertex counts below are measured on the two shipped asteroid textures
(`public/assets/lighting/asteroid-color.png` and `asteroid2-color.png`) by tracing 128 subpixel
alpha rays from the texture centre, exactly as the game does, then running closed-polygon RDP over
that contour.

## 1. What production 2D engines limit, and why

| Engine                       | Limit / approach                                                                                                                                                                                                       | Stated reason                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Box2D 2.4                    | `b2_maxPolygonVertices` = **8** per convex polygon.                                                                                                                                                                    | "You cannot increase this too much because `b2BlockAllocator` has a maximum object size." ([b2_settings.h](https://github.com/erincatto/box2d/blob/v2.4.1/include/box2d/b2_settings.h#L51-L53))                                                                                                                               |
| Box2D 3.x                    | Still **8**; "If you have more complex shapes, I recommend using multiple polygons."                                                                                                                                   | Polygons must be convex and solid; compound bodies are the escape hatch. ([collision.md](https://github.com/erincatto/box2d/blob/main/docs/collision.md))                                                                                                                                                                     |
| Chipmunk2D                   | No documented hard cap (plane storage grows past an inline cache), but `cpPolyShapeNew` **computes a convex hull** from the input, so concave input is silently hulled.                                                | Convexity is a shape invariant: "The vertexes must be convex with a counter-clockwise winding." ([cpPolyShape.h](https://github.com/slembcke/Chipmunk2D/blob/master/include/chipmunk/cpPolyShape.h), [cpPolyShape.c](https://github.com/slembcke/Chipmunk2D/blob/master/src/cpPolyShape.c))                                   |
| Unity `Physics2D`            | A compile-time cap per **convex** polygon (`Physics2D.MaxPolygonShapeVertices`), not per authored outline.                                                                                                             | "All of its edges need to iterated to calculate collisions or perform queries. A value too large results in a lot of time … A value too small reduces the number of useful polygon shapes." ([MaxPolygonShapeVertices](https://docs.unity3d.com/6000.2/Documentation/ScriptReference/Physics2D.MaxPolygonShapeVertices.html)) |
| Unity `PolygonCollider2D`    | Freeform closed outline; optional "Use Delaunay Mesh" triangulates it into collision shapes.                                                                                                                           | Concave input is decomposed; the extra step "can improve collision shapes for complex shapes, but can reduce performance." ([manual](https://docs.unity3d.com/6000.0/Documentation/Manual/class-PolygonCollider2D.html))                                                                                                      |
| Godot `CollisionPolygon2D`   | "The polygon can be concave or convex"; `BUILD_SOLIDS` behaves as "several `ConvexPolygonShape2D` nodes, one for each convex shape in the convex decomposition".                                                       | Concave input is decomposed internally (`Geometry2D::decompose_polygon_in_convex`). ([docs](https://docs.godotengine.org/en/stable/classes/class_collisionpolygon2d.html), [source](https://github.com/godotengine/godot/blob/master/scene/2d/physics/collision_polygon_2d.cpp))                                              |
| Godot `ConvexPolygonShape2D` | Faster than `ConcavePolygonShape2D`, slower than primitives; "use should generally be limited to medium-sized objects".                                                                                                | Convexity enables the fast path. ([docs](https://docs.godotengine.org/en/stable/classes/class_convexpolygonshape2d.html))                                                                                                                                                                                                     |
| Rapier                       | Convex only. `convexHull` silently computes the hull; `convexPolyline` "assumes it is already convex … if the input mesh isn't actually convex, the collision-detection for that shape will give an incorrect result." | Non-convex dynamic bodies need "a convex decomposition with a compound shape". ([colliders guide](https://rapier.rs/docs/user_guides/javascript/colliders/))                                                                                                                                                                  |
| planck.js                    | `Settings.maxPolygonVertices` = **12**; "In most cases you should not need many vertices for a convex polygon."                                                                                                        | Box2D lineage, same allocator argument. ([Settings.ts](https://github.com/shakiba/planck.js/blob/master/src/Settings.ts#L33-L36), [PolygonShape.ts](https://github.com/shakiba/planck.js/blob/master/src/collision/shape/PolygonShape.ts#L39-L44))                                                                            |

The caps are **per convex piece, not per object**: Box2D's 8 is an allocator constraint, Box2D and
Rapier point at compound shapes for richer outlines, and Unity and Godot decompose concave input
on the way in. Nothing suggests a silhouette needs more than a few dozen vertices.

## 2. Line / polygon simplification for a closed silhouette

**Ramer–Douglas–Peucker (RDP).** Recursively keeps the point farthest from the chord until every
input vertex is within ε; ε is a perpendicular distance in the input's units, and the output is a
subsequence of the input. Worst case O(n²), best Ω(n log n)
([Wikipedia](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm);
[Douglas & Peucker 1973](https://doi.org/10.3138/FM57-6770-U75U-7727)). Two caveats matter here:
the bound applies to **input vertices**, not to points along input segments, and RDP "can
self-intersect if the accepted approximation is not sufficiently fine."

A closed ring needs explicit handling because its first and last points coincide. JTS turns off
endpoint preservation for `LinearRing` and repairs or drops degenerate rings
([simplifier](https://github.com/locationtech/jts/blob/master/modules/core/src/main/java/org/locationtech/jts/simplify/DouglasPeuckerSimplifier.java),
[line simplifier](https://github.com/locationtech/jts/blob/master/modules/core/src/main/java/org/locationtech/jts/simplify/DouglasPeuckerLineSimplifier.java)).
SpacePewPew instead splits the ring at the vertex farthest from the first into two open chains
(`simplifyClosedPolygon` in `src/app/polygon-fit.ts`), avoiding the degenerate chord.

**Visvalingam–Whyatt (VW).** Repeatedly removes the point whose triangle with its two neighbours
has the smallest area, via a priority queue; closed rings need no special case because it only
looks at immediate neighbours
([Wikipedia](https://en.wikipedia.org/wiki/Visvalingam%E2%80%93Whyatt_algorithm);
[Visvalingam & Whyatt 1993](https://doi.org/10.1179/000870493786962263)). But it "does not
differentiate between sharp spikes and shallow features" and erodes fine detail — exactly the
faceted corners a rock needs.

**Keep facet corners (dominant points).** Threshold the turn angle and keep only corners
([dominant-point detection](http://eprints.nottingham.ac.uk/47521/)); cheapest and matched to
faceted art, but the threshold is shape-dependent and there is no error bound.

**Fit for faceted art:** RDP. A faceted silhouette is piecewise linear, so its real corners are
precisely the points with large perpendicular deviation, which RDP keeps. VW's area criterion
deletes thin spikes; a pure corner detector cannot bound error. RDP keeps vertex order, so the
ring stays simple in practice (verified below).

## 3. Convex decomposition

SAT's correctness rests on the hyperplane separation theorem: disjoint **convex** sets admit a
separating axis on which their projections are disjoint
([Wikipedia](https://en.wikipedia.org/wiki/Hyperplane_separation_theorem)). For a concave shape a
single projection overlap can be a false positive, which is why the engines above decompose or
refuse concave input (Rapier: "incorrect result"; Godot: convex decomposition).

- **Fan from the trace centre** — n triangles `(centre, v_i, v_i+1)`. Valid exactly when the
  centre lies in the polygon's **kernel**, i.e. the polygon is star-shaped about it
  ([star-shaped polygon](https://en.wikipedia.org/wiki/Star-shaped_polygon)). A contour traced by
  rays from a point is a visibility polygon from that point, hence star-shaped about it _before_
  simplification. Cheapest decomposition: no new vertices, n pieces.
- **Ear clipping** — any simple polygon triangulates into n−2 triangles; O(n²) implementations are
  standard ([polypartition](https://github.com/ivanfratric/polypartition/blob/master/src/polypartition.h),
  [Wikipedia](https://en.wikipedia.org/wiki/Polygon_triangulation)). Always valid after
  simplification, but more pieces than a fan.
- **Bayazit** — recursive decomposition into convex **polygons** rather than triangles, O(n·r) for
  r reflex vertices, no holes
  ([reference implementation](https://github.com/tainicom/Aether.Physics2D/blob/master/Physics2D/Common/Decomposition/BayazitDecomposer.cs)).
  Useful when feeding an engine with an 8-vertex convex cap; unnecessary for a custom fan.
- **Hertel–Mehlhorn** — merges ear-clipped triangles into convex parts, at most 4× optimal, O(n²)
  ([polypartition](https://github.com/ivanfratric/polypartition/blob/master/src/polypartition.h)).
- **V-HACD** — 3D volumetric approximate decomposition; exact convex decomposition is NP-hard and
  approximate methods trade concavity against hull count
  ([README](https://github.com/kmammou/v-hacd)). Overkill for a 2D rock.

**When the fan stays valid after simplification:** check that the centre is on the interior side
of every edge — O(n) cross products, all the same sign. If that fails, fall back to ear clipping
(n ≤ 32 makes the O(n²) cost irrelevant). This is implemented: `pointInKernel` guards the cached
`fanTriangles` decomposition, and `buildEarClip` triangulates and verifies that the piece areas sum
to the polygon area; a U-shaped outline in the tests exercises the fallback.

## 4. Choosing and verifying a tolerance

ε is in the same units as the points, so the useful form is **ε as a fraction of the shape's
radius**, which is scale-invariant. Box2D supplies a first-party sense of "small enough to be
visually insignificant": `b2_linearSlop` is 0.005 m and the polygon skin is twice that
([b2_common.h](https://github.com/erincatto/box2d/blob/v2.4.1/include/box2d/b2_common.h#L63-L74)).
At this repo's 64 px/m, a 620 px rock is ≈ 9.7 m across, so 2 % of its radius is ≈ 6.4 px ≈ 9.7 cm
— about 1 % of the rock's diameter.

Verify with the **Hausdorff distance** — "the greatest of all the distances from a point in one
set to the closest point in the other set"
([Wikipedia](https://en.wikipedia.org/wiki/Hausdorff_distance)) — measured in **both** directions,
because RDP only guarantees source→simplified. Because RDP bounds position, not normals, also
compare edge normals: a median error around 5° is invisible, while a single edge near 30° is the
acceptable worst case for a removed notch.

Measured on the shipped art (128-ray contour, closed RDP, no vertex cap):

| ε (% of radius) | asteroid verts | asteroid2 verts | max deviation (both ways) |
| --------------- | -------------- | --------------- | ------------------------- |
| 1 %             | 47             | 54              | 0.76–1.00 %               |
| **2 %**         | **29**         | **32**          | 1.73–1.98 %               |
| 3 %             | 22             | 17              | 2.38–2.83 %               |
| 5 %             | 18             | 15              | 3.9–4.6 %                 |

At 2 % the edge-normal error was median 4.8°/4.7°, p90 14.5°/15.6°, max 28.4°/21.5°. The fan from
the origin was an exact partition at every tolerance tested: all triangle windings agreed and
Σ triangle areas equalled the polygon area (ratio 1.0000), i.e. the centre stayed in the kernel
after RDP.

## 5. Recommendation for SpacePewPew

1. **Use closed RDP with ε = 2 % of the rock's max radius and a hard cap of 32 vertices.** For the
   620 px faceted rock that is ≈ 6.4 px and yields **29–32 vertices** (measured), a 4–4.5×
   reduction from the 128-ray outline. The shipped fitter seeds at 1 % and grows until it meets
   the 32 cap, which lands at an effective ε ≈ 2.25 % and **24–28 vertices** — slightly fewer
   pieces at a marginally larger error (~2.0–2.2 %). Seeding at 2 % would instead stop at
   29–32 vertices in one pass; both are within the same visual budget, the shipped choice just
   trades ~2 cm more error for ~4 fewer SAT pieces per rock.
2. **Target max silhouette error ≈ 2 % of radius** (≈ 6.4 px, ≈ 9.7 cm at 64 px/m) in both
   directions. Do not chase 1 %; it costs 47–54 vertices and ~1.6–1.7× the SAT/ray work for an
   invisible gain.
3. **Keep the fan; it remains valid after simplification** for both rocks (measured exact
   partition). The O(n) star-shape assertion and ear-clipping fallback are now in
   `src/app/asteroid-collision.ts`, so future art cannot silently produce an invalid fan.
4. **Do not use VW** (it deletes the thin spikes that define facets). Bayazit / Hertel–Mehlhorn
   only matter if the collider moves to a stock engine with an 8-vertex convex cap; V-HACD is
   unnecessary in 2D.
5. **Verify in a unit test**: symmetric Hausdorff ≤ ε, Σ triangle areas == polygon area, and a
   normal-error p90 (≈ 15° here) rather than only the max. The repo now tests symmetric deviation
   (`maxSymmetricDeviation`) and fan/ear-clip area partition; normal-error p90 is documented here
   but not yet asserted in CI.
