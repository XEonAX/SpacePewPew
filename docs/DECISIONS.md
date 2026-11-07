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
  mode drops all grips. Uncaptered metal cools and fades after ~8 s so it cannot starve the pool.
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
  are pure `Graphics` strokes (`add` blend, 6 px halo + 1.8 px core) redrawn each frame — six
  small rounded-rect strokes, no filters or textures.
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
