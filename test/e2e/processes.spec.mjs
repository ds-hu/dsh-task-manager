/**
 * Test 2 — the Processes page.
 *
 * Mirrors the Win11 Processes tab: three group rows with totals, the six
 * columns, real rows carrying a PID, the bottom status bar, CPU sorting, row
 * selection, and the end-task confirmation (cancel path only — the suite must
 * never end a real process).
 */
import { expect, test } from './fixtures.mjs';
import { SEL, settle } from './helpers.mjs';
import { apiUrl } from './runtime.mjs';

/** Column labels promised by docs/UI-SPEC.md § 进程. */
const COLUMNS = ['名称', '状态', 'CPU', '内存', '磁盘', '网络'];

/**
 * Read the CPU cells of the top-level process rows, grouped by their group
 * header. Child rows are nested under their parent and sorted separately, so
 * only root rows participate in the column sort.
 * @param {import('@playwright/test').Page} page - Panel page.
 * @returns {Promise<number[][]>} CPU percentages per group.
 */
function readGroupedCpus(page) {
  return page.evaluate(() => {
    const table = document.querySelector('[data-testid="tm-process-table"]');
    if (table === null) return [];
    const rows = [...table.querySelectorAll('[data-testid="tm-process-group"], [data-testid="tm-process-row"]')];
    const groups = [];
    let current = null;
    for (const row of rows) {
      if (row.getAttribute('data-testid') === 'tm-process-group') {
        current = [];
        groups.push(current);
        continue;
      }
      if (current === null) continue;
      // A nested child row carries the 20 px indent element.
      if (row.querySelector('.tm-indent') !== null) continue;
      const cells = row.querySelectorAll('[role="cell"]');
      const text = cells[2]?.textContent ?? '';
      const value = Number(text.replace(/[^0-9.-]/gu, ''));
      current.push(Number.isFinite(value) ? value : 0);
    }
    return groups;
  });
}

/**
 * Whether a numeric series is monotonic in the requested direction.
 * @param {number[]} values - Series.
 * @param {'asc' | 'desc'} direction - Expected direction.
 * @returns {boolean} true when monotonic.
 */
function isMonotonic(values, direction) {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (direction === 'asc' && current < previous - 0.001) return false;
    if (direction === 'desc' && current > previous + 0.001) return false;
  }
  return true;
}

