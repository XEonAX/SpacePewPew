# Decisions

Short architecture decision log. Append new decisions; do not rewrite history.

## ADR-001 — PixiJS v8 + Vite + TypeScript

**Status:** accepted (2026-11-06)

Use PixiJS v8 (the current major) with Vite 8 and TypeScript 6 in strict mode. TypeScript 6
ships WebGPU types in `lib.dom`, so the project uses `@types/web` with `lib: ["ESNext"]` and
avoid `@webgpu/types` conflicts. `moduleResolution` is `bundler` so PixiJS subpath exports
resolve.

**Consequences:** PixiJS v7 patterns are forbidden; the `pixijs` skill collection is the
reference for API usage.

## ADR-002 — Small committed placeholder audio, Howler behind a wrapper

**Status:** accepted (2026-11-06); superseded by ADR-009 for weapon audio.

A single small placeholder WAV (`public/audio/blip.wav`, ~16 KB) is committed so the starter has
working audio without any build-time asset pipeline. Howler is used only through
`src/audio/audio.ts`, which centralises loading, mute, volume and the browser's user-gesture
unlock requirement.

**Consequences:** replacing audio means dropping in a new file and updating `SOUND_SOURCES`;
keep clips small. Do not reintroduce generation pipelines for placeholder content.

## ADR-003 — One shared, human-visible Chrome over CDP

**Status:** accepted (2026-11-06)

Agents and the human use the same visible Chrome instance, exposed over CDP on
`127.0.0.1:9222` with a disposable profile in `.agent/chrome-profile`. The browser is launched
once and reused across sessions; agents attach with Playwright. This keeps interactions
observable in both directions and avoids multiple conflicting browser windows.

Chrome keeps its own sandbox. It is launched once **outside** the agent file sandbox (one-time
approval) because a nested macOS sandbox prevents Chrome's sandbox from initialising. The
tooling never adds sandbox-disabling flags by default; `SPACEPEWPEW_CHROME_NO_SANDBOX=1` is an
explicit escape hatch for disposable CI.

**Consequences:** browser lifecycle is a shared resource. Use `pnpm browser:stop` deliberately;
never kill another agent's window. Artifacts live in `.agent/` and are gitignored.

## ADR-004 — Playwright MCP attaches to the shared browser

**Status:** accepted (2026-11-06)

The DSH desktop profile runs `@playwright/mcp` through `scripts/mcp-browser.mjs`. The wrapper
attaches to the shared browser when it is running and otherwise starts its own headed,
isolated Chrome. This gives every agent session MCP browser tools while preserving the
human-visible shared window.

The wrapper pins MCP file outputs inside the repo (`cwd` + `--ignore-roots`), writes tool
artifacts to `.agent/mcp/`, and enables the `vision` capability for canvas-based apps.

**Consequences:** changing the project path or Node installation requires updating the profile
entry. New MCP tools require a DSH restart. MCP artifacts go to `.agent/mcp/`.

## ADR-005 — Starter only, no gameplay

**Status:** accepted (2026-11-06)

The repo intentionally ships a starter screen and infrastructure, not a game. Gameplay should
be added later as focused modules (input, entities, systems, rendering) with pure logic
separated from PixiJS for unit testing.

**Consequences:** do not grow `starter-scene.ts`; add modules instead and keep `pnpm check`
green.

## ADR-006 — Baked procedural background textures over a custom shader

**Status:** accepted (2026-11-06)

The nebulas, galaxies, star glow and hero-star flares are generated once into deterministic
`CanvasSource` textures (seeded value-noise fbm, periodic so nebulas tile seamlessly) and
composed with batched `Sprite` / `TilingSprite` layers. This was chosen over a full-screen
fragment shader for predictable performance and simpler WebGL/WebGPU support: per-frame work is
texture sampling instead of noise evaluation, and PixiJS batches the star sprites.

**Consequences:** visual changes require re-baking textures; tileable nebulas repeat at very
large camera distances. Keep the bake one-time and avoid per-frame full-screen shaders/filters
unless profiling shows a need.

## ADR-007 — Depth-weighted zoom with a 50× zoom-out limit

**Status:** accepted (2026-11-06)

The background is built for a 2.5D flying game where camera zoom will be driven by ship
velocity (zoom out at higher speeds). Zoom is depth-weighted rather than uniform:

- far star layers, nebulas and galaxies keep a fixed scale (the "sky"),
- mid/near star layers respond partially (`zoomResponse` in `starfield-model`),
- near-field dust takes the full pan and zoom.

Zoom is clamped to **0.02×–1×**; 1× is both the default and the maximum zoom-in, and the
0.02 floor is the requested 50× zoom-out limit. The background owns the smoothed
zoom target; only the wheel adjusts it.

**Consequences:** zooming far out leaves the sky stable and shrinks/removes the near layers,
which suits high-speed gameplay: the background does not fly apart while ships/entities (added
later) scale with the camera. The star field spans 2×2 world units to stay covered at the
zoom-out limit.

## ADR-008 — Custom normal-map shader instead of a lighting library

**Status:** accepted (2026-11-06); supersedes the earlier `pixijs-light2d` choice.

`@pixi/lights` targets PixiJS 6/7. `pixijs-light2d` runs on v8 but has no true directional
light, does not rotate normal vectors with sprite rotation, needs a Spine peer it never uses,
and required shadow-map/pre-object-light workarounds for our spinning demo. We replaced it
with a small custom GLSL Mesh shader in `src/app/lit-sprite.ts`:

- diffuse + normal + emissive + glow textures,
- one directional key light + ambient,
- normals rotated by the mesh rotation, so rotating ships shade correctly,
- emissive maps for the ship's cyan panels,
- auto-generated mipmaps for texture LOD during camera zoom-out.

The pointer omni light was a test aid and has been removed. Lighting is WebGL-only (GLSL), so
the Application pins `preference: 'webgl'`.

**Consequences:** no lighting dependency; extend `lit-sprite.ts` for new light types or effects.
No PBR/roughness/metalness support — this is a stylized diffuse shader.

## ADR-009 — Committed weapon SFX with per-shot variation

**Status:** accepted (2026-11-06); supersedes the placeholder-audio part of ADR-002.

Six small WAV clips are committed in `public/audio/weapons/`: one front beam and five rear blast
variants, trimmed/faded/normalized offline from the supplied sources. The front pair uses the
beam (two detuned, panned voices); the three rear pairs cycle variant pools so consecutive shots
do not repeat, with small per-shot rate, volume, and stereo-pan variation.

Howler remains behind `src/audio/audio.ts`, which now supports per-shot rate, volume, and pan.
No build-time audio pipeline.

**Consequences:** audio changes mean replacing a committed clip and updating `SOUND_SOURCES`.

## ADR-010 — Integrate parallax pan instead of deriving it from camera × zoom

**Status:** accepted (2026-11-07).

The background camera is an unbounded, normalized world coordinate and the starfield is a
repeating 2×2 field. Projecting a layer as `wrap(point − camera × parallax × zoom / layerScale)`
is fine at a fixed zoom, but every wheel notch then translated each layer by
`camera × parallax × Δzoom`. After ~10 s of flight (~300 m, ~20 field repeats) that is several
screen heights per zoom step, so zooming appeared to pan the sky up/down relative to the ship
while the ship, grid, and dust stayed put.

Layers now own an accumulated pan offset (`advanceLayerPan`) advanced by **camera deltas**.
At a fixed zoom the result is identical, and the screen pan rate stays `parallax × zoom ×
cameraSpeed`, but zoom only scales each layer about the viewport centre — it never translates
by the distance already flown. Dust/grid keep using the raw camera offset, which already had
this property.

**Consequences:** never recompute pan from the absolute camera position; feed moves through
`advanceCamera()` so zoom remains a pure scale. `projectPoint`/`projectStar` now take a layer pan
(not a camera), which the unit tests assert.

## ADR-011 — Per-engine hum loops driven by nozzle power

