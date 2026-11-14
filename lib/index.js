/**
 * dsh-task-manager — Host half.
 *
 * Mounts one web-server prefix (`/dsh-task-manager`) and serves the JSON API
 * the browser panel polls. Every reading is derived from the operating system
 * on demand; the plugin owns no durable state and writes nothing to disk, so
 * uninstalling the bundle leaves the machine untouched.
 *
 * `webServer` is a hard dependency: without it there is no panel, so the plugin
 * stays inert until it exists. No Cordis service is published; the row sits
 * loose in the Host root realm.
 *
 * @module @ds-hu/dsh-task-manager
 */
import { createApi } from './api.js';
import { PLUGIN_VERSION } from './version.js';

/** Plugin name registered with the Loader; must equal the row `id` in cordis.patch.yml. */
export const name = 'task-manager';

/** Host services this plugin cannot work without. */
export const inject = ['webServer'];

/**
 * Mount the plugin.
 *
 * The row may carry `config` (`allowKillSystemProcesses`, `refreshIntervalMs`,
 * `maxProcesses`, `sampleCacheMs`). It is read defensively by the API and every
 * value is clamped there, so an invalid row config degrades to the defaults
 * instead of failing activation.
 *
 * @param {any} ctx - Host plugin context (Cordis).
 * @param {Record<string, unknown>} [config] - Row config.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  /**
   * Route diagnostics through the Host log when it exposes one, and stay quiet
   * enough otherwise that a bare profile is not noisy.
   * @param {string} level - Severity.
   * @param {string} message - Text to record.
   * @returns {void}
   */
  const logger = (level, message) => {
    const sink = ctx.get?.('logger');
    if (typeof sink === 'function') {
      sink.call(ctx, level, message);
      return;
    }
    if (typeof sink?.log === 'function') {
      sink.log(level, message);
      return;
    }
    if (level === 'error' || level === 'warn') console.warn(message);
  };

  const api = createApi({
    ctx,
    logger,
    version: PLUGIN_VERSION,
    config,
  });

  ctx.effect(() => {
    const unregister = ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-task-manager',
      handler: api.handler,
    });
    logger('info', 'task-manager: API mounted at /dsh-task-manager/api');
    return () => {
      unregister();
      api.dispose();
    };
  }, 'task-manager: web routes');
}
