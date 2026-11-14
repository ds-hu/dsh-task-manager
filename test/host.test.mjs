/**
 * Host-half unit tests.
 *
 * Everything OS-facing is injected, so this suite runs on any machine (and in
 * CI without `/proc`): the parsers, the CPU delta maths, the cache windows and
 * in-flight de-duplication, the history fold, the config clamps, the kill
 * guards, and every documented response envelope.
 *
 * Run with `node --test test/host.test.mjs` (also `npm run test:host`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError } from '../lib/http.js';
import {
  API_PREFIX,
  createApi,
  SERVICES_CACHE_MS,
  STARTUP_CACHE_MS,
  SYSTEM_CACHE_MS,
} from '../lib/api.js';
import { createHistory, MAX_FOLD_SECONDS } from '../lib/history.js';
import {
  collectStartupEntries,
  createMetrics,
  GUI_ALLOWLIST,
  normalizeConfig,
  parseDesktopEntry,
  resolveDshVersion,
} from '../lib/metrics.js';
import {
  computeProcessCpu,
  createProcfs,
  detectPageSize,
  isPhysicalDisk,
  mapProcessState,
  parseAuxvPageSize,
  parseCpuStat,
  parseDiskstats,
  parseNetDev,
  parsePasswd,
  parseProcStat,
  parseProcStatusUid,
} from '../lib/procfs.js';

const ORIGIN = 'http://127.0.0.1:3091';
const API = API_PREFIX;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Minimal `ServerResponse` double.
 * @returns {any} the response.
 */
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    ended: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
      return this;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) this.body += String(chunk);
      this.ended = true;
      return this;
    },
  };
}

/**
 * Minimal `IncomingMessage` double.
 * @param {object} [options] - Request fields.
 * @returns {any} the request.
 */
function fakeReq({ method = 'GET', url = `${API}/health`, headers = {}, body = '' } = {}) {
  const listeners = new Map();
  return {
    method,
    url,
    headers,
    on(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    destroy() {},
    /** Fire the body events the way Node would. */
    emitBody() {
      if (body !== '') listeners.get('data')?.(Buffer.from(body));
      listeners.get('end')?.();
    },
  };
}

/**
 * Invoke the API handler and decode the JSON response.
 * @param {any} api - Router.
 * @param {object} options - Request options.
 * @param {string} [options.json] - JSON body (sets the JSON content type).
 * @returns {Promise<{ status: number, body: any, res: any }>} the response.
 */
async function call(api, { json, ...options } = {}) {
  const headers = { host: '127.0.0.1:3091', ...(options.headers ?? {}) };
  let body = options.body ?? '';
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers['content-type'] = 'application/json';
  }
  const req = fakeReq({ ...options, headers, body });
  const res = fakeRes();
  const pending = api.handler(req, res);
  req.emitBody();
  await pending;
  return { status: res.statusCode, body: res.body === '' ? undefined : JSON.parse(res.body), res };
}

/**
 * A collector stub for router-level tests.
 * @param {Record<string, unknown>} [overrides] - Method overrides.
 * @returns {{ metrics: any, calls: Record<string, number> }} the stub and its call counts.
 */
function stubMetrics(overrides = {}) {
  const calls = { snapshot: 0, system: 0, services: 0, startup: 0, history: 0, kill: 0 };
  const metrics = {
    settings: normalizeConfig({}),
    async snapshot() {
      calls.snapshot += 1;
      return { ok: true, ts: 1, sampleMs: 1, intervalMs: 1500 };
    },
    async system() {
      calls.system += 1;
      return { ok: true, hostname: 'stub' };
    },
    async services() {
      calls.services += 1;
      return { ok: true, ts: 1, services: [] };
    },
    async startup() {
      calls.startup += 1;
      return { ok: true, ts: 1, entries: [] };
    },
    history() {
      calls.history += 1;
      return { ok: true, ts: 1, since: 0, apps: [] };
    },
    async kill(body) {
      calls.kill += 1;
      return { pid: body.pid, signal: body.signal ?? 'SIGTERM' };
    },
    dispose() {},
    ...overrides,
  };
  return { metrics, calls };
}

/**
 * Build an API router with a stub collector.
 * @param {object} [options] - Router options.
 * @param {Record<string, unknown>} [options.config] - Row config.
 * @param {() => number} [options.now] - Clock.
 * @param {Record<string, unknown>} [options.overrides] - Collector overrides.
 * @returns {{ api: any, calls: Record<string, number> }} the router and counts.
 */
function makeApi({ config = {}, now, overrides = {} } = {}) {
  const { metrics, calls } = stubMetrics(overrides);
  const api = createApi({
    ctx: { webServer: { getOrigin: () => ORIGIN } },
    logger: () => {},
    version: '0.1.0',
    config,
    now,
    metrics,
  });
  return { api, calls };
}

/**
 * A `systeminformation` double with the calls the collector makes.
 * @param {Record<string, unknown>} [overrides] - Function overrides.
 * @returns {any} the fake namespace.
 */
function fakeSi(overrides = {}) {
  return {
    async mem() {
      return {
        total: 8_000_000_000,
        used: 4_000_000_000,
        free: 700_000_000,
        available: 3_400_000_000,
        active: 3_500_000_000,
        buffcache: 2_200_000_000,
        buffers: 100_000_000,
        cached: 2_100_000_000,
        swaptotal: 0,
        swapused: 0,
        swapfree: 0,
      };
    },
    async fsSize() {
      return [
        { fs: '/dev/sda1', type: 'ext4', size: 1000, used: 400, available: 600, use: 40, mount: '/' },
        { fs: 'tmpfs', type: 'tmpfs', size: 10, used: 1, available: 9, use: 10, mount: '/run' },
      ];
    },
    async users() {
      return [{ user: 'root', tty: 'pts/0', date: '2026-11-14', time: '15:00', ip: '', command: '-bash' }];
    },
    async services() {
      return [];
    },
    async osInfo() {
      return { distro: 'Ubuntu', release: '26.04 LTS', kernel: '7.0.0-34-generic', arch: 'x64' };
    },
    async cpu() {
      return {
        manufacturer: 'Intel', brand: 'N100', cores: 4, physicalCores: 4, speed: 2.4,
        governor: 'powersave', cache: { l1d: 1, l1i: 2, l2: 3, l3: 4 },
      };
    },
    async system() {
      return { manufacturer: 'Lecoo', model: 'MINI' };
    },
    async graphics() {
      return {
        controllers: [{ model: 'UHD', vendor: 'Intel', vram: 256, vramDynamic: false }],
        displays: [{ model: 'X', resolutionX: 1920, resolutionY: 1080, currentResX: 1920, currentResY: 1080, main: true }],
      };
    },
    async networkInterfaces() {
      return [
        { iface: 'lo', ifaceName: 'lo', ip4: '127.0.0.1', mac: '00:00:00:00:00:00', operstate: 'unknown', type: 'virtual', speed: null, virtual: false },
        { iface: 'eth0', ifaceName: 'eth0', ip4: '192.168.1.2', mac: 'aa:bb:cc:dd:ee:ff', operstate: 'up', type: 'wired', speed: 1000, virtual: false },
      ];
    },
    async currentLoad() {
      return { currentLoad: 12.5, currentLoadUser: 10, currentLoadSystem: 2.5, currentLoadIdle: 87.5, currentLoadNice: 0, currentLoadIrq: 0, cpus: [{ load: 10 }, { load: 15 }] };
    },
    async processes() {
      return {
        all: 2,
        list: [
          { pid: 10, parentPid: 1, name: 'alpha', user: 'alice', state: 'running', cpu: 5, memRss: 1000, threads: 2, command: 'alpha --x', started: '2026-11-14 10:00:00', priority: 20, nice: 0 },
          { pid: 11, parentPid: 10, name: 'beta', user: 'root', state: 'sleeping', cpu: 0, memRss: 2000, threads: 1, command: 'beta', started: '2026-11-14 11:00:00', priority: 20, nice: 0 },
        ],
      };
    },
    async networkStats() {
      return [{ iface: 'eth0', operstate: 'up', rx_bytes: 100, tx_bytes: 200, rx_sec: 10, tx_sec: 20 }];
    },
    async disksIO() {
      return { rIO: 1, wIO: 2, tIO: 3, rIO_sec: 1.5, wIO_sec: 2.5, tIO_sec: 4, rWaitPercent: 5, wWaitPercent: 6, tWaitPercent: 11 };
    },
    async cpuTemperature() {
      return { main: 44.4 };
    },
    ...overrides,
  };
}

