# Agent workflow: shared browser + Playwright MCP

This repo is set up so a human and one or more agents can look at and interact with the same
browser window. The human uses the window directly; agents attach over the Chrome DevTools
Protocol (CDP). Every action is visible on both sides, and agents can screenshot the current
state at any time.

## The model

```
           ┌─────────────────────────────┐
           │  Shared Chrome (visible)    │
           │  profile: .agent/chrome-    │
           │  profile · CDP: :9222       │
           └──────────┬──────────────────┘
                      │ CDP
        ┌─────────────┼─────────────────────┐
        │             │                     │
  Human input   scripts/browser.mjs   Playwright MCP
  (mouse/kbd)   inspect · act        (mcp__playwright__*)
```

- There is exactly **one** shared browser. It is launched once, then reused across sessions
  and agents.
- `scripts/browser.mjs` attaches over CDP and never steals the window; it does not close the
  browser after an action.
- The browser profile is disposable and lives under `.agent/` (gitignored) — never the user's
  main Chrome profile.

## Lifecycle

```bash
pnpm dev                     # app on http://localhost:5173 (foreground)
pnpm dev:bg                  # or detached; use dev:status / dev:stop
pnpm browser:launch          # launch/reuse the shared Playwright browser
pnpm browser:inspect         # screenshot + state dump
pnpm browser:act click "canvas"
pnpm browser:act eval "document.title"
pnpm browser:stop            # close it when you are done
```

The first launch must happen **outside** the agent's file sandbox so Chrome keeps its own
sandbox. In DSH this means approving a one-time elevated run of:

```bash
node scripts/browser.mjs open
```

After that, the browser is reused by every later session and agent over CDP. If it is closed,
launch it again the same way (one approval, then reuse).

### Why not `--no-sandbox`?