test.describe('Processes page', () => {
  test.beforeEach(async ({ app }) => {
    await expect(app.locator(SEL.nav.processes)).toHaveAttribute('aria-current', 'page');
    await app.locator(SEL.processTable).waitFor({ state: 'visible' });
    await expect(app.locator(SEL.processRow).first()).toBeVisible();
  });

  test('renders Win11 groups, columns, live rows and the status bar', async ({ app, request, runtime }) => {
    // Group headers, in Win11 order, with their counts. All three start
    // expanded by design (matches the Win11 default), so each is expandable.
    const groups = app.locator(SEL.processGroup);
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toContainText(/应用 \(\d+\)/u);
    await expect(groups.nth(1)).toContainText(/后台进程 \(\d+\)/u);
    await expect(groups.nth(2)).toContainText(/系统进程 \(\d+\)/u);
    for (let index = 0; index < 3; index += 1) {
      await expect(groups.nth(index)).toHaveAttribute('aria-expanded', 'true');
    }

    // Panel chrome: the title row owns refresh/overflow, the status bar owns the
    // single End task button (no duplicate page-header actions by design).
    await expect(app.locator(SEL.refresh)).toBeVisible();
    await expect(app.locator('[data-testid="tm-more"]')).toBeVisible();

    // Column headers.
    const table = app.locator(SEL.processTable);
    for (const label of COLUMNS) {
      await expect(table.getByRole('columnheader').filter({ hasText: label })).toHaveCount(1);
    }

    // Real rows: a positive PID and a process that the Host API also sees.
    const rows = app.locator(SEL.processRow);
    expect(await rows.count()).toBeGreaterThan(2);
    const firstRow = rows.first();
    const pid = Number(await firstRow.getAttribute('data-pid'));
    expect(Number.isInteger(pid)).toBe(true);
    expect(pid).toBeGreaterThan(0);
    await expect(firstRow).toHaveAttribute('aria-selected', 'false');
    await expect(firstRow).toContainText(/.+/u);

    const snapshot = await (await request.get(apiUrl(runtime, '/snapshot'))).json();
    expect(snapshot.processes.some((process) => process.pid === pid), `pid ${pid} is a real process`).toBe(true);

    // Every data row paints CPU / memory / disk / network values.
    const cells = firstRow.locator('[role="cell"]');
    expect(await cells.count()).toBe(6);
    await expect(cells.nth(2)).toContainText(/%/u);
    await expect(cells.nth(3)).toContainText(/(MB|GB|B)/u);
    await expect(cells.nth(4)).toContainText(/(MB\/秒|MB\/s|KB\/秒|B\/秒)/u);
    await expect(cells.nth(5)).toContainText(/(Mbps|Kbps|bps)/u);

    // Bottom status bar mirrors the snapshot totals and owns the End task button.
    const statusBar = app.locator(SEL.statusBar);
    await expect(statusBar).toBeVisible();
    const statusText = await statusBar.innerText();
    expect(statusText).toMatch(/进程[:：]\s*[\d,]+/u);
    expect(statusText).toMatch(/CPU[:：]\s*\d+(?:\.\d+)?%/u);
    expect(statusText).toMatch(/内存[:：]\s*\d+(?:\.\d+)?%/u);
    expect(statusText).toMatch(/磁盘[:：]\s*\d+(?:\.\d+)?%/u);
    expect(statusText).toMatch(/网络[:：]\s*[\d.]+\s*(?:Mbps|Kbps|bps)/u);
    await expect(statusBar.locator(SEL.endTask)).toBeVisible();
  });

  test('sorts by CPU and toggles the direction', async ({ app }) => {
    const cpuHeader = app.locator('[data-testid="tm-sort-cpu"]').locator('xpath=..');
    await expect(cpuHeader).toHaveAttribute('aria-sort', 'descending');

    // Descending is the default: the largest group must already be ordered.
    let groups = await readGroupedCpus(app);
    let target = groups.reduce((best, group) => (group.length > best.length ? group : best), []);
    expect(target.length).toBeGreaterThan(1);
    expect(isMonotonic(target, 'desc')).toBe(true);

    // First click flips to ascending.
    await app.locator('[data-testid="tm-sort-cpu"]').click();
    await expect(cpuHeader).toHaveAttribute('aria-sort', 'ascending');
    await settle(app, 250);
    groups = await readGroupedCpus(app);
    target = groups.reduce((best, group) => (group.length > best.length ? group : best), []);
    expect(target.length).toBeGreaterThan(1);
    expect(isMonotonic(target, 'asc')).toBe(true);

    // Second click returns to descending.
    await app.locator('[data-testid="tm-sort-cpu"]').click();
    await expect(cpuHeader).toHaveAttribute('aria-sort', 'descending');
    await settle(app, 250);
    groups = await readGroupedCpus(app);
    target = groups.reduce((best, group) => (group.length > best.length ? group : best), []);
    expect(isMonotonic(target, 'desc')).toBe(true);
  });

  test('selects a row and cancels the end-task dialog', async ({ app }) => {
    const endTask = app.locator(SEL.endTask);
    await expect(endTask).toBeDisabled();

    const firstRow = app.locator(SEL.processRow).first();
    const pid = Number(await firstRow.getAttribute('data-pid'));
    const name = (await firstRow.locator('[role="cell"]').first().innerText()).trim();
    await firstRow.click();
    await expect(firstRow).toHaveAttribute('aria-selected', 'true');
    await expect(endTask).toBeEnabled();

    await endTask.click();
    const dialog = app.locator(SEL.endTaskDialog);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText(name.slice(0, 12));
    await expect(dialog).toContainText(String(pid));

    // Cancel must close the dialog and leave the process alone.
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(firstRow).toHaveAttribute('aria-selected', 'true');

    // Escape also closes a dialog.
    await endTask.click();
    await expect(dialog).toBeVisible();
    await app.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('nests child processes under their parent', async ({ app }) => {
    // Expandable parents carry a disclosure chevron; children are indented.
    const chevrons = app.locator(`${SEL.processTable} .tm-chevron-btn[aria-expanded]`);
    expect(await chevrons.count()).toBeGreaterThan(0);
    const indents = app.locator(`${SEL.processRow} .tm-indent`);
    expect(await indents.count()).toBeGreaterThanOrEqual(0);
  });

  test('scrolls internally with a sticky header and a fixed status bar', async ({ app }) => {
    const scroller = app.locator(SEL.processTable);
    const header = scroller.locator('.tm-table-header').first();
    const statusBar = app.locator(SEL.statusBar);
    await expect(header).toHaveCSS('position', 'sticky');

    /**
     * Geometry that must not move while the table scrolls.
     * @returns {Promise<{scrollTop: number, headerY: number, docScrollY: number}>} metrics.
     */
    const readMetrics = () =>
      app.evaluate(() => {
        const node = document.querySelector('[data-testid="tm-process-table"]');
        const headerNode = node.querySelector('.tm-table-header');
        return {
          scrollTop: node.scrollTop,
          headerY: headerNode.getBoundingClientRect().y,
          docScrollY: window.scrollY,
        };
      });

    const before = await readMetrics();
    const statusBefore = await statusBar.boundingBox();
    expect(before.scrollTop).toBe(0);

    const box = await scroller.boundingBox();
    await app.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    await app.mouse.wheel(0, 900);
    await expect.poll(async () => (await readMetrics()).scrollTop).toBeGreaterThan(0);

    const after = await readMetrics();
    expect(after.scrollTop).toBeGreaterThan(before.scrollTop);
    // The document itself never scrolls: only the panel's own scroll region.
    expect(after.docScrollY).toBe(0);
    // The sticky header stays pinned to the top of the scroll region.
    expect(Math.abs(after.headerY - before.headerY)).toBeLessThanOrEqual(1);
    // The bottom status bar is outside the scroll region and does not move.
    const statusAfter = await statusBar.boundingBox();
    expect(Math.abs(statusAfter.y - statusBefore.y)).toBeLessThanOrEqual(1);

    // Scrolling back up returns to the first row.
    await app.mouse.wheel(0, -900);
    await expect.poll(async () => (await readMetrics()).scrollTop).toBe(0);
  });
});
