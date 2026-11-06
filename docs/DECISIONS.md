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

**Status:** amended (2026-11-06) — the generated-asset pipeline was removed as over-engineering.

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

Zoom is clamped to **0.02×–6×**; the 0.02 floor is the requested 50× zoom-out limit. The
background exposes `setZoom(zoom)` (smoothed target) and `resetView()` so gameplay can ease the
camera out from velocity without coupling the game loop to rendering.

**Consequences:** zooming far out leaves the sky stable and shrinks/removes the near layers,
which suits high-speed gameplay: the background does not fly apart while ships/entities (added
later) scale with the camera. The star field spans 2×2 world units to stay covered at the
zoom-out limit.

## ADR-008 — pixijs-light2d for normal-mapped lighting

**Status:** accepted (2026-11-06)

`@pixi/lights` (the well-known deferred-lighting plugin) targets PixiJS 6/7 and cannot run on
PixiJS 8. The v8 option we adopted is
[`pixijs-light2d`](https://www.npmjs.com/package/pixijs-light2d) (MIT), used through
`LightSprite` with the ship/asteroid normal maps. It ships a custom batched render pipe and
handles ambient + point lights.

The library has no directional light type, so the requested top-right directional key light is
approximated by a distant, very wide point light. Its shader samples a shadow map for the first
four lights, so the map is baked once (with no casters) and refreshed per frame only when
`shadowSystem.casters` is non-empty. The package imports a Spine peer (`@esotericsoftware/spine-pixi-v8`)
even when Spine isn't used, so that peer is installed as a runtime dependency.

The library is diffuse-only, so there is no roughness/metalness response. Because the
reference art already includes baked shading, full-strength tangent-space normals read as
embossed/polished metal. The processed normal maps are therefore softened to ~0.30 strength
(blended toward flat) and the key light is kept soft.

**Consequences:** lighting is WebGL-only; keep `preference: 'webgl'` in the app. Processed
runtime art lives in `public/assets/lighting/`. Replacing the lighting library later means
replacing `LightSprite` usage in `lighting-scene.ts` only. If real PBR materials are needed,
this approach and art are not enough — that requires albedo/roughness/metalness maps and a
different shading model.
