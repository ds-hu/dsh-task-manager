/**
 * Resolve the URL of the isolated E2E instance.
 *
 * Precedence:
 *  1. `TM_URL` — the caller manages the instance (CI, another owner's run);
 *  2. `$DSH_E2E_HOME/e2e-runtime.json` — written by the global setup;
 *  3. `$DSH_E2E_HOME/url.txt` — written by `scripts/e2e-instance.sh`.
 *
 * The token is part of the URL the Host prints at boot; navigating to it sets
 * the session cookie and redirects to the clean origin.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (two levels above test/e2e). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Isolated DSH_HOME; never the production profile. */
export const HOME = process.env.DSH_E2E_HOME || '/tmp/dsh-tm-e2e-qa';

/** Isolated instance port. */
export const PORT = Number(process.env.DSH_E2E_PORT || 3092);

/** Shared runtime descriptor written by the global setup. */
export const STATE_FILE = path.join(HOME, 'e2e-runtime.json');

/** URL the instance script writes when the web server is ready. */
export const URL_FILE = path.join(HOME, 'url.txt');

/** PID file written by the instance script. */
export const PID_FILE = path.join(HOME, 'web.pid');

/** Host API prefix served by the plugin. */
export const API_PREFIX = '/dsh-task-manager/api';

/**
 * Turn a tokenized URL into the runtime descriptor used by the tests.
 * @param {string} url - URL printed by the Host (may carry `?token=`).
 * @param {Record<string, unknown>} [extra] - Additional descriptor fields.
 * @returns {{ url: string, origin: string, baseURL: string, token: string | null }} descriptor.
 */
export function describeRuntime(url, extra = {}) {
  const parsed = new URL(url);
  return {
    url,
    origin: parsed.origin,
    baseURL: parsed.origin,
    token: parsed.searchParams.get('token'),
    ...extra,
  };
}

/**
 * Read the runtime descriptor for this run.
 * @returns {Promise<ReturnType<typeof describeRuntime>>} descriptor.
 */
export async function readRuntime() {
  const fromEnv = process.env.TM_URL?.trim();
  if (fromEnv) return describeRuntime(fromEnv, { external: true, started: false });

  try {
    const state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (typeof state?.url === 'string' && state.url !== '') return describeRuntime(state.url, state);
  } catch {
    // Fall through to the script's URL file.
  }

  const url = (await readFile(URL_FILE, 'utf8')).trim();
  if (url === '') throw new Error(`empty instance URL in ${URL_FILE}`);
  return describeRuntime(url, { external: false, started: false });
}

/**
 * Absolute URL of one API route.
 * @param {{ origin: string }} runtime - Runtime descriptor.
 * @param {string} route - Route below `/dsh-task-manager/api`.
 * @returns {string} absolute URL.
 */
export function apiUrl(runtime, route) {
  return `${runtime.origin}${API_PREFIX}${route}`;
}
