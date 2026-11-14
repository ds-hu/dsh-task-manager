/**
 * Test 4 — the secondary pages: App history, Startup, Users, Details, Services.
 *
 * Each page must render its documented test hook plus real data or an honest
 * empty state. Details search must filter the shared process list.
 */
import { expect, test } from './fixtures.mjs';
import { navTo, SEL, settle } from './helpers.mjs';

test.describe('secondary pages', () => {
  test('App history shows accumulated app totals or the honest collecting state', async ({ app }) => {
    await navTo(app, 'appHistory', SEL.appHistoryTable);
    await expect(app.locator(SEL.pageTitle)).toHaveText('应用历史记录');
    const table = app.locator(SEL.appHistoryTable);
    await expect(table).toBeVisible();

    const rows = table.locator('.tm-table-row');
    if ((await rows.count()) === 0) {
      await expect(table).toContainText('正在收集应用历史记录…');
    } else {
      await expect(table.getByRole('columnheader').filter({ hasText: '名称' })).toHaveCount(1);
      await expect(table.getByRole('columnheader').filter({ hasText: 'CPU 时间' })).toHaveCount(1);
      await expect(table.getByRole('columnheader').filter({ hasText: '网络' })).toHaveCount(1);
      await expect(table.getByRole('columnheader').filter({ hasText: '内存峰值' })).toHaveCount(1);
      await expect(table.getByRole('columnheader').filter({ hasText: '上次使用' })).toHaveCount(1);
      const cells = rows.first().locator('[role="cell"]');
      expect(await cells.count()).toBe(5);
      // /api/history has no per-app network counter: the column is an honest dash.
      await expect(cells.nth(2)).toHaveText('—');
      await expect(cells.nth(3)).toContainText(/(MB|GB|B)/u);
    }
    await expect(app.locator('.tm-footnote')).toContainText('数据自本插件启动后开始累积。');
  });

  test('Startup apps renders the read-only table or an honest empty state', async ({ app }) => {
    await navTo(app, 'startup', SEL.startupTable);
    await expect(app.locator(SEL.pageTitle)).toHaveText('启动应用');
    const table = app.locator(SEL.startupTable);
    await expect(table).toBeVisible();

    const rows = table.locator('.tm-table-row');
    if ((await rows.count()) === 0) {
      await expect(table).toContainText('当前平台没有可显示的启动项。');
    } else {
      await expect(table.getByRole('columnheader').filter({ hasText: '名称' })).toHaveCount(1);
      await expect(table.getByRole('columnheader').filter({ hasText: '发布者/路径' })).toHaveCount(1);
      await expect(table.getByRole('columnheader').filter({ hasText: '状态' })).toHaveCount(1);
      await expect(table.getByRole('columnheader').filter({ hasText: '启动影响' })).toHaveCount(1);
      const first = rows.first();
      expect(await first.locator('[role="cell"]').count()).toBe(4);
      await expect(first).toContainText(/已启用|已禁用/u);
    }
    await expect(app.locator('.tm-footnote')).toContainText('启用或禁用启动项由操作系统管理');
  });

  test('Users aggregates real logged-in users and sessions', async ({ app }) => {
    await navTo(app, 'users', `${SEL.usersList}, ${SEL.empty}`);
    await expect(app.locator(SEL.pageTitle)).toHaveText('用户');

    const list = app.locator(SEL.usersList);
    if ((await list.count()) === 0) {
      await expect(app.locator(SEL.root)).toContainText('没有已登录的用户。');
      return;
    }
    await expect(list).toBeVisible();
    const text = await list.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toContain('会话数');
    expect(text).toMatch(/CPU/u);
    expect(text).toMatch(/内存/u);

    // The sessions table is present with the documented columns.
    const sessions = app.locator('[data-testid="tm-sessions-table"]');
    if ((await sessions.count()) > 0) {
      await expect(sessions.getByRole('columnheader').filter({ hasText: '用户' })).toHaveCount(1);
      await expect(sessions.getByRole('columnheader').filter({ hasText: '客户端' })).toHaveCount(1);
      await expect(sessions.getByRole('columnheader').filter({ hasText: '会话类型' })).toHaveCount(1);
    }
  });

  test('Details lists processes and filters by the search box', async ({ app }) => {
    await navTo(app, 'details', SEL.detailsTable);
    await expect(app.locator(SEL.pageTitle)).toHaveText('详细信息');
    const table = app.locator(SEL.detailsTable);
    const rows = table.locator('[data-testid="tm-detail-row"]');
    expect(await rows.count()).toBeGreaterThan(5);

    // Documented columns.
    for (const label of ['名称', 'PID', '状态', '用户名', 'CPU', '内存', '磁盘', '网络', '线程数', '优先级', '命令行']) {
      await expect(table.getByRole('columnheader').filter({ hasText: label })).toHaveCount(1);
    }
    const initialCount = await rows.count();
    const pidCell = (await rows.first().locator('[role="cell"]').nth(1).innerText()).trim();
    // PIDs are identifiers, never locale-grouped.
    expect(pidCell).toMatch(/^\d+$/u);
    expect(Number(pidCell)).toBeGreaterThan(0);

    // Search filters to matching names only.
    const search = app.locator(SEL.search);
    await expect(search).toBeVisible();
    await search.fill('node');
    await expect.poll(async () => rows.count()).toBeLessThanOrEqual(initialCount);
    const filtered = await rows.allInnerTexts();
    expect(filtered.length).toBeGreaterThan(0);
    for (const rowText of filtered) {
      expect(rowText.toLowerCase()).toContain('node');
    }

    // A query with no match shows the honest empty state.
    await search.fill('zzz-no-such-process-zzz');
    await expect(table).toContainText('没有匹配的项。');
    await expect(rows).toHaveCount(0);

    // Clearing restores the list.
    await search.fill('');
    await expect.poll(async () => rows.count()).toBeGreaterThan(5);
    await settle(app, 200);
  });

  test('Services lists services with the read-only footnote', async ({ app }) => {
    await navTo(app, 'services', SEL.servicesTable);
    await expect(app.locator(SEL.pageTitle)).toHaveText('服务');
    const table = app.locator(SEL.servicesTable);
    await expect(table).toBeVisible();

    for (const label of ['名称', 'PID', '描述', '状态', '启动类型']) {
      await expect(table.getByRole('columnheader').filter({ hasText: label })).toHaveCount(1);
    }
    const rows = table.locator('.tm-table-row');
    expect(await rows.count()).toBeGreaterThan(1);
    await expect(rows.first()).toContainText(/正在运行|已停止/u);
    await expect(app.locator('.tm-footnote')).toContainText('服务控制由操作系统管理');

    // be1da5f enriches Linux services with systemd descriptions/start modes:
    // at least one row must show real 描述 and 启动类型 values, not dashes.
    const rowData = await rows.evaluateAll((nodes) =>
      nodes.map((node) => [...node.querySelectorAll('[role="cell"]')].map((cell) => cell.textContent.trim())),
    );
    const enriched = rowData.find((cells) => cells[2] !== '—' && /自动|手动|已禁用/u.test(cells[4]));
    expect(enriched, 'at least one service has a description and a start mode').toBeTruthy();
    const apparmor = rowData.find((cells) => cells[0] === 'apparmor');
    if (apparmor !== undefined) {
      expect(apparmor[2]).toBe('Load AppArmor profiles');
      expect(apparmor[4]).toBe('自动');
    }

    // The page also exposes a search box that filters by name/description.
    const search = app.locator(SEL.search);
    await expect(search).toBeVisible();
    const firstName = (await rows.first().locator('.tm-cell-name-text').innerText()).trim();
    await search.fill(firstName);
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);
    for (const rowText of await rows.allInnerTexts()) {
      expect(rowText.toLowerCase()).toContain(firstName.toLowerCase());
    }
    await search.fill('zzz-no-such-service-zzz');
    await expect(table).toContainText('没有匹配的项。');
    await search.fill('');
  });
});
