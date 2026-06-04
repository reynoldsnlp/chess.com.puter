// Playwright fixtures for loading the built extension (dist/) into a persistent
// Chromium context, plus helpers for driving the side panel and mocking
// chess.com / lichess pages.

import { test as base, chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATH_TO_EXTENSION = path.resolve(__dirname, '../../dist');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

export const test = base.extend({
  // A persistent context with the unpacked extension loaded.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // MV3 extensions don't load in Playwright's headless (chrome-headless-shell),
      // so we run headed. CI runs this under xvfb on Linux. (Set PW_HEADLESS=1 only
      // to experiment with the new headless mode.)
      headless: !!process.env.PW_HEADLESS,
      args: [
        `--disable-extensions-except=${PATH_TO_EXTENSION}`,
        `--load-extension=${PATH_TO_EXTENSION}`,
      ],
    });
    await use(context);
    await context.close();
  },

  // The MV3 service worker (background). Waited for so the extension is live.
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },

  // The extension's runtime id, parsed from the service-worker URL.
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export { expect };

/** Open the side panel as a standalone tab and return the page. */
export async function openPanel(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
  return page;
}

/**
 * Force a low engine depth before the panel loads, so full-game analysis is
 * fast. controls.js reads these chrome.storage.local keys at construction.
 */
export async function setEngineSpeed(serviceWorker, { depth = 6, multiPv = 1 } = {}) {
  await serviceWorker.evaluate(
    (vals) => chrome.storage.local.set(vals),
    { depth, multiPv },
  );
}

/**
 * Serve a fixture HTML file for a given URL glob via route interception.
 * The committed URL still matches the manifest content-script patterns, so the
 * extension injects its content script into the fulfilled page.
 */
export async function mockSite(context, urlGlob, fixtureFile) {
  const body = readFileSync(path.join(FIXTURES_DIR, fixtureFile), 'utf8');
  await context.route(urlGlob, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }),
  );
}
