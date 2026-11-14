/**
 * Playwright fixtures shared by the Task Manager E2E specs.
 *
 * `boot` opens the Harness shell and dismisses the first-run dialogs but does
 * not open the panel; `app` additionally opens the Task Manager panel and waits
 * for its root. Both collect uncaught page errors and `console.error` lines and
 * fail the test at teardown when a real defect was logged, so every spec gets
 * the "no console/page errors" guarantee for free.
 */
import { test as base, expect } from '@playwright/test';

import { fatalErrors, openPanel, dismissFirstRun } from './helpers.mjs';
import { readRuntime } from './runtime.mjs';

/**
 * Open the Host shell, dismiss onboarding, and return the page.
 * @param {import('@playwright/test').Page} page - Host page.
 * @param {{ url: string }} runtime - Instance descriptor.
 * @returns {Promise<void>} resolves when the shell is interactive.
 */
async function bootHost(page, runtime) {
  await page.goto(runtime.url, { waitUntil: 'domcontentloaded' });
  await dismissFirstRun(page);
}

/** Extended Playwright test object. */
export const test = base.extend({
  /** Instance descriptor, read once per worker. */
  runtime: [
    async ({}, use) => {
      await use(await readRuntime());
    },
    { scope: 'worker' },
  ],

  /** Uncaught page errors collected for the current test. */
  pageErrors: [
    async ({}, use) => {
      /** @type {string[]} */
      const errors = [];
      await use(errors);
    },
    { scope: 'test' },
  ],

  /** `console.error` lines collected for the current test. */
  consoleErrors: [
    async ({}, use) => {
      /** @type {string[]} */
      const errors = [];
      await use(errors);
    },
    { scope: 'test' },
  ],

  /** Host page with onboarding dismissed; the panel is not open yet. */
  boot: async ({ page, runtime, pageErrors, consoleErrors }, use) => {
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await bootHost(page, runtime);
    await use(page);

    const fatal = fatalErrors(pageErrors, consoleErrors);
    if (fatal.length > 0) {
      throw new Error(`console/page errors while exercising the panel:\n- ${fatal.join('\n- ')}`);
    }
  },

  /** Host page with the Task Manager panel open. */
  app: async ({ boot }, use) => {
    await openPanel(boot);
    await use(boot);
  },
});

export { expect };
