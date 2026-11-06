# AGENTS.md

Single source of truth for coding agents working on SpacePewPew. Read this first; humans
should start with [README.md](README.md).

## What this repo is

SpacePewPew is a **starter/demo**, not a game loop yet. It contains:

- PixiJS v8 rendering a procedural space background and a normal-mapped ship/asteroid demo,
- a small custom GLSL normal-map lighting shader (directional key + emissive panels),
- a typed Howler audio wrapper playing a small committed placeholder sound,
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
| `pnpm typecheck`            | `tsc --noEmit`                                               |
| `pnpm lint`                 | ESLint                                                       |
| `pnpm format`               | Prettier write                                               |
| `pnpm test`                 | Vitest run                                                   |
| `pnpm build`                | Typecheck + build to `dist/`                                 |
| `pnpm preview`              | Serve the production build                                   |
| `pnpm check`                | **Definition of done**: typecheck, lint, format, test, build |
| `pnpm browser:inspect`      | Screenshot + console/state dump of the shared browser        |
| `pnpm browser:act <action>` | Drive the shared browser (`click`, `fill`, `eval`, …)        |
| `pnpm browser:open`         | Reuse the shared browser (launch once outside the sandbox)   |
| `pnpm browser:stop`         | Close the shared browser                                     |
| `pnpm mcp:browser`          | Run the Playwright MCP stdio server manually                 |

Run `pnpm check` before you report completion. If you touched rendering or browser-visible
behaviour, also run `pnpm browser:inspect` and check the screenshot.

## Architecture map

- `src/app/create-app.ts` — creates and initialises the PixiJS `Application`.
- `src/app/lighting-scene.ts` — the only scene: ship + asteroid layout, lighting state, WASD
  input. Places both objects with `Background.getDustTransform()` on the near dust layer.
- `src/app/ship-flight.ts` — pure ramped arcade flight model in metres (0.3 s input ramp,
  thrust, drag; both axes damp while any input is active; terminal speed emerges from
  thrust/drag). Unit-tested in `tests/ship-flight.test.ts`.
- `src/app/flight-tuner.ts` — live DOM slider overlay that mutates `FlightTuning`; dev-facing.
- `src/app/flight-telemetry.ts` — read-only DOM overlay for terminal/current/ramped state.
- `src/app/world-scale.ts` — `PIXELS_PER_METER = 64`; all flight physics is in metres.
- `src/app/ground-grid.ts` — screen-space 1 m × 1 m grid fixed to the near dust layer
  (64 world px per metre; major lines every 5 m).
- `src/app/engine-exhaust.ts` — three cyan cone-flame sprites plus dust-world smoke particles
  emitted from the cone tips; smoke fades over 10 s.
- `src/app/lit-sprite.ts` — custom normal-map Mesh shader (directional light, emissive/glow).
- `src/app/background.ts` — layered procedural background (nebulas, galaxies, stars, flares)
  and the smoothed camera that follows the ship.
- `src/app/background-textures.ts` — one-time deterministic canvas textures for the background.
- `src/app/starfield-model.ts` — deterministic star generation, projection, twinkle (pure).
- `src/audio/audio.ts` — the only place Howler is used.
- `src/utils/random.ts` — seeded PRNG helpers for procedural content.
- `src/utils/` — pure helpers (safe to unit test).
- `src/main.ts` — entry point, input handlers, HMR teardown, `window.__SPACEPEWPEW__` hook.
- `docs/reference/` — supplied color/normal reference art for the ship and asteroid.
- `public/assets/lighting/` — processed runtime copies (color + normal maps) used by the scene.
- `scripts/browser.mjs` — CLI for the shared browser.
- `scripts/lib/shared-browser.mjs` — browser lifecycle, CDP health checks, shared profile.
- `scripts/mcp-browser.mjs` — Playwright MCP stdio wrapper.
- `tests/` — Vitest tests. Keep them fast, pure and DOM-free.

## Conventions

- **TypeScript is strict.** Avoid `any`; prefer `unknown` + narrowing. Exported functions
  should have explicit return types.
- **PixiJS v8 only.** No v7 APIs (`beginFill`, `DisplayObject`, `@pixi/*` imports). Use async
  `app.init()`, shape-then-fill `Graphics`, `deltaMS`-based updates, and destroy tickers and
  listeners on HMR.
- **Audio goes through `AudioManager`.** Browsers require a user gesture, so call `enable()`
  from a pointer/keyboard handler. Never construct `Howl` elsewhere.
- **Audio assets are small and committed.** `public/audio/blip.wav` is a placeholder; replace
  it with real assets and update `SOUND_SOURCES` in `src/audio/audio.ts`. Do not add build-time
  asset-generation pipelines for placeholder content.
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
- **Reference art is source, not runtime.** Treat `docs/reference/` as supplied source art and
  `public/assets/lighting/` as the processed runtime copies. Processing runs were a one-off
  matte/despill/premultiplied-resample pass; don't add a build-time asset pipeline.
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
- **Galaxies are fixed sky.** The two galaxy sprites have zero parallax/zoom response; only
  stars, nebulas, and the near dust layer pan.
- **Parallax is screen-consistent.** `projectPoint` scales camera movement by `zoom / layerScale`,
  so at any zoom a layer's screen pan is `parallax × zoom`; the near dust/grid layer (parallax 1)
  is always fastest. No independent drift.
- **Camera lookahead is quadratic.** `followCamera()` applies a `speed²` curve (near-zero at
  slow speed, max near terminal), boosts the offset as zoom decreases, and cancels the follow
  camera's lag using `CAMERA_FOLLOW_RATE`. Tune in `lighting-scene.ts`/`background.ts`.
- **Zoom is depth-weighted.** Far stars/nebulas stay at a fixed scale; mid/near stars respond
  partially; near dust takes the full pan + zoom. Zoom is clamped to `0.02`–`1` (1× is the
  default and maximum zoom-in) and exposed as
  `Background.setZoom()` for velocity-driven camera work.

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