/**
 * Build a fake `/proc` sampler with three processes.
 * @param {object} [options] - Options.
 * @returns {{ procfs: any, setCpu: (cpu: any) => void, rows: any[], killCalls: any[] }} the sampler.
 */
function fakeProcfs({ rows, cpu, identities, pageSize = 4096 } = {}) {
  let currentCpu = cpu ?? {
    total: 1000, idle: 800, user: 150, nice: 0, system: 40, irq: 10,
    cores: [{ total: 500, idle: 400 }, { total: 500, idle: 400 }],
  };
  const table = rows ?? [
    { pid: 10, name: 'alpha', comm: 'alpha', state: 'R', ppid: 1, ttyNr: 0, utime: 100, stime: 50, priority: 20, nice: 0, threads: 2, starttime: 100, rss: 10, uid: 1000, cmd: '/usr/bin/alpha --flag', rssBytes: 10 * pageSize },
    { pid: 11, name: 'beta', comm: 'beta', state: 'S', ppid: 10, ttyNr: 34816, utime: 0, stime: 0, priority: 20, nice: 5, threads: 1, starttime: 200, rss: 20, uid: 1000, cmd: 'beta', rssBytes: 20 * pageSize },
    { pid: 1, name: 'systemd', comm: 'systemd', state: 'S', ppid: 0, ttyNr: 0, utime: 5, stime: 5, priority: 20, nice: 0, threads: 1, starttime: 10, rss: 30, uid: 0, cmd: '/sbin/init', rssBytes: 30 * pageSize },
  ];
  const identitiesMap = identities ?? new Map([
    [1, { starttime: 10, uid: 0 }],
    [10, { starttime: 100, uid: 1000 }],
    [11, { starttime: 200, uid: 1000 }],
    [99, { starttime: 1, uid: 0 }],
  ]);
  const killCalls = [];
  const procfs = {
    supported: true,
    pageSize,
    readCpuStat: () => currentCpu,
    readUptimeSec: () => 1234,
    readProcessTable: () => table,
    readNetDev: () => [{ iface: 'lo', rx_bytes: 1, tx_bytes: 1 }, { iface: 'eth0', rx_bytes: 1000, tx_bytes: 2000 }],
    readDiskstats: () => ({ reads: 100, writes: 50, readMs: 10, writeMs: 5 }),
    readTemperature: () => 45.5,
    readOperstate: () => 'up',
    readPasswd: () => new Map([[0, 'root'], [1000, 'alice']]),
    readProcessIdentity: (pid) => {
      const identity = identitiesMap.get(pid);
      if (identity === undefined) throw Object.assign(new Error(`gone ${pid}`), { code: 'ENOENT' });
      return identity;
    },
  };
  return {
    procfs,
    rows: table,
    killCalls,
    setCpu(next) {
      currentCpu = next;
    },
  };
}

/**
 * Collect the sorted key list of an object.
 * @param {object} value - Object.
 * @returns {string[]} sorted keys.
 */
function keys(value) {
  return Object.keys(value).sort();
}

/* ------------------------------------------------------------------ */
/* procfs parsers                                                      */
/* ------------------------------------------------------------------ */

test('parseProcStat handles a comm with spaces and parentheses', () => {
  const tail = ['S', '1', '4241', '4241', '0', '-1', '4194560', '100', '0', '0', '0', '12', '34', '0', '0', '20', '5', '7', '0', '555', '1000000', '42', '0', '0'];
  const parsed = parseProcStat(`4242 (a (weird) name) ${tail.join(' ')}`);
  assert.ok(parsed);
  assert.equal(parsed.pid, 4242);
  assert.equal(parsed.comm, 'a (weird) name');
  assert.equal(parsed.state, 'S');
  assert.equal(parsed.ppid, 1);
  assert.equal(parsed.ttyNr, 0);
  assert.equal(parsed.utime, 12);
  assert.equal(parsed.stime, 34);
  assert.equal(parsed.priority, 20);
  assert.equal(parsed.nice, 5);
  assert.equal(parsed.threads, 7);
  assert.equal(parsed.starttime, 555);
  assert.equal(parsed.rss, 42);
});

test('parseProcStat rejects malformed lines', () => {
  assert.equal(parseProcStat(''), null);
  assert.equal(parseProcStat('1234 no parens here'), null);
  assert.equal(parseProcStat('1234 (short) S 1 2'), null);
  assert.equal(parseProcStat(undefined), null);
});

test('parseProcStatusUid reads the real uid', () => {
  assert.equal(parseProcStatusUid('Name:\tnode\nUid:\t1000\t1000\t1000\t1000\n'), 1000);
  assert.equal(parseProcStatusUid('Name:\tnode\n'), null);
  assert.equal(parseProcStatusUid(undefined), null);
});

test('mapProcessState covers every documented state', () => {
  assert.equal(mapProcessState('R'), 'running');
  assert.equal(mapProcessState('S'), 'sleeping');
  assert.equal(mapProcessState('I'), 'sleeping');
  assert.equal(mapProcessState('D'), 'blocked');
  assert.equal(mapProcessState('W'), 'blocked');
  assert.equal(mapProcessState('T'), 'stopped');
  assert.equal(mapProcessState('t'), 'stopped');
  assert.equal(mapProcessState('Z'), 'zombie');
  assert.equal(mapProcessState('X'), 'unknown');
  assert.equal(mapProcessState('?'), 'unknown');
});

test('parseCpuStat sums aggregate and per-core jiffies', () => {
  const text = [
    'cpu  100 10 40 800 20 5 5 0 0 0',
    'cpu0 50 5 20 400 10 2 3 0 0 0',
    'cpu1 50 5 20 400 10 3 2 0 0 0',
    'intr 123',
  ].join('\n');
  const parsed = parseCpuStat(text);
  assert.ok(parsed);
  assert.equal(parsed.total, 980); // 100+10+40+800+20+5+5+0
  assert.equal(parsed.idle, 820); // idle + iowait
  assert.equal(parsed.user, 100);
  assert.equal(parsed.nice, 10);
  assert.equal(parsed.system, 40);
  assert.equal(parsed.irq, 10); // irq + softirq
  assert.equal(parsed.cores.length, 2);
  assert.equal(parsed.cores[0].total, 490);
  assert.equal(parsed.cores[0].idle, 410);
  assert.equal(parseCpuStat(''), null);
  assert.equal(parseCpuStat('intr 1'), null);
});

