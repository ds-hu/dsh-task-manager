/**
 * Shared selectors and interactions for the Task Manager E2E suite.
 *
 * The selectors come from docs/UI-SPEC.md § Test hooks. The onboarding flow is
 * the Host's own first-run experience (预览版说明 → 继续, then 开始使用 → close),
 * which is dismissed with Escape so it works in both zh and en locales.
 */
import { expect } from '@playwright/test';

/** Test hooks promised by docs/UI-SPEC.md. */
export const SEL = {
  root: '[data-testid="tm-root"]',
  sidebarEntry: 'button[aria-label="任务管理器"], button[aria-label="Task Manager"]',
  nav: {
    processes: '[data-testid="tm-nav-processes"]',
    performance: '[data-testid="tm-nav-performance"]',
    appHistory: '[data-testid="tm-nav-app-history"]',
    startup: '[data-testid="tm-nav-startup"]',
    users: '[data-testid="tm-nav-users"]',
    details: '[data-testid="tm-nav-details"]',
    services: '[data-testid="tm-nav-services"]',
  },
  processTable: '[data-testid="tm-process-table"]',
  processRow: '[data-testid="tm-process-row"]',
  processGroup: '[data-testid="tm-process-group"]',
  endTask: '[data-testid="tm-end-task"]',
  statusBar: '[data-testid="tm-status-bar"]',
  refresh: '[data-testid="tm-refresh"]',
  search: '[data-testid="tm-search"]',
  perf: {
    cpu: '[data-testid="tm-perf-cpu"]',
    mem: '[data-testid="tm-perf-mem"]',
    disk: '[data-testid="tm-perf-disk"]',
    net: '[data-testid="tm-perf-net"]',
  },
  graph: '[data-testid="tm-graph"]',
  detailsTable: '[data-testid="tm-details-table"]',
  servicesTable: '[data-testid="tm-services-table"]',
  usersList: '[data-testid="tm-users-list"]',
  startupTable: '[data-testid="tm-startup-table"]',
  appHistoryTable: '[data-testid="tm-app-history-table"]',
  settings: '[data-testid="tm-settings"]',
  settingsDialog: '[data-testid="tm-settings-dialog"]',
  dialog: '[role="dialog"]',
  endTaskDialog: '[data-testid="tm-dialog-end-task"]',
  empty: '.tm-empty',
  pageTitle: '.tm-page-title',
  statLabel: '.tm-stat-label',
  statValue: '.tm-stat-value',
};

/** Console/page errors that are not panel defects. */
const BENIGN_ERRORS = [
  /favicon/i,
  /net::ERR_ABORTED/i,
  /net::ERR_NETWORK_CHANGED/i,
  /Download the React DevTools/i,
];

/**
 * Whether an error line is a known-benign Host/browser message.
 * @param {string} text - Console or page error text.
 * @returns {boolean} true when the line can be ignored.
 */
export function isBenignError(text) {
  return BENIGN_ERRORS.some((pattern) => pattern.test(text));
}

/**
 * Filter collected errors down to real defects.
 * @param {string[]} pageErrors - Uncaught page errors.
 * @param {string[]} consoleErrors - `console.error` lines.
 * @returns {string[]} fatal lines.
 */
export function fatalErrors(pageErrors, consoleErrors) {
  return [...pageErrors, ...consoleErrors].filter((line) => !isBenignError(line));
}

/**
 * Wait until the Harness shell is interactive.
 * @param {import('@playwright/test').Page} page - Host page.
 * @returns {Promise<void>} resolves when the sidebar entry exists.
 */
export async function waitForShell(page) {
  await page.locator(SEL.sidebarEntry).first().waitFor({ state: 'visible', timeout: 90_000 });
}

/**
 * Dismiss the two first-run dialogs (预览版说明 → 继续, 开始使用 → close).
 *
 * Escape is used because it closes both dialogs and is locale-independent; the
 * 继续 button is only clicked when Escape did not remove the first dialog.
 *
 * @param {import('@playwright/test').Page} page - Host page.
 * @returns {Promise<void>} resolves when no dialog is visible.
 */
export async function dismissFirstRun(page) {
  await waitForShell(page);

  // The first-run dialogs mount *after* the shell paints, and the second one is
  // queued behind the first, so a single check races the animation. Loop until
  // no dialog has been attached for a quiet period.
  await page.waitForTimeout(1000);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dialogs = page.locator('[role="dialog"]:visible');
    if ((await dialogs.count()) === 0) {
      await page.waitForTimeout(600);
      if ((await page.locator('[role="dialog"]:visible').count()) === 0) break;
      continue;
    }

    const continueButton = page.getByRole('button', { name: '继续' });
    if ((await continueButton.count()) > 0 && (await continueButton.first().isVisible())) {
      await continueButton.first().click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(450);
  }

  // The overlay mask is a sibling of the dialog; wait for the whole layer to
  // detach so the sidebar entry is actually clickable.
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
}

/**
 * Click the sidebar entry and wait for the panel root.
 * @param {import('@playwright/test').Page} page - Host page.
 * @returns {Promise<import('@playwright/test').Locator>} the panel root.
 */
export async function openPanel(page) {
  const entry = page.locator(SEL.sidebarEntry).first();
  await entry.click();
  const root = page.locator(SEL.root).first();
  await root.waitFor({ state: 'visible', timeout: 30_000 });
  await expect(root).toHaveAttribute('data-theme', /^(light|dark)$/u);
  return root;
}

/**
 * Navigate to one panel page through the left rail.
 * @param {import('@playwright/test').Page} page - Host page.
 * @param {keyof typeof SEL.nav} name - Page name.
 * @param {string} [marker] - Selector that proves the page rendered.
 * @returns {Promise<void>} resolves when the marker is visible.
 */
export async function navTo(page, name, marker) {
  const tab = page.locator(SEL.nav[name]).first();
  await expect(tab).toBeVisible();
  await tab.click();
  if (marker !== undefined) await page.locator(marker).first().waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Open the settings dialog from the rail-bottom gear.
 *
 * The implementation puts `data-testid="tm-settings"` on the gear trigger and
 * `data-testid="tm-settings-dialog"` on the Win11 dialog; both are asserted by
 * the settings spec.
 *
 * @param {import('@playwright/test').Page} page - Host page.
 * @returns {Promise<import('@playwright/test').Locator>} the settings dialog.
 */
export async function openSettings(page) {
  const trigger = page.locator(SEL.settings).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.locator(SEL.settingsDialog).first();
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  return dialog;
}

/**
 * Parse a percentage or a formatted number out of a table cell.
 * @param {string} text - Cell text such as `5.4%` or `1,151.0 MB`.
 * @returns {number} the numeric value, or NaN.
 */
export function parseNumber(text) {
  const match = text.replace(/,/gu, '').match(/-?\d+(?:\.\d+)?/u);
  return match === null ? Number.NaN : Number(match[0]);
}

/**
 * Wait long enough for at least one snapshot poll to land after an action.
 * @param {import('@playwright/test').Page} page - Host page.
 * @param {number} [ms] - Extra settle time.
 * @returns {Promise<void>} resolves after the wait.
 */
export async function settle(page, ms = 1800) {
  await page.waitForTimeout(ms);
}
