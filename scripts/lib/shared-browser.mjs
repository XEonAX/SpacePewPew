/**
 * Helpers for the shared, user-visible Chrome instance used by agent tooling.
 *
 * The browser is launched once with the Chrome DevTools Protocol enabled. Both
 * the human (using the window directly) and agents (attaching over CDP) share
 * the same page, so each side can see the other's interactions live.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ARTIFACT_DIR = path.join(ROOT_DIR, '.agent', 'browser');
export const PROFILE_DIR = path.join(ROOT_DIR, '.agent', 'chrome-profile');
export const DEFAULT_CDP_PORT = Number(process.env.SPACEPEWPEW_CDP_PORT ?? 9222);
export const DEFAULT_URL = process.env.SPACEPEWPEW_URL ?? 'http://localhost:5173/';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function cdpEndpoint(port = DEFAULT_CDP_PORT) {
  return `http://127.0.0.1:${port}`;
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Returns the Chrome executable we should drive, or throws with guidance. */
export function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Could not find Chrome or Chromium. Set CHROME_PATH, or run `pnpm exec playwright install chromium`.',
  );
}

export async function isCdpReachable(endpoint = cdpEndpoint()) {
  try {
    const response = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Starts the shared browser if it is not already running.
 *
 * The browser profile is disposable (`.agent/chrome-profile`) so it is safe to
 * automate without touching the user's main Chrome profile.
 */
export async function ensureSharedBrowser({
  url = DEFAULT_URL,
  port = DEFAULT_CDP_PORT,
  waitMs = 15_000,
} = {}) {
  const endpoint = cdpEndpoint(port);
  const allowUnsandboxed = process.env.SPACEPEWPEW_CHROME_NO_SANDBOX === '1';

  // Reuse a healthy browser that is already running.
  if (await isCdpReachable(endpoint)) {
    if (await browserIsHealthy(endpoint)) {
      return { started: false, endpoint, sandboxed: null };
    }

    console.warn('[browser] shared browser is not responding; restarting it.');
    await closeBrowser(endpoint);
    await waitUntilCdpGone(endpoint, 5000);
  }

  const chromePath = findChrome();
  await mkdir(PROFILE_DIR, { recursive: true });

  const baseArguments = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    url,
  ];
  const unsandboxedArguments = [
    ...baseArguments,
    // Only used for the disposable dev profile when Chrome cannot initialise
    // its own sandbox inside another sandbox (DSH, CI containers).
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-breakpad',
  ];

  // Keep Chrome's own sandbox unless the operator explicitly opts in to the
  // disposable fallback. The preferred workflow is to launch the shared browser
  // once from outside the agent sandbox, then reuse it from every session.
  const candidates = [
    { argumentsList: baseArguments, sandboxed: true },
    ...(allowUnsandboxed ? [{ argumentsList: unsandboxedArguments, sandboxed: false }] : []),
  ];

  for (const candidate of candidates) {
    if (!candidate.sandboxed) {
      console.warn(
        '[browser] launching Chrome with --no-sandbox: a nested sandbox cannot initialise inside DSH. This profile is disposable and only used for localhost development.',
      );
    }

    const child = launchChrome(chromePath, candidate.argumentsList);
    const ready = await waitForCdp(endpoint, child, waitMs);

    if (ready && (await browserIsHealthy(endpoint))) {
      return { started: true, endpoint, chromePath, sandboxed: candidate.sandboxed };
    }

    if (child.exitCode === null) child.kill();
    await closeBrowser(endpoint);
    await waitUntilCdpGone(endpoint, 2000);
  }

  throw new Error(
    [
      'Could not start a usable Chrome instance with its sandbox enabled.',
      'Launch the shared browser once from outside the agent sandbox (a normal terminal, or approve an elevated run of `node scripts/browser.mjs open`), then reuse it across sessions.',
      'For disposable CI-only use, SPACEPEWPEW_CHROME_NO_SANDBOX=1 opts into a no-sandbox browser on the localhost-only profile.',
    ].join(' '),
  );
}

/** A bare CDP endpoint can survive while renderers crash, so verify a page runs. */
async function browserIsHealthy(endpoint) {
  let browser;

  try {
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const result = await page.evaluate(() => 1 + 1);
    return result === 2;
  } catch (error) {
    console.warn(
      `[browser] health check failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
    return false;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function closeBrowser(endpoint) {
  let browser;

  try {
    browser = await chromium.connectOverCDP(endpoint);
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close').catch(() => {});
  } catch {
    // Already closed.
  } finally {
    await browser?.close().catch(() => {});
  }
}

function launchChrome(chromePath, argumentsList) {
  const child = spawn(chromePath, argumentsList, { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

async function waitForCdp(endpoint, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isCdpReachable(endpoint)) return true;
    if (child.exitCode !== null) return false;
    await sleep(250);
  }

  return false;
}

async function waitUntilCdpGone(endpoint, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!(await isCdpReachable(endpoint))) return true;
    await sleep(250);
  }

  return false;
}

/**
 * Closes the shared browser through CDP. Safe to call when it is not running.
 */
export async function stopSharedBrowser({ port = DEFAULT_CDP_PORT } = {}) {
  const endpoint = cdpEndpoint(port);

  if (!(await isCdpReachable(endpoint))) return false;

  await closeBrowser(endpoint);
  await waitUntilCdpGone(endpoint, 5000);
  return true;
}

/** Picks the app page from a connected browser, creating one when necessary. */
export async function findAppPage(context, url = DEFAULT_URL) {
  const pages = context.pages();
  const targetUrl = new URL(url);
  const matching = pages.find((page) => page.url().startsWith(targetUrl.origin));

  if (matching) return matching;

  return context.newPage();
}
