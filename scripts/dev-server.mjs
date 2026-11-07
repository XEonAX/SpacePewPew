#!/usr/bin/env node
/**
 * Detached Vite dev server for SpacePewPew.
 *
 *   pnpm dev:bg      start in the background (pid/log in .agent/)
 *   pnpm dev:status  is it running?
 *   pnpm dev:stop    stop the managed server
 *
 * The server keeps running after the terminal command exits, so agents and
 * humans can share it without holding a foreground process open.
 */
import { existsSync, closeSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_DIR = path.join(ROOT, '.agent');
const PID_FILE = path.join(AGENT_DIR, 'dev-server.pid');
const LOG_FILE = path.join(AGENT_DIR, 'dev-server.log');
const URL = 'http://localhost:5173/';
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const HEALTH_TIMEOUT_MS = 15_000;

const command = process.argv[2] ?? 'status';

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      await stop();
      break;
    case 'status':
      await status();
      break;
    default:
      throw new Error(`Unknown command "${command}" (use start, stop or status)`);
  }
}

async function start() {
  await mkdir(AGENT_DIR, { recursive: true });
  const pid = await readPid();

  if (pid && isAlive(pid)) {
    report({ status: 'already-running', pid, url: URL, log: relative(LOG_FILE) });
    return;
  }
  if (pid) await rm(PID_FILE, { force: true });

  if (await isHealthy()) {
    report({
      status: 'already-responding',
      url: URL,
      hint: 'A dev server is already serving this port but was not started by dev:bg.',
    });
    return;
  }
  if (!existsSync(VITE_BIN)) throw new Error('vite is not installed; run pnpm install first');

  const logFd = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [VITE_BIN, '--port', '5173', '--strictPort'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.unref();
  closeSync(logFd);
  await writeFile(PID_FILE, `${child.pid}\n`);

  if (!(await waitForHealth())) {
    const tail = await readLogTail();
    report({
      status: 'failed',
      pid: child.pid,
      url: URL,
      log: relative(LOG_FILE),
      logTail: tail,
    });
    process.exitCode = 1;
    return;
  }

  report({ status: 'started', pid: child.pid, url: URL, log: relative(LOG_FILE) });
}

async function stop() {
  const pid = await readPid();
  if (!pid) {
    report({ status: (await isHealthy()) ? 'not-managed' : 'not-running', url: URL });
    return;
  }
  if (!isAlive(pid)) {
    await rm(PID_FILE, { force: true });
    report({ status: 'not-running', pid, url: URL });
    return;
  }

  killTree(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50 && isAlive(pid); attempt += 1) {
    await sleep(100);
  }
  if (isAlive(pid)) killTree(pid, 'SIGKILL');

  await rm(PID_FILE, { force: true });
  report({ status: 'stopped', pid, url: URL });
}

async function status() {
  const pid = await readPid();
  report({
    status: pid && isAlive(pid) ? 'running' : 'stopped',
    pid: pid ?? null,
    url: URL,
    healthy: await isHealthy(),
    log: relative(LOG_FILE),
  });
}

function report(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function readPid() {
  try {
    const value = Number.parseInt((await readFile(PID_FILE, 'utf8')).trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid, signal) {
  try {
    // The detached child is a process-group leader; this also stops Vite's
    // child processes (esbuild, etc.) on POSIX.
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

async function isHealthy() {
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await sleep(200);
  }
  return false;
}

async function readLogTail() {
  try {
    return (await readFile(LOG_FILE, 'utf8')).split('\n').slice(-12).join('\n').trim();
  } catch {
    return '';
  }
}

function relative(file) {
  return path.relative(ROOT, file);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
