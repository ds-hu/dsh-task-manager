/**
 * Playwright global setup: make sure the isolated Task Manager instance is up.
 *
 * `TM_URL` keeps an externally managed instance (useful when debugging a page
 * in a second terminal); otherwise the script-managed instance on
 * `$DSH_E2E_PORT` (default 3092) is restarted so the run sees the current Host
 * code. The runtime descriptor is written to `$DSH_E2E_HOME/e2e-runtime.json`
 * for the worker fixtures.
 */
import { ensureStarted } from './instance.mjs';

/**
 * Playwright global setup hook.
 * @returns {Promise<void>} resolves when the instance answers HTTP.
 */
export default async function globalSetup() {
  const runtime = await ensureStarted();
  process.env.TM_URL = runtime.url;
  process.stdout.write(`\n[e2e] task-manager instance: ${runtime.url}\n\n`);
}
