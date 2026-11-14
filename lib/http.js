/**
 * Small HTTP helpers for the Task Manager Host API.
 *
 * The Host web server hands the plugin the raw Node request/response pair and
 * expects the handler to own the full response lifecycle, so these are plain
 * `node:http` utilities rather than a framework.
 *
 * @module @ds-hu/dsh-task-manager/lib/http
 */

/** Largest JSON body the API accepts (kill requests are tiny). */
export const MAX_JSON_BYTES = 16 * 1024;

/** A request that cannot be answered as asked, with a status code. */
export class HttpError extends Error {
  /**
   * @param {number} status - HTTP status to send.
   * @param {string} code - Stable machine code.
   * @param {string} message - Human-readable explanation.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Send a JSON response and end it.
 * @param {import('node:http').ServerResponse} res - Response.
 * @param {number} status - Status code.
 * @param {unknown} value - Body to serialize.
 * @returns {void}
 */
export function sendJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * Send the shared error envelope and end the response.
 * @param {import('node:http').ServerResponse} res - Response.
 * @param {number} status - HTTP status code.
 * @param {string} code - Stable machine code.
 * @param {string} message - Human-readable explanation.
 * @returns {void}
 */
export function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, code, error: message });
}

/**
 * Read a request body as UTF-8 text, refusing anything over the limit.
 * @param {import('node:http').IncomingMessage} req - Request.
 * @param {number} [limit] - Largest accepted size in bytes.
 * @returns {Promise<string>} the body.
 */
export function readBody(req, limit = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(new HttpError(413, 'payload-too-large', `request body must stay under ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

/**
 * Read a request body and parse it as JSON.
 * @param {import('node:http').IncomingMessage} req - Request.
 * @param {number} [limit] - Largest accepted size in bytes.
 * @returns {Promise<unknown>} the parsed value.
 */
export async function readJson(req, limit = MAX_JSON_BYTES) {
  const text = await readBody(req, limit);
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad-json', 'request body is not valid JSON');
  }
}

/**
 * The host a request was addressed to, as the browser saw it.
 * @param {import('node:http').IncomingMessage} req - Request.
 * @returns {string} the host header value.
 */
export function requestHost(req) {
  const forwarded = req.headers['x-forwarded-host'];
  if (typeof forwarded === 'string' && forwarded !== '') return forwarded.split(',')[0].trim();
  return typeof req.headers.host === 'string' ? req.headers.host : '';
}

/**
 * Whether two origin-ish strings name the same site.
 * @param {string} announced - Origin or host from the request.
 * @param {string} requestHostValue - Host the request reached.
 * @param {string} origin - Host origin the plugin believes it serves.
 * @returns {boolean} whether they agree.
 */
export function sameSite(announced, requestHostValue, origin) {
  const strip = (value) => value.replace(/^https?:\/\//u, '').replace(/\/$/u, '').toLowerCase();
  const candidates = new Set([strip(requestHostValue), strip(origin)].filter((value) => value !== ''));
  return candidates.has(strip(announced));
}

/**
 * Refuse a cross-origin mutation: the browser panel always announces its own
 * origin, and every mutation is JSON. A same-origin GET is unaffected.
 * @param {import('node:http').IncomingMessage} req - Request.
 * @param {() => string} origin - Getter for the Host origin.
 * @returns {void}
 */
export function assertSameOriginJson(req, origin) {
  const announced = req.headers.origin;
  if (typeof announced === 'string' && announced !== '' && !sameSite(announced, requestHost(req), origin())) {
    throw new HttpError(403, 'cross-origin', 'this API only accepts requests from the Host page');
  }
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'unsupported-media-type', 'send application/json');
  }
}

/**
 * Parse a positive integer route/query value.
 * @param {unknown} value - Raw value.
 * @param {string} name - Field name for the error message.
 * @returns {number} the parsed integer.
 */
export function positiveInt(value, name) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, 'bad-request', `${name} must be a positive integer`);
  }
  return parsed;
}