**Status:** accepted (2026-11-07).

Each nozzle gets its own continuous hum voice so thrust, reverse and turning read through
audio as well as the exhaust:

- main centre engine → `engine-main.wav`, a heavy sub-heavy rumble,
- the two side main engines → `engine-side.wav`, a normal mid-range rocket,
- the two reverse engines → `engine-reverse.wav`, lighter and brighter.

The loops are deliberately tuned "sweet" rather than aggressive: soft saturation, a warmth
EQ bump around 90–500 Hz, rolled-off top end with just a little air, added consonant fifths,
and slow vibrato on the upper tones instead of broadband hiss.

The three loops are generated offline and committed. Seamlessness is structural rather than
faded: tones and LFOs are quantised to integer cycles per loop, and the noise beds are
synthesised in the frequency domain with random phases, so the last sample joins the first with
no discontinuity (a 20 ms crossfade would dull the low end). The runtime may change playback
rate freely because the loop length does not change.

`AudioManager.createLoop()` owns the Howler loop voices (one `Howl` per source, multiple ids);
the game maps `computeEngineOutputs()` to per-engine gain (`base × power^1.25`), adds a small
left/right detune plus a subtle pitch rise with power, and pans each voice from the nozzle's
screen position. Gain is smoothed per frame so spool-up/down is click-free. Engines at zero
power are silent, not idling.

**Consequences:** changing an engine's feel means replacing its WAV or tuning the gain table in
`engine-audio.ts`; do not synthesize hums per frame or route them through repeated one-shots.

## ADR-012 — Engine audio couples to speed and thrust·velocity

**Status:** accepted (2026-11-07).

The per-nozzle hums only knew about ramped thrust, so accelerating felt static and braking with
the main engines sounded identical to accelerating. Two layers now read the flight state:

- **Speed ramp.** `speedFraction = |v| / forwardTerminalSpeed(tuning)` drives a shared
  `engine-rush.wav` bed with gain `speedFraction^1.6` (a little higher while engines are lit) and
  a `0.92 → 1.08` rate ramp. Every hum's playback rate also rises with `speedFraction`, so the
  approach to forward terminal speed is audible.
- **Thrust · velocity.** `engineThrustAlignment()` is the dot of an engine's thrust direction
  with the normalised velocity (ship forward is `(sin rotation, -cos rotation)`; reverse engines
  flip the sign). Negative alignment means the engine is fighting momentum: a shared
  `engine-strain.wav` bed fades in per nozzle, and the normal hum ducks by up to 45%, so firing
  the mains while flying backwards (or S while flying forwards) sounds laboured.

Alignment fades to zero below ~3 m/s so a stationary ship has no meaningful direction; all layer
gains are smoothed at ~18/s to stay click-free. `forwardTerminalSpeed()` lives in
`ship-flight.ts` and is shared with the camera lookahead so there is one definition of terminal
speed.

**Consequences:** terminal-speed tuning changes both camera lookahead and engine audio; new
engine effects should take a pure function of flight state so they stay unit-testable. All
loops remain seamless, so rate ramps are safe.

## ADR-013 — Sleek electric-turbine engine timbre

**Status:** accepted (2026-11-07); refines ADR-011/012.

The earlier hums read as buzzing. The causes were structural: zero-phase harmonic stacks (a
pulse train with a dense comb spectrum), `tanh` saturation adding intermodulation, and noise
beds loud enough to hiss. The mix now leans on clean additive synthesis:

- sparse harmonic spines with **random per-harmonic phase** and smooth decay,
- exact-harmonic slot whines around 1.2–4.3 kHz with very slow, shallow vibrato (the "electric
  motor" character), no inharmonic partials,
- every group has a different whine centre (main ≈1.2–2.2 kHz, sides ≈2–3.5 kHz, reverse
  ≈2.7–4.3 kHz) so they read as one turbine family but stay distinguishable,
- only a low-passed noise bed at ≤0.07 for body; no saturation stage.

The speed ramp was made more urgent to sell velocity: hum pitch rises with `speedFraction`
(+8% at forward terminal), hum gain gets a +12% speed-coupled lift (bases reduced to keep
headroom), the rush bed's gain is `speedFraction^1.35` up to 0.85 and its rate sweeps 0.90 →
1.10. `engine-rush.wav` is itself tonal air + sheen rather than broad hiss.

**Consequences:** keep new engine layers sparse, phase-randomised and free of clipping; if a
loop sounds buzzy, suspect dense harmonics or saturation before adding EQ.

## ADR-014 — Camera zoom scales the listener volume

**Status:** accepted (2026-11-07).

Zoom already changes apparent distance (the ship and dust shrink, the sky holds), but the mix
stayed at full level, so pulling out felt visually farther without sounding it. `AudioManager`
now exposes `setListenerGain()`, which drives Howler's master gain, and the scene feeds it
`listenerGainForZoom(zoom)`:

- 1× (default, max zoom-in) = full volume,
- 0.02× (50× zoom-out limit) = 0.20 (−14 dB),
- a `zoom^0.7` curve so the first wheel notches fade gently and far zoom-out reads clearly.

Driving Howler's master (rather than per-voice gains) means one-shots already in flight fade
with the camera, and mute/unmute restores the current distance level (`Howler.mute` restores
`Howler._volume`). Zoom is already eased at 8/s, so the gain changes are smooth without extra
ramping; `setListenerGain` skips sub-0.001 updates.

**Consequences:** new audio automatically respects zoom as long as it goes through
`AudioManager`; if per-voice distance tweaks are ever needed, apply them _on top of_ the master
listener gain, not instead of it.

## ADR-015 — Shots are committed at trigger time, not at spawn time

**Status:** accepted (2026-11-07).

Turret pairs fire only while the mouse is inside their aiming cone, and each weapon sound
starts immediately while its projectile waits out the clip's charge delay (`WEAPON_SHOT_DELAYS`,
~0.28 s for the rear pairs). Bullets used to read the live muzzle list when the charge finished,
so pulling the trigger inside a cone and then moving the mouse out played the charge and shot
audio but spawned nothing — a visible/non-audible mismatch.

`fireWeapon` now commits the shot when it is triggered: `muzzlesForPair()` selects the tracking
barrels, `commitShot()` freezes their poses into the pending queue, and `advanceShots()` spawns
from that snapshot. Only the ship transform is read live (position, rotation, velocity), so the
tracer leaves the muzzle in the direction it was aimed at the trigger pull. If no barrel is
tracking the pair, `commitShot` refuses the shot, so a sound can never play without a projectile.

The turret charge glow latches per barrel (`latchedBarrels` in `turrets.ts`): a barrel that was
tracking while its pair charged keeps its glow after the mouse leaves the arc, while the pair's
other barrels stay at rest. The latch clears when the pair's glow level returns to rest.

**Consequences:** keep charge timing in `weapons.ts` and freeze any pose-dependent state there —
do not resolve live turret state inside the spawn callback; that is exactly the bug this ADR
removes. Barrels that were never in the arc must never glow or fire from a committed shot.

## ADR-016 — Two aiming modes: mouse tracking and all-forward

**Status:** accepted (2026-11-07).

Mouse aiming is precise but leaves half the battery idle unless the player waves the cursor
across the ship. Keyboard flight also wants a fire control that does not depend on the pointer.
**1** keeps the existing mouse tracking; **2** puts every mount at the forward-most aim its own
cone permits (`forwardAimInArc` clamps 0 into the arc): front turrets point dead ahead, the
middle four sit 45° off the nose, and the rear pair ends up broadside, because that is as far
forward as their side-to-rear cones reach. All four pairs are hot in this mode, and **Space**
fires the whole battery while held; each pair still respects its rate of fire.

Mode is scene state, not turret state: `TurretFrame.mode` tells the turrets which aim resolver to
use, and the scene picks the fire input (`fireHeld()` = click in mouse mode, Space in forward
mode). Space is deliberately inert in mouse mode, and the crosshair is irrelevant in forward
mode so keyboard-panned shots are centred (`pan = 0`).

