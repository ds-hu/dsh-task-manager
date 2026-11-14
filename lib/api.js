/**
 * The Task Manager Host API router (temporary scaffold).
 *
 * The real implementation lives in `lib/api.js` and is owned by the host
 * metrics task. This file exists only so the bundle can boot and the panel can
 * be verified end-to-end before the full collector lands.
 *
 * @module @ds-hu/dsh-task-manager/lib/api
 */
import { HttpError, sendError, sendJson } from './http.js';

/**
 * Build the HTTP surface.
 * @param {object} options - API options.
 * @param {any} options.ctx - Host plugin context.
 * @param {(level: string, message: string) => void} [options.logger] - Diagnostic sink.
 * @param {string} options.version - Plugin version.
 * @param {Record<string, unknown>} [options.config] - Row config.
 * @returns {{ handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>, dispose: () => void }} the router.
 */
export function createApi({ ctx, logger = () => {}, version, config = {} }) {
  const startedAt = Date.now();

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://task-manager.invalid');
    } catch {
      sendError(res, 400, 'bad-request', 'malformed request URL');
      return;
    }
    try {
      if (url.pathname === '/dsh-task-manager/api/health') {
        sendJson(res, 200, {
          ok: true,
          name: 'task-manager',
          version,
          pid: process.pid,
          startedAt,
          platform: process.platform,
          config,
        });
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

  return { handler, dispose() {} };
}
