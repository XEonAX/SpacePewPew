# AGENTS.md

Single source of truth for coding agents working on SpacePewPew. Read this first; humans
should start with [README.md](README.md).

## What this repo is

**COLD ROCK: PROSPECT** (repository: SpacePewPew) is a playable PixiJS demo. It contains:

- PixiJS v8 rendering a procedural space background and a normal-mapped ship/asteroid demo,
- a small custom GLSL normal-map lighting shader (directional key + emissive panels),
- a typed Howler audio wrapper playing committed weapon SFX with per-shot variation,
- Vite + TypeScript + Vitest + ESLint + Prettier wiring,
- a shared, visible Chrome instance that both the human and agents can drive,
- Playwright MCP configured to attach to that shared browser.

Do not add gameplay systems, entities, or art pipelines unless the task explicitly asks for
them. Keep the starter screen small and put new capabilities in new modules.

## Stack and versions

Node >= 22.12, pnpm 10, Vite 8, TypeScript 6 (strict), PixiJS 8, Howler 2, Vitest 5,
Playwright 1.65, `@playwright/mcp` 0.0.84.

## Commands

| Command                     | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `pnpm install`              | Install dependencies                                         |
| `pnpm dev`                  | Dev server on http://localhost:5173                          |
| `pnpm dev:bg`               | Start the dev server detached (pid/log in `.agent/`)         |
| `pnpm dev:status`           | Report whether the detached dev server is running            |
| `pnpm dev:stop`             | Stop the detached dev server                                 |
| `pnpm typecheck`            | `tsc --noEmit`                                               |
| `pnpm lint`                 | ESLint                                                       |
| `pnpm format`               | Prettier write                                               |
| `pnpm test`                 | Vitest run                                                   |
| `pnpm build`                | Typecheck + build to `dist/`                                 |
| `pnpm preview`              | Serve the production build                                   |
| `pnpm check`                | **Definition of done**: typecheck, lint, format, test, build |
| `pnpm browser:inspect`      | Screenshot + console/state dump of the shared browser        |
| `pnpm browser:act <action>` | Drive the shared browser (`click`, `fill`, `eval`, …)        |
| `pnpm browser:launch`       | Launch/reuse the shared Playwright-controlled browser        |
| `pnpm browser:open`         | Alias for `browser:launch`                                   |
| `pnpm browser:stop`         | Close the shared browser                                     |
| `pnpm mcp:browser`          | Run the Playwright MCP stdio server manually                 |

Run `pnpm check` before you report completion. If you touched rendering or browser-visible
behaviour, also run `pnpm browser:inspect` and check the screenshot.

## Architecture map

- `src/app/create-app.ts` — creates and initialises the PixiJS `Application`.
- `src/app/lighting-scene.ts` — the only scene: ship + asteroid layout, lighting state, WASD
  input, and the collider debug gizmo (hidden by default; F2 shows green rock polygons +
  bounding circles and the cyan ship hull bubble) used to verify the physics shapes against the
  art. Places both objects with `Background.getDustTransform()` on the near dust layer. The
  flight state lives at the ship's **centre of mass** (orange panel just behind the cargo
  hatch): `shipCentre()` derives the texture-centre pose used for rendering, turrets, mining and
  the shield, and the camera tracks the centre of mass so turns pivot there. Holds the collision
  tuning (shield restitution/friction, impact spin damping, camera shake) and reuses the flight
  model's mass and hull inertia for impacts.
- `src/app/ship-flight.ts` — pure mass-based flight in metres. The hull is a rigid body: each
  nozzle produces `thrust × engine-mix output` at its mount, so linear force is summed and yaw
  torque falls out of the nozzle positions (`engineWrench`). Acceleration is force/mass, angular
  acceleration is torque/inertia (`shipInertiaKgM2` from the radius of gyration), and the yaw
  couple is force-balanced to the weaker engine group. Inputs ramp
  over 0.3 s; drag multiplies velocity on both axes while any input is active — including the
  stabiliser hold — and terminal speeds/yaw rate emerge from thrust/drag. Hold X swaps the mix for
  the stabiliser outputs; the
  per-nozzle mix that was used is returned so the exhaust and engine audio show the same thrust.
  Unit-tested in `tests/ship-flight.test.ts`.
