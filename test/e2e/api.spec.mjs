/**
 * Test 7 — Host API contract (docs/API.md), exercised over HTTP.
 *
 * These checks are browser-independent: they hit the same origin the panel
 * polls. The kill guards are exercised with `pid 1` (always protected) and
 * non-positive pids, so the suite never ends a real process.
 */
import { expect, test } from '@playwright/test';

import { apiUrl, readRuntime } from './runtime.mjs';

/** States promised by docs/API.md § Process semantics. */
const STATES = ['running', 'sleeping', 'blocked', 'stopped', 'zombie', 'unknown'];
/** Groups promised by docs/API.md § Process semantics. */
const GROUPS = ['app', 'background', 'system'];

test.describe('Host API contract', () => {
  /** @type {Awaited<ReturnType<typeof readRuntime>>} */
  let runtime;

  test.beforeAll(async () => {
    runtime = await readRuntime();
  });

  test('GET /health describes the plugin process', async ({ request }) => {
    const response = await request.get(apiUrl(runtime, '/health'));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['cache-control']).toBe('no-store');

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.name).toBe('task-manager');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(Number.isInteger(body.pid)).toBe(true);
    expect(body.pid).toBeGreaterThan(0);
    expect(typeof body.startedAt).toBe('number');
    expect(body.startedAt).toBeGreaterThan(0);
  });

  test('GET /system exposes every documented field (null when unknown)', async ({ request }) => {
    const response = await request.get(apiUrl(runtime, '/system'));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    for (const key of ['hostname', 'platform', 'distro', 'release', 'arch', 'kernel', 'manufacturer', 'model', 'cpu', 'memTotal', 'swapTotal', 'disks', 'netIfaces', 'graphics', 'dsh']) {
      expect(Object.hasOwn(body, key), `system.${key} is present`).toBe(true);
    }
    expect(typeof body.hostname).toBe('string');
    expect(body.hostname.length).toBeGreaterThan(0);
    expect(['linux', 'darwin', 'win32']).toContain(body.platform);
    expect(body.cpu.cores).toBeGreaterThan(0);
    expect(body.cpu.physicalCores).toBeGreaterThan(0);
    expect(typeof body.cpu.brand).toBe('string');
    expect(body.cpu.cache).toMatchObject({
      l1d: expect.any(Number),
      l1i: expect.any(Number),
      l2: expect.any(Number),
      l3: expect.any(Number),
    });
    expect(body.memTotal).toBeGreaterThan(0);
    expect(Array.isArray(body.disks)).toBe(true);
    expect(Array.isArray(body.netIfaces)).toBe(true);
    expect(body.graphics).toMatchObject({
      controllers: expect.any(Array),
      displays: expect.any(Array),
    });
    expect(typeof body.dsh.version).toBe('string');
    expect(body.dsh.pid).toBeGreaterThan(0);
  });

  test('GET /snapshot returns live processes and machine totals', async ({ request }) => {
    const response = await request.get(apiUrl(runtime, '/snapshot'));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Math.abs(Date.now() - body.ts)).toBeLessThan(60_000);
    expect(body.sampleMs).toBeGreaterThanOrEqual(0);
    expect(body.intervalMs).toBeGreaterThanOrEqual(500);
    expect(body.intervalMs).toBeLessThanOrEqual(10_000);

    // Machine totals.
    expect(body.cpu.load).toBeGreaterThanOrEqual(0);
    expect(body.cpu.load).toBeLessThanOrEqual(100);
    expect(body.cpu.cores.length).toBeGreaterThan(0);
    for (const core of body.cpu.cores) {
      expect(core).toBeGreaterThanOrEqual(0);
      expect(core).toBeLessThanOrEqual(100);
    }
    expect(body.cpu.processCount).toBeGreaterThan(0);
    expect(body.mem.total).toBeGreaterThan(0);
    expect(body.mem.usedPercent).toBeGreaterThanOrEqual(0);
    expect(body.mem.usedPercent).toBeLessThanOrEqual(100);
    expect(Array.isArray(body.disks)).toBe(true);
    expect(body.network.total.rx_bytes).toBeGreaterThanOrEqual(0);
    expect(body.network.total.tx_bytes).toBeGreaterThanOrEqual(0);

    // Processes: real rows with the documented shape.
    expect(Array.isArray(body.processes)).toBe(true);
    expect(body.processes.length).toBeGreaterThan(0);
    for (const proc of body.processes.slice(0, 25)) {
      expect(Number.isInteger(proc.pid)).toBe(true);
      expect(proc.pid).toBeGreaterThan(0);
      expect(typeof proc.name).toBe('string');
      expect(proc.name.length).toBeGreaterThan(0);
      expect(STATES).toContain(proc.state);
      expect(GROUPS).toContain(proc.group);
      expect(proc.cpu).toBeGreaterThanOrEqual(0);
      expect(proc.cpu).toBeLessThanOrEqual(100);
      expect(proc.memBytes).toBeGreaterThanOrEqual(0);
      expect(proc.memPercent).toBeGreaterThanOrEqual(0);
      expect(proc.threads).toBeGreaterThanOrEqual(0);
      expect(proc.started).toBeGreaterThan(0);
      expect(typeof proc.cmd).toBe('string');
    }

    // The list is sorted by CPU descending (docs/API.md § Process semantics).
    const cpus = body.processes.slice(0, 20).map((proc) => proc.cpu);
    for (let index = 1; index < cpus.length; index += 1) {
      expect(cpus[index - 1]).toBeGreaterThanOrEqual(cpus[index]);
    }

    expect(body.processSummary.all).toBeGreaterThanOrEqual(1);
    expect(body.processSummary.all).toBeGreaterThanOrEqual(body.processes.length);
    expect(body.processSummary.threads).toBeGreaterThan(0);
    expect(Array.isArray(body.users)).toBe(true);
  });

  test('GET /services returns a service list with stable fields', async ({ request }) => {
    const response = await request.get(apiUrl(runtime, '/services'));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services.length).toBeGreaterThan(0);
    for (const service of body.services.slice(0, 20)) {
      expect(typeof service.name).toBe('string');
      expect(service.name.length).toBeGreaterThan(0);
      expect(typeof service.running).toBe('boolean');
      expect(Array.isArray(service.pids)).toBe(true);
      expect(typeof service.cpu).toBe('number');
      expect(typeof service.mem).toBe('number');
    }
  });

  test('GET /startup returns startup entries', async ({ request }) => {
    const response = await request.get(apiUrl(runtime, '/startup'));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
    for (const entry of body.entries.slice(0, 20)) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.source).toBe('string');
      expect(typeof entry.enabled).toBe('boolean');
      expect(typeof entry.type).toBe('string');
      expect(typeof entry.impact).toBe('string');
    }
  });

  test('GET /history accumulates per-app totals', async ({ request }) => {
    const response = await request.get(apiUrl(runtime, '/history'));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.since).toBe('number');
    expect(body.since).toBeLessThanOrEqual(body.ts);
    expect(Array.isArray(body.apps)).toBe(true);
    for (const app of body.apps.slice(0, 20)) {
      expect(typeof app.name).toBe('string');
      expect(app.cpuSeconds).toBeGreaterThanOrEqual(0);
      expect(app.peakMemBytes).toBeGreaterThanOrEqual(0);
      expect(app.lastSeen).toBeGreaterThan(0);
      expect(app.samples).toBeGreaterThanOrEqual(1);
    }
  });

  test('POST /process/kill refuses pid 1 and non-positive pids', async ({ request }) => {
    const protectedResponse = await request.post(apiUrl(runtime, '/process/kill'), {
      headers: { origin: runtime.origin },
      data: { pid: 1 },
    });
    expect(protectedResponse.status()).toBe(403);
    expect(await protectedResponse.json()).toMatchObject({
      ok: false,
      code: 'protected-process',
    });

    for (const pid of [0, -1, -999]) {
      const response = await request.post(apiUrl(runtime, '/process/kill'), {
        headers: { origin: runtime.origin },
        data: { pid },
      });
      expect(response.status(), `pid ${pid} is rejected`).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, code: 'bad-pid' });
    }

    // The Host process itself is protected too.
    const health = await (await request.get(apiUrl(runtime, '/health'))).json();
    const hostResponse = await request.post(apiUrl(runtime, '/process/kill'), {
      headers: { origin: runtime.origin },
      data: { pid: health.pid },
    });
    expect(hostResponse.status()).toBe(403);
    expect(await hostResponse.json()).toMatchObject({ ok: false, code: 'protected-process' });

    // A non-JSON mutation is refused before it reaches the guard.
    const plainResponse = await request.post(apiUrl(runtime, '/process/kill'), {
      headers: { origin: runtime.origin, 'content-type': 'text/plain' },
      data: '{"pid":1}',
    });
    expect(plainResponse.status()).toBe(415);
    expect(await plainResponse.json()).toMatchObject({ ok: false, code: 'unsupported-media-type' });
  });
});