test('parseNetDev skips the header and reads rx/tx bytes', () => {
  const text = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo: 100 1 0 0 0 0 0 0 200 2 0 0 0 0 0 0',
    '  eth0: 1000 5 0 0 0 0 0 0 2000 6 0 0 0 0 0 0',
  ].join('\n');
  assert.deepEqual(parseNetDev(text), [
    { iface: 'lo', rx_bytes: 100, tx_bytes: 200 },
    { iface: 'eth0', rx_bytes: 1000, tx_bytes: 2000 },
  ]);
  assert.deepEqual(parseNetDev(''), []);
});

test('parseDiskstats sums whole disks only', () => {
  const line = (name, reads, readMs, writes, writeMs) => `   8       0 ${name} ${reads} 0 0 ${readMs} ${writes} 0 0 ${writeMs} 0 0 0 0 0 0`;
  const text = [
    line('sda', 10, 20, 30, 40),
    line('sda1', 999, 999, 999, 999), // partition: must not double count
    line('nvme0n1', 1, 2, 3, 4),
    line('dm-0', 888, 888, 888, 888), // device mapper: must not double count
    line('loop0', 777, 777, 777, 777),
  ].join('\n');
  assert.deepEqual(parseDiskstats(text), { reads: 11, writes: 33, readMs: 22, writeMs: 44 });
  assert.deepEqual(parseDiskstats(''), { reads: 0, writes: 0, readMs: 0, writeMs: 0 });
});

test('parsePasswd maps uid to user name', () => {
  const map = parsePasswd('root:x:0:0:root:/root:/bin/bash\n# comment\nalice:x:1000:1000::/home/alice:/bin/sh\n');
  assert.equal(map.get(0), 'root');
  assert.equal(map.get(1000), 'alice');
  assert.equal(map.size, 2);
});

test('parseAuxvPageSize finds AT_PAGESZ and detectPageSize falls back', () => {
  const buffer = Buffer.alloc(48);
  buffer.writeBigUInt64LE(6n, 0);
  buffer.writeBigUInt64LE(65536n, 8);
  buffer.writeBigUInt64LE(0n, 16);
  assert.equal(parseAuxvPageSize(buffer), 65536);
  assert.equal(parseAuxvPageSize(Buffer.alloc(0)), null);
  assert.equal(detectPageSize(() => { throw new Error('no auxv'); }), 4096);
  assert.equal(detectPageSize(() => buffer), 65536);
});

test('computeProcessCpu uses machine-wide jiffies and rejects recycled pids', () => {
  assert.equal(computeProcessCpu(undefined, { ticks: 10, starttime: 1 }, 100), 0);
  assert.equal(computeProcessCpu({ ticks: 0, starttime: 1 }, { ticks: 50, starttime: 1 }, 400), 12.5);
  // A reused pid (different starttime) must not inherit the old counter.
  assert.equal(computeProcessCpu({ ticks: 0, starttime: 1 }, { ticks: 50, starttime: 2 }, 400), 0);
  // Counter reset or zero window reports 0 instead of a negative/absurd value.
  assert.equal(computeProcessCpu({ ticks: 100, starttime: 1 }, { ticks: 50, starttime: 1 }, 400), 0);
  assert.equal(computeProcessCpu({ ticks: 0, starttime: 1 }, { ticks: 50, starttime: 1 }, 0), 0);
});

test('isPhysicalDisk filters virtual filesystems and container mounts', () => {
  assert.equal(isPhysicalDisk({ fs: '/dev/mapper/vg-lv', type: 'ext4', mount: '/' }), true);
  assert.equal(isPhysicalDisk({ fs: 'C:', type: 'NTFS', mount: 'C:' }), true);
  assert.equal(isPhysicalDisk({ fs: 'tmpfs', type: 'tmpfs', mount: '/run' }), false);
  assert.equal(isPhysicalDisk({ fs: 'overlay', type: 'overlay', mount: '/' }), false);
  assert.equal(isPhysicalDisk({ fs: 'efivarfs', type: 'efivarfs', mount: '/sys/firmware/efi/efivars' }), false);
  assert.equal(isPhysicalDisk({ fs: 'none', type: 'ext4', mount: '/' }), false);
});

/* ------------------------------------------------------------------ */
/* procfs sampler                                                      */
/* ------------------------------------------------------------------ */

test('createProcfs reads the process table with injected files', () => {
  const files = new Map([
    ['/proc/1/stat', '1 (systemd) S 0 1 1 0 -1 4194560 100 0 0 0 5 5 0 0 20 0 1 0 10 1000 30 0 0'],
    ['/proc/1/status', 'Name:\tsystemd\nUid:\t0\t0\t0\t0\n'],
    ['/proc/1/cmdline', '/sbin/init\0--system\0'],
    ['/proc/42/stat', '42 (my proc) R 1 42 42 0 34816 4194560 100 0 0 0 12 34 0 0 20 5 7 0 555 1000 42 0 0'],
    ['/proc/42/status', 'Name:\tmy proc\nUid:\t1000\t1000\t1000\t1000\n'],
    ['/proc/42/cmdline', '/usr/bin/prog\0arg\0'],
    ['/proc/43/stat', '43 (gone) S 1 43 43 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 600 0 0 0 0'],
    ['/proc/stat', 'cpu  1 2 3 4 5 6 7 8 0 0\ncpu0 1 2 3 4 5 6 7 8 0 0\n'],
    ['/proc/uptime', '1234.56 999.0\n'],
    ['/proc/net/dev', '  eth0: 10 1 0 0 0 0 0 0 20 2 0 0 0 0 0 0\n'],
    ['/proc/diskstats', '   8 0 sda 1 0 0 2 3 0 0 4 0 0 0 0 0 0'],
    ['/etc/passwd', 'root:x:0:0::/root:/bin/sh\nalice:x:1000:1000::/home/alice:/bin/sh\n'],
    ['/sys/class/net/eth0/operstate', 'up\n'],
  ]);
  let passwdReads = 0;
  const procfs = createProcfs({
    platform: 'linux',
    pageSize: 4096,
    readdir: (dir) => {
      assert.equal(dir, '/proc');
      return ['1', '42', '43', 'self', 'meminfo'];
    },
    readFile: (file) => {
      if (file === '/etc/passwd') passwdReads += 1;
      if (!files.has(file)) throw Object.assign(new Error(`ENOENT ${file}`), { code: 'ENOENT' });
      return files.get(file);
    },
    readBuffer: () => {
      throw new Error('unused');
    },
  });
  const rows = procfs.readProcessTable();
  assert.equal(rows.length, 2, 'a process whose status vanished is skipped');
  const first = rows.find((row) => row.pid === 1);
  assert.equal(first.name, 'systemd');
  assert.equal(first.uid, 0);
  assert.equal(first.cmd, '/sbin/init --system');
  assert.equal(first.rssBytes, 30 * 4096);
  const second = rows.find((row) => row.pid === 42);
  assert.equal(second.comm, 'my proc');
  assert.equal(second.uid, 1000);
  assert.equal(second.cmd, '/usr/bin/prog arg');
  assert.equal(second.starttime, 555);
  assert.equal(second.rssBytes, 42 * 4096);
  assert.equal(procfs.readUptimeSec(), 1234.56);
  assert.equal(procfs.readCpuStat().cores.length, 1);
  assert.equal(procfs.readNetDev()[0].iface, 'eth0');
  assert.equal(procfs.readDiskstats().reads, 1);
  assert.equal(procfs.readOperstate('eth0'), 'up');
  assert.equal(procfs.readOperstate('missing'), null);
  assert.equal(procfs.readPasswd().get(1000), 'alice');
  assert.equal(procfs.readPasswd().get(1000), 'alice');
  assert.equal(passwdReads, 1, '/etc/passwd is read once and cached');
  assert.deepEqual(procfs.readProcessIdentity(42), { starttime: 555, uid: 1000, comm: 'my proc' });
  assert.throws(() => procfs.readProcessIdentity(404), /ENOENT/);
});

