/**
 * Playwright configuration for the Task Manager end-to-end suite.
 *
 * The suite runs against the isolated DSH web instance managed by
 * `scripts/e2e-instance.sh` (own DSH_HOME, own port, 768 MB heap cap). It never
 * touches the production profile on :3080 or another owner's instance.
 *
 * `baseURL` comes from `TM_URL` when the caller already has an instance; on a
 * bare `npx playwright test` the global setup starts the isolated instance and
 * publishes its tokenized URL to the worker fixtures through
 * `$DSH_E2E_HOME/e2e-runtime.json` (see test/e2e/runtime.mjs). The global
 * teardown stops the instance only when this run started it.
 *
 * One worker, one browser, no retries: the panel polls the Host and the
 * screenshots must be deterministic.
 */
import { defineConfig } from '@playwright/test';

/** Isolated instance port; must match the instance script invocation. */
const PORT = Number(process.env.DSH_E2E_PORT || 3092);

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  globalSetup: './test/e2e/global-setup.mjs',
  globalTeardown: './test/e2e/global-teardown.mjs',
  use: {
    // Set only when the caller supplies an instance; the fixtures use the
    // runtime file otherwise, so both modes share one navigation helper.
    baseURL: process.env.TM_URL || undefined,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    colorScheme: 'light',
    timezoneId: 'UTC',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      metadata: { port: PORT },
    },
  ],
});
