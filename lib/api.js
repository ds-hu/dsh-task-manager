/**
 * The Task Manager Host API router.
 *
 * One web-server prefix (`/dsh-task-manager`) serves the JSON the browser panel
 * polls. The router is a thin, on-demand layer: it validates the request,
 * enforces the same-origin JSON guard on mutations, and memoises the collector
 * for exactly as long as docs/API.md promises. No timer ever runs here, so an
 * idle panel costs nothing; concurrent requests share one in-flight sample.
 *
 * Cache windows (contract):
 *   /snapshot  sampleCacheMs (default 800 ms, configurable 200–5000)
 *   /system    300 s
 *   /services  15 s
 *   /startup   60 s
 *   /history   never cached (it is a cheap in-memory projection)
 *
 * @module @ds-hu/dsh-task-manager/lib/api
 */

import { HttpError, assertSameOriginJson, readJson, sendError, sendJson } from './http.js';
import { createMetrics, normalizeConfig } from './metrics.js';

/** Route prefix registered with the Host web server. */
export const API_PREFIX = '/dsh-task-manager/api';

/** How long the slow-changing `/system` payload is reused (docs/API.md). */
export const SYSTEM_CACHE_MS = 300_000;
/** How long the service list is reused (docs/API.md). */
export const SERVICES_CACHE_MS = 15_000;
/** How long the startup list is reused (docs/API.md). */
export const STARTUP_CACHE_MS = 60_000;

/**
 * Refuse a route called with the wrong method.
 * @param {string} method - Actual method.
 * @param {string} expected - Allowed method.
 * @returns {void}
 */
function requireMethod(method, expected) {
  if (method !== expected) throw new HttpError(405, 'method-not-allowed', `use ${expected}`);
}

/**
 * Build the HTTP surface.
 *
 * @param {object} options - API options.
 * @param {any} options.ctx - Host plugin context (used for the Host origin).
 * @param {(level: string, message: string) => void} [options.logger] - Diagnostic sink.
 * @param {string} options.version - Plugin version.
 * @param {Record<string, unknown>} [options.config] - Row config.
 * @param {() => number} [options.now] - Clock, injectable for tests.
 * @param {ReturnType<typeof createMetrics>} [options.metrics] - Collector override, for tests.
 * @returns {{ handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>,
 *   dispose: () => void, settings: ReturnType<typeof normalizeConfig> }} the router.
 */
export function createApi({ ctx, logger = () => {}, version, config = {}, now = () => Date.now(), metrics }) {
  const startedAt = now();
  const settings = normalizeConfig(config);
  const collector = metrics ?? createMetrics({ config: settings, logger, now });

  /** The Host origin, resolved lazily because the server may bind after mount. */
  const originOf = () => {
    try {
      return ctx?.webServer?.getOrigin?.() ?? '';
    } catch {
      return '';
    }
  };

  /** Cached payloads, keyed by route name. @type {Map<string, { at: number, value: any }>} */
  const caches = new Map();
  /** In-flight producers, so a burst of polls runs one sample. @type {Map<string, Promise<any>>} */
  const inflight = new Map();
  let disposed = false;

  /**
   * Memoise one async producer for `ttlMs`, de-duplicating concurrent calls.
   * @template T
   * @param {string} key - Cache key.
   * @param {number} ttlMs - Freshness window in milliseconds.
   * @param {() => Promise<T>} producer - Work to run on a miss.
   * @returns {Promise<T>} the cached or fresh value.
   */
  function memo(key, ttlMs, producer) {
    const hit = caches.get(key);
    if (hit !== undefined && now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    const pending = inflight.get(key);
    if (pending !== undefined) return pending;
    const promise = Promise.resolve()
      .then(producer)
      .then((value) => {
        caches.set(key, { at: now(), value });
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  /**
   * Dispatch one `/dsh-task-manager/api/*` request.
   * @param {import('node:http').IncomingMessage} req - Request.
   * @param {import('node:http').ServerResponse} res - Response.
   * @param {URL} url - Parsed URL.
   * @returns {Promise<void>} resolves after the response.
   */
  async function routeApi(req, res, url) {
    const method = req.method ?? 'GET';
    const path = url.pathname.replace(/\/+$/u, '');
    const relative = path.slice(API_PREFIX.length);

    if (relative === '/health') {
      requireMethod(method, 'GET');
      sendJson(res, 200, {
        ok: true,
        name: 'task-manager',
        version,
        pid: process.pid,
        startedAt,
      });
      return;
    }
    if (relative === '/system') {
      requireMethod(method, 'GET');
      sendJson(res, 200, await memo('system', SYSTEM_CACHE_MS, () => collector.system()));
      return;
    }
    if (relative === '/snapshot') {
      requireMethod(method, 'GET');
      sendJson(res, 200, await memo('snapshot', settings.sampleCacheMs, () => collector.snapshot()));
      return;
    }
    if (relative === '/services') {
      requireMethod(method, 'GET');
      sendJson(res, 200, await memo('services', SERVICES_CACHE_MS, () => collector.services()));
      return;
    }
    if (relative === '/startup') {
      requireMethod(method, 'GET');
      sendJson(res, 200, await memo('startup', STARTUP_CACHE_MS, () => collector.startup()));
      return;
    }
    if (relative === '/history') {
      requireMethod(method, 'GET');
      sendJson(res, 200, collector.history());
      return;
    }
    if (relative === '/process/kill') {
      requireMethod(method, 'POST');
      assertSameOriginJson(req, originOf);
      const body = await readJson(req);
      const result = await collector.kill(body);
      sendJson(res, 200, { ok: true, pid: result.pid, signal: result.signal });
      return;
    }
    throw new HttpError(404, 'not-found', `no route for ${url.pathname}`);
  }

  /**
   * The single registered route handler.
   * @param {import('node:http').IncomingMessage} req - Request.
   * @param {import('node:http').ServerResponse} res - Response.
   * @returns {Promise<void>} resolves after the response.
   */
  async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://task-manager.invalid');
    } catch {
      sendError(res, 400, 'bad-request', 'malformed request URL');
      return;
    }
    try {
      if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
        await routeApi(req, res, url);
        return;
      }
      throw new HttpError(404, 'not-found', `no route for ${url.pathname}`);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      logger('warn', `task-manager: ${req.method} ${url.pathname} failed: ${error?.stack ?? error}`);
      sendError(res, 500, 'internal', error?.message ?? 'internal error');
    }
  }

  /** Drop caches and release the collector. @returns {void} */
  function dispose() {
    if (disposed) return;
    disposed = true;
    caches.clear();
    inflight.clear();
    collector.dispose?.();
  }

  return { handler, dispose, settings };
}