test('createProcfs reports unsupported on non-Linux and never touches /proc', () => {
  const procfs = createProcfs({
    platform: 'win32',
    readFile: () => { throw new Error('should not be called'); },
    readBuffer: () => { throw new Error('should not be called'); },
    readdir: () => { throw new Error('should not be called'); },
  });
  assert.equal(procfs.supported, false);
  assert.equal(procfs.pageSize, 4096);
});

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

test('normalizeConfig returns the documented defaults', () => {
  const defaults = {
    allowKillSystemProcesses: false,
    refreshIntervalMs: 1500,
    maxProcesses: 400,
    sampleCacheMs: 800,
  };
  assert.deepEqual(normalizeConfig(undefined), defaults);
  assert.deepEqual(normalizeConfig(null), defaults);
  assert.deepEqual(normalizeConfig({}), defaults);
  assert.deepEqual(normalizeConfig('nonsense'), defaults);
  assert.deepEqual(normalizeConfig([1, 2, 3]), defaults);
});

test('normalizeConfig clamps every value and never throws', () => {
  assert.equal(normalizeConfig({ refreshIntervalMs: 1 }).refreshIntervalMs, 500);
  assert.equal(normalizeConfig({ refreshIntervalMs: 99_999 }).refreshIntervalMs, 10_000);
  assert.equal(normalizeConfig({ maxProcesses: 1 }).maxProcesses, 50);
  assert.equal(normalizeConfig({ maxProcesses: 9999 }).maxProcesses, 2000);
  assert.equal(normalizeConfig({ sampleCacheMs: 1 }).sampleCacheMs, 200);
  assert.equal(normalizeConfig({ sampleCacheMs: 99_999 }).sampleCacheMs, 5000);
  assert.equal(normalizeConfig({ refreshIntervalMs: 2000 }).refreshIntervalMs, 2000);
  assert.equal(normalizeConfig({ refreshIntervalMs: '2500' }).refreshIntervalMs, 2500);
  assert.equal(normalizeConfig({ refreshIntervalMs: Number.NaN }).refreshIntervalMs, 1500);
  assert.equal(normalizeConfig({ allowKillSystemProcesses: true }).allowKillSystemProcesses, true);
  assert.equal(normalizeConfig({ allowKillSystemProcesses: 'yes' }).allowKillSystemProcesses, false);
  assert.doesNotThrow(() => normalizeConfig({ refreshIntervalMs: 10n }));
  assert.doesNotThrow(() => normalizeConfig({ get refreshIntervalMs() { throw new Error('boom'); } }));
});

/* ------------------------------------------------------------------ */
/* history                                                             */
/* ------------------------------------------------------------------ */

test('createHistory folds CPU seconds, peak memory, lastSeen and samples', () => {
  const history = createHistory({ since: 1000, now: () => 1000 });
  history.fold([
    { name: 'alpha', cpu: 10, memBytes: 100 },
    { name: 'beta', cpu: 0, memBytes: 500 },
  ], 1000);
  // First fold has no elapsed window, so it credits no CPU time.
  assert.equal(history.view(1000).apps.find((app) => app.name === 'alpha').cpuSeconds, 0);

  history.fold([
    { name: 'alpha', cpu: 10, memBytes: 400 },
    { name: 'beta', cpu: 5, memBytes: 100 },
  ], 3000);
  const apps = history.view(3000).apps;
  const alpha = apps.find((app) => app.name === 'alpha');
  assert.equal(alpha.cpuSeconds, 0.2); // 10 % over 2 s
  assert.equal(alpha.peakMemBytes, 400);
  assert.equal(alpha.lastSeen, 3000);
  assert.equal(alpha.samples, 2);
  const beta = apps.find((app) => app.name === 'beta');
  assert.equal(beta.cpuSeconds, 0.1); // 5 % over 2 s
  assert.equal(beta.peakMemBytes, 500);
  assert.equal(history.view(3000).since, 1000);
});

test('createHistory caps tracked names by evicting the least recently seen', () => {
  const history = createHistory({ since: 0, maxEntries: 2, now: () => 0 });
  history.fold([{ name: 'one', cpu: 0, memBytes: 1 }], 1000);
  history.fold([{ name: 'two', cpu: 0, memBytes: 1 }], 2000);
  history.fold([{ name: 'three', cpu: 0, memBytes: 1 }], 3000);
  assert.equal(history.size(), 2);
  const names = history.view(3000).apps.map((app) => app.name).sort();
  assert.deepEqual(names, ['three', 'two']);
});

test('createHistory clamps the credited interval', () => {
  const history = createHistory({ since: 0, now: () => 0 });
  history.fold([{ name: 'alpha', cpu: 100, memBytes: 0 }], 0);
  history.fold([{ name: 'alpha', cpu: 100, memBytes: 0 }], 10 * 60 * 1000);
  assert.equal(history.view(0).apps[0].cpuSeconds, MAX_FOLD_SECONDS);
});

/* ------------------------------------------------------------------ */
/* metrics: snapshot                                                   */
/* ------------------------------------------------------------------ */

