/**
 * Test 3 — the Performance page.
 *
 * Resource cards, a real canvas graph (non-zero size and actually painted), the
 * Win11 stats grid, and card switching.
 */
import { expect, test } from './fixtures.mjs';
import { navTo, SEL, settle } from './helpers.mjs';

test.describe('Performance page', () => {
  test.beforeEach(async ({ app }) => {
    await navTo(app, 'performance', SEL.perf.cpu);
    await expect(app.locator(SEL.pageTitle)).toHaveText('性能');
  });

  test('shows resource cards, a painted graph and the stats grid', async ({ app }) => {
    // Resource cards, in Win11 order.
    for (const selector of [SEL.perf.cpu, SEL.perf.mem, SEL.perf.disk, SEL.perf.net]) {
      const card = app.locator(selector);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('role', 'tab');
      expect((await card.innerText()).trim().length).toBeGreaterThan(1);
    }
    await expect(app.locator(SEL.perf.cpu)).toHaveAttribute('aria-selected', 'true');

    // The main graph is a canvas with a real layout box and drawn pixels.
    const graph = app.locator(SEL.graph);
    await expect(graph).toBeVisible();
    await expect(graph).toHaveJSProperty('tagName', 'CANVAS');
    const box = await graph.boundingBox();
    expect(box, 'graph has a layout box').not.toBeNull();
    expect(box.width).toBeGreaterThan(150);
    expect(box.height).toBeGreaterThan(80);
    const painted = await graph.evaluate((canvas) => {
      const context = canvas.getContext('2d');
      const { width, height } = canvas;
      const data = context.getImageData(0, 0, width, height).data;
      let visiblePixels = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) visiblePixels += 1;
      }
      return { width, height, visiblePixels };
    });
    expect(painted.width).toBeGreaterThan(150);
    expect(painted.height).toBeGreaterThan(80);
    expect(painted.visiblePixels, 'graph canvas has painted pixels').toBeGreaterThan(0);

    // Stats grid: 利用率 / 速度 / 进程 (CPU is the default resource).
    const labels = await app.locator(SEL.statLabel).allInnerTexts();
    expect(labels).toEqual(expect.arrayContaining(['利用率', '速度', '进程']));
    const values = await app.locator(SEL.statValue).allInnerTexts();
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const value of values) expect(value.trim().length).toBeGreaterThan(0);

    // Graph x-axis labels.
    await expect(app.locator('.tm-graph-labels')).toContainText('60 秒');
    await expect(app.locator('.tm-graph-labels')).toContainText('0');
  });

  test('switches between CPU, memory, disk and network details', async ({ app }) => {
    const title = app.locator('.tm-perf-title');

    await app.locator(SEL.perf.mem).click();
    await expect(app.locator(SEL.perf.mem)).toHaveAttribute('aria-selected', 'true');
    await expect(title).toHaveText('内存');
    await expect(app.locator(SEL.statLabel).filter({ hasText: '使用中' })).toHaveCount(1);
    await expect(app.locator(SEL.statLabel).filter({ hasText: '可用' })).toHaveCount(1);

    await app.locator(SEL.perf.disk).click();
    await expect(title).toContainText('磁盘');
    await expect(app.locator(SEL.statLabel).filter({ hasText: '活动时间' })).toHaveCount(1);
    await expect(app.locator(SEL.statLabel).filter({ hasText: '读取速度' })).toHaveCount(1);

    await app.locator(SEL.perf.net).click();
    await expect(title).toContainText(/以太网|Wi-Fi/u);
    await expect(app.locator(SEL.statLabel).filter({ hasText: '发送' })).toHaveCount(1);
    await expect(app.locator(SEL.statLabel).filter({ hasText: '接收' })).toHaveCount(1);

    // The graph survives the switch and keeps drawing.
    await expect(app.locator(SEL.graph)).toBeVisible();
    await settle(app, 300);
  });
});
