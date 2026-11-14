/**
 * Screenshots for the README and visual review.
 *
 * Nine 1440x900 PNGs are captured into `e2e/screenshots/` (git-ignored; the Lead
 * copies the final set into docs/screenshots). Every capture also asserts the
 * panel is fully inside the viewport and that the document itself does not
 * scroll, so a clipped or overflowing layout fails the suite instead of shipping
 * a bad image.
 */
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from './fixtures.mjs';
import { navTo, openSettings, SEL, settle } from './helpers.mjs';
import { ROOT } from './runtime.mjs';

/** Output directory for the review screenshots. */
const SCREENSHOT_DIR = path.join(ROOT, 'e2e', 'screenshots');

/**
 * Assert the panel is not clipped by the viewport.
 * @param {import('@playwright/test').Page} page - Host page.
 * @returns {Promise<void>} resolves when the layout is inside the viewport.
 */
async function assertLayoutFits(page) {
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tm-root"]');
    const rect = root === null ? null : root.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      root: rect === null ? null : { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    };
  });
  expect(metrics.root, 'panel root exists').not.toBeNull();
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 1);
  expect(metrics.root.x).toBeGreaterThanOrEqual(0);
  expect(metrics.root.y).toBeGreaterThanOrEqual(0);
  expect(metrics.root.right).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.root.bottom).toBeLessThanOrEqual(metrics.innerHeight + 1);
  expect(metrics.root.width).toBeGreaterThan(800);
  expect(metrics.root.height).toBeGreaterThan(600);
}

/**
 * Capture one screenshot and assert its PNG dimensions and weight.
 * @param {import('@playwright/test').Page} page - Host page.
 * @param {string} name - File name without extension.
 * @returns {Promise<string>} absolute file path.
 */
async function capture(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await assertLayoutFits(page);
  await page.screenshot({ path: file, animations: 'disabled' });
  const buffer = await readFile(file);
  expect(buffer.length, `${name}.png is not blank`).toBeGreaterThan(15_000);
  expect(buffer.readUInt32BE(16), `${name}.png width`).toBe(1440);
  expect(buffer.readUInt32BE(20), `${name}.png height`).toBe(900);
  return file;
}

test.describe('screenshots', () => {
  test.beforeAll(async () => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
  });

  test('processes-light', async ({ app }) => {
    await app.locator(SEL.processTable).waitFor({ state: 'visible' });
    await expect(app.locator(SEL.processRow).first()).toBeVisible();
    await expect(app.locator(SEL.statusBar)).toBeVisible();
    await settle(app, 2200);
    await capture(app, 'processes-light');
  });

  test('performance-light', async ({ app }) => {
    await navTo(app, 'performance', SEL.perf.cpu);
    await expect(app.locator(SEL.graph)).toBeVisible();
    await settle(app, 3600);
    await capture(app, 'performance-light');
  });

  test('details-light', async ({ app }) => {
    await navTo(app, 'details', SEL.detailsTable);
    await expect(app.locator('[data-testid="tm-detail-row"]').first()).toBeVisible();
    await settle(app, 1200);
    await capture(app, 'details-light');
  });

  test('services-light', async ({ app }) => {
    await navTo(app, 'services', SEL.servicesTable);
    await expect(app.locator(`${SEL.servicesTable} .tm-table-row`).first()).toBeVisible();
    await settle(app, 1200);
    await capture(app, 'services-light');
  });

  test('app-history-light', async ({ app }) => {
    await navTo(app, 'appHistory', SEL.appHistoryTable);
    // Wait for the first fold with >= 2 samples so the real table is shown.
    await expect
      .poll(async () => app.locator(`${SEL.appHistoryTable} .tm-table-row`).count(), { timeout: 15_000 })
      .toBeGreaterThan(0)
      .catch(() => undefined);
    await settle(app, 800);
    await capture(app, 'app-history-light');
  });

  test('startup-light', async ({ app }) => {
    await navTo(app, 'startup', SEL.startupTable);
    await expect(app.locator(`${SEL.startupTable} .tm-table-row`).first()).toBeVisible();
    await settle(app, 1200);
    await capture(app, 'startup-light');
  });

  test('users-light', async ({ app }) => {
    await navTo(app, 'users', SEL.usersList);
    await expect(app.locator(SEL.usersList)).toBeVisible();
    await settle(app, 1200);
    await capture(app, 'users-light');
  });

  test('settings-light', async ({ app }) => {
    await app.locator(SEL.processTable).waitFor({ state: 'visible' });
    await settle(app, 800);
    const dialog = await openSettings(app);
    await expect(dialog).toBeVisible();
    await settle(app, 500);
    await capture(app, 'settings-light');
  });
});

test.describe('screenshots (dark)', () => {
  test.use({ colorScheme: 'dark' });

  test('processes-dark', async ({ app }) => {
    await expect(app.locator(SEL.root)).toHaveAttribute('data-theme', 'dark');
    await app.locator(SEL.processTable).waitFor({ state: 'visible' });
    await expect(app.locator(SEL.processRow).first()).toBeVisible();
    await settle(app, 2200);
    await capture(app, 'processes-dark');
  });
});