- `src/app/ship-engines.ts` — the drive geometry: every `EngineMount` (group/index, nozzle
  position relative to the centre of mass in body metres, thrust direction) built from the baked
  `engine-layout.ts` art and the current layout scale, plus the radius of gyration. Unit-tested
  in `tests/ship-engines.test.ts`.
- `src/app/stabilizer.ts` — hold-X flight assist: never re-orients the hull. It fires a
  force-balanced yaw couple to cancel spin, then burns the applicable axial thruster
  (reversers when travelling nose-first, mains when travelling backwards) to slow translation;
  lateral drift is left to the linear drag that stabilising also engages. Re-evaluated every
  frame; ramped with the input ramp. Unit-tested in `tests/stabilizer.test.ts`.
- `src/app/flight-tuner.ts` — live DOM slider overlay that mutates `FlightTuning` (mass, per-engine
  thrust, drags, ramp); dev-facing, with a collapsible chevron header.
- `src/app/input-system.ts` — the common input layer. Keyboard/mouse, a standard gamepad and
  the touch overlay all feed one snapshot: analog `thrust`/`turn`, `stabilize`, `fire`/`fireAll`,
  a pointer-or-stick `aim`, gamepad heading demand + analog trigger throttle, edge-triggered
  `InputAction`s (weapons, aim modes, carry, mute, colliders, dev-overlay toggle) and a
  multiplicative zoom factor. Gamepads are polled with a deadzone; the touch overlay is created
  here and hides the dev panels while visible (`?touch=1` forces it for testing).
  `src/app/input-model.ts` holds the pure deadzone/stick/aim/zoom maths, unit-tested.
- `src/app/heading-steer.ts` — pure gamepad heading controller: converts a left-stick direction
  into a PD turn input (P + D, deadband) so the ship points where the stick points without a
  large overshoot. The scene feeds its output through the normal flight input ramp; gamepad
  triggers supply main/reverse thrust separately. Unit-tested.
- `src/app/player-hud.ts` — player-facing HUD (brand, weapon/cargo pills, per-barrel laser heat
  bars, aim reticle and an auto-fading hint line that follows the device actually in use:
  keyboard/mouse copy, gamepad copy or hidden for touch). The dev tuners/telemetry are hidden by
  default and revealed by **F1** or `?dev=1`; when dev UI is on the player HUD steps out.
- `src/app/flight-telemetry.ts` — read-only **TELEMETRY** overlay: mass, terminal W/S/yaw,
  velocity, live/peak G, cargo held, cumulative shield damage absorbed, angular velocity,
  ramped inputs and applied drag. G is derived from the actual frame velocity delta (so
  collisions spike it) via `src/app/telemetry-model.ts`; the scene feeds cargo from
  `mining.getCargo()`, damage from collision `hitEnergy`, and keeps the peak.
- `src/app/world-scale.ts` — `PIXELS_PER_METER = 64`; all flight physics is in metres.
- `src/app/ground-grid.ts` — world-space 1 m × 1 m grid (64 world px per metre; major lines every
  5 m), drawn as a camera-centred quad transformed by the dust camera exactly like the asteroid
  layer. Its zoom pivot is therefore the camera point, and it cannot drift from the world. The
  x = 0 axis is amber and y = 0 is green as a world-space reference; `setView` takes the camera
  position in world px plus the zoom and viewport size.
- `src/app/engine-exhaust.ts` — flames and dust-world smoke driven by the engine mix; flame
  length/alpha are proportional to each engine's ramped output and smoke emission is weighted
  per engine.
- `src/app/engine-audio.ts` — per-engine electric-turbine hum loops whose gain follows each
  nozzle's power (heavy centre, normal sides, lighter/higher reverse), stereo-panned from the
  nozzle's screen position. Adds a speed rush that ramps to forward terminal speed and a
  retro-strain bed driven by `dot(thrust, velocity) < 0` (main hums duck while braking). Pure
  helpers unit-tested in `tests/engine-audio.test.ts`.
- `src/app/mining-audio.ts` — mining-rig audio: a laser bed whose gain follows active cutting and
  whose pitch rises with heat, a short steam-vent release, cooling ticks, overheat/re-arm one-shots, a tractor bed whose gain follows connected
  barrels, and the cargo-intake latch one-shot. Gain/pitch helpers are pure and unit-tested in
  `tests/mining-audio.test.ts`.
