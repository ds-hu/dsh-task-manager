/**
 * Test 1 — the sidebar entry and the panel shell.
 *
 * The plugin's whole discovery surface is one left-sidebar button. It must be
 * labelled in the active locale, render its own 18 px SVG glyph, and open the
 * main-slot panel without a single console or page error.
 */
import { expect, test } from './fixtures.mjs';
import { fatalErrors, SEL } from './helpers.mjs';

test.describe('sidebar entry', () => {
  test('is labelled, has an SVG icon, and opens the panel cleanly', async ({
    boot,
    consoleErrors,
    pageErrors,
  }) => {
    const entry = boot.locator(SEL.sidebarEntry).first();
    await expect(entry).toBeVisible();
    await expect(entry).toContainText(/任务管理器|Task Manager/u);
    await expect(entry).toBeEnabled();

    // The glyph is an inline SVG (no external image) sized by the sidebar.
    const icon = entry.locator('svg').first();
    await expect(icon).toBeVisible();
    const iconBox = await icon.boundingBox();
    expect(iconBox, 'sidebar icon has a layout box').not.toBeNull();
    expect(iconBox.width).toBeGreaterThanOrEqual(12);
    expect(iconBox.height).toBeGreaterThanOrEqual(12);
    expect(iconBox.width).toBeLessThanOrEqual(24);
    expect(iconBox.height).toBeLessThanOrEqual(24);
    await expect(entry.locator('img')).toHaveCount(0);

    // Clicking the entry mounts the panel in the main slot.
    await entry.click();
    const root = boot.locator(SEL.root).first();
    await expect(root).toBeVisible();
    await expect(root).toHaveAttribute('data-theme', /^(light|dark)$/u);
    await expect(root).toContainText(/任务管理器|Task Manager/u);

    // The panel fills the centre column instead of collapsing to a corner.
    const rootBox = await root.boundingBox();
    expect(rootBox, 'panel root has a layout box').not.toBeNull();
    expect(rootBox.x).toBeGreaterThanOrEqual(0);
    expect(rootBox.y).toBeGreaterThanOrEqual(0);
    expect(rootBox.width).toBeGreaterThan(600);
    expect(rootBox.height).toBeGreaterThan(400);
    expect(rootBox.x + rootBox.width).toBeLessThanOrEqual(1441);
    expect(rootBox.y + rootBox.height).toBeLessThanOrEqual(901);

    // Panel chrome: the title row carries refresh + overflow (the page header
    // intentionally has no duplicate actions).
    await expect(boot.locator(SEL.refresh)).toBeVisible();
    await expect(boot.locator('[data-testid="tm-more"]')).toBeVisible();

    // Opening the panel must not log a single real console/page error.
    expect(fatalErrors(pageErrors, consoleErrors)).toEqual([]);
  });
});