test('metrics.snapshot returns the documented envelope and process semantics', async () => {
  const { procfs } = fakeProcfs();
  const metrics = createMetrics({
    config: {},
    now: () => 1000,
    bootTime: 1_000_000,
    si: fakeSi(),
    procfs,
    sleep: async () => {},
    dshVersion: '9.9.9',
  });
  const snapshot = await metrics.snapshot();

  assert.deepEqual(keys(snapshot), [
    'cpu', 'diskIO', 'disks', 'intervalMs', 'mem', 'network', 'ok', 'processSummary',
    'processes', 'sampleMs', 'ts', 'users',
  ].sort());
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.ts, 1000);
  assert.equal(snapshot.intervalMs, 1500);
  assert.ok(snapshot.sampleMs >= 0);
  assert.deepEqual(keys(snapshot.cpu), [
    'cores', 'idle', 'irq', 'load', 'nice', 'processCount', 'system', 'temperature', 'threadCount', 'uptimeSec', 'user',
  ].sort());
  assert.deepEqual(keys(snapshot.mem), [
    'active', 'available', 'buffcache', 'buffers', 'cached', 'free', 'swapFree', 'swapTotal',
    'swapUsed', 'total', 'used', 'usedPercent',
  ].sort());
  assert.deepEqual(keys(snapshot.diskIO), [
    'rIO', 'rIO_sec', 'rWaitPercent', 'tIO', 'tIO_sec', 'tWaitPercent', 'wIO', 'wIO_sec', 'wWaitPercent',
  ].sort());
  assert.deepEqual(keys(snapshot.network), ['ifaces', 'total']);
  assert.deepEqual(keys(snapshot.processSummary), ['all', 'blocked', 'running', 'sleeping', 'stopped', 'threads', 'zombie']);
  assert.deepEqual(keys(snapshot.users[0]), ['command', 'date', 'ip', 'time', 'tty', 'user']);
  assert.deepEqual(keys(snapshot.processes[0]), [
    'cmd', 'cpu', 'group', 'isDsh', 'isGui', 'isKernel', 'memBytes', 'memPercent', 'name', 'nice',
    'pid', 'ppid', 'priority', 'started', 'state', 'threads', 'uid', 'user',
  ].sort());

  // One physical disk only (tmpfs filtered), full snapshot disk shape.
  assert.equal(snapshot.disks.length, 1);
  assert.deepEqual(keys(snapshot.disks[0]), ['available', 'fs', 'mount', 'size', 'type', 'usePercent', 'used']);
  assert.equal(snapshot.disks[0].usePercent, 40);

  // The first sample reports no per-process CPU (documented), but machine CPU is real.
  assert.equal(snapshot.cpu.load, 0);
  assert.equal(snapshot.cpu.uptimeSec, 1234);
  assert.equal(snapshot.cpu.temperature, 45.5);
  assert.equal(snapshot.processSummary.all, 3);
  assert.equal(snapshot.processSummary.running, 1);
  assert.equal(snapshot.processSummary.sleeping, 2);
  assert.equal(snapshot.processSummary.threads, 4);

  const byPid = new Map(snapshot.processes.map((proc) => [proc.pid, proc]));
  const alpha = byPid.get(10);
  assert.equal(alpha.user, 'alice');
  assert.equal(alpha.uid, 1000);
  assert.equal(alpha.state, 'running');
  assert.equal(alpha.group, 'background'); // no tty, not a GUI name
  assert.equal(alpha.memBytes, 10 * 4096);
  assert.equal(alpha.memPercent, 0); // 40 KB of 8 GB rounds to 0.00
  assert.equal(alpha.started, 1_001_000); // boot + starttime * 10 ms
  assert.equal(alpha.cmd, '/usr/bin/alpha --flag');
  assert.equal(alpha.isKernel, false);
  assert.equal(alpha.isDsh, false);
  const beta = byPid.get(11);
  assert.equal(beta.group, 'app'); // owns a tty
  assert.equal(byPid.get(1).group, 'system'); // uid 0
  assert.equal(byPid.get(1).user, 'root');

  assert.equal(snapshot.network.ifaces.length, 1, 'loopback is excluded');
  assert.equal(snapshot.network.ifaces[0].iface, 'eth0');
  assert.equal(snapshot.network.ifaces[0].operstate, 'up');
  assert.equal(snapshot.network.total.rx_bytes, 1000);
});

test('metrics.snapshot computes machine and per-process CPU from deltas', async () => {
  let clock = 1000;
  const { procfs, rows, setCpu } = fakeProcfs();
  const metrics = createMetrics({
    now: () => clock,
    bootTime: 0,
    si: fakeSi(),
    procfs,
    sleep: async () => {},
  });
  await metrics.snapshot();

  // 400 jiffies elapsed on the machine, 300 of them idle: 25 % load.
  setCpu({
    total: 1400, idle: 1100, user: 210, nice: 0, system: 70, irq: 20,
    cores: [{ total: 700, idle: 550 }, { total: 700, idle: 550 }],
  });
  // alpha burns 30 more ticks out of 400 machine-wide: 7.5 % of the machine.
  rows[0].utime += 20;
  rows[0].stime += 10;
  clock = 2500;
  const second = await metrics.snapshot();

  assert.equal(second.cpu.load, 25);
  assert.equal(second.cpu.user, 15); // +60 user jiffies
  assert.equal(second.cpu.system, 7.5); // +30 system jiffies
  assert.equal(second.cpu.irq, 2.5); // +10 irq jiffies
  assert.deepEqual(second.cpu.cores, [25, 25]);
  const alpha = second.processes.find((proc) => proc.pid === 10);
  assert.equal(alpha.cpu, 7.5);
  const beta = second.processes.find((proc) => proc.pid === 11);
  assert.equal(beta.cpu, 0);

  // The history fold saw the same data.
  const history = metrics.history();
  const alphaHistory = history.apps.find((app) => app.name === 'alpha');
  assert.ok(alphaHistory.cpuSeconds > 0);
  assert.equal(alphaHistory.samples, 2);
});

test('metrics.snapshot sorts by CPU then memory and caps maxProcesses', async () => {
  const rows = [];
  for (let index = 0; index < 60; index += 1) {
    rows.push({
      pid: 1000 + index,
      name: `proc-${index}`,
      comm: `proc-${index}`,
      state: 'S',
      ppid: 1,
      ttyNr: 0,
      utime: 0,
      stime: 0,
      priority: 20,
      nice: 0,
      threads: 1,
      starttime: 100,
      rss: index,
      uid: 1000,
      cmd: `proc-${index}`,
      rssBytes: index * 1024,
    });
  }
  const { procfs } = fakeProcfs({ rows });
  const metrics = createMetrics({
    config: { maxProcesses: 50 },
    now: () => 1000,
    bootTime: 0,
    si: fakeSi(),
    procfs,
    sleep: async () => {},
  });
  const snapshot = await metrics.snapshot();
  assert.equal(snapshot.processes.length, 50);
  assert.equal(snapshot.processSummary.all, 60, 'the summary still counts every process');
  // Equal CPU (0) falls back to memory descending.
  assert.equal(snapshot.processes[0].pid, 1059);
  assert.equal(snapshot.processes[49].pid, 1010);
});

test('metrics.snapshot marks kernel threads, GUI apps and the DSH host', async () => {
  const rows = [
    { pid: 2, name: 'kworker/0:0', comm: 'kworker/0:0', state: 'I', ppid: 0, ttyNr: 0, utime: 0, stime: 0, priority: 20, nice: 0, threads: 1, starttime: 1, rss: 0, uid: 0, cmd: '', rssBytes: 0 },
    { pid: 300, name: 'gnome-shell', comm: 'gnome-shell', state: 'S', ppid: 1, ttyNr: 0, utime: 0, stime: 0, priority: 20, nice: 0, threads: 5, starttime: 2, rss: 5, uid: 1000, cmd: 'gnome-shell', rssBytes: 5000 },
    { pid: 400, name: 'dsh', comm: 'dsh', state: 'S', ppid: 1, ttyNr: 0, utime: 0, stime: 0, priority: 20, nice: 0, threads: 3, starttime: 3, rss: 9, uid: 1000, cmd: 'node /usr/local/bin/dsh', rssBytes: 9000 },
  ];
  const { procfs } = fakeProcfs({ rows });
  const metrics = createMetrics({
    hostPid: 400,
    now: () => 1000,
    bootTime: 0,
    si: fakeSi(),
    procfs,
    sleep: async () => {},
  });
  const snapshot = await metrics.snapshot();
  const byPid = new Map(snapshot.processes.map((proc) => [proc.pid, proc]));
  assert.equal(byPid.get(2).isKernel, true);
  assert.equal(byPid.get(2).group, 'system');
  assert.equal(byPid.get(2).state, 'sleeping');
  assert.equal(byPid.get(2).cmd, 'kworker/0:0'); // falls back to the name
  assert.equal(byPid.get(300).isGui, true);
  assert.equal(byPid.get(300).group, 'app');
  assert.equal(byPid.get(400).isDsh, true);
  assert.equal(byPid.get(400).group, 'app');
  assert.ok(GUI_ALLOWLIST.has('gnome-shell'));
});