- `src/app/impact-audio.ts` — collision audio: impact one-shots scaled by hit energy (threshold,
  energy curve, cooldown) plus a scrape bed driven by the contact's tangential slide speed.
  `ShipCollision.slideSpeed` supplies that speed. Pure helpers unit-tested in
  `tests/impact-audio.test.ts`.
- `src/app/engine-layout.ts` — shared main/reverse nozzle geometry (must match the baked texture).
- `src/app/engine-mix.ts` — pure ramped engine-output mixer: throttle plus the A/D turn couple,
  force-balanced with `turnThrustBalance` (the pair is capped by the weaker engine group, so a
  turn never translates); unit-tested in `tests/engine-mix.test.ts`.
- `src/app/turrets.ts` — eight turret mounts with finite-speed mouse tracking, per-mount aiming cones, and charge glows at the barrel tips. In mining mode the barrel glows are tinted red (front pair) / green (tractors) on a neutral white glow texture with normal blending (additive would wash to cyan over the blue hull); they stay lit and brighten per mount while its beam is active (`miningBeams`).
- `src/app/turret-aim.ts` — pure angular spring-damper aim, unit-tested.
- `src/app/weapons.ts` — clean turret-pair sound pools, cadence, per-sound tracer delays, and
  committed shots: a trigger pulled inside the cone snapshots every tracking barrel, so the
  projectile still leaves the muzzle after the mouse moves out of the arc. Unit-tested.
- `src/app/laser-heat.ts` — pure per-barrel laser heat state: 5 s continuous fire, fast vent on
  early release, locked slow cool-down after overheat, HUD readouts. Unit-tested.
- `src/app/weapon-mode.ts` — the two weapon systems (`guns`, `mining`), Tab toggling, the
  mouse/forward aiming modes for guns and mining lasers separately, the turret aim resolver
  (`mining`/`mining-forward`) and the control hint. Unit-tested.
- `src/app/weapon-tuner.ts` — live per-pair rate-of-fire sliders; while the mining rig is
  equipped (Tab) the panel swaps to live mining tunables (melt, focus, laser heat/vent, chunk,
  tractor, carry and laser range). Collapsible chevron header.
- `src/app/tuner-panel.ts` — shared DOM helper for the collapsible dev-tuner headers; keeps the
  chevron, title and expanded/collapsed state consistent between the flight and weapon panels.
