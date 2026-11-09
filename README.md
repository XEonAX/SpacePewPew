# COLD ROCK: PROSPECT

**A hand-lit 2.5D space sandbox built on PixiJS.**

**[▶ Play the live demo](https://coldrock.aeonax.com/)** · runs in the browser, no install.

[![CI](https://github.com/XEonAX/SpacePewPew/actions/workflows/ci.yml/badge.svg)](https://github.com/XEonAX/SpacePewPew/actions/workflows/ci.yml)
[![Deploy](https://github.com/XEonAX/SpacePewPew/actions/workflows/pages.yml/badge.svg)](https://coldrock.aeonax.com/)
![PixiJS v8](https://img.shields.io/badge/PixiJS-v8-ff5fb0)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Vite](https://img.shields.io/badge/Vite-8-646cff)
![Vitest](https://img.shields.io/badge/tests-250%20passing-brightgreen)

![COLD ROCK: PROSPECT — flying through the asteroid field](https://github.com/user-attachments/assets/e9592e59-5c2c-4676-bb6c-615cdfad6f9d)

**COLD ROCK: PROSPECT** is a playable demo about **weight**: an 18.5-tonne hull that answers to thrust,
drag and inertia, a seeded field of one hundred stylised asteroids, and a mining rig that cuts
metal out of rock and tractors it into the hold. Everything is rendered with a custom
normal-map shader over a living parallax sky — including asteroid sprites baked in Blender
with lighting left to the engine, so a tumbling rock actually catches the light.

No game engine, no physics library, no runtime art generation: just PixiJS v8, TypeScript,
a small GLSL shader, and the maths written down.

## Features

- **Mass-based 2.5D flight.** Every nozzle applies a real force at its mount; acceleration,
  turning and terminal speed fall out of mass, inertia and drag. Hold `X` for a stabilised
  retro burn.
- **One hundred seeded asteroids.** A deterministic field with ten art variants, alpha-traced
  low-poly colliders and a few 3× heroes. The scatter keeps the world axes and the spawn bubble
  clear, and every rock is solid, mineable and shootable.
- **Two weapon systems.** An eight-turret gun battery that respects finite turret speed and
  per-mount cones, or the mining rig: dwell lasers that melt orange scars into the rock, metal
  chunks that cool as they drift, six autonomous green tractors and a cargo hatch that swallows
  the cargo one chunk at a time.
- **Live normal-map lighting.** A custom PixiJS Mesh shader lights every ship and rock with a
  top-right key and ambient fill. Asteroid colour maps are pure unlit albedo — all shading comes
  from the normal map, so spinning rocks shade correctly instead of dragging baked shadows around.
- **Impacts with weight.** Shield collisions produce real impulses (`Δv = J/m`, `Δω = L/I`) at
  the contact patch: heavy hits shove, glancing hits scrape, off-centre hits spin the hull, and
  the shield lights up with camera shake and collision audio.
- **Fast to load.** All ship and asteroid maps are committed as WebP — under 1 MB for the
  entire art set instead of 7.4 MB of PNGs — with a boot progress screen for the first load.
- **Presentation.** Parallax nebulas, stars and galaxies, a world-space metagrid, engine flames
  and smoke, a speed-reactive camera, and engine hums whose pitch and stereo position follow each
  nozzle.
- **One input layer for every device.** Keyboard + mouse, a standard twin-stick gamepad, and a
  two-stick touch layout. Sticks are analog but still pass through the flight model's input
  ramp, so the ship eases into a turn exactly like it does on keys.
- **Player HUD + dev tools.** A clean in-game HUD (mode, cargo, reticle, fading hints) by
  default; **F1** (or `?dev=1`) brings up the live flight/gun/mining tuners and telemetry.
  Built for tuning, not just watching.

## Screenshots

Mining rig: red cutting lasers, orange melt patches and the tractor array working the rock.

![Mining lasers cutting an asteroid](https://github.com/user-attachments/assets/02739119-1f56-4f6f-873c-84023f52ea8c)

A shield impact — the bubble flares at the contact patch while the hull takes the impulse.

![Shield flaring on impact with an asteroid](https://github.com/user-attachments/assets/efa7584b-8cb8-42dc-850c-76204c5c2ba1)

## Quick start

Play it now at **https://coldrock.aeonax.com/** (GitHub Pages), or run it locally.
Requires **Node 22.12+** and **pnpm 10** (`.nvmrc` pins Node 22).

```bash
git clone https://github.com/XEonAX/SpacePewPew.git
cd SpacePewPew
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

```bash
pnpm build     # typecheck + production build
pnpm preview   # serve the build locally
pnpm check     # typecheck, lint, format check, tests and build — the full gate
```

Pushes to `main` are checked by CI and deployed to GitHub Pages by
`.github/workflows/pages.yml` (Vite is built with the repo's subpath as its base).

## Controls

| Input                              | Action                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| `W` / `S`                          | Main / reverse thrust                                              |
| `A` / `D`                          | Turn left / right                                                  |
| `X` (hold)                         | Stabiliser — cancel spin, brake along current heading, engage drag |
| Mouse                              | Aim the turrets                                                    |
| Click / hold                       | Fire the aimed pair (or mining lasers in mining mode)              |
| `Space` (hold, guns + forward aim) | Fire every pair forward                                            |
| `Tab`                              | Switch gun battery ↔ mining rig                                    |
| `1` / `2`                          | Gun aiming: mouse track / all-forward                              |
| `P`                                | Mining carry: physics (default) / curved arc                       |
| `M`                                | Mute / unmute                                                      |
| `F1`                               | Toggle developer overlays (hidden by default)                      |
| `F2`                               | Toggle collider debug gizmo                                        |
| Scroll                             | Zoom (1× in, 50× out)                                              |

### Gamepad

| Input       | Action                                 |
| ----------- | -------------------------------------- |
| Left stick  | Point the ship's heading (PD steering) |
| Right stick | Aim the turrets and mining lasers      |
| RT          | Main engine (analog)                   |
| LT          | Reverse engine (analog)                |
| A           | Fire                                   |
| B           | Stabiliser                             |
| X           | Switch gun battery ↔ mining rig        |
| Y           | Mining carry mode                      |
| D-pad ← / → | Aim mode: mouse / forward              |
| D-pad ↑     | Toggle developer overlays              |
| R3          | Cycle aim mode                         |
| LB / RB     | Zoom out / in                          |
| Start       | Mute / unmute                          |
| Back        | Toggle collider debug gizmo            |

### Touch

| Input                    | Action                                                    |
| ------------------------ | --------------------------------------------------------- |
| Left stick               | Fly (analog thrust and turn)                              |
| Right stick              | Aim                                                       |
| FIRE                     | Fire                                                      |
| AIM / TAB / STAB / CARRY | Cycle aim mode / switch weapons / stabiliser / carry mode |
| − / +                    | Zoom out / in                                             |
| MUTE                     | Mute / unmute                                             |

Touch controls appear automatically on touch-first devices; append `?touch=1` to the URL to
show them on a desktop browser. Developer tuning panels are hidden while they are up.

## How it works

- **Flight** — pure force-based rigid body with mass, hull inertia, ramped inputs and drag;
  everything is in metres and converted to pixels only at draw time. Analog stick axes feed
  the same ramp as digital keys. See [`src/app/ship-flight.ts`](src/app/ship-flight.ts).
- **Input** — one merged snapshot from keyboard/mouse, gamepad and touch, with edge-triggered
  actions and a normalized aim point. See [`src/app/input-system.ts`](src/app/input-system.ts).
- **Lighting** — one custom GLSL Mesh shader: directional key + ambient, tangent-space normals
  rotated by each mesh's rotation, emissive panels for the ship. See
  [`src/app/lit-sprite.ts`](src/app/lit-sprite.ts).
- **Asteroids** — committed Blender sprites loaded at runtime, colliders traced from each
  sprite's alpha and simplified to a low-poly silhouette that rotates with the rock. See
  [`src/app/asteroid-field.ts`](src/app/asteroid-field.ts) and
  [`tools/asteroid-gen/`](tools/asteroid-gen/).
- **Mining** — lasers dwell on one spot, melt a scar anchored to the rock's frame, eject a
  pooled metal chunk, and six tractors arc cargo into the hull's own hatch. Each front laser has
  a 5 s heat bank: release early to vent fast, or overheat and wait out a slow lock-out. Two
  beams focused on the same spot melt faster. See [`src/app/mining.ts`](src/app/mining.ts).

The full systems write-up lives in **[docs/GAMEPLAY.md](docs/GAMEPLAY.md)**; the module map and
conventions are in **[AGENTS.md](AGENTS.md)**; design decisions are recorded in
**[docs/DECISIONS.md](docs/DECISIONS.md)**. The current DEADWEIGHT design brief and its visual
companion are in **[docs/DEADWEIGHT.md](docs/DEADWEIGHT.md)** and
**[docs/DEADWEIGHT_VISUALS.md](docs/DEADWEIGHT_VISUALS.md)**.

## Project layout

```text
src/app/         flight, lighting, asteroids, weapons, mining, HUD overlays
public/assets/   committed ship + asteroid colour/normal maps (WebP)
public/audio/    committed weapon, engine, mining and impact audio
tools/asteroid-gen/  offline Blender pipeline for the asteroid sprites
tests/           fast, pure unit tests for the simulation maths
scripts/         detached dev server + shared-browser automation
docs/            deep dive, decisions, reference art, agent workflow
```

## Development

- `pnpm check` is the definition of done: typecheck, lint, Prettier check, Vitest and build.
- The bottom-left panels are developer tuners: rate-of-fire in gun mode, live **mining
  tunables** in mining mode.
- `window.__SPACEPEWPEW__` exposes the Pixi app, asteroid colliders, ship pose and a
  screenshot/test staging helper for browser automation.
- Agent workflow, the shared Playwright browser and the offline Blender commands are documented
  in [AGENTS.md](AGENTS.md) and [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

## Asteroids are baked offline

The asteroid sprites are rendered with Blender by [`tools/asteroid-gen/`](tools/asteroid-gen/)
(faceted hulls, boolean craters, inset plates, painted albedo, camera-space normals) and committed
as 1024 px WebP images (quality 88 for colour, 92 for normals) for fast web delivery. There is
no build-time or runtime art generation; re-bake deliberately with the pipeline README. The colour pass is unlit albedo by design — keeping lighting in the shader is
what lets a spinning rock shade correctly in game.

## Licence

**All rights reserved.** This repository and its assets are published for viewing and reference
only. No permission is granted to use, copy, modify, distribute, sublicense or sell any part of
it without prior written permission from the copyright holder. See [LICENSE](LICENSE).
