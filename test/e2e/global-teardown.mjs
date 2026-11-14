/**
 * Playwright global teardown: stop the isolated instance when this run started
 * it. An externally supplied `TM_URL` is left untouched.
 */
import { stopStarted } from './instance.mjs';

/**
 * Playwright global teardown hook.
 * @returns {Promise<void>} resolves once the port is released.
 */
export default async function globalTeardown() {
  await stopStarted();
}