- `src/app/mining.ts` — mining rig rendering + rules: red front mining lasers that must **dwell
  on a spot for ~0.75 s** before melting a chunk (irregular, flickering orange melt craters with
  torn rims, hot cores, bloom and drifting embers, attached to the rock's spinning frame, left
  behind as cooling scars), small flat-solid **grey-blue** metal chunks
  (square / triangle, two baked textures) that leave along the laser's reflection angle and
  cool/slow as they drift, six
  autonomous green tractor beams (5 m reach, max six carried chunks, grips are sticky and never
  stolen, free beams claim the most external chunk first, barrels swing fully round to face
  their chunk with extra slew, cargo is only reeled once a beam is connected within 13 deg,
  cargo that would need >3 rad/s of slew is dropped for another beam) that carry metal in the ship's frame into
  the hull's own slatted hatch. The hatch pulses three glowing rounded-rectangle intake rings
  (the hatch's shape, 1.2× at spawn scaling down through it — a pulling-in wave) while the rig is
  equipped; they quicken/flare with inbound cargo and flash on delivery. Any chunk that drifts into the
  hatch — tractored or not — sinks in and scales to nothing (~0.3 s) before it counts
  as cargo. Lasers can bite any asteroid in the field (the nearest hit along each beam).
  Carry is
  switchable in game with **P**: `physics` (default — bounded acceleration/momentum) or `curved`
  (arcs to the hatch at a turn rate the barrels can track). Beams drop a chunk that leaves their reach;
  uncaptured metal cools and fades, but a gripped chunk's lifetime is reset each frame so
  cargo never expires in transit. Object-pooled chunks (256); laser/tractor beds and the cargo
  latch are driven by `mining-audio.ts` from the exposed beam counts and cargo total. A chunk
  with a **visually connected** tractor beam gets a green silhouette outline plus a soft additive
  halo (pooled helper sprites); a barrel that has merely claimed a chunk but is still swinging
  onto it draws nothing. Each front laser has its own **heat bank**: 5 s of continuous fire, fast
  venting after an early release, and a slow locked cool-down after overheat; two beams focused on
  the same small spot melt 1.5× faster. In the final 10% of heat the beam's thickness chatters and
  an outer bloom flickers; `src/app/laser-heat.ts` owns the pure state; HUD heat bars show the two
  barrels, and heat/focus drive the laser pitch plus overheat/re-arm one-shots.
- `src/app/fracture-model.ts` — pure fracture planning: monotonic-chain convex hull, a
  deterministic two-piece wedge cut and triangle-region helpers; unit-tested.
- `src/app/fracture-rock.ts` — one authored destructible test rock: an amber weak point, a
  growing V-notch crack overlay (clipped to the live collider silhouette), and a three-hit shell
  break. The shell splits into a small
  cracked-out wedge plus a larger >180° piece with baked fragment textures, separate convex
  colliders and shallow drift/rotation bodies.
  Both pieces get an immediate separation gap, persist and stay close to the break. The molten
  core is drawn beneath the shell at the break seam, so it is exposed through the gap rather
  than pasted onto the surface. The fragment shells are mining targets too, so they occlude the
  core: only its exposed part can be cut, and overlapped parts mine the rock surface. No physics
  engine.
- `src/app/mining-model.ts` — pure reflection, beam-carry, intake-pulse and rotated-rect intake
  math, unit-tested (laser/tracer hit tests are polygon-based in `asteroid-collision.ts`).
- `src/app/mining-tuning.ts` — live `MiningTuning` values (melt dwell/spot/cool, focus melt/radius,
  laser heat/vent/overheat, chunk ejection/damping/lifetime, tractor reach/slew, cargo
  speed/turn/easing, laser range). `createMining()`
  reads it every frame, so the overlay sliders take effect immediately; defaults are the
  designed rig values and unit-tested in `tests/mining-tuning.test.ts`.
- `src/app/asteroid-layout.ts` — pure deterministic asteroid scatter: seeded PRNG, rejection
  placement, axis/spawn clearances, diameter/variant mix across all available arts. Unit-tested
  in `tests/asteroid-layout.test.ts`.
- `public/assets/lighting/generated/` — eight committed asteroid sprites (`asteroid-gen-NN-color/-normal.webp`)
  rendered offline by `tools/asteroid-gen/`. Loaded with `Assets.load()` in `lighting-scene.ts`;
  there is no runtime asteroid art generation.
- `src/app/asteroid-field.ts` — all asteroids live in the **world (dust layer)**: each is a lit
  mesh plus a **two-stage collider** — a bounding circle and a **low-poly silhouette fit**. The
  contour is traced with 128 subpixel rays from the texture centre to the alpha edge, then
  reduced with closed-polygon Ramer–Douglas–Peucker to a **32-vertex budget** (typically 24–28
  points per rock, ~1–2 % of radius deviation). Concavities are kept; the collision pass fans
  the outline into triangles. The fit scales to the rock and **rotates with its spin**. The field exposes collider/mining lists (same objects, so melt decals and lasers share
  the spin). Rocks tumble slowly (0.02–0.06 rad/s, seeded). `add(x, y, diameter, variant?)`
  places one, picking from the ten art variants (two supplied plus eight Blender-rendered).
  Every art is traced and fitted to a ~24–28 point silhouette. The world is seeded once on
  layout with a deterministic **100-rock scatter** from `asteroid-layout.ts`: seeded placement,
  all ten art variants, a few 3x heroes, the ship's spawn bubble kept clear and the **vertical
  world axis kept free of rock edges**. The ship's centre of mass and the camera start at the
  world origin.
- `src/app/bullets.ts` — pooled 1 m glowing tracers with 200 m range and 50 m fade; a swept
  test stops them on every asteroid's polygon collider (circle fast pass inside) via `blockers`,
  and reports the blocker/hit point through `onHit` for destructible-rock damage.
- `src/app/bullet-math.ts` — pure bullet range/fade math, unit-tested.
- `src/app/asteroid-collision.ts` — polygon collision math: `AsteroidCollider` (rotating outline
  - bounding radius), **cached fan-triangle compound decomposition** so concave silhouettes are
    honoured (with a cheap per-piece distance reject), separating-axis collision between the ship's
    **hull bubble** and each rock piece with an **impulse response** (mass/inertia, shield
    restitution, Coulomb friction, off-centre hits spin the hull), plus concave point-in-polygon,
    ray and swept-segment tests for mining lasers and tracers. Pure and unit-tested. The response
    returns world/angular impulse vectors and a depenetration offset; it does **not** own the
    flight velocities — `applyShipImpulse()` in `ship-flight.ts` applies them to the rigid body.
- `src/app/polygon-fit.ts` — pure closed-polygon simplification (Ramer–Douglas–Peucker) and a
  vertex-budget fitter that turns the traced silhouette into a low-poly collider; unit-tested.
- `src/app/ship-shield.ts` — the hull-shaped energy shield, drawn in ship-texture px so it
  inherits the ship transform; its boundary glows and fades inward, and impacts light up the
  contact patch (masked to the bubble). It draws the same hull used for collision. The bubble
  rests **dim** and a recent hit lifts it to full brightness (then eases back over ~2 s), with
  the curve isolated in `src/app/shield-glow.ts` and unit-tested.
- `src/app/shield-glow.ts` — pure shield brightness curve: resting α, hit α, afterglow decay,
  breathing and flash clamping, unit-tested in `tests/shield-glow.test.ts`.
- `src/app/lit-sprite.ts` — custom normal-map Mesh shader (directional light, emissive/glow);
  fragments can pass an explicit world rotation so their baked normal maps light correctly.
- `src/app/background.ts` — layered procedural background (nebulas, galaxies, stars, flares)
  and the smoothed camera that follows the ship.
- `src/app/background-textures.ts` — one-time deterministic canvas textures for the background.
- `src/app/starfield-model.ts` — deterministic star generation, projection, twinkle (pure).
- `src/audio/audio.ts` — the only place Howler is used.
- `src/utils/random.ts` — seeded PRNG helpers for procedural content.
- `src/utils/` — pure helpers (safe to unit test).
- `src/main.ts` — entry point, input handlers, HMR teardown, `window.__SPACEPEWPEW__` hook
  (Pixi app, colliders, ship pose, camera zoom, merged input state and asteroid staging for
  browser automation/screenshots).
  Shows the boot overlay, pings analytics on non-local hosts and fades the overlay once
  textures and audio are ready.
- `src/app/loading-screen.ts` — full-screen boot overlay with texture progress, an
  indeterminate audio phase, error state and reduced-motion support; `loading-model.ts` holds
  the pure progress clamping (tested).
- `src/app/analytics.ts` — fire-and-forget visit ping (`no-cors`, silent failures) except on
  `localhost`/`127.0.0.1`; hostname gate unit-tested.
- `docs/GAMEPLAY.md` — detailed systems write-up moved out of the README (flight, collisions,
  asteroids, weapons, mining, lighting, audio).
- `docs/reference/` — supplied color/normal reference art for the ship and asteroid.
- `public/assets/lighting/` — processed runtime copies (color + normal maps) used by the scene.
- `scripts/browser.mjs` — CLI for the shared browser.
- `scripts/dev-server.mjs` — detached dev server (start/stop/status).
- `scripts/lib/shared-browser.mjs` — browser lifecycle, CDP health checks, shared profile.
- `scripts/mcp-browser.mjs` — Playwright MCP stdio wrapper.
- `tools/asteroid-gen/` — offline Blender pipeline (`render_asteroid.py` + `postprocess.py`)
  that bakes the asteroid sprites: Voronoi-dual facets, tapered boolean craters, inset-raised
  plates, painted fake-lit emission materials, studs/chunks, ink outline and attenuated normal
  map. `README.md` has usage; `HANDOFF.md` has the tuning knobs and status.
- `tests/` — Vitest tests. Keep them fast, pure and DOM-free.

## Conventions

- **TypeScript is strict.** Avoid `any`; prefer `unknown` + narrowing. Exported functions
  should have explicit return types.
- **PixiJS v8 only.** No v7 APIs (`beginFill`, `DisplayObject`, `@pixi/*` imports). Use async
  `app.init()`, shape-then-fill `Graphics`, `deltaMS`-based updates, and destroy tickers and
  listeners on HMR.
- **Audio goes through `AudioManager`.** Browsers require a user gesture, so call `enable()`
  from a pointer/keyboard handler. Never construct `Howl` elsewhere. Camera distance is applied
  with `audio.setListenerGain(listenerGainForZoom(zoom))` (Howler master gain), so it scales
  one-shots and loops alike; do not bake zoom into individual voice gains.
- **Audio assets are small and committed.** Weapon WAVs live in `public/audio/weapons/`,
  seamless engine loops in `public/audio/engines/`, mining beds in `public/audio/mining/`, and
  impact/scrape clips in `public/audio/impacts/`; all are registered in `src/audio/audio.ts`.
  Trim/fade/normalize offline; do not add a build-time audio pipeline.
- **Engine loops are tonal, not saturated.** Harmonic banks use random phases and stay sparse;
  no tanh/noise beds beyond a low smooth body. Zero-phase stacks and hard saturation read as
  buzz, which is the one thing these loops must avoid.
- **Continuous sounds are loops, not repeated shots.** Engine hums use
  `AudioManager.createLoop()` and per-engine gain from `computeEngineOutputs`; loop assets must
  stay seamless at any playback rate (constant loop length, no fades baked in). Velocity-coupled
  layers use `forwardTerminalSpeed()` and `dot(thrust, velocity)` — never derive speed caps from
  separate constants.
- **Browser artifacts are disposable.** `.agent/` and `.playwright-mcp/` are gitignored.
- **Shared browser is shared.** Prefer `browser:inspect` / `browser:act`; they attach over CDP
  without closing the window. Do not launch a second persistent browser or kill the shared one
  unless the task asks for it.
- **Sandbox policy.** The shared Chrome is launched once outside the agent sandbox so Chrome
  keeps its own sandbox; later commands only attach. Do not add `--no-sandbox` to defaults.
  `SPACEPEWPEW_CHROME_NO_SANDBOX=1` is an explicit, disposable-CI-only escape hatch.
- **Keep the starter small.** New gameplay should arrive as focused modules with tests, not as
  a growing `lighting-scene.ts`.
- **Procedural content is deterministic.** Use `src/utils/random.ts` with a fixed seed and keep
  generation/projection math pure in `*-model.ts` files so it can be unit tested.
- **Asteroid sprites are baked offline.** The eight generated variants are committed WebP sprites
  rendered by `tools/asteroid-gen/` (Blender) and optimized for the web (quality 88 colour / 92
  normal via `optimize_webp.py`). Re-bake with the README commands; do not add runtime art
  generation or a build-time asset step. Their colour maps are **unlit albedo**
  (painted plate colours + baked AO only); directional shading comes from the normal map and the
  `LitSprite` shader, so keep normals blended toward flat (~0.3) and let `asteroidLighting`
  soften the key. Never bake lighting back into the colour map: it makes shadows rotate with the
  sprite instead of reacting to the light.
- **Reference art is source, not runtime.** Treat `docs/reference/` as supplied source art and
  `public/assets/lighting/` as the processed runtime copies. Processing runs were a one-off
  matte/despill/premultiplied-resample pass (see `public/assets/lighting/README.md`), including
  the ~0.30 normal-strength softening and flat normals in the transparent gutter; don't add a
  build-time asset pipeline.
- **Lighting is a custom Mesh shader.** Lit meshes come from `src/app/lit-sprite.ts`; normals
  are rotated by each mesh's rotation and combined with one directional key light + ambient.
  The renderer is pinned to WebGL because the shader is GLSL. Do not add a lighting library back
  without solving directional lighting and normal rotation. Lit textures enable auto-generated
  mipmaps (texture LOD); keep that on so camera zoom-out doesn't shimmer.
- **Background textures are baked once.** Nebula/galaxy/glow textures are generated at startup
  into `CanvasSource`s and composed with batched sprites/TilingSprites. Avoid per-frame
  full-screen shaders or filters unless profiling justifies them.
- **Flight physics is metric.** Keep velocities/accelerations/positions in metres; convert to
  screen pixels only at render time with `PIXELS_PER_METER`. Grid/telemetry display metres.
- **Flight is force-based.** Tune mass and per-engine thrust, never an abstract acceleration or a
  synthetic yaw torque: turning must fall out of the nozzle positions via `engineWrench` and the
  engine mix, so the physics matches the flames and audio.
- **All input goes through `input-system.ts`.** Do not add ad-hoc `keydown`/`pointerdown`
  handlers to the scene: add the action/axis to `InputSnapshot` or `InputAction` and consume it
  in the tick. Analog stick targets go into `FlightControls.thrustAxis`/`turnAxis` so the flight
  input ramp still applies; never bypass the ramp with direct velocity changes.
- **Impacts go through the physics layer.** Collisions return a physical impulse + angular impulse;
  the scene applies them with `applyShipImpulse()` (Δv = J/m, Δω = L/I) and only writes the
  depenetration offset back to the flight position. Never assign `flight.vx/vy/angularVelocity`
  from a collision solver, or impacts stop respecting the configured mass and inertia.
- **Galaxies are fixed sky.** The two galaxy sprites have zero parallax/zoom response; only
  stars, nebulas, and the near dust layer pan.
- **Parallax pan is integrated.** Each panned layer owns an accumulated pan offset advanced by
  camera deltas (`advanceLayerPan` in `starfield-model.ts`), so at any zoom its screen pan rate
  is `parallax × zoom` (the near dust/grid layer, parallax 1, is fastest) while wheel zoom only
  scales layers about the viewport centre. Never recompute pan from the absolute camera — after
  a long flight that translates every layer by `camera × parallax × Δzoom`. No independent drift.
- **Camera lookahead is quadratic and zoom-independent.** `followCamera()` applies a `speed²`
  curve (near-zero at slow speed, max near terminal) as a fixed **world-space offset** (metres,
  not screen px), capped so the engine cones/smoke stay on screen, and cancels the follow
  camera's lag with `CAMERA_FOLLOW_RATE`. Do not make the offset zoom-aware: that moves the
  camera on every wheel notch and pans the near dust/grid layer relative to the sky.
- **Zoom is depth-weighted.** Far stars/nebulas stay at a fixed scale; mid/near stars respond
  partially; near dust takes the full pan + zoom. Zoom is clamped to `0.02`–`1`
  (1× is the default and maximum zoom-in). Zoom input comes through
  `input-system.ts` — wheel, gamepad LB/RB and the touch −/+ buttons all call
  `background.zoomBy()`; don't add another wheel listener back into the background.

## Agent workflow

1. Read this file and the relevant source files before editing.
2. Start the dev server if needed: `pnpm dev` (background is fine).
3. Make a small change, then verify:
   - `pnpm typecheck`
   - `pnpm test` (add tests for pure logic)
   - `pnpm browser:inspect` when the UI changed; read the saved screenshot.
4. Run the full `pnpm check` before finishing.
5. Update `README.md`, this file, or `docs/DECISIONS.md` when commands, architecture, or
   browser workflow change.

## Shared browser + Playwright MCP

- CDP endpoint: `http://127.0.0.1:9222`; profile: `.agent/chrome-profile`.
- The desktop profile contributes zero-token chat commands `/dev` and `/browser`
  (`~/.dsh/profiles/desktop/spacepewpew-commands`, host-side, no model turn).
- The browser is launched once and reused across sessions until `pnpm browser:stop`.
- `pnpm browser:inspect` writes `.agent/browser/latest.png` and `.agent/browser/latest.json`
  (page errors, console errors, failed requests, canvas size, renderer, FPS).
- `pnpm browser:act click "canvas"`, `pnpm browser:act eval "expression"`, etc. Actions are
  visible live in the shared window.
- Playwright MCP is configured in the DSH desktop profile via `scripts/mcp-browser.mjs`. It
  attaches to the shared browser when running; otherwise it launches its own headed Chrome.
  New MCP tools require a DSH restart (`mcp__playwright__*`).
- Browser artifacts live under `.agent/` (`browser/`, `mcp/`, `playwright-browsers/`,
  `chrome-profile/`); they are disposable and gitignored.
- Environment switches and the full CLI reference are in
  [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).
- Details and troubleshooting: [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

## Testing rules

- Vitest runs in the `node` environment. Do not import modules that need a DOM, canvas, or
  WebGL into unit tests.
- Test pure helpers and logic; use `pnpm browser:inspect` for rendering checks.
- Keep tests deterministic — seed any randomness.

## Skills

The global skill collection at `~/.agents/skills` includes the complete `pixijs` skill family.
Load the `pixijs` skill before any PixiJS work, then the matching sub-skill (application,
scene, assets, ticker, events, …).

## Git

Use small, focused commits with Conventional Commit subjects (`feat:`, `fix:`, `docs:`,
`chore:`). Never commit `node_modules/`, `dist/`, `.agent/`, or generated browser artifacts.
