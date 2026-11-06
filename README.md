# SpacePewPew

**PixiJS v8 + Vite + TypeScript** starter with a procedural space background, a normal-mapped
lighting demo (ship + asteroid), **Howler** audio, and an agent-inspectable shared browser.
There is no gameplay loop yet — this is the foundation to build on.

![SpacePewPew starter screen](docs/screenshot.png)

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. Node **22.12+** and pnpm **10** are expected (`.nvmrc` pins Node 22).

## Stack

| Area      | Choice                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------- |
| Rendering | [PixiJS v8](https://pixijs.com/)                                                                    |
| Bundler   | [Vite 8](https://vite.dev/)                                                                         |
| Language  | TypeScript 6 (strict)                                                                               |
| Audio     | [Howler 2](https://howlerjs.com/) via a typed wrapper                                               |
| Lighting  | [pixijs-light2d](https://www.npmjs.com/package/pixijs-light2d) (normal maps + point/ambient lights) |
| Tests     | Vitest                                                                                              |
| Quality   | ESLint (flat config), Prettier, EditorConfig                                                        |
| Browser   | Playwright + Playwright MCP, shared via Chrome DevTools Protocol                                    |
| Package   | pnpm                                                                                                |

## Scripts

| Command                             | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                          | Vite dev server with HMR on `http://localhost:5173`                  |
| `pnpm build`                        | Typecheck and build to `dist/`                                       |
| `pnpm preview`                      | Serve the production build                                           |
| `pnpm typecheck`                    | `tsc --noEmit`                                                       |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                                               |
| `pnpm format` / `pnpm format:check` | Prettier                                                             |
| `pnpm test` / `pnpm test:watch`     | Vitest                                                               |
| `pnpm check`                        | Typecheck + lint + format check + tests + build (definition of done) |
| `pnpm browser:open`                 | Reuse the shared Chrome (launch once outside the sandbox)            |
| `pnpm browser:inspect`              | Screenshot + console/state dump (`--headless` for a throwaway run)   |
| `pnpm browser:act <action>`         | Drive the shared browser (click, type, eval, …)                      |
| `pnpm browser:stop`                 | Close the shared browser                                             |
| `pnpm mcp:browser`                  | Run the Playwright MCP stdio server manually                         |

## Project layout

```
src/
  app/create-app.ts       PixiJS Application bootstrap
  app/lighting-scene.ts   Ship + asteroid lighting demo (keep small)
  app/background.ts       Layered procedural background (nebulas, galaxies, stars)
  app/background-textures.ts  One-time procedural canvas textures (nebula/galaxy/star/flare)
  app/starfield-model.ts  Deterministic star generation + projection (tested)
  audio/audio.ts          Howler wrapper: load, play, mute, unlock
  utils/                  Small pure helpers (tested)
  main.ts                 Entry point, HMR cleanup, inspection hook
public/
  favicon.svg
  audio/blip.wav          Small committed placeholder UI sound
  assets/lighting/        Processed ship/asteroid color + normal maps
scripts/
  browser.mjs             Shared-browser CLI (open / inspect / act / stop)
  mcp-browser.mjs         Playwright MCP launcher (attaches to shared browser)
  lib/shared-browser.mjs  CDP/browser lifecycle helpers
tests/                    Vitest unit tests
docs/                     Architecture decisions, reference art and agent workflow
.agent/                   Generated browser artifacts and profile (gitignored)
```

## Controls

- **Move the mouse** to move the omni light. The ship and asteroid respond through their normal maps.
- **Drag the canvas** to pan the background; **scroll / pinch** to zoom it (`0.02×–6×`,
  50× max zoom-out). **Double-click** resets the background view.
- **Click** for the placeholder sound; **M** mutes/unmutes.
- `Background.setZoom()` is exposed for velocity-driven background zoom.

## Lighting

The scene uses [`pixijs-light2d`](https://www.npmjs.com/package/pixijs-light2d) (PixiJS v8)
with `LightSprite` + normal maps:

- **Directional key light from the top-right** — the library only exposes point/ambient lights,
  so this is a distant, very wide point light positioned off the top-right corner.
- **Omni light** — a point light follows the pointer.
- **Ambient fill** for readability.
- The shadow map is baked once while there are no shadow casters.

## Reference art

Source art for the 2.5D game (ship + asteroid, color/key and matching normal maps) lives in
[docs/reference/](docs/reference/) — see [REFERENCE_ART.md](docs/REFERENCE_ART.md). Processed
runtime copies live in [public/assets/lighting/](public/assets/lighting/).

## Audio

Howler is wired through `src/audio/audio.ts`, with a tiny committed placeholder
(`public/audio/blip.wav`) so the starter has working sound out of the box. Replace it with real
assets and update `SOUND_SOURCES`; keep clips small and avoid build-time asset pipelines.

## Agentic development

This repo is set up for coding agents:

- **[AGENTS.md](AGENTS.md)** — the rules and workflow every agent should follow, read natively by
  Claude Code and DeepSeek Harness.
- **[docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md)** — how the shared browser and Playwright MCP work.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — short architecture decision log.
- The shared Chrome window is the same page the human sees: both can interact with it live.
- Playwright MCP is configured in the DSH desktop profile and attaches to that shared browser
  when it is running. MCP tools (`mcp__playwright__*`) require a DSH restart after profile
  changes.
- CLI flags, environment variables, MCP configuration and artifacts are documented in
  [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

## Browser sandbox note

The shared browser is launched once **outside** the agent sandbox so Chrome keeps its own
sandbox. Later sessions and agents only attach over CDP. The tooling never disables Chrome's
sandbox by default; `SPACEPEWPEW_CHROME_NO_SANDBOX=1` is an explicit escape hatch for
disposable CI environments. If the browser is closed, relaunch it once from a normal terminal
(or approve the one-time elevated run) — do not cargo-cult sandbox-disabling flags.