**Consequences:** keep mode-dependent aim/fire decisions in `weapon-mode.ts` and the scene; a
mount's forward aim must always be clamped into its cone, never assumed to be 0. Fire input and
aim mode are separate: adding a third mode means a new resolver, not new turret state.

## ADR-017 — Weapon systems: guns and the mining rig

**Status:** accepted (2026-11-07).

Firing modes were becoming one axis: mouse aim, all-forward, and now a second weapon system.
The axes are separate. **Tab** cycles the weapon _system_ (`guns` / `mining`); **1 / 2** select
the gun _aiming_ mode and are inert while mining. The turrets take a resolver
(`turretAimMode()`): `mouse`, `forward`, or `mining`, which tracks the pointer with the front
pair only and parks the six tractor barrels at their forward limit.

Mining rules:

- Front pair = **red mining lasers**, mouse-aimed inside their cones. A beam ray-tests a circle
  around the asteroid (`rayCircleHit`); a hit melts off a molten chunk that leaves along the
  beam's **reflection** about the local surface normal (`reflectDirection`), with scatter so
  repeat hits do not stack.
- The six middle/rear barrels = **green tractor beams** with a 5 m reach, measured from the
  barrel. They are autonomous while the rig is equipped, and each barrel **rotates fully** (no
  cone clamp) to point at the chunk it holds, so the beam visibly follows its cargo.
- Assignment is **one beam per chunk**, so at most six chunks are carried at once. Grips are
  **sticky**: a beam keeps its chunk until it is delivered or lost, and an earlier barrel always
  keeps a contested chunk (a later beam never steals it). Only a _free_ beam hunts, claiming the
  chunk furthest from the hull within reach — the freshest metal, likeliest to drift off. Spare
  beams idle instead of stacking onto one object.
- Two carry models live side by side, switched in game with **P** and shown in the hint:
  - `curved` (default): `arcToward` arcs the chunk to the hatch at a bounded turn rate and
    reduced orbital speed, so a tractor barrel can always keep its beam on it.
  - `physics`: `steerToward` treats the chunk as a mass — bounded acceleration, real momentum,
    arrival steering — so it eases in naturally and can genuinely miss if the ship flies off.
    Both apply the step **in the ship's frame** (ship velocity is added first), so cargo keeps up
    with a flying ship instead of falling behind. Neither can overshoot: the final step is clamped
    to the remaining distance.
- If every beam loses the chunk (5 m reach) it is dropped and drifts freely again. Leaving mining
  mode drops all grips. Uncaptered metal cools and fades after ~8 s so it cannot starve the pool,
  but a **gripped chunk's lifetime is reset every frame**: cargo in transit is never aged, so it
  cannot cool away between the beam and the hatch.
- The intake is the **hull's own slatted hatch** between the two rearmost pairs (ship-texture
  pixels: centre `(-1, 123)`, half-extents `23 × 45`), so no grill graphic is drawn. Any chunk
  whose centre enters that rotated rectangle is handed to a short **swallow** animation (~0.3 s)
  in which the chunk sinks the rest of the way into the hatch and scales to zero; only then does
  the cargo counter tick up, so metal visibly disappears into the ship instead of snapping away.
  The intake does not require a tractor beam: stray metal that drifts in on its own is swallowed
  too, so a chunk never has to wait for a beam to become cargo.
- While the rig is equipped the hatch also pulses **three concentric rounded-rectangle rings**
  drawn in the hatch's own shape. Each ring spawns at **1.2×** the hatch outline and scales down
  past **0.7×**, so it visibly crosses the hatch boundary on the way in — the pulling-in look of
  movie space-elevator beams. Rings are staggered a third of a period apart, fade in as they
  spawn and fade out as they land, quicken (~1.7×) and brighten while cargo is inbound, and the
  intake flashes on each delivery. A landed ring never exceeds 1.2× the hatch height; the rings
  are pure `Graphics` strokes (6 px halo + 1.8 px core) redrawn each frame — six small
  rounded-rect strokes, no filters or textures.
