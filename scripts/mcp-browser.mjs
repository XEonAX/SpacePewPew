#!/usr/bin/env node
/**
 * stdio launcher for the Playwright MCP server.
 *
 * If the shared SpacePewPew browser is already running (CDP endpoint up), the
 * MCP server attaches to it so humans and agents share one visible window.
 * Otherwise Playwright MCP launches its own headed Chrome on demand.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DEFAULT_CDP_PORT, ROOT_DIR, cdpEndpoint, isCdpReachable } from './lib/shared-browser.mjs';

const cliPath = path.join(ROOT_DIR, 'node_modules', '@playwright', 'mcp', 'cli.js');
if (!existsSync(cliPath)) {
  console.error(`[mcp-browser] Missing @playwright/mcp at ${cliPath}. Run \`pnpm install\`.`);
  process.exit(1);
}

const endpoint = cdpEndpoint(DEFAULT_CDP_PORT);
const sharedBrowserIsRunning = await isCdpReachable(endpoint);
const outputDirectory = path.join(ROOT_DIR, '.agent', 'mcp');
const commonArguments = ['--ignore-roots', '--caps', 'vision', '--output-dir', outputDirectory];
const mcpArguments = sharedBrowserIsRunning
  ? [cliPath, '--cdp-endpoint', endpoint, ...commonArguments]
  : [cliPath, '--browser', 'chrome', '--isolated', ...commonArguments];

console.error(
  sharedBrowserIsRunning
    ? `[mcp-browser] attaching to the shared browser at ${endpoint}`
    : '[mcp-browser] shared browser is not running; Playwright MCP will launch its own headed Chrome',
);

const child = spawn(process.execPath, mcpArguments, {
  // Keep file-based tool results (screenshots, snapshots) inside the project.
  cwd: ROOT_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Keep Playwright's cache inside the disposable workspace artifacts so the
    // MCP server also works when launched from a sandboxed agent process.
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(ROOT_DIR, '.agent', 'playwright-browsers'),
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