test('metrics.snapshot survives failing optional sources', async () => {
  const messages = [];
  const { procfs } = fakeProcfs();
  const metrics = createMetrics({
    logger: (level, message) => messages.push(`${level}: ${message}`),
    now: () => 1000,
    bootTime: 0,
    si: fakeSi({
      mem: async () => { throw new Error('meminfo unavailable'); },
      fsSize: async () => { throw new Error('df unavailable'); },
      users: async () => { throw new Error('who unavailable'); },
    }),
    procfs,
    sleep: async () => {},
  });
  const snapshot = await metrics.snapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.mem.total, 0);
  assert.deepEqual(snapshot.disks, []);
  assert.deepEqual(snapshot.users, []);
  assert.ok(messages.some((message) => message.includes('meminfo unavailable')));
});

test('metrics.snapshot falls back to systeminformation on non-Linux', async () => {
  const metrics = createMetrics({
    now: () => 1000,
    bootTime: 0,
    platform: 'win32',
    procfs: { supported: false },
    si: fakeSi(),
    sleep: async () => {},
    dshVersion: null,
  });
  const snapshot = await metrics.snapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.cpu.load, 12.5);
  assert.equal(snapshot.cpu.temperature, 44.4);
  assert.equal(snapshot.cpu.processCount, 2);
  assert.equal(snapshot.processes.length, 2);
  const alpha = snapshot.processes.find((proc) => proc.pid === 10);
  assert.equal(alpha.user, 'alice');
  assert.equal(alpha.state, 'running');
  assert.equal(alpha.group, 'background');
  const beta = snapshot.processes.find((proc) => proc.pid === 11);
  assert.equal(beta.group, 'system'); // root
  assert.equal(snapshot.network.ifaces[0].iface, 'eth0');
  assert.equal(snapshot.diskIO.tIO, 3);
  assert.deepEqual(snapshot.disks.map((disk) => disk.mount), ['/']);
});

/* ------------------------------------------------------------------ */
/* metrics: system / services / startup                                */
/* ------------------------------------------------------------------ */

test('metrics.system returns the documented shape with nulls for unknowns', async () => {
  const metrics = createMetrics({
    now: () => 1000,
    si: fakeSi(),
    procfs: fakeProcfs().procfs,
    sleep: async () => {},
    dshVersion: '0.2.1-rc.5',
  });
  const system = await metrics.system();
  assert.deepEqual(keys(system), [
    'arch', 'cpu', 'disks', 'distro', 'dsh', 'graphics', 'hostname', 'kernel', 'manufacturer',
    'memTotal', 'model', 'netIfaces', 'ok', 'platform', 'release', 'swapTotal',
  ].sort());
  assert.equal(system.distro, 'Ubuntu 26.04 LTS');
  assert.equal(system.release, '7.0.0-34-generic');
  assert.equal(system.kernel.startsWith('Linux '), true);
  assert.equal(system.manufacturer, 'Lecoo');
  assert.deepEqual(keys(system.cpu), ['brand', 'cache', 'cores', 'governor', 'manufacturer', 'physicalCores', 'speedGHz']);
  assert.deepEqual(keys(system.cpu.cache), ['l1d', 'l1i', 'l2', 'l3']);
  assert.deepEqual(keys(system.disks[0]), ['fs', 'mount', 'size', 'type']);
  assert.deepEqual(keys(system.netIfaces[0]), ['iface', 'ifaceName', 'ip4', 'mac', 'operstate', 'speed', 'type', 'virtual']);
  assert.deepEqual(keys(system.graphics), ['controllers', 'displays']);
  assert.deepEqual(keys(system.graphics.controllers[0]), ['model', 'vendor', 'vram', 'vramDynamic']);
  assert.deepEqual(keys(system.graphics.displays[0]), ['currentResX', 'currentResY', 'main', 'model', 'resolutionX', 'resolutionY']);
  assert.deepEqual(system.dsh, { version: '0.2.1-rc.5', pid: process.pid, node: process.version });

  const bare = createMetrics({
    now: () => 1000,
    si: fakeSi({
      osInfo: async () => { throw new Error('no os-release'); },
      cpu: async () => { throw new Error('no cpuinfo'); },
      system: async () => { throw new Error('no dmi'); },
      graphics: async () => null,
      networkInterfaces: async () => [],
    }),
    procfs: fakeProcfs().procfs,
    sleep: async () => {},
    dshVersion: null,
  });
  const bareSystem = await bare.system();
  assert.equal(bareSystem.distro, null);
  assert.equal(bareSystem.release, null);
  assert.equal(bareSystem.cpu.manufacturer, null);
  assert.equal(bareSystem.cpu.cache.l1d, null);
  assert.equal(bareSystem.manufacturer, null);
  assert.deepEqual(bareSystem.netIfaces, []);
  assert.deepEqual(bareSystem.graphics, { controllers: [], displays: [] });
  assert.equal(bareSystem.dsh.version, null);
});

test('metrics.services maps systeminformation rows to the contract', async () => {
  const metrics = createMetrics({
    now: () => 1000,
    si: fakeSi({
      services: async () => [
        { name: 'ssh', displayName: 'OpenBSD Secure Shell server', running: true, startmode: 'enabled', pids: [123, 0, 'x'], cpu: 0.12, mem: 1.24 },
        { name: 'cron', running: false, startmode: '', pids: [], cpu: 0, mem: 0 },
        { name: '', running: true },
      ],
    }),
    procfs: fakeProcfs().procfs,
    sleep: async () => {},
  });
  const services = await metrics.services();
  assert.equal(services.ok, true);
  assert.equal(services.ts, 1000);
  assert.equal(services.services.length, 2);
  const ssh = services.services.find((service) => service.name === 'ssh');
  assert.deepEqual(ssh, {
    name: 'ssh',
    displayName: 'OpenBSD Secure Shell server',
    running: true,
    startmode: 'enabled',
    pids: [123],
    cpu: 0.1,
    mem: 1.2,
  });
  const cron = services.services.find((service) => service.name === 'cron');
  assert.equal(cron.displayName, null);
  assert.equal(cron.startmode, null);
  assert.deepEqual(keys(cron), ['cpu', 'displayName', 'mem', 'name', 'pids', 'running', 'startmode']);
});

