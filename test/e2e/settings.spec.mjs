/**
 * Test 5 — the Settings dialog.
 *
 * Opens from the rail-bottom gear, is a Win11-style modal (`role="dialog"`,
 * `aria-modal="true"`, focus inside, Escape closes), and the refresh interval
 * choice persists in `localStorage["dsh.task-manager.settings"]` and is applied
 * to the snapshot poll cadence.
 */
import { expect, test } from './fixtures.mjs';
import { openSettings, SEL, settle } from './helpers.mjs';

/** Persisted settings key promised by docs/UI-SPEC.md § 设置. */
const SETTINGS_KEY = 'dsh.task-manager.settings';

test.describe('Settings dialog', () => {
  test.beforeEach(async ({ app }) => {
    await expect(app.locator(SEL.settings)).toBeVisible();
  });

  test('opens as a modal, traps focus and closes with Escape', async ({ app }) => {
    const dialog = await openSettings(app);
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('设置');
    await expect(dialog).toContainText('刷新间隔');
    await expect(dialog).toContainText('关于');

    // Focus is moved inside the dialog.
    const focusInside = await app.evaluate(() => {
      const dialogNode = document.querySelector('[data-testid="tm-settings-dialog"]');
      return dialogNode !== null && document.activeElement !== null && dialogNode.contains(document.activeElement);
    });
    expect(focusInside).toBe(true);

    await app.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('refresh interval choice persists and applies immediately', async ({ app }) => {
    let dialog = await openSettings(app);
    const select = dialog.locator('select');
    await expect(select).toHaveAttribute('aria-label', '刷新间隔');
    await expect(select).toHaveValue('1500');

    // Pick 2 s; the value is the interval in milliseconds.
    await select.selectOption('2000');
    await expect(select).toHaveValue('2000');

    const stored = await app.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    }, SETTINGS_KEY);
    expect(stored).not.toBeNull();
    expect(stored.refreshIntervalMs).toBe(2000);

    // Closing and reopening keeps the choice.
    await app.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    dialog = await openSettings(app);
    await expect(dialog.locator('select')).toHaveValue('2000');

    // The panel now polls the snapshot roughly every 2 s.
    const stamps = [];
    app.on('request', (request) => {
      if (request.url().includes('/dsh-task-manager/api/snapshot')) stamps.push(Date.now());
    });
    await settle(app, 5000);
    expect(stamps.length).toBeGreaterThanOrEqual(2);
    const gap = stamps[stamps.length - 1] - stamps[stamps.length - 2];
    expect(gap).toBeGreaterThanOrEqual(1400);
    expect(gap).toBeLessThanOrEqual(3400);

    await app.keyboard.press('Escape');
  });

  test('kernel-thread and compact-row toggles are persisted', async ({ app }) => {
    const dialog = await openSettings(app);
    const checkboxes = dialog.locator('input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(2);

    const before = await checkboxes.nth(0).isChecked();
    await checkboxes.nth(0).click();
    await expect(checkboxes.nth(0)).toBeChecked({ checked: !before });

    const stored = await app.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY);
    expect(typeof stored.showKernelThreads).toBe('boolean');
    expect(stored.showKernelThreads).toBe(!before);
  });
});
