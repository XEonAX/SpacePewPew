# Low-poly collider fitting for faceted asteroid art

Research note behind ADR-028. Question: how should a 2D game fit a collision polygon to a
faceted rock silhouette efficiently? Findings are quoted from primary engine documentation,
reference implementations and the algorithm literature.

## 1. What real 2D engines allow

- **Box2D** caps a convex polygon at **8 vertices** (`b2_maxPolygonVertices = 8`) and explicitly
  says you cannot raise it much because the block allocator has a maximum object size
  ([b2_settings.h](https://box2d.org/doc_version_2_4/b2__settings_8h.html)). Static, free-form
  scenery is instead given a **chain shape** — a sequence of line segments with one-sided
  collision, not limited to 8 points
  ([b2ChainShape](https://box2d.org/doc_version_2_4/classb2_chain_shape.html)).
- **Chipmunk2D** polygon shapes require **convex vertices in counter-clockwise winding**; the
  high-level `cpPolyShapeNew`/`cpPolyShapeInit` compute a **convex hull** from the vertices you
  pass, and only the `Raw` variants let you assert convexity yourself
  ([cpPolyShape.h](https://raw.githubusercontent.com/slembcke/Chipmunk2D/master/include/chipmunk/cpPolyShape.h)).
- **Unity Physics2D** exposes `Physics2D.MaxPolygonShapeVertices` as a compile-time maximum per
  convex polygon. Its docs explain the trade-off: a polygon's **edges are all iterated to
  calculate collisions or perform queries**, so "a value too large results in a lot of time
  discounting polygons. A value too small reduces the number of useful polygon shapes"
  ([MaxPolygonShapeVertices](https://docs.unity3d.com/6000.2/Documentation/ScriptReference/Physics2D.MaxPolygonShapeVertices.html)).
- **Godot**'s `CollisionPolygon2D` accepts an arbitrary polygon and decomposes it into convex
  shapes internally; the authored outline is not itself the runtime collider
  ([CollisionPolygon2D](https://docs.godotengine.org/en/4.2/classes/class_collisionpolygon2d.html)).

Takeaway: engines either cap vertices hard, use chains for static geometry, or decompose a
richer outline. The common constraint is **few vertices per convex piece**, because collision and
queries are per-edge.

## 2. Simplifying a closed silhouette

- **Ramer–Douglas–Peucker** "decimates a curve composed of line segments to a similar curve with
  fewer points" by recursively keeping the point farthest from the current chord unless it is
  within **ε**; it "produces the most accurate generalization, but is also more time-consuming"
  ([RDP](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm)). The
  page also warns that with an insufficiently fine tolerance the simplified curve can
  **self-intersect**, and that worst-case complexity is O(n²).
- For a **closed** outline the loop has no endpoints, so it is split into two open polylines (for
  example at the vertex farthest from the first point), each is simplified, and the seams are
  joined without duplicate points.
- Alternatives include **Visvalingam–Whyatt** (repeatedly remove the point that contributes the
  least triangle area) and other cartographic simplification schemes; RDP is preferred here
  because its ε has a direct geometric meaning (maximum deviation) and the art is already
  piecewise linear
  ([Visvalingam–Whyatt](https://en.wikipedia.org/wiki/Visvalingam%E2%80%93Whyatt_algorithm)).

## 3. Why convex pieces, and when a fan is valid

- Separating-axis tests are only exact for **convex** shapes, which is why engines demand convex
  polygons and why concave outlines are decomposed
  ([Chipmunk polygon constraint](https://raw.githubusercontent.com/slembcke/Chipmunk2D/master/include/chipmunk/cpPolyShape.h)).
- A **fan** (one vertex joined to every edge) decomposes a polygon into triangles without
  clipping. It is valid when the polygon is **star-shaped** with respect to the fan's centre: a
  polygon is star-shaped when there is a kernel point from which the whole boundary is visible
  ([Star-shaped polygon](https://en.wikipedia.org/wiki/Star-shaped_polygon)). A radial
  ray-traced silhouette around its centre satisfies this by construction.
- **Ear clipping** triangulates any simple polygon into `n − 2` triangles, so it is the fallback
  if the outline is not star-shaped
  ([Polygon triangulation](https://en.wikipedia.org/wiki/Polygon_triangulation)).

## 4. Choosing ε and the vertex budget

Engine guidance is explicit that the correct vertex count is a **performance/flexibility
trade-off**, not a fixed rule (Unity docs above; Box2D's 8-vertex cap). For a **static** body
(the rocks never move dynamically), there is no solver stability reason to stay near 8 — a
chain/fan of a few dozen segments is cheap. Practical rule applied here:

- express the tolerance as a fraction of the shape radius, so the same budget works for every
  rock size — **1 % of radius as the starting ε**, grown until the budget is met;
- cap the outline at a **32-vertex budget** (one triangle per edge in the fan);
- verify with **maximum deviation** from the untraced contour, not by eye.

For the two 620 px faceted rock textures this yields **24 and 28 vertices** with **≤ ~2 % of
radius deviation** (≈ 0.2 m on the 9.7 m rock), which is below the shield stroke width at normal
zoom. The 128-sample contour was accurate but overkill: most of its vertices describe
anti-aliased scallops that no gameplay interaction can feel.

## Recommendation for SpacePewPew

1. Trace the silhouette with subpixel ray/alpha crossings (integer sampling makes RDP chase
   pixel staircase noise and keep almost every point).
2. Simplify the closed loop with RDP, starting at 1 % of radius and growing ε until the outline
   fits **32 vertices**.
3. Keep the **fan** decomposition: the radial trace is star-shaped around the centre, and the
   vertex budget directly caps the number of SAT pieces and ray clips.
4. Cache the fan per rock and reject pieces by bounding circle before SAT; the collider is
   static apart from its rotation.