test('collectStartupEntries reads systemd wants and XDG autostart', () => {
  const directories = new Map([
    ['/etc/systemd/system', ['multi-user.target.wants', 'ssh.service']],
    ['/etc/systemd/system/multi-user.target.wants', ['ssh.service', 'cron.service']],
    ['/usr/lib/systemd/system', []],
    ['/etc/xdg/autostart', ['app.desktop', 'hidden.desktop', 'not-an-app.desktop']],
    ['/home/alice/.config/autostart', []],
  ]);
  const files = new Map([
    ['/etc/xdg/autostart/app.desktop', '[Desktop Entry]\nType=Application\nName=My App\nExec=/usr/bin/app\n'],
    ['/etc/xdg/autostart/hidden.desktop', '[Desktop Entry]\nType=Application\nName=Hidden App\nHidden=true\n'],
    ['/etc/xdg/autostart/not-an-app.desktop', '[Desktop Entry]\nType=Link\nName=Not An App\n'],
  ]);
  const links = new Map([
    ['/etc/systemd/system/multi-user.target.wants/ssh.service', '/lib/systemd/system/ssh.service'],
  ]);
  const entries = collectStartupEntries({
    platform: 'linux',
    homedir: () => '/home/alice',
    readdir: (dir) => {
      if (!directories.has(dir)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return directories.get(dir);
    },
    readFile: (file) => {
      if (!files.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(file);
    },
    readlink: (file) => {
      if (!links.has(file)) throw new Error('EINVAL');
      return links.get(file);
    },
  });
  assert.deepEqual(keys(entries[0]), ['enabled', 'impact', 'name', 'path', 'source', 'type']);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  assert.equal(entries.length, 4); // ssh, cron, My App, and the disabled Hidden App (Link dropped)
  assert.equal(byName.get('ssh').path, '/lib/systemd/system/ssh.service');
  assert.equal(byName.get('ssh').source, 'systemd');
  assert.equal(byName.get('ssh').enabled, true);
  assert.equal(byName.get('cron').path, '/etc/systemd/system/cron.service'); // readlink failed: fall back to the unit root
  assert.equal(byName.get('My App').source, 'xdg');
  assert.equal(byName.get('My App').type, 'app');
  assert.equal(byName.get('Hidden App').enabled, false);
  assert.equal(byName.has('Not An App'), false);
  assert.deepEqual(entries.map((entry) => entry.name), ['cron', 'Hidden App', 'My App', 'ssh']);
});

test('collectStartupEntries returns [] on non-Linux and on a bare filesystem', () => {
  assert.deepEqual(collectStartupEntries({ platform: 'win32' }), []);
  assert.deepEqual(collectStartupEntries({
    platform: 'linux',
    readdir: () => { throw new Error('ENOENT'); },
    readFile: () => { throw new Error('ENOENT'); },
    readlink: () => { throw new Error('ENOENT'); },
    homedir: () => '/nonexistent',
  }), []);
});

test('metrics.startup returns the documented envelope', async () => {
  const metrics = createMetrics({
    platform: 'win32',
    now: () => 777,
    procfs: { supported: false },
    si: fakeSi(),
    sleep: async () => {},
  });
  const startup = await metrics.startup();
  assert.deepEqual(keys(startup), ['entries', 'ok', 'ts']);
  assert.equal(startup.ts, 777);
  assert.deepEqual(startup.entries, []);
});

test('parseDesktopEntry reads only the Desktop Entry section', () => {
  const fields = parseDesktopEntry([
    '# comment',
    '[Desktop Entry]',
    'Name=My App',
    'Exec=/usr/bin/app --flag=a=b',
    '',
    '[Desktop Action New]',
    'Name=New Window',
  ].join('\n'));
  assert.equal(fields.Name, 'My App');
  assert.equal(fields.Exec, '/usr/bin/app --flag=a=b');
  assert.equal(fields['Desktop Action New'], undefined);
});

/* ------------------------------------------------------------------ */
/* metrics: kill guards                                                */
/* ------------------------------------------------------------------ */

/**
 * Build a collector wired for kill-guard tests.
 * @param {object} [options] - Options.
 * @returns {{ metrics: any, calls: any[] }} collector and recorded signals.
 */
function killRig({ config = {}, hostPid = 500, hostPpid = 400, kill, identities } = {}) {
  const calls = [];
  const { procfs } = fakeProcfs({ identities });
  const metrics = createMetrics({
    config,
    hostPid,
    hostPpid,
    bootTime: 1_000_000,
    now: () => 1000,
    si: fakeSi(),
    procfs,
    sleep: async () => {},
    kill: kill ?? ((pid, signal) => { calls.push({ pid, signal }); }),
  });
  return { metrics, calls };
}

/**
 * Assert a promise rejects with a specific stable code and status.
 * @param {Promise<unknown>} promise - The promise.
 * @param {number} status - Expected HTTP status.
 * @param {string} code - Expected stable code.
 * @returns {Promise<void>} resolves when the assertion holds.
 */
async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof HttpError, `expected HttpError, got ${error}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test('kill rejects a bad pid with bad-pid', async () => {
  const { metrics } = killRig();
  await rejectsWith(metrics.kill({}), 400, 'bad-pid');
  await rejectsWith(metrics.kill({ pid: 0 }), 400, 'bad-pid');
  await rejectsWith(metrics.kill({ pid: -5 }), 400, 'bad-pid');
  await rejectsWith(metrics.kill({ pid: 'abc' }), 400, 'bad-pid');
  await rejectsWith(metrics.kill({ pid: 1.5 }), 400, 'bad-pid');
  await rejectsWith(metrics.kill(null), 400, 'bad-request');
  await rejectsWith(metrics.kill([]), 400, 'bad-request');
});

test('kill rejects a missing process with no-such-process', async () => {
  const { metrics } = killRig();
  await rejectsWith(metrics.kill({ pid: 4242, startTime: 1 }), 404, 'no-such-process');
});

test('kill protects pid 1, the Host and its parent', async () => {
  const { metrics } = killRig({ hostPid: 10, hostPpid: 11 });
  await rejectsWith(metrics.kill({ pid: 1, startTime: 1_000_100 }), 403, 'protected-process');
  await rejectsWith(metrics.kill({ pid: 10, startTime: 1_001_000 }), 403, 'protected-process');
  await rejectsWith(metrics.kill({ pid: 11, startTime: 1_002_000 }), 403, 'protected-process');
});

test('kill rejects a recycled pid with stale-process', async () => {
  const { metrics } = killRig({ hostPid: 500, hostPpid: 400 });
  await rejectsWith(metrics.kill({ pid: 10, startTime: 1_005_000 }), 409, 'stale-process');
  await rejectsWith(metrics.kill({ pid: 10 }), 409, 'stale-process');
  await rejectsWith(metrics.kill({ pid: 10, startTime: 'soon' }), 409, 'stale-process');
});

test('kill refuses uid-0 processes unless config allows it', async () => {
  const denied = killRig();
  await rejectsWith(denied.metrics.kill({ pid: 99, startTime: 1_000_010 }), 403, 'system-process');

  const allowed = killRig({ config: { allowKillSystemProcesses: true } });
  const result = await allowed.metrics.kill({ pid: 99, startTime: 1_000_010 });
  assert.deepEqual(result, { pid: 99, signal: 'SIGTERM' });
  assert.deepEqual(allowed.calls, [{ pid: 99, signal: 'SIGTERM' }]);
});

test('kill defaults to SIGTERM and requires force for SIGKILL', async () => {
  const { metrics, calls } = killRig();
  assert.deepEqual(await metrics.kill({ pid: 10, startTime: 1_001_000 }), { pid: 10, signal: 'SIGTERM' });
  await rejectsWith(metrics.kill({ pid: 10, startTime: 1_001_000, signal: 'SIGKILL' }), 400, 'bad-request');
  assert.deepEqual(await metrics.kill({ pid: 10, startTime: 1_001_000, signal: 'SIGKILL', force: true }), { pid: 10, signal: 'SIGKILL' });
  await rejectsWith(metrics.kill({ pid: 10, startTime: 1_001_000, signal: 'SIGUSR1' }), 400, 'bad-request');
  assert.deepEqual(calls, [{ pid: 10, signal: 'SIGTERM' }, { pid: 10, signal: 'SIGKILL' }]);
});

test('kill maps a failed signal to kill-failed', async () => {
  const { metrics } = killRig({ kill: () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); } });
  await rejectsWith(metrics.kill({ pid: 10, startTime: 1_001_000 }), 500, 'kill-failed');
});

/* ------------------------------------------------------------------ */
/* API router                                                          */
/* ------------------------------------------------------------------ */

test('GET /api/health returns exactly the documented shape', async () => {
  const { api } = makeApi();
  const { status, body, res } = await call(api, { url: `${API}/health` });
  assert.equal(status, 200);
  assert.deepEqual(keys(body), ['name', 'ok', 'pid', 'startedAt', 'version'].sort());
  assert.equal(body.ok, true);
  assert.equal(body.name, 'task-manager');
  assert.equal(body.version, '0.1.0');
  assert.equal(body.pid, process.pid);
  assert.equal(typeof body.startedAt, 'number');
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('GET routes answer the documented envelopes', async () => {
  const { api, calls } = makeApi();
  assert.deepEqual((await call(api, { url: `${API}/system` })).body, { ok: true, hostname: 'stub' });
  assert.equal((await call(api, { url: `${API}/snapshot` })).body.ok, true);
  assert.deepEqual((await call(api, { url: `${API}/services` })).body.services, []);
  assert.deepEqual((await call(api, { url: `${API}/startup` })).body.entries, []);
  assert.deepEqual((await call(api, { url: `${API}/history` })).body.apps, []);
  assert.equal(calls.snapshot, 1);
  assert.equal(calls.system, 1);
  assert.equal(calls.services, 1);
  assert.equal(calls.startup, 1);
  assert.equal(calls.history, 1);
});

test('snapshot cache honours sampleCacheMs and de-duplicates in-flight work', async () => {
  let clock = 1000;
  let snapshots = 0;
  let releaseSnapshot;
  const gate = new Promise((resolve) => { releaseSnapshot = resolve; });
  const api = createApi({
    ctx: { webServer: { getOrigin: () => ORIGIN } },
    version: '0.1.0',
    config: { sampleCacheMs: 500 },
    now: () => clock,
    metrics: stubMetrics({
      async snapshot() {
        snapshots += 1;
        await gate;
        return { ok: true, ts: clock, sampleMs: 1 };
      },
    }).metrics,
  });
  const first = api.handler(fakeReq({ url: `${API}/snapshot` }), fakeRes());
  const second = api.handler(fakeReq({ url: `${API}/snapshot` }), fakeRes());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots, 1, 'two concurrent polls share one sample');
  releaseSnapshot();
  await Promise.all([first, second]);

  await api.handler(fakeReq({ url: `${API}/snapshot` }), fakeRes());
  assert.equal(snapshots, 1, 'a cached sample is reused inside the window');

  clock += 499;
  await api.handler(fakeReq({ url: `${API}/snapshot` }), fakeRes());
  assert.equal(snapshots, 1);

  clock += 2;
  await api.handler(fakeReq({ url: `${API}/snapshot` }), fakeRes());
  assert.equal(snapshots, 2, 'the cache expires after sampleCacheMs');
});

test('system, services and startup cache for their documented windows', async () => {
  let clock = 0;
  const { api, calls } = makeApi({ now: () => clock });
  const get = async (path) => call(api, { url: `${API}/${path}` });

  await get('system');
  await get('system');
  assert.equal(calls.system, 1);
  clock = SYSTEM_CACHE_MS - 1;
  await get('system');
  assert.equal(calls.system, 1);
  clock = SYSTEM_CACHE_MS + 1;
  await get('system');
  assert.equal(calls.system, 2);

  clock = 0;
  await get('services');
  await get('services');
  assert.equal(calls.services, 1);
  clock = SERVICES_CACHE_MS + 1;
  await get('services');
  assert.equal(calls.services, 2);

  clock = 0;
  await get('startup');
  await get('startup');
  assert.equal(calls.startup, 1);
  clock = STARTUP_CACHE_MS + 1;
  await get('startup');
  assert.equal(calls.startup, 2);
});

test('history is never cached', async () => {
  const { api, calls } = makeApi();
  await call(api, { url: `${API}/history` });
  await call(api, { url: `${API}/history` });
  assert.equal(calls.history, 2);
});

test('POST /api/process/kill enforces the same-origin JSON guard', async () => {
  const { api, calls } = makeApi();
  const json = { pid: 42, startTime: 1 };

  const crossOrigin = await call(api, {
    method: 'POST',
    url: `${API}/process/kill`,
    json,
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.code, 'cross-origin');

  const wrongType = await call(api, {
    method: 'POST',
    url: `${API}/process/kill`,
    headers: { origin: ORIGIN },
    body: '{"pid":42}',
  });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.body.code, 'unsupported-media-type');

  const sameOrigin = await call(api, {
    method: 'POST',
    url: `${API}/process/kill`,
    json,
    headers: { origin: ORIGIN },
  });
  assert.equal(sameOrigin.status, 200);
  assert.deepEqual(sameOrigin.body, { ok: true, pid: 42, signal: 'SIGTERM' });
  assert.equal(calls.kill, 1);

  const noOrigin = await call(api, { method: 'POST', url: `${API}/process/kill`, json });
  assert.equal(noOrigin.status, 200, 'a same-origin fetch may omit the origin header');
});

test('POST /api/process/kill forwards collector refusals as error envelopes', async () => {
  const { api } = makeApi({
    overrides: {
      async kill() {
        throw new HttpError(409, 'stale-process', 'the process start time does not match');
      },
    },
  });
  const { status, body, res } = await call(api, { method: 'POST', url: `${API}/process/kill`, json: { pid: 7, startTime: 1 } });
  assert.equal(status, 409);
  assert.deepEqual(body, { ok: false, code: 'stale-process', error: 'the process start time does not match' });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('router rejects wrong methods, unknown routes and internal errors', async () => {
  const { api } = makeApi();
  const wrongMethod = await call(api, { method: 'POST', url: `${API}/snapshot`, json: {} });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.code, 'method-not-allowed');

  const killAsGet = await call(api, { url: `${API}/process/kill` });
  assert.equal(killAsGet.status, 405);

  const unknown = await call(api, { url: `${API}/nope` });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'not-found');

  const outside = await call(api, { url: '/dsh-task-manager/other' });
  assert.equal(outside.status, 404);

  const trailingSlash = await call(api, { url: `${API}/health/` });
  assert.equal(trailingSlash.status, 200, 'trailing slashes are tolerated');

  const broken = makeApi({ overrides: { async snapshot() { throw new Error('collector exploded'); } } });
  const internal = await call(broken.api, { url: `${API}/snapshot` });
  assert.equal(internal.status, 500);
  assert.deepEqual(internal.body, { ok: false, code: 'internal', error: 'collector exploded' });
});

test('router dispose is idempotent and drops caches', async () => {
  const { api, calls } = makeApi();
  await call(api, { url: `${API}/system` });
  assert.equal(calls.system, 1);
  api.dispose();
  api.dispose();
});

/* ------------------------------------------------------------------ */
/* version resolution                                                  */
/* ------------------------------------------------------------------ */

test('resolveDshVersion walks up from the running entry point', () => {
  const files = new Map([
    ['/opt/dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' })],
  ]);
  assert.equal(resolveDshVersion({
    argv: ['node', '/opt/dsh/lib/bin.js'],
    readFile: (file) => {
      if (!files.has(file)) throw new Error('ENOENT');
      return files.get(file);
    },
  }), '0.2.1-rc.5');
  assert.equal(resolveDshVersion({
    argv: ['node', '/opt/unknown/bin.js'],
    readFile: () => { throw new Error('ENOENT'); },
  }), null);
});