Chrome cannot initialise its nested macOS sandbox while DSH already wraps the command in one;
it crashes or spawns renderers that crash. Instead of disabling Chrome's sandbox by default,
the approved one-time launch runs Chrome unsandboxed by DSH (Chrome's own sandbox stays on).
`SPACEPEWPEW_CHROME_NO_SANDBOX=1` exists only as an explicit escape hatch for disposable CI
containers. Do not add sandbox-disabling flags to scripts or configs.

## Inspecting

`pnpm browser:inspect` connects over CDP and writes:

- `.agent/browser/latest.png` — screenshot of the live page,
- `.agent/browser/latest.json` — title, URL, canvas size, renderer, FPS, GPU info, console
  messages, page errors, failed requests.

Exit code is non-zero when the app never becomes ready or the canvas is missing.

Useful actions for `pnpm browser:act`:

```bash
pnpm browser:act goto http://localhost:5173/
pnpm browser:act click "canvas"
pnpm browser:act press KeyM
pnpm browser:act eval "window.__SPACEPEWPEW__?.ready"
pnpm browser:act screenshot .agent/browser/after-click.png
pnpm browser:act reload
pnpm browser:act info
```

## CLI reference

All commands accept `--url=<app-url>` (default `http://localhost:5173/`) and `--port=<cdp-port>`
(default `9222`).

### `browser:open`

Reuses a healthy shared browser when the CDP endpoint is up; otherwise launches one. Under a
sandboxed agent process the launch fails by design — perform the one-time elevated launch
instead (see the sandbox section above).

### `browser:stop`

Closes the shared browser via CDP and prints `{ "status": "stopped" | "not-running" }`.

### `browser:inspect`

| Flag            | Default                     | Purpose                                      |
| --------------- | --------------------------- | -------------------------------------------- |
| `--headless`    | off                         | Throwaway headless browser, no shared window |
| `--out=<path>`  | `.agent/browser/latest.png` | Screenshot destination                       |
| `--url=<url>`   | `http://localhost:5173/`    | App URL                                      |
| `--port=<port>` | `9222`                      | CDP port                                     |

### `browser:act <action> [args]`

| Action       | Example                                        |
| ------------ | ---------------------------------------------- |
| `goto`       | `pnpm browser:act goto http://localhost:5173/` |
| `click`      | `pnpm browser:act click "canvas"`              |
| `fill`       | `pnpm browser:act fill "#input" "text"`        |
| `type`       | `pnpm browser:act type "hello"`                |
| `press`      | `pnpm browser:act press KeyM`                  |
| `hover`      | `pnpm browser:act hover "canvas"`              |
| `eval`       | `pnpm browser:act eval "document.title"`       |
| `wait`       | `pnpm browser:act wait 500`                    |
| `reload`     | `pnpm browser:act reload`                      |
| `screenshot` | `pnpm browser:act screenshot out.png`          |
| `info`       | `pnpm browser:act info`                        |

Actions attach to the shared browser, so the human sees them happen; they never close it.

## Environment variables

| Variable                        | Default                      | Purpose                                                                 |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `SPACEPEWPEW_URL`               | `http://localhost:5173/`     | App URL used by the browser CLI                                         |
| `SPACEPEWPEW_CDP_PORT`          | `9222`                       | CDP port for the CLI and MCP wrapper                                    |
| `SPACEPEWPEW_CHROME_NO_SANDBOX` | unset                        | Set to `1` to allow the disposable no-sandbox fallback (CI only)        |
| `CHROME_PATH`                   | auto-detected                | Chrome/Chromium executable override                                     |
| `PLAYWRIGHT_BROWSERS_PATH`      | `.agent/playwright-browsers` | Playwright cache used by the MCP wrapper (set automatically when unset) |

## Artifacts (all gitignored)

| Path                          | Contents                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.agent/browser/latest.png`   | Latest inspect screenshot                                                                                       |
| `.agent/browser/latest.json`  | Title, URL, HTTP status, readiness, viewport, canvas, renderer, FPS, GPU, console, page errors, failed requests |
| `.agent/mcp/`                 | Playwright MCP output files (snapshots, unnamed screenshots)                                                    |
| `.agent/playwright-browsers/` | Playwright browser cache used by MCP                                                                            |
| `.agent/chrome-profile/`      | Shared browser profile (disposable)                                                                             |

## Playwright MCP

`scripts/mcp-browser.mjs` is a stdio launcher for `@playwright/mcp`. Behaviour:

1. If the shared browser is running (CDP `:9222`), it attaches to that browser and enables the
   `vision` capability (useful for canvas-based apps).
2. Otherwise it starts Playwright MCP with its own headed Chrome, using `--isolated` so no
   profile leaks between runs.

It writes MCP artifacts to `.agent/mcp/`, keeps Playwright's cache in
`.agent/playwright-browsers/`, runs with `cwd` set to the repo and `--ignore-roots`, and enables
the `vision` capability (useful for canvas-based apps). Tool results that name a relative file
therefore resolve inside the project.

The DSH desktop profile already contains the server entry (`mcp-playwright`). Tools appear as
`mcp__playwright__*` after restarting DSH. Configuration lives at
`~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: /Users/user/.nvm/versions/node/v22.23.2/bin/node
        args:
          - /Users/user/Projects/SpacePewPew/scripts/mcp-browser.mjs
        toolCallTimeoutMs: 300000
        failOnStartupError: false
```

The entry is **global** (it affects every DSH workspace, not just this project). Remove the
`mcp-playwright` insert block and restart DSH to disable it. The command uses an absolute Node
path and the absolute path to `scripts/mcp-browser.mjs`; update both if the project or Node
installation moves. `failOnStartupError: false` means a missing project/wrapper cannot block
harness boot — but the browser tools silently disappear in that case.

## Troubleshooting

**`Dev server is not reachable`** — start `pnpm dev` first. The scripts default to
`http://localhost:5173/`; override with `--url=` or `SPACEPEWPEW_URL`.

**`browserContext.newPage: Target crashed`** — the shared browser was started inside a nested
sandbox, so its renderer died. Close it (`pnpm browser:stop`) and relaunch it once outside the
sandbox as described above.

**MCP tools missing** — restart DSH after editing the profile. Check the wrapper manually with
`pnpm mcp:browser` (it speaks MCP over stdio, so use an MCP client or the smoke test approach).

**Port 9222 in use** — set `SPACEPEWPEW_CDP_PORT` for the CLI and update the wrapper/MCP setup
accordingly.

**`Could not start a usable Chrome instance with its sandbox enabled`** — expected when a
sandboxed agent tries to launch Chrome. Do the one-time elevated launch outside the sandbox; do
not add `--no-sandbox` to the defaults.

**Stale profile** — stop the browser and delete `.agent/chrome-profile/` to start clean. It is
disposable.

**CI / headless** — `pnpm browser:inspect --headless` uses a throwaway browser and does not
need the shared window.
