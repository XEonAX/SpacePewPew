#!/usr/bin/env node
/**
 * Agent browser tooling for SpacePewPew.
 *
 *   pnpm browser:open              launch the shared, visible Chrome (CDP on :9222)
 *   pnpm browser:inspect           screenshot + console/state dump of the shared browser
 *   pnpm browser:inspect --headless   run the same check in a throwaway headless browser
 *   pnpm browser:act <action> ...  drive the shared browser (click, type, eval, maximize, ...)
 *
 * The human uses the same Chrome window directly, so agent actions are visible
 * live and the agent can screenshot what the human is doing.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import {
  ARTIFACT_DIR,
  DEFAULT_CDP_PORT,
  DEFAULT_URL,
  ROOT_DIR,
  cdpEndpoint,
  ensureSharedBrowser,
  findAppPage,
  stopSharedBrowser,
} from './lib/shared-browser.mjs';

const commands = new Set(['open', 'inspect', 'act', 'stop']);
const args = parseArgs(process.argv.slice(2));
const command = commands.has(args._[0]) ? args._[0] : 'open';

main().catch((error) => {
  console.error(`[browser] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  switch (command) {
    case 'open':
      await openSharedBrowser();
      break;
    case 'inspect':
      await inspect();
      break;
    case 'act':
      await act();
      break;
    case 'stop':
      await stop();
      break;
  }
}

async function stop() {
  const stopped = await stopSharedBrowser({ port: numberOption('port', DEFAULT_CDP_PORT) });
  console.log(JSON.stringify({ status: stopped ? 'stopped' : 'not-running' }, null, 2));
}

async function openSharedBrowser() {
  const port = numberOption('port', DEFAULT_CDP_PORT);
  const url = stringOption('url', DEFAULT_URL);

  await warnIfUrlUnreachable(url);
  const session = await ensureSharedBrowser({ url, port });
  await mkdir(ARTIFACT_DIR, { recursive: true });

  console.log(
    JSON.stringify(
      {
        status: session.started ? 'launched' : 'already-running',
        sandboxed: session.sandboxed,
        url,
        cdp: cdpEndpoint(port),
        profile: path.relative(ROOT_DIR, path.join(ROOT_DIR, '.agent', 'chrome-profile')),
        hint: 'Interact with the window directly. Agents attach over CDP with `pnpm browser:inspect` / `pnpm browser:act`; the browser is reused across sessions until `pnpm browser:stop`.',
      },
      null,
      2,
    ),
  );
}

async function inspect() {
  const url = stringOption('url', DEFAULT_URL);
  const screenshotPath = path.resolve(ROOT_DIR, stringOption('out', '.agent/browser/latest.png'));
  const reportPath = path.join(ARTIFACT_DIR, 'latest.json');
  const headless = booleanOption('headless');

  await ensureUrlReachable(url);
  await mkdir(ARTIFACT_DIR, { recursive: true });

  const session = headless ? await launchHeadlessSession() : await attachSharedSession(url);

  try {
    const consoleMessages = [];
    const pageErrors = [];
    const failedRequests = [];

    session.page.on('console', (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    });
    session.page.on('pageerror', (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });
    session.page.on('requestfailed', (request) => {
      failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown',
      });
    });

    const httpStatus = await navigateIfNeeded(session.page, url);
    const ready = await waitForReady(session.page);
    await session.page.waitForTimeout(700);

    const page = await session.page.evaluate(() => {
      const app = window.__SPACEPEWPEW__?.app;
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');

      let gpu = null;
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          gpu = {
            vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
            renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
          };
        }
      }

      return {
        title: document.title,
        href: location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        canvas: canvas
          ? {
              width: canvas.width,
              height: canvas.height,
              cssWidth: canvas.clientWidth,
              cssHeight: canvas.clientHeight,
            }
          : null,
        app: app
          ? {
              renderer: app.renderer.constructor.name,
              fps: Math.round(app.ticker.FPS),
              stageChildren: app.stage.children.length,
            }
          : null,
        gpu,
      };
    });

    await session.page.screenshot({ path: screenshotPath });

    const consoleErrors = consoleMessages.filter((message) => message.type === 'error');
    const report = {
      generatedAt: new Date().toISOString(),
      mode: headless ? 'headless' : 'shared',
      url,
      httpStatus,
      ready,
      page,
      console: consoleMessages,
      consoleErrors,
      pageErrors,
      failedRequests,
      screenshot: path.relative(ROOT_DIR, screenshotPath),
    };

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log(
      JSON.stringify(
        {
          mode: report.mode,
          url,
          httpStatus,
          ready,
          title: page.title,
          canvas: page.canvas,
          renderer: page.app?.renderer ?? null,
          fps: page.app?.fps ?? null,
          gpu: page.gpu,
          consoleErrors,
          pageErrors,
          failedRequests,
          screenshot: report.screenshot,
          report: path.relative(ROOT_DIR, reportPath),
        },
        null,
        2,
      ),
    );

    if (!ready || !page.canvas) {
      process.exitCode = 1;
    }
  } finally {
    await session.close();
  }
}

async function act() {
  const action = args._[1];
  const rest = args._.slice(2);

  if (!action) {
    throw new Error(
      'Usage: pnpm browser:act <goto|click|fill|type|press|hover|eval|wait|screenshot|reload|info|maximize> [args]',
    );
  }

  await ensureUrlReachable(stringOption('url', DEFAULT_URL));
  const session = await attachSharedSession(stringOption('url', DEFAULT_URL));

  try {
    const page = session.page;
    let result = null;

    switch (action) {
      case 'goto': {
        const target = rest[0];
        if (!target) throw new Error('Usage: pnpm browser:act goto <url>');
        const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
        result = { url: page.url(), status: response?.status() ?? null };
        break;
      }
      case 'click': {
        const selector = rest.join(' ');
        if (!selector) throw new Error('Usage: pnpm browser:act click <selector>');
        await page.click(selector, { timeout: 5000 });
        result = { clicked: selector };
        break;
      }
      case 'fill': {
        const [selector, ...valueParts] = rest;
        if (!selector) throw new Error('Usage: pnpm browser:act fill <selector> <value>');
        await page.fill(selector, valueParts.join(' '));
        result = { filled: selector };
        break;
      }
      case 'type': {
        await page.keyboard.type(rest.join(' '), { delay: 30 });
        result = { typed: rest.join(' ') };
        break;
      }
      case 'press': {
        const key = rest[0];
        if (!key) throw new Error('Usage: pnpm browser:act press <key>');
        await page.keyboard.press(key);
        result = { pressed: key };
        break;
      }
      case 'hover': {
        await page.hover(rest.join(' '));
        result = { hovered: rest.join(' ') };
        break;
      }
      case 'eval': {
        const expression = rest.join(' ');
        if (!expression) throw new Error('Usage: pnpm browser:act eval "<expression>"');
        result = await page.evaluate((source) => (0, eval)(source), expression);
        break;
      }
      case 'wait': {
        const ms = Number(rest[0] ?? 500);
        await page.waitForTimeout(ms);
        result = { waitedMs: ms };
        break;
      }
      case 'reload': {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForReady(page);
        result = { url: page.url() };
        break;
      }
      case 'maximize': {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        try {
          const { windowId } = await cdp.send('Browser.getWindowForTarget');
          await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'maximized' },
          });
        } catch {
          // Some window managers don't support maximizing over CDP; clearing the
          // viewport override is still enough to let the page fill the window.
        }
        await page.waitForTimeout(150);
        result = await page.evaluate(() => ({
          innerWidth,
          innerHeight,
          outerWidth,
          outerHeight,
        }));
        break;
      }
      case 'screenshot': {
        const output = rest[0] ?? '.agent/browser/act-latest.png';
        const screenshotPath = path.resolve(ROOT_DIR, output);
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath });
        result = { screenshot: path.relative(ROOT_DIR, screenshotPath) };
        break;
      }
      case 'info': {
        result = await page.evaluate(() => ({
          title: document.title,
          url: location.href,
          ready: Boolean(window.__SPACEPEWPEW__?.ready),
        }));
        break;
      }
      default:
        throw new Error(`Unknown action "${action}"`);
    }

    console.log(JSON.stringify({ action, result, page: page.url() }, null, 2));
  } finally {
    await session.close();
  }
}

async function attachSharedSession(url) {
  const port = numberOption('port', DEFAULT_CDP_PORT);
  await ensureSharedBrowser({ url, port });

  const browser = await chromium.connectOverCDP(cdpEndpoint(port));
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await findAppPage(context, url);

  return {
    page,
    close: async () => {
      // Disconnect only: the visible browser keeps running for the human.
      await browser.close().catch(() => {});
    },
  };
}

async function launchHeadlessSession() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  return {
    page,
    close: async () => {
      await browser.close().catch(() => {});
    },
  };
}

async function navigateIfNeeded(page, url) {
  if (page.url().startsWith('about:')) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    return response?.status() ?? null;
  }
  return null;
}

async function waitForReady(page) {
  try {
    await page.waitForFunction(() => Boolean(window.__SPACEPEWPEW__?.ready), undefined, {
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureUrlReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Dev server is not reachable at ${url} (${error instanceof Error ? error.message : String(error)}). Start it with \`pnpm dev\` and retry.`,
      { cause: error },
    );
  }
}

async function warnIfUrlUnreachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    console.warn(
      `[browser] warning: ${url} is not reachable yet. Start \`pnpm dev\` to load the app.`,
    );
  }
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--')) {
      const [key, inlineValue] = argument.slice(2).split('=', 2);
      if (inlineValue !== undefined) {
        parsed[key] = inlineValue;
      } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
        parsed[key] = argv[index + 1];
        index += 1;
      } else {
        parsed[key] = true;
      }
    } else {
      parsed._.push(argument);
    }
  }

  return parsed;
}

function stringOption(name, fallback) {
  const value = args[name];
  return typeof value === 'string' ? value : fallback;
}

function numberOption(name, fallback) {
  const value = String(stringOption(name, ''));
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== '' ? parsed : fallback;
}

function booleanOption(name) {
  return args[name] === true || args[name] === 'true';
}