- Mining glow colour is **composited, not just tinted**. Over the blue hull an additive red or
  green glow washes out to white/cyan, so mining muzzle glows use a neutral **white** glow
  texture (the gun glow's cyan texture stays for guns) and **normal blending**, letting the red
  laser pair and green tractors read true; the laser muzzles are 1.3× bigger and brighter
  (alpha 0.9 idle → 1 when firing) than the tractors. Intake rings are normal-blended for the
  same reason. Tractor beams stay **additive** (they mostly cross dark space) but use a
  zero-blue green (`0x2eff33`) so the additive result stays green instead of teal.
- Chunks are drawn as **small flat-solid shapes**, not glows: one square and one triangle texture
  (32×32, flat fill, thin rim, light glow, normal blending). The old additive radial blob read as
  pure light with no metal in it; gradients, an inset molten core and irregular polygons were all
  needless detail at a 0.35 m sprite. Keeping **two** textures means the chunk sprites batch in
  two draw calls instead of eight; the sprites themselves are the same pooled 256, baked once,
  with only position/rotation/alpha touched per frame.
- Metal leaves the laser slowly (1.2–2.8 m/s along the reflection) and cools while drifting, an
  exponential `dampVelocity` of 0.55 /s, so a burst settles near the ship instead of sailing past
  and the short-reach beams can catch it.
- Beams and chunk sprites live in the same metric world container as tracers, so they scale with
  zoom and pan with the dust layer. Chunks are object-pooled (64). No mining audio yet.

**Consequences:** mining never fires gun pairs (`updateWeapons` returns early in mining mode) and
gun barrels never emit tractor beams. Laser aim, tractor reach, tractor acceleration and the
hatch rectangle remain separate knobs in `mining.ts`; the pure geometry (`mining-model.ts`) stays
DOM-free and unit-tested.

## ADR-018 — Solid asteroid circle collider and the shield capsule

**Status:** accepted (2026-11-07).

The asteroid was background art: the ship flew through it and tracers passed through it. The
ship is long and pointed and the rock is roughly circular, so the cheapest honest collision model
is **one circle for the rock** and **one capsule for the hull**, both computed from the baked art
proportions. No physics engine is involved, and none is wanted: there is exactly one static body
and one moving body, the arcade flight model already owns the ship's motion, and a solver would
add a dependency, its own timestep/units, and its own position state that would then have to be
reconciled with the metric flight state and the dust-layer camera pan every frame. Push-out plus
a restitution bounce is a few dozen lines, is deterministic, and stays unit-testable.

Rules:

- **Asteroid collider:** one circle, radius set from the colour map's silhouette
  (`ASTEROID_RADIUS_OF_WIDTH = 0.476` — the opaque pixels' 95th-percentile radius). The same
  radius feeds the mining laser ray test, so the laser, the ship and tracers all agree on where
  the rock is.
- **Ship collider = the shield:** the hull's collider is a capsule down the centre line
  (`radius = 0.38 × ship width`, straight section `0.3 × ship height`). The shield draws that exact
  capsule in ship-texture pixels, so the rock visibly stops at the shield surface; because it is a
  capsule rather than a circle, the nose and tail cannot sink into the rock while the sides stay
  snug. The capsule rotates with the hull.
- **Response:** when the capsule overlaps the rock, the ship's position is pushed out along the
  contact normal by the penetration and the inward component of velocity is reflected with
  `SHIP_IMPACT_RESTITUTION = 0.35`; the tangential component is kept, so glancing hits slide.
  The ship's angular state is untouched — the shield takes the hit, not the controls.
- **Tracers:** each bullet is swept from its previous to new metric position against the rock
  circle (`segmentCircleHit`), so fast rounds cannot tunnel through. The tracer is dropped at the
  surface; there is no impact art yet.
- **Shield look:** the boundary is the brightest part and the glow fades inward (seven inset
  strokes), so the capsule reads as a surface. It is always visible (idle alpha ≈ 0.6) and
  breathes slightly. Impacts do **not** flash the whole bubble: the shield keeps a contact point
  returned by the collision, converts it into ship-texture space, and lights a radial bloom there
  that decays over ~0.3 s, scaled by impact speed.

**Consequences:** because the ship starts within one nose-length of the rock, turning the shield's
nose toward the asteroid puts it in contact immediately — the push-out keeps them apart, so the
ship can never begin a frame inside the rock. Collision geometry stays pure (`asteroid-collision.ts`)
and unit-tested; the shield is purely a renderer of that same capsule. Adding moving asteroids or
debris later would mean a broadphase and multiple circles, not a rewrite of this response.

## ADR-019 — Hull-shaped shield bubble and the centre-of-mass pivot

**Status:** accepted (2026-11-07).

Two follow-ups to ADR-018. First, a single capsule was the wrong collider _and_ the wrong
picture: it cut through the wing tips and the nose, and a plain rounded rectangle would look
cheap. Second, the ship turned about its texture centre, which sits forward of the cargo hatch,
so turns felt like they pivoted in front of the ship rather than around its mass.

Rules:

- **Shield shape is a hull bubble.** The collider is a convex outline around the hull — pointed
  nose, wing tips, short blunt tail — inflated by a bubble radius; that is exactly the union of
  capsule segments along the outline's edges with rounded joins. Collision is point-to-convex-
  polygon distance against that outline with `radius + rockRadius` as the reach, so it is a
  handful of segment-distance tests per frame (cheap), while the visible shape follows the ship
  instead of a generic rectangle. The outline is drawn from ship-texture proportions, so it
  scales with the hull and the layout.
- **The boundary is the bright part.** The shield is a single static `Graphics`: faint body fill,
  a soft outer bloom, then inset outlines (the outline offset inward at the bubble radius minus
  each step) fading toward the middle, a hot 2 px boundary line and a second faint inner contour.
  Only the container transform and alpha are touched per frame.
- **Impacts light the shield, not space.** The contact bloom is a radial sprite **masked to the
  bubble shape**, so it brightens the shield around the contact point and is clipped at the
  boundary instead of spilling into the starfield.
- **Physics centre of mass is the orange panel behind the cargo hatch** (`SHIP_COM_AFT_PX`).
  `flight.x/y` remain the integrated state but now mean the centre of mass; `shipCentre()`
  derives the texture-centre pose used by rendering, turrets, mining, muzzle poses and the
  shield. Collision resolves on the hull centre and is converted back to the pivot. The camera
  tracks the centre of mass, so the hull's visual centre orbits the pivot and hard turns swing
  the nose wide. Layout seeds the pivot aft of the layout position so the hull still starts where
  it did.
- **No art edits.** The pivot is a physics change only; the ship texture is untouched.

**Consequences:** anything that needs the hull's visual centre must go through `shipCentre()`;
using `flight.x/y` directly for rendering or muzzle origins would double-count the pivot offset.
The hull bubble remains pure and unit-tested in `asteroid-collision.ts`; the shield only draws the
same shape.

## ADR-020 — Impulse collisions: mass, restitution and shield friction

**Status:** accepted (2026-11-07).

Bumps against the asteroid felt like a wall sliding the ship: the response only reflected the
normal component and ignored how the hull is a heavy object being stopped at a lever arm. The fix
is a proper impulse response against the static rock, still without a physics engine: one rigid
body, one static circle, ~40 lines of deterministic math.

Parameters (in `lighting-scene.ts` unless noted):

- **Ship mass `SHIP_MASS_KG = 24 000`.** Mass sets the hit's energy (`½mv²`), which drives the
  shield flare, the camera shake and the spin the hull picks up. Inertia is derived from the
  hull: `I = m (0.3 × length)²` (radius of gyration ≈ 0.3 × hull length).
- **Shield restitution `SHIELD_RESTITUTION = 0.22`.** The shield absorbs most of the hit and
  returns a fifth: a 10 m/s ram leaves ~2.2 m/s of separation, so the ship thuds off the rock
  instead of pinging away.
- **Shield friction `SHIELD_FRICTION = 0.5`.** Coulomb-friction impulse clamped to `μ ×` the
  normal impulse, applied at the contact patch along the sliding direction. Glancing hits scrape
  and slow the ship and add spin; head-on hits have no tangential slide and no friction.
- **Off-centre hits spin the hull.** The impulse is applied at the contact point with a lever arm
  from the centre of mass (`SHIP_COM_AFT_PX`), so a hit on the nose or a wing rotates the ship
  about its pivot. Collision spin is tracked separately (`impactSpin`) and bled off at
  `IMPACT_SPIN_DAMPING = 1.2 /s`, clamped to 1.2 rad/s: the flight model only damps angular
  motion while input is held, so without this a hit would leave the ship spinning forever.
- **Weight is felt as motion + feedback.** Camera shake peaks at `SHAKE_PEAK_PIXELS = 9` and is
  scaled by hit energy (`SHAKE_ENERGY_REFERENCE_J = 90 kJ` saturates it), decaying at 4.5 /s.
  The shield's contact bloom already scales with impact speed.
- **No physics engine.** The rock is static scenery with effectively infinite mass; there is no
  broadphase, stacking, or constraint to solve. An engine would add a dependency, its own
  timestep/units and its own body state that would have to be reconciled with the metric flight
  model and camera pan every frame. It becomes worth it only with many dynamic bodies (debris
  fields, tumbling rocks, chained collisions), which this demo does not have.

**Consequences:** the impulse response stays pure in `asteroid-collision.ts`
(`resolveShipCollision(ship, hull, circle, body)`) and is unit-tested for bounce, friction, spin,
energy and separation. Everything physical is SI: mass in kg, inertia in kg·m², impulses in N·s.

## ADR-021 — Asteroids live in the world, as a field

**Status:** accepted (2026-11-07).

The first asteroid was placed by the screen layout next to the ship: it scaled with the
viewport and there was exactly one. The direction is now a field of rocks the ship flies between,
so asteroids moved into the **dust-layer world**: each rock has a metric position and a diameter
in metres, and it pans and zooms with the environment like everything else.

Rules:

- **`src/app/asteroid-field.ts` owns them.** `add(x, y, diameter)` creates a lit mesh (shared
  colour/normal textures) and a fitted circle collider; the field exposes `getColliders()` and
  `getMiningTargets()` and does the per-frame transform work (world px → screen px through the
  dust transform, scaled by zoom) plus lighting. Adding a rock is one call, so a field of them is
  just a loop.
- **Rocks are metric size now.** Diameter is fixed in metres instead of being derived from the
  viewport scale, which is the correct model once rocks are world objects; the layout gives the
  seed rocks the same on-screen size as before at 1920×908.
- **Seed field:** the demo rock beside the ship plus **one new rock 20 m dead ahead** of the
  hull's centre (`ASTEROID_AHEAD_METERS = 20`). At the default 1× zoom that rock starts just off
  the top of the screen — it is 1280 px away at 64 px/m — so you fly at it or scroll out to see
  it.
- **Every system consumes the same list.** Ship collision resolves against each rock in turn
  (strongest hit drives the shield flash and shake); tracers are swept against every circle;
  mining bites the **nearest rock along each beam**, so any asteroid can be mined, not just the
  demo one.
- **No physics engine, still.** With static rocks this is collider work, not solver work; a
  uniform-grid broadphase is the next step if the field reaches hundreds of rocks. An engine
  becomes justified when the rocks themselves are dynamic (tumbling, pushing, resting contacts)
  or when debris needs chained contacts.

**Consequences:** rock count is the field's responsibility; scene code only iterates the collider
list. Grow the field with `add()`, and keep the collider math pure in `asteroid-collision.ts` so
the same response works for any number of rocks.

## ADR-022 — Second asteroid art variant

**Status:** accepted (2026-11-07).

A second asteroid was supplied (rounder, more cratered than the first) for the rock parked ahead
of the ship. It is a separate art variant, not a reskin of the first: `createAsteroidField` now
takes an array of `AsteroidArt` (colour + normal) and `add(x, y, diameter, variant)` picks one, so
more supplied asteroids can be added without touching the field's contract.

The new art went through the **same one-off treatment** documented in
`public/assets/lighting/README.md`, so it lights identically to the existing rocks:

- magenta chroma-key to alpha with soft-edge matte extraction and despill,
- trimmed to the silhouette with a 4 px transparent gutter,
- resampled in premultiplied alpha (LANCZOS) at roughly 2× the rock's on-screen size
  (620 px wide at the current camera scale),
- normal map masked with the colour alpha and paired at identical framing,
- normals **softened to ~0.30** (blended toward a flat `(0, 0, 1)` normal) because the art already
  has baked cel shading; flat `(127, 127, 254)` normals fill the transparent gutter so linear
  filtering never pulls a sideways normal into the silhouette edge.

The processed silhouette radius measures **0.474 × art width** against the first rock's 0.477, so
both use the shared `ASTEROID_RADIUS_OF_WIDTH` collider ratio rather than a per-variant constant.
The supplied sources live in `docs/reference/asteroid2-*.webp`; runtime copies are
`public/assets/lighting/asteroid2-*.png`.

**Consequences:** adding an asteroid is now "supply art, process it with the documented pass,
append it to the field's art array, pick its variant index". Keep processed textures out of the
source tree and the pipeline one-off.

## ADR-023 — Melting takes dwell time; melt regions stick to the spinning rock

**Status:** accepted (2026-11-07).

Mining previously sprayed a chunk every 0.1 s wherever the laser happened to be, and the chunks
were orange. Both were wrong: metal should take time and heat to melt, the visual should show
_where_ the rock is being melted, and the debris should look like cooled metal, not fire.

Rules:

- **Dwell to melt.** Each laser barrel keeps its own heat (`meltHeat`) and a world-space aim
  point. While the beam bites the rock and the hit point stays within `MELT_DWELL_RADIUS_M`
  (0.6 m) of that point, heat accumulates; at `MELT_SECONDS` (1.1 s) one chunk melts off and the
  heat resets. Sweeping the beam to a different spot resets the charge, so the laser drills one
  spot instead of painting chunks across the rock. Two front barrels melt independently.
- **Orange melt patches mark the region.** The heating spot is drawn in an orange layer
  (`melt`, normal blending so the colour reads against the brightly lit rock) growing from
  0.08 m to 0.30 m with heat, with a pale core and a small white-hot beam pinpoint on top. When a
  chunk is released, the patch **stays on the rock** as a cooling melt region for
  `MELT_COOL_SECONDS` (4 s), fading out; a small pool (24) means old scars recycle.
- **Melt regions spin with the asteroid.** The rock art rotates, so the collider is a circle and
  the melt decal must not be anchored in world space. The spot is stored in the rock's local
  frame (offset from its centre rotated by `-rotation` at spawn) and drawn back through the
  rock's **current** rotation, using the spin exposed by `getMiningTargets()`. The beam still
  ends on the live ray hit (where the barrels point); the scar it leaves rotates away with the
  surface — which is what a spinning rock does.
- **Chunks are grey-blue metal**, not molten orange: flat fills `#9fb2c6` / `#8a9cb0`, a dark
  blue-grey rim and a faint cool halo. They still leave along the reflected laser direction.
- **The second asteroid is 3× the base diameter** (`ASTEROID_AHEAD_SCALE`), i.e. ~18.7 m across,
  so the rock ahead reads as a landmark and gives the dwell-time mining something to chew on.

**Consequences:** chunk cadence is now `MELT_SECONDS` per barrel while a beam is held steady;
aiming accuracy and dwell matter more than rate. Melt decals are pure rendering state in
`mining.ts` (no entities), and the rock's spin is part of its mining target, so any future
rotating bodies get the same treatment for free.

## ADR-024 — Melt look: irregular ember craters, slow asteroid tumble

**Status:** accepted (2026-11-07).

The first melt pass read as a clean orange dot: two perfect circles that grew on a timer, on a
rock spinning at 0.22 rad/s. Real rock melts are ragged, flicker, spit, and the rock itself is a
heavy object — it should tumble slowly.

Rules:

- **Asteroids tumble slowly.** Spin is now seeded per rock at **0.02–0.06 rad/s** in either
  direction (`0.22` was pinwheel-fast): a 20 m rock takes minutes to turn, not seconds.
- **Melt patches are torn, not circular.** Four pre-generated irregular crater outlines (10 unit
  points with radii jittered 0.68–1.22) are picked per heated spot, with a per-spot flicker
  phase. Drawing is layered: a dark torn rim (`MELT_RIM_COLOR`), a molten orange pool, a hot
  core, and two additive bloom polygons slightly larger than the crater, all scaled by radius and
  wobbling on two sine frequencies so the patch breathes instead of pulsing uniformly.
- **Live melts spit embers.** Three small additive ember dots orbit/drift out of a live patch
  (only while intensity is high; cooling scars don't spit), each with its own phase and wobble.
- **Scars keep their shape.** A finished melt stores the crater shape and phase with its local
  rock offset, so cooling scars keep the same torn outline as they fade, spinning with the rock.
- Chunks stay grey-blue; only the molten craters are orange, matching how metal glows while
  heated and sets once it is torn off.

**Consequences:** all of it is still pure `Graphics` drawing plus pool state in `mining.ts` — no
particles, textures or filters. Shape variants and flicker are seeded (deterministic), so the
look is stable across runs.

## ADR-025 — Two-stage asteroid colliders: circle fast pass, silhouette polygon narrow pass

**Status:** accepted (2026-11-07).

A single fitted circle was a placeholder: the rock art is an irregular polygon, so the circle
sometimes poked outside the visible silhouette (and left gaps inside it), and bumps looked wrong.
The rock also tumbles, so whatever collider exists has to turn with the art.

Rules:

- **The collider is traced from the art.** Per art variant, once at startup, the colour map's
  alpha is sampled into 28 angular slices around the texture centre; each slice keeps its
  maximum radius; empty slices interpolate from neighbours; the result goes through a convex
  hull. The template is scaled to each rock's diameter and stored as an **`AsteroidCollider`**:
  world centre, current rotation, convex outline in local metres, and a bounding radius.
- **Fast pass, then accurate pass.** Every query starts with the **bounding circle**:
  ship-vs-rock rejects on centre distance > rock radius + ship bounding radius; ray tests use a
  cheap circle/range reject; tracer segments use the circle before touching the polygon. Only
  survivors pay for polygon work.
- **Ship collision is separating-axis** between the rock's rotated outline and the ship hull
  polygon inflated by the shield bubble radius (the bubble rounds the hull, so its support grows
  by `radius` on every axis). The minimum-overlap axis gives the contact normal and depth; the
  existing impulse response (mass/inertia, restitution, Coulomb friction) is unchanged, so hits
  still spin the hull about its centre of mass. The contact patch is the ship hull's support
  point toward the rock plus the bubble radius — still the shield surface.
- **Lasers and tracers use the polygon.** Mining rays clip against the rock's half-planes
  (fast circle reject first) and return the nearest surface hit; tracers use a swept segment test
  (either endpoint inside or an edge crossing). Chunk spawn normals and melt-disc offsets come
  from the **true surface edge normal** (`polygonHitNormal`), so debris leaves perpendicular to
  the silhouette face it was cut from.
- **Colliders turn with the rock.** `getColliders()` and `getMiningTargets()` return the same
  objects, and the field updates each collider's rotation with the mesh every frame — so the
  polygon, melt decals and the visible art all agree while the rock tumbles.

**Consequences:** the circle constants (`ASTEROID_RADIUS_OF_WIDTH`, `rayCircleHit`) are gone; art
silhouettes drive collision. Cost stays small: a handful of rocks × ~28-edge SAT and clipping,
with the circle rejecting most of it. Concave dents are hulled away — acceptable, since a rock's
bites are shallow compared with its outline; add multiple convex pieces later only if a shape
needs real concavity.

## ADR-026 — Concave compound colliders, not a convex hull

**Status:** accepted (2026-11-07), superseding the convex-hull note in ADR-025.

The first polygon pass hulled the silhouette. On screen that reads as the collider _never going
into the inner bites_: the hull bridges every dent, so bumps and laser hits stop on a smooth
outline that isn't the rock. Convexity is only needed by the SAT stage, not by the data — so the
rock became a **compound of convex pieces**.

Rules:

- **Silhouette stays concave.** The per-art outline is the radial sample polygon itself (48
  angular slices, max radius per slice), in angular order. It is star-shaped around the texture
  centre, so the natural decomposition is a **fan of triangles** (centre → each edge), which
  together cover the real silhouette exactly.
- **Ship collision is per triangle.** Fast circle reject, then each fan triangle does a
  separating-axis test against the ship hull inflated by the shield bubble; the piece with the
  deepest overlap produces the contact normal and depth. The impulse response is unchanged.
  Concave notches are now empty space for the ship — the test suite proves a ship sitting in a
  notch (inside the old hull) does not collide, while contact with an arm does.
- **Lasers and tracers use the concave data.** Rays clip against each fan triangle and take the
  nearest entry; tracers use an even-odd point-in-polygon test plus polygon edge crossings, so a
  chord across a notch passes through instead of registering a false hit.
- **The gizmo shows the truth.** F2 draws the actual sampled outline (green, with vertex dots),
  the bounding circle and the ship's cyan hull bubble — the tool used to catch the convexity
  problem. It is on by default while the colliders are being tuned.

**Consequences:** cost is a handful of triangles per rock (48 × small SAT/clip tests) on top of
the circle reject; still no physics engine, because this _is_ what an engine's compound collider
would do — one rigid body against static scenery. The fan decomposition assumes radial
star-shapedness from the silhouette centre, which the radial sampler guarantees.

## ADR-027 — Trace the silhouette contour, not angular bins

**Status:** accepted (2026-11-07).

The first polygon sampled 48 angular bins and placed each bin's maximum radius at the bin
_centre_ angle. On a faceted rock that is the wrong vertex position: the max point belongs to a
specific angle inside the bin, up to half a bin away. At 200 px radius a half-bin error puts the
vertex ~17 px tangentially off, so the outline visibly cut corners and the collider looked
inaccurate against the art even though its data was consistent.

Rules:

- **March rays, don't bin.** For each of 128 sample angles, a ray steps outward from the texture
  centre through the alpha mask and keeps the outermost opaque pixel (`> 128` alpha). The vertex
  therefore sits on the real contour at exactly that angle. Cost is ~128 × radius lookups per art
  variant, once at startup.
- **Same compound physics.** The 128-point contour feeds the fan-triangle decomposition for SAT,
  concave point-in-polygon and edge tests for tracers, and per-triangle ray clipping for lasers;
  the circle fast pass is unchanged.
- **Accuracy is measured, not eyeballed.** With the mesh hidden and shown, the rendered
  silhouette and the gizmo line are compared by angular profile: mean separation is ~2 px on a
  ~200 px radius (~1 %), which is the stroke half-width plus the texture's soft alpha edge; the
  contour no longer cuts faceted corners.

**Consequences:** vertex count is fixed at 128 for every art variant (predictable cost). If the
field grows large, decrease `SILHOUETTE_SAMPLES` for distant rocks, or add a distance LOD — the
physics contract does not change.

## ADR-028 — Low-poly collider fit with a vertex budget

**Status:** accepted (2026-11-07).

ADR-027 fixed the vertex _placement_ by tracing the contour ray-by-ray. It did not fix the
vertex _count_: 128 points per rock, and every query pays per vertex — ship SAT builds one
triangle per edge, each laser ray clips per triangle, each tracer segment tests every edge. With
a field of asteroids coming, that is the wrong scaling.

Rules:

- **Trace subpixel, then simplify.** Each ray now interpolates the alpha crossing between the
  last opaque sample and the first transparent one, so contour points lie on the real edge
  instead of the pixel grid. Without this, Ramer–Douglas–Peucker chases staircase noise and
  keeps almost every sample.
- **Closed-polygon Ramer–Douglas–Peucker with a budget.** `src/app/polygon-fit.ts` simplifies the
  closed loop (split at the vertex farthest from the first, simplify both halves, join without
  duplicating the seam) and grows the tolerance from 1 % of the rock radius until the outline
  fits `COLLIDER_MAX_VERTICES = 32`. The two current art variants fit at **24 and 28 vertices**
  (down from 128) with ≤ ~2 % of radius deviation — below the stroke width at normal zoom, and
  well under the ~0.2 m that matters for a 24 t ship.
- **Accuracy is a budget, not a religion.** The art is faceted, so the silhouette has dozens of
  small scallops that no gameplay interaction can feel. The vertex budget is the tunable knob;
  raise it if a hero rock ever needs a tighter fit.
- **Cheap where it counts.** Fan triangles are cached per rock (keyed by its stable local points
  array) instead of rebuilt per query, and SAT skips pieces whose bounding circle cannot reach
  the ship before doing any separating-axis work. Ray and tracer tests still walk the simplified
  edges directly.

**Consequences:** per-rock collision cost drops roughly 4–5×, and adding rocks scales with ~26
triangles each rather than 128. The collider is now visibly low-poly in the F2 gizmo, which is
the point: it matches the faceted art rather than the anti-aliased alpha fringe. If distant-rock
cost ever matters, the same budget can drop with distance without touching the physics contract.

The fan decomposition is guarded by a cheap kernel test (`pointInKernel`, measuring deviation in
both directions): both shipped outlines stay star-shaped after simplification, so the fan is used;
if future art does not, `buildEarClip` triangulates instead and verifies that the pieces sum to the
polygon area. Tests cover a U-shaped outline where the centre is outside the kernel.

See `docs/research/polygon-collider-simplification.md` for engine limits, algorithm comparisons,
and the measured vertex/error table behind these constants.

## ADR-029 — Mass-based flight with the engines as force sources

**Status:** accepted (2026-11-07).

The flight model was acceleration-based: thrust, reverse and turn torque were abstract numbers in
m/s² and rad/s², so the ship had no mass in its handling, and a turn was a scripted angular
acceleration that the engine visuals and engine mix never actually caused. Mass existed only in
the collision solver.

Rules:

- **Every nozzle is a force source.** `src/app/ship-engines.ts` turns the baked
  `engine-layout.ts` art into `EngineMount`s: group and mix index, nozzle position relative to the
  centre of mass in body metres, and thrust direction (main = nose-forward, reverse = aft). The
  mounts are rebuilt from the current layout scale, like the collision hull.
- **Input becomes force in one place.** `engineWrench(linearInput, angularInput)` runs the ramped
  inputs through the existing `computeEngineOutputs` mix and sums `thrust × output` per nozzle into
  a body-frame force and torque. The same mix already drives the flames and engine audio, so
  physics, exhaust and sound agree.
- **Mass and inertia are real.** Acceleration is `force / mass`; yaw acceleration is
  `torque / inertia`, with inertia from the hull's radius of gyration (≈ 0.3 × hull length).
  Mass is a tuning value (default 18.5 t) shared with the collision solver, so impacts and handling
  read the same number.
- **One thrust per engine group.** `mainThrustN` and `reverseThrustN` are per-engine, in newtons.
  The groups can be tuned independently; ADR-030 balances the yaw couple so a weaker reverse
  group still produces a pure turn instead of creeping forward.
- **Drag stays a velocity multiplier.** Both drags apply while any input is active (as before),
  matching Unity/Box2D damping semantics: mass changes acceleration/top speed, not the decay rate.
- **Terminal speeds are derived, not capped.** Forward terminal = Σ main thrust / (mass × drag);
  reverse terminal uses both reverse engines; yaw terminal = nozzle torque / (inertia × angular
  drag). All three are shown in telemetry.

**Consequences:** a heavier ship accelerates and turns more slowly and has a lower terminal speed
for the same thrust; the mass slider also makes impacts heavier because collision uses the same
mass/inertia. Turning while thrusting loses forward thrust — the mix cuts the inside main
engine and lights the same-side reverse engine — so a full-yaw burn keeps well under its
straight-line force. That is what the baked flames already showed; if it feels too costly, retune
the mix or the thrusters rather than reintroducing a synthetic yaw torque. The geometry is built
from the layout scale, so a window resize rescales the ship and its drive together (the world
already scales with the viewport).

## ADR-030 — Force-balanced yaw couple so unequal engines still turn pure

**Status:** accepted (2026-11-07).

ADR-029 made yaw emerge from the engine mix: turning fires one reverse engine and
lights the opposite main engine. That couple only cancels its linear force when
both engine groups have the same thrust, so lowering the reverse engines to get
lighter braking also made every turn drift forward.

Rules:

- **The couple is a pair, not two independent commands.** `turnThrustBalance(mainThrustN,
reverseThrustN)` returns the per-group scale that equalises the two sides: the pair force is
  `min(main, reverse)`, and the stronger group is throttled down to deliver it
  (`engine-mix.ts`).
- **Only the turn component is scaled.** The mix applies the balance to the turn term
  (`turnRight * balance.main` / `turnLeft * balance.reverse`), not to the throttle term, so W/S
  still use each group's full thrust and braking is unaffected.
- **Physics, flames and audio share the balanced mix.** `ship-flight.ts` passes the balance into
  `engineWrench`, and the exhaust and engine-audio frames carry the same `turnBalance`, so the
  main flame visibly dims to match the reverse nozzle's force instead of lying about it.
- **Yaw authority is the weaker nozzle.** A pure rotation can only push with a force both sides
  can deliver, so terminal yaw now tracks `min(main, reverse)` (visible in telemetry) instead of
  the main engine's thrust. If a future design wants strong yaw with weak braking it needs
  dedicated reaction-control nozzles, not a stronger main engine.

**Consequences:** the reverse-thrust slider no longer introduces translation during turns; it
scales the turn couple and shows up directly as terminal yaw. With equal groups nothing changes
(balance is 1/1); with the shipped 200 kN main / 150 kN reverse the main side of the couple is
throttled to 0.75 and a standstill turn stays at 0.00 m/s. The force balance covers the turn-only
component; a throttle + turn still trades forward thrust for yaw, which is physical.

## ADR-031 — Mining and impact audio: beds for continuous sounds, one-shots for events

**Status:** accepted (2026-11-07).

The added gameplay (mining lasers, tractor beams, cargo intake, collisions, scraping) had no
audio. It has both continuous and discrete parts, and they should not be modelled the same way.

Rules:

- **Continuous states are looped beds.** The mining laser and tractor beams are loops whose
  volume is a smoothed function of the active barrel counts (`mining-audio.ts`), not repeated
  shots. The scrape is a loop whose gain follows the worst tangential contact speed. Loops are
  created through `AudioManager.createLoop()` so they unlock with the first gesture and fade
  with camera distance like every other continuous voice.
- **Events are one-shots with physical gain mapping.** A chunk landing in the hatch fires the
  cargo-intake latch. Contacts above `1.1 m/s` inward fire an impact one-shot (alternating two
  sampled weights) with volume from `sqrt(hitEnergy / 90 kJ)` and a rate that drops as the hit
  gets heavier; a `0.12 s` cooldown keeps resting contacts from machine-gunning.
- **The collision result carries the audio inputs.** `ShipCollision` now exposes `slideSpeed`
  alongside `impactSpeed` and `hitEnergy`, so the scene can hand one frame's worst contact to
  `impact-audio.ts` without re-deriving contact velocity.
- **Assets are generated offline and committed.** Loops quantise every component to an integer
  number of cycles per loop (same rule as the engine hums), so the seam is mathematically
  continuous; one-shots are short mono 16-bit WAVs with edge fades. No build-time pipeline.

**Consequences:** continuous mining/scraping reads as sustained machinery, while impacts stay
punchy and scale with the same energy that drives camera shake and shield flash. New one-shots
need a `SoundName`/`LoopName` entry in `src/audio/audio.ts` and an asset under `public/audio/`;
new beds should follow the loop rules rather than scheduling repeated clips.

## ADR-032 — Shield glow reflects recent impacts, not a permanent light

**Status:** accepted (2026-11-07).

The shield is the ship's collision surface and always visible, but a constant bright boundary
read as a permanently powered dome and competed with the hull art.

Rules:

- **Dim at rest.** The bubble sits at `DIM_ALPHA = 0.2`, enough to read the surface without
  drawing attention.
- **A hit lifts it to the old brightness.** Any contact sets an afterglow to 1 and the whole
  bubble reaches `HIT_ALPHA = 0.58` (the previous resting level), then decays at
  `0.45 /s` — a little over 2 s to rest.
- **Flash and breathing stack on top.** The contact-patch bloom keeps its own faster flash decay
  (3.4 /s), and the slow breathing ripple is weighted toward the lit state so the idle shield
  stays still.
- **Pure curve, tested.** `src/app/shield-glow.ts` owns the alpha math and is unit-tested so the
  dim/bright/decayed levels are pinned without touching PixiJS.

**Consequences:** impacts visibly charge the shield, and the resting ship is quieter on screen.
Grazes and scrapes that resolve without inward speed do not trigger the afterglow; only a real
contact does. If continuous scraping should also keep it lit, feed the slide speed into
`afterglow` in `ship-shield.ts` rather than changing the curve.

## ADR-033 — Stabiliser (hold X): retro burn with attitude alignment

**Status:** accepted (2026-11-07).

A single "stop" action should null both translation and spin, but the thrusters can only push
along the hull axis: mains forward, reversers aft. A naive reverse burn therefore cannot stop a
sideways drift.

Rules:

- **Point at the burn, then burn.** While X is held the stabiliser picks the thruster group that
  opposes travel (reversers for positive axial speed, mains for negative), steers the nose at the
  matching burn angle with a PD attitude law, and only starts the axial burn once the hull is
  within ~18° of that angle — otherwise the thrust would inject a sideways component and the
  ship spirals.
- **Spin is a balanced couple.** The attitude command becomes a side main plus the opposite
  reverse nozzle with equal force, so it adds torque without adding translation. It is clamped to
  the weaker engine pair and the nozzle headroom.
- **Ramped like any other input.** The whole command scales with the input ramp, so the nozzles
  spool instead of snapping; while the stabiliser is active the normal drag rule applies and
  helps settle the last centimetres per second.
- **The mix is the source of truth for visuals.** `stepFlight` returns the per-nozzle mix it used,
  and the exhaust and engine-audio frames consume that mix instead of recomputing it from inputs,
  so a stabiliser burn shows reverse flames and the matching hum.

**Consequences:** holding X from 30 m/s forward stops the ship in ~2 s with a retro burn; a
sideways 20 m/s drift makes the hull rotate to face the drift and then brakes it (~5 s,
converging to under 0.25 m/s while drag finishes the rest). The heading can change during the
manoeuvre when it had to turn to face the burn — that is the cost of having no lateral
thrusters. If the hull should hold its heading instead, the alternative is invisible RCS
translation, which would break the force-from-nozzles rule.

## ADR-034 — Camera lookahead is zoom-independent

**Status:** accepted (2026-11-07).

The near dust/grid layer, asteroids and ship share the same camera transform, so any camera move
is also a world pan. The lookahead offset used to grow as the camera zoomed out, which meant a
wheel notch changed the follow target: the near layer slid relative to the fixed sky, the same
parallax artefact ADR for the integrated star pan fixed.

Rules:

- **Lookahead is metres, not screen pixels.** `followCamera()` computes the lookahead from the
  `speed²` curve and the viewport's short edge, then converts to metres once. It never divides by
  the current dust zoom.
- **The screen offset scales with zoom naturally.** A fixed world offset appears smaller when
  zoomed out, which is fine: the ship is already small and the exhaust has plenty of room. The
  exhaust-room cap is evaluated in metres at the ship's layout scale, not in current screen px.
- **Zoom only scales.** `background` still eases zoom toward `targetZoom`, and the panned star
  layers still only scale about the viewport centre (ADR "stop zoom from translating the
  parallax sky"); the near world now behaves the same way.

**Consequences:** wheel zoom no longer changes the follow target, so the grid/asteroids/dust stay
anchored to the ship and scale about it. The ship sits slightly closer to screen centre when
zoomed out than it did with the boosted lookahead; that is the correct trade for a stable world.

## ADR-035 — The ground grid is a world-space mesh, not a screen-space shader

**Status:** accepted (2026-11-07).

The grid was drawn as a full-screen quad whose fragment shader reconstructed world coordinates
from screen position, camera position and zoom. That should mathematically match the world
layers, but it duplicated the camera transform in the shader and made zoom-anchor/pan bugs hard to
reason about.

Rules:

- **Use the real camera transform.** The grid mesh is a large quad centred on the viewport and
  scaled by the dust zoom; a `uCameraWorld` uniform offsets its local vertices into world pixels.
  The mesh therefore goes through Pixi's world/projection matrices exactly like the dust motes,
  asteroids and ship, so it is in the same space by construction.
- **The pivot is the camera point.** Because the quad stays centred on screen and only its scale
  and world offset change, the world point under the viewport centre (the camera) is fixed while
  zooming; the grid scales about the camera/ship, never about an offset point.
- **Mark the origin.** The world x = 0 line is amber and y = 0 green, giving a world-locked
  reference to eyeball the layer sync and zoom pivot.
- **Cover the viewport at every zoom.** The quad's half-extent covers an 8K viewport at the
  0.02x zoom-out limit; it is centred on the camera so it still covers when the ship is far from
  the world origin.

**Consequences:** the grid now shares the exact transform with the dust layer (verified: same
position/scale and `center - cameraWorld * zoom` mapping for asteroid and dust containers at
multiple zooms), and zooming is visually anchored on the ship. The earlier lookup-based shader
and its `uResolution`/`uCamera` uniforms are gone.

## ADR-036 — Ship CoM at the world origin with a deterministic 100-rock field

**Status:** accepted (2026-11-07).

The demo used to place the ship and one asteroid side by side for framing, plus a hero rock 20 m
ahead. That made the world origin incidental and gave no field to fly through.

Rules:

- **Spawn at the origin.** The flight state (centre of mass) starts at `(0, 0)` on layout and the
  camera follows it there immediately, so the world origin, the camera point and the amber/green
  grid axes all coincide with the ship at start.
- **Deterministic scatter.** `src/app/asteroid-layout.ts` generates 100 rocks from a fixed seed:
  random position, diameter (0.5–2.2x base, ~6 % at 3x) and art variant, with rejection so rocks
  do not interpenetrate and the ship's spawn bubble stays clear. Same seed, same field.
- **Keep the vertical axis free.** Placement requires `|x| - rockRadius >= 5 m`, so no rock edge
  crosses the world y axis and the amber origin line stays readable.
- **No side-by-side framing.** Layout no longer positions the ship next to a pad rock; it only
  sizes the ship/art scale and seeds the field around the origin.

**Consequences:** the initial view shows the ship on the origin axes with clear space around it
(spawn bubble 7 m edge clearance), and rocks appear in the side sectors as you look or fly out.
The full field is visible by zooming out. The previous `ASTEROID_AHEAD_*` constants and demo-rock
seeding are gone; more rocks are one `add()` call, but the field begins from the generator.

## ADR-037 — Procedural asteroid art baked in the browser, with authored silhouettes

**Status:** accepted (2026-11-07).

Two supplied rock arts were not enough variety for a 100-rock field, and tracing a silhouette from
alpha costs time and produces 24–28 collider points. Rather than ship more hand-painted PNGs or a
build-time art pipeline, the game bakes extra variants at startup.

Rules:

- **Generation is deterministic and pure.** `asteroid-art-model.ts` takes a seed and returns
  straight-alpha colour pixels, tangent-space normal pixels, the visual outline and a simplified
  collider silhouette. Unit tests pin determinism, palette variation, silhouette budgets and
  normal/alpha validity. `asteroid-art.ts` is a thin browser adapter that paints those pixels into
  `CanvasSource` textures; it runs once at startup in the browser, not in Node.
- **Look matches the supplied rocks.** The two supplied palettes are reused, faceted Voronoi
  shading is baked into the colour map (the supplied art is painted, not purely normal-lit), and
  craters are faceted polygonal pits with flat floors, straight walls and lit rims.
- **Colliders stay cheap.** The visual outline is 16–24 vertices and star-shaped (valid fan
  kernel); it is simplified once with the existing Ramer–Douglas–Peucker fit to ≤16 points and
  travels with the `AsteroidArt`, so `asteroid-field` skips the alpha trace. Supplied arts still
  trace and fit as before.
- **Variety is seeded.** Six variants (alternating palettes) are generated, and the layout picks
  from all eight arts (`variantCount`), so the field mixes painted and generated rocks.

**Consequences:** startup pays a few canvas uploads (deterministic, no network), the collider
loop gets cheaper for most rocks, and adding variants is a seed/option change rather than new
art files. Keep generated art and its tests in the pure model; do not put canvas/DOM code there.

## ADR-038 — Blender-rendered asteroid sprites replace the browser bake

**Status:** accepted (2026-11-09). Supersedes ADR-037.

ADR-037 baked extra asteroid variants in the browser at startup. The reference art called for a
much higher bar — layered facets, tapered flat-floored craters, bevel ridges and painted
detail — which is far easier to author in a 3D renderer than in a 2D canvas pass, and baking
eight 1024 px variants on the main thread cost several seconds of startup.

Rules:

- **Sprites are rendered offline.** `tools/asteroid-gen/render_asteroid.py` (Blender) builds each
  rock from a seed: Voronoi-dual flat facets, tapered octagonal boolean craters, inset-raised
  plates, scattered studs/chunks, and painted fake-lit emission materials; a second pass writes
  camera-space normals. `postprocess.py` adds the ink outline, a rim light and attenuates the
  normals to 0.3 (the colour map already carries the shading, like the supplied art).
- **Assets are committed.** Eight variants live in `public/assets/lighting/generated/` as
  `asteroid-gen-NN-color.png` / `-normal.png` (1024 px). `lighting-scene.ts` loads them with
  `Assets.load()` and appends them to the two supplied rocks, so the layout picks across ten arts.
- **No runtime or build-time generation.** Re-baking is a manual offline step documented in
  `tools/asteroid-gen/README.md` and `HANDOFF.md`; `pnpm build` does not touch the assets.
- **Colliders are still traced from alpha.** All ten arts are plain PNGs, so `asteroid-field.ts`
  traces and fits their silhouettes once (~24–28 points), exactly like the supplied rocks. The
  authored-silhouette fast path from ADR-037 is no longer used.
- **The browser generator is gone.** `src/app/asteroid-art.ts`, `asteroid-art-model.ts` and
  `tests/asteroid-art-model.test.ts` were deleted with the same change.

**Consequences:** startup no longer spends seconds baking canvases, the field renders a more
detailed and more varied set of rocks, and art direction happens in Blender where facets, booleans
and painted materials are natural. The trade-off is ~6.4 MB of committed PNGs and an offline
rebake step when the look changes.
