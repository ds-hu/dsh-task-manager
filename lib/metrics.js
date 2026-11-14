/**
 * The Task Manager metrics collector.
 *
 * One object owns every reading the Host API serves: the live `/snapshot`, the
 * slow `/system` facts, `/services`, `/startup`, the accumulated `/history` and
 * the guarded kill operation. It is deliberately **on-demand**: nothing here
 * starts a timer or keeps a socket open, so an idle panel costs nothing beyond
 * the last cached sample.
 *
 * Platform strategy
 * -----------------
 * `systeminformation` (MIT, the mature upstream library we standardise on) is
 * the portable source for CPU, memory, filesystems, network adapters, graphics,
 * services and users. On Linux its process listing and its load/rate samplers
 * are too slow for a 1.5 s poll (they spawn `ps` and wait 500 ms for deltas), so
 * the Linux path uses `./procfs.js` for the hot data and keeps
 * `systeminformation` for everything static or slow-changing. Non-Linux falls
 * back to `systeminformation` throughout.
 *
 * All OS access is injectable (`si`, `procfs`, `kill`, `now`, `sleep`,
 * `bootTime`, `dshVersion`) so the whole collector is unit-testable on any
 * machine. The collector never writes to disk and never calls the network.
 *
 * @module @ds-hu/dsh-task-manager/lib/metrics
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import systeminformation from 'systeminformation';

import { HttpError } from './http.js';
import { createHistory } from './history.js';
import { computeProcessCpu, createProcfs, isPhysicalDisk, LINUX_CLK_TCK, mapProcessState } from './procfs.js';

/** Row-config defaults; docs/API.md is authoritative for these numbers. */
export const DEFAULT_CONFIG = Object.freeze({
  allowKillSystemProcesses: false,
  refreshIntervalMs: 1500,
  maxProcesses: 400,
  sampleCacheMs: 800,
});

/**
 * Process names that read as interactive applications even when they do not own
 * a tty (desktop sessions, browsers, editors, Electron shells). This only feeds
 * the `group` / `isGui` hints; the process list itself is always complete.
 * @type {ReadonlySet<string>}
 */
export const GUI_ALLOWLIST = new Set([
  'Xorg', 'Xwayland', 'gnome-shell', 'gnome-session-binary', 'plasmashell', 'kwin_x11',
  'kwin_wayland', 'mutter', 'xfwm4', 'cinnamon', 'code', 'code-insiders', 'chrome',
  'chromium', 'google-chrome', 'firefox', 'firefox-esr', 'msedge', 'electron',
  'spotify', 'slack', 'discord', 'telegram-desktop', 'thunderbird', 'nautilus',
  'dolphin', 'thunar', 'gnome-terminal', 'konsole', 'xterm', 'wezterm', 'kitty',
  'alacritty',
]);

/** How long the slow filesystem usage list is reused inside a snapshot. */
const FS_CACHE_MS = 10_000;
/** How long the logged-in user list is reused inside a snapshot. */
const USERS_CACHE_MS = 10_000;
/** First-sample jiffy window, so the very first CPU reading is instantaneous. */
const WARMUP_MS = 100;
/** How far a kill request's `startTime` may drift from the current process start. */
const START_TOLERANCE_MS = 1000;

/**
 * Clamp one integer config value.
 * @param {unknown} value - Raw value.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @param {number} fallback - Value used when the input is not numeric.
 * @returns {number} the clamped value.
 */
function clampInt(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Normalise the row config. Never throws: an invalid row config degrades to the
 * documented defaults instead of failing activation.
 * @param {unknown} raw - Raw row config.
 * @returns {{ allowKillSystemProcesses: boolean, refreshIntervalMs: number,
 *   maxProcesses: number, sampleCacheMs: number }} the clamped config.
 */
export function normalizeConfig(raw) {
  const out = { ...DEFAULT_CONFIG };
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
    if (typeof raw.allowKillSystemProcesses === 'boolean') out.allowKillSystemProcesses = raw.allowKillSystemProcesses;
    out.refreshIntervalMs = clampInt(raw.refreshIntervalMs, 500, 10_000, DEFAULT_CONFIG.refreshIntervalMs);
    out.maxProcesses = clampInt(raw.maxProcesses, 50, 2000, DEFAULT_CONFIG.maxProcesses);
    out.sampleCacheMs = clampInt(raw.sampleCacheMs, 200, 5000, DEFAULT_CONFIG.sampleCacheMs);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  return out;
}

/**
 * Round to one decimal place.
 * @param {number} value - Raw number.
 * @returns {number} rounded number.
 */
function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Round to two decimal places.
 * @param {number} value - Raw number.
 * @returns {number} rounded number.
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Coerce to a finite number with a fallback.
 * @param {unknown} value - Raw value.
 * @param {number} [fallback] - Value for non-numeric input.
 * @returns {number} the number.
 */
function num(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Clamp a percentage into 0…100.
 * @param {number} value - Raw percentage.
 * @returns {number} clamped percentage.
 */
function percent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Resolve the running DSH version without a network call.
 *
 * The Host does not publish its own version as a service, so walk up from the
 * running entry point (`…/@deepseek-ai/dsh/lib/bin.js`) looking for the CLI's
 * `package.json`, and fall back to normal module resolution. Missing is `null`,
 * never an exception.
 * @param {object} [options] - Injection points.
 * @param {string[]} [options.argv] - `process.argv` override.
 * @param {(file: string) => string} [options.readFile] - Text reader.
 * @returns {string|null} the version, or null.
 */
export function resolveDshVersion({ argv = process.argv, readFile = (file) => fs.readFileSync(file, 'utf8') } = {}) {
  const candidates = [];
  const entry = argv?.[1];
  if (typeof entry === 'string' && entry !== '') {
    // `dsh` is usually a symlink in a bin directory; the real file lives inside
    // the CLI package, so resolve it before walking up.
    let resolved = path.resolve(entry);
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      // keep the unresolved path
    }
    let dir = path.dirname(resolved);
    for (let depth = 0; depth < 6; depth += 1) {
      candidates.push(path.join(dir, 'package.json'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  try {
    candidates.push(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'));
  } catch {
    // not resolvable from the plugin's own dependency tree
  }
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(readFile(file));
      if (pkg?.name === '@deepseek-ai/dsh' && typeof pkg.version === 'string' && pkg.version !== '') {
        return pkg.version;
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Parse one `[Desktop Entry]` section of a `.desktop` file.
 * @param {string} text - File contents.
 * @returns {Record<string, string>} the keys of that section.
 */
export function parseDesktopEntry(text) {
  const fields = Object.create(null);
  if (typeof text !== 'string') return fields;
  let inMain = true;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      inMain = trimmed === '[Desktop Entry]';
      continue;
    }
    if (!inMain) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in fields) continue;
    fields[key] = trimmed.slice(eq + 1).trim();
  }
  return fields;
}

/**
 * Collect the read-only startup list for Linux.
 *
 * Two sources, both read-only: enabled systemd units (the `.wants` symlink
 * directories under the system unit roots, which is how `systemctl enable`
 * records its choice) and XDG autostart `.desktop` entries from
 * `/etc/xdg/autostart` and `~/.config/autostart`. User entries override system
 * entries with the same display name. Other platforms return `[]`, which the
 * contract allows.
 *
 * @param {object} [options] - Injection points for tests.
 * @param {(dir: string) => (string|{ name: string })[]} [options.readdir] - Directory reader.
 * @param {(file: string) => string} [options.readFile] - Text reader.
 * @param {(file: string) => string} [options.readlink] - Symlink reader.
 * @param {() => string} [options.homedir] - Home directory provider.
 * @param {string} [options.platform] - Platform override.
 * @returns {{ name: string, path: string, source: string, enabled: boolean,
 *   type: string, impact: string }[]} the entries.
 */
export function collectStartupEntries({
  readdir = (dir) => fs.readdirSync(dir),
  readFile = (file) => fs.readFileSync(file, 'utf8'),
  readlink = (file) => fs.readlinkSync(file),
  homedir = () => os.homedir(),
  platform = process.platform,
} = {}) {
  if (platform !== 'linux') return [];
  /** @type {Map<string, { name: string, path: string, source: string, enabled: boolean, type: string, impact: string }>} */
  const entries = new Map();

  for (const base of ['/etc/systemd/system', '/usr/lib/systemd/system']) {
    let dirents;
    try {
      dirents = readdir(base);
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      const wants = typeof dirent === 'string' ? dirent : dirent?.name;
      if (typeof wants !== 'string' || !wants.endsWith('.wants')) continue;
      let units;
      try {
        units = readdir(path.join(base, wants));
      } catch {
        continue;
      }
      for (const unit of units) {
        const file = typeof unit === 'string' ? unit : unit?.name;
        if (typeof file !== 'string' || !file.endsWith('.service')) continue;
        const name = file.slice(0, -'.service'.length);
        const key = `systemd:${name}`;
        if (entries.has(key)) continue;
        const link = path.join(base, wants, file);
        let target = null;
        try {
          target = readlink(link);
        } catch {
          // a plain file still means the unit is enabled
        }
        entries.set(key, {
          name,
          path: target ?? path.join(base, file),
          source: 'systemd',
          enabled: true,
          type: 'service',
          impact: 'low',
        });
      }
    }
  }

  for (const dir of ['/etc/xdg/autostart', path.join(homedir(), '.config', 'autostart')]) {
    let files;
    try {
      files = readdir(dir);
    } catch {
      continue;
    }
    for (const entry of files) {
      const file = typeof entry === 'string' ? entry : entry?.name;
      if (typeof file !== 'string' || !file.endsWith('.desktop')) continue;
      let text;
      try {
        text = readFile(path.join(dir, file));
      } catch {
        continue;
      }
      const fields = parseDesktopEntry(text);
      if (fields.Type !== undefined && fields.Type !== 'Application') continue;
      const hidden = fields.Hidden === 'true' || fields['X-GNOME-Autostart-enabled'] === 'false';
      const name = fields.Name !== undefined && fields.Name !== '' ? fields.Name : file.slice(0, -'.desktop'.length);
      entries.set(`xdg:${name}`, {
        name,
        path: path.join(dir, file),
        source: 'xdg',
        enabled: !hidden,
        type: 'app',
        impact: 'low',
      });
    }
  }

  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Unit-file roots in override order: the first definition of a unit wins, which
 * is the same precedence systemd uses.
 * @type {readonly string[]}
 */
export const UNIT_ROOTS = Object.freeze([
  '/etc/systemd/system',
  '/run/systemd/system',
  '/usr/lib/systemd/system',
  '/lib/systemd/system',
  '/run/systemd/generate',
]);

/** `[Install]` keys that make a unit enableable; without one systemd calls it `static`. */
const INSTALL_KEYS = new Set(['WantedBy', 'RequiredBy', 'Also', 'Alias', 'UpheldBy']);

/**
 * Parse the parts of a systemd unit file the services table needs.
 *
 * Reads only the `[Unit]` `Description=` and whether the unit has an
 * `[Install]` section at all: a unit with no install keys is `static` in
 * `systemctl list-unit-files`, which is exactly the distinction the panel needs.
 * @param {string} text - Unit file contents.
 * @returns {{ description: string|null, installable: boolean }} the parsed fields.
 */
export function parseUnitFile(text) {
  const result = { description: null, installable: false };
  if (typeof text !== 'string') return result;
  let inUnit = false;
  let inInstall = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      inUnit = line === '[Unit]';
      inInstall = line === '[Install]';
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (inUnit && key === 'Description' && result.description === null) result.description = value;
    if (inInstall && value !== '' && INSTALL_KEYS.has(key)) result.installable = true;
  }
  return result;
}

/**
 * Parse `systemctl list-unit-files --type=service --no-legend` output.
 *
 * Each line is `name.service <state> <preset>`; the state is one of
 * enabled/disabled/static/masked/alias/generated/indirect/enabled-runtime. This
 * is the fallback when the unit files cannot be read, so the parser is kept
 * separate and unit-tested.
 * @param {string} text - Command output.
 * @returns {Map<string, string>} unit file name → state.
 */
export function parseUnitFileStates(text) {
  const states = new Map();
  if (typeof text !== 'string') return states;
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 2) continue;
    const unit = fields[0];
    if (!unit.endsWith('.service')) continue;
    states.set(unit, fields[1]);
  }
  return states;
}

/**
 * Run `systemctl` and resolve its stdout. Rejects on a missing/failing binary so
 * callers can fall back.
 * @param {string[]} args - Arguments after the program name.
 * @returns {Promise<string>} stdout.
 */
export function runSystemctl(args) {
  return new Promise((resolve, reject) => {
    execFile('systemctl', args, { timeout: 3000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Derive a unit's `list-unit-files` state from the unit files themselves.
 * @param {string} unit - Unit file name (e.g. `ssh.service`).
 * @param {{ masked: boolean, alias: boolean, generated: boolean, installable: boolean }} entry - Scanned facts.
 * @param {Map<string, Set<'persistent'|'runtime'>>} linked - Units reachable from a `.wants`/`.requires` link.
 * @returns {string|null} the state, or null when unknown.
 */
function deriveUnitState(unit, entry, linked) {
  if (entry.masked) return 'masked';
  if (entry.generated) return 'generated';
  if (entry.alias) return 'alias';
  if (!entry.installable) return 'static';
  let links = linked.get(unit);
  if (links === undefined && unit.endsWith('@.service')) {
    // A template is enabled when any instance is linked (e.g. getty@tty1).
    const prefix = unit.slice(0, -'.service'.length);
    const merged = new Set();
    for (const [candidate, roots] of linked) {
      if (candidate.startsWith(prefix) && candidate.endsWith('.service')) {
        for (const root of roots) merged.add(root);
      }
    }
    links = merged.size > 0 ? merged : undefined;
  }
  if (links === undefined) return 'disabled';
  return links.has('runtime') && !links.has('persistent') ? 'enabled-runtime' : 'enabled';
}

/**
 * Best-effort Linux service enrichment for `GET /api/services`.
 *
 * `systemctl list-unit-files` is the canonical source for the unit-file state
 * (`enabled`/`disabled`/`static`/`masked`, …) and for unit descriptions, but it
 * costs 630–800 ms on a 190-service host — over the route's ~400 ms cold budget.
 * The same facts are derivable from the unit filesystem in ~15 ms: symlinks in
 * `*.wants`/`*.requires` mean enabled, a `/dev/null` symlink means masked, a
 * symlink to another unit means alias, an `[Install]` section distinguishes
 * disabled from static, and `[Unit] Description=` is the display name. This was
 * cross-checked against `systemctl list-unit-files` (289/303 units identical;
 * the rest are systemd-internal alias/indirect states).
 *
 * `systemctl list-unit-files` is still used as a fallback when the unit roots
 * are unreadable (non-standard layout). Non-Linux returns empty maps so the
 * caller keeps whatever `systeminformation` reported and emits null otherwise.
 *
 * @param {object} [options] - Injection points for tests.
 * @param {string} [options.platform] - Platform override.
 * @param {string[]} [options.unitRoots] - Unit directories in override order.
 * @param {(dir: string) => (string|{ name: string })[]} [options.readdir] - Directory reader.
 * @param {(file: string) => string} [options.readFile] - Text reader.
 * @param {(file: string) => string} [options.readlink] - Symlink reader.
 * @param {(file: string) => string} [options.realpath] - Symlink resolver.
 * @param {(args: string[]) => Promise<string>} [options.systemctl] - systemctl runner.
 * @returns {Promise<{ states: Map<string, string>, descriptions: Map<string, string> }>} the maps.
 */
export async function collectServiceEnrichment({
  platform = process.platform,
  unitRoots = UNIT_ROOTS,
  readdir = (dir) => fs.readdirSync(dir),
  readFile = (file) => fs.readFileSync(file, 'utf8'),
  readlink = (file) => fs.readlinkSync(file),
  realpath = (file) => fs.realpathSync(file),
  systemctl = runSystemctl,
} = {}) {
  const empty = { states: new Map(), descriptions: new Map() };
  if (platform !== 'linux') return empty;

  /** @type {Map<string, { description: string|null, installable: boolean, masked: boolean, alias: boolean, generated: boolean }>} */
  const info = new Map();
  /** @type {Map<string, Set<'persistent'|'runtime'>>} */
  const linked = new Map();
  const seenRoots = new Set();

  for (const root of unitRoots) {
    let real;
    try {
      real = realpath(root);
    } catch {
      continue;
    }
    if (seenRoots.has(real)) continue;
    seenRoots.add(real);
    const runtime = real.startsWith('/run/');
    const generated = real.startsWith('/run/systemd/generate');
    let names;
    try {
      names = readdir(real);
    } catch {
      continue;
    }
    for (const rawName of names) {
      const name = typeof rawName === 'string' ? rawName : rawName?.name;
      if (typeof name !== 'string') continue;
      if (name.endsWith('.wants') || name.endsWith('.requires')) {
        let units;
        try {
          units = readdir(path.join(real, name));
        } catch {
          continue;
        }
        for (const rawUnit of units) {
          const unit = typeof rawUnit === 'string' ? rawUnit : rawUnit?.name;
          if (typeof unit !== 'string' || !unit.endsWith('.service')) continue;
          if (!linked.has(unit)) linked.set(unit, new Set());
          linked.get(unit).add(runtime ? 'runtime' : 'persistent');
        }
        continue;
      }
      if (!name.endsWith('.service') || info.has(name)) continue;
      const full = path.join(real, name);
      let target = null;
      try {
        target = readlink(full);
      } catch {
        // a regular unit file
      }
      const masked = target === '/dev/null';
      const alias = target !== null && !masked && path.basename(target) !== name && target.endsWith('.service');
      let text;
      try {
        text = readFile(full);
      } catch {
        continue;
      }
      const parsed = parseUnitFile(text);
      info.set(name, { ...parsed, masked, alias, generated });
    }
  }

  if (info.size === 0) {
    // Unreadable/absent unit roots: ask systemd directly and accept the slower path.
    try {
      const states = parseUnitFileStates(await systemctl(['list-unit-files', '--type=service', '--no-pager', '--no-legend']));
      return { states, descriptions: new Map() };
    } catch {
      return empty;
    }
  }

  const states = new Map();
  const descriptions = new Map();
  for (const [unit, entry] of info) {
    if (entry.description !== null && entry.description !== '') descriptions.set(unit, entry.description);
    const state = deriveUnitState(unit, entry, linked);
    if (state !== null) states.set(unit, state);
  }
  return { states, descriptions };
}

/**
 * Build the metrics collector.
 *
 * @param {object} [options] - Injection points.
 * @param {Record<string, unknown>} [options.config] - Row config (normalised here).
 * @param {(level: string, message: string) => void} [options.logger] - Diagnostic sink.
 * @param {() => number} [options.now] - Clock.
 * @param {typeof systeminformation} [options.si] - `systeminformation` namespace.
 * @param {ReturnType<typeof createProcfs>} [options.procfs] - `/proc` sampler.
 * @param {string} [options.platform] - Platform override.
 * @param {number} [options.hostPid] - Host process id (protected from kill).
 * @param {number} [options.hostPpid] - Host parent id (protected from kill).
 * @param {(pid: number, signal: string) => unknown} [options.kill] - Signal sender.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Delay, injectable for tests.
 * @param {number} [options.bootTime] - Boot epoch ms override.
 * @param {string|null} [options.dshVersion] - DSH version override.
 * @param {() => Promise<{ states: Map<string, string>, descriptions: Map<string, string> }>} [options.serviceEnrichment] - Service metadata provider.
 * @returns {object} the collector.
 */
export function createMetrics({
  config = {},
  logger = () => {},
  now = () => Date.now(),
  si = systeminformation,
  procfs = createProcfs({ platform: process.platform }),
  platform = process.platform,
  hostPid = process.pid,
  hostPpid = process.ppid,
  kill = (pid, signal) => process.kill(pid, signal),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  bootTime,
  dshVersion,
  serviceEnrichment = () => collectServiceEnrichment({ platform }),
} = {}) {
  const settings = normalizeConfig(config);
  const startedAt = now();
  const boot = Number.isFinite(bootTime) ? bootTime : now() - Math.round(os.uptime() * 1000);
  const history = createHistory({ since: startedAt, now });
  const dsh = {
    version: dshVersion !== undefined ? dshVersion : resolveDshVersion(),
    pid: hostPid,
    node: process.version,
  };

  /**
   * Previous sample, used for every rate/delta the next snapshot reports.
   * @type {null|{ ts: number, cpu: any, procTicks: Map<number, { ticks: number, starttime: number }>,
   *   net: Map<string, { rx: number, tx: number }>, disk: { reads: number, writes: number, readMs: number, writeMs: number } }}
   */
  let previous = null;

  /** @type {{ at: number, value: any }|undefined} */
  let fsCache;
  /** @type {{ at: number, value: any }|undefined} */
  let usersCache;

  /**
   * Call a `systeminformation` function, logging and falling back on failure.
   * @template T
   * @param {() => Promise<T>} fn - Call.
   * @param {T} fallback - Value on failure.
   * @param {string} label - Log label.
   * @returns {Promise<T>} the result.
   */
  async function call(fn, fallback, label) {
    try {
      return await fn();
    } catch (error) {
      logger('warn', `task-manager: ${label} failed: ${error?.message ?? error}`);
      return fallback;
    }
  }

  /**
   * Filesystem usage rows, reused for {@link FS_CACHE_MS}.
   * @returns {Promise<any[]>} `systeminformation.fsSize()` rows.
   */
  async function diskUsage() {
    const at = now();
    if (fsCache !== undefined && at - fsCache.at < FS_CACHE_MS) return fsCache.value;
    const value = await call(() => si.fsSize(), [], 'fsSize');
    const rows = Array.isArray(value) ? value : [];
    fsCache = { at, value: rows };
    return rows;
  }

  /**
   * Logged-in users, reused for {@link USERS_CACHE_MS} (the `who` call is ~35 ms).
   * @returns {Promise<any[]>} `systeminformation.users()` rows.
   */
  async function userList() {
    const at = now();
    if (usersCache !== undefined && at - usersCache.at < USERS_CACHE_MS) return usersCache.value;
    const value = await call(() => si.users(), [], 'users');
    const rows = Array.isArray(value) ? value : [];
    usersCache = { at, value: rows };
    return rows;
  }

  /**
   * Map memory counters to the API shape.
   * @param {any} mem - `systeminformation.mem()` result.
   * @returns {Record<string, number>} the mem block.
   */
  function memView(mem) {
    const total = num(mem?.total);
    const used = num(mem?.used);
    return {
      total,
      used,
      free: num(mem?.free),
      available: num(mem?.available),
      active: num(mem?.active),
      buffcache: num(mem?.buffcache),
      buffers: num(mem?.buffers),
      cached: num(mem?.cached),
      swapTotal: num(mem?.swaptotal),
      swapUsed: num(mem?.swapused),
      swapFree: num(mem?.swapfree),
      usedPercent: total > 0 ? round1(percent((used / total) * 100)) : 0,
    };
  }

  /**
   * Map filesystem rows to the `/snapshot` disk list.
   * @param {any[]} rows - `fsSize()` rows.
   * @returns {object[]} disk rows.
   */
  function diskView(rows) {
    return rows.filter(isPhysicalDisk).map((row) => {
      const size = num(row?.size);
      const used = num(row?.used);
      const available = num(row?.available);
      const usePercent = row?.use !== undefined && Number.isFinite(Number(row.use))
        ? round1(num(row.use))
        : (size > 0 ? round1(percent((used / size) * 100)) : 0);
      return {
        fs: typeof row?.fs === 'string' ? row.fs : null,
        mount: typeof row?.mount === 'string' ? row.mount : null,
        type: typeof row?.type === 'string' ? row.type : null,
        size,
        used,
        available,
        usePercent,
      };
    });
  }

  /**
   * Map a raw `/proc` row to the contract's process row.
   * @param {any} raw - Row from {@link createProcfs}.
   * @param {{ prevTicks: Map<number, { ticks: number, starttime: number }>|undefined,
   *   totalDelta: number, passwd: Map<number, string>, memTotal: number }} context - Sample context.
   * @returns {object} the process row.
   */
  function processRowFromProcfs(raw, context) {
    const ticks = raw.utime + raw.stime;
    const cpu = computeProcessCpu(context.prevTicks?.get(raw.pid), { ticks, starttime: raw.starttime }, context.totalDelta);
    const memBytes = Math.max(0, num(raw.rssBytes));
    const uid = raw.uid === null || raw.uid === undefined ? null : num(raw.uid);
    const cmd = typeof raw.cmd === 'string' && raw.cmd !== '' ? raw.cmd : '';
    const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : (cmd !== '' ? path.basename(cmd.split(' ')[0]) : `pid ${raw.pid}`);
    const isKernel = cmd === '';
    const isDsh = raw.pid === hostPid;
    const isGui = GUI_ALLOWLIST.has(name) || (cmd !== '' && GUI_ALLOWLIST.has(path.basename(cmd.split(' ')[0])));
    const hasTty = num(raw.ttyNr) !== 0;
    // The DSH Host is the application this panel belongs to, so it reads as
    // `app` even when it runs as root (docs/API.md, process semantics).
    const group = isDsh ? 'app' : (uid === 0 || isKernel ? 'system' : (hasTty || isGui ? 'app' : 'background'));
    return {
      pid: raw.pid,
      ppid: num(raw.ppid),
      name,
      user: uid === null ? null : (context.passwd.get(uid) ?? String(uid)),
      uid,
      state: mapProcessState(raw.state),
      cpu: round1(cpu),
      memBytes,
      memPercent: context.memTotal > 0 ? round2(percent((memBytes / context.memTotal) * 100)) : 0,
      threads: num(raw.threads),
      cmd: cmd !== '' ? cmd : name,
      started: boot + num(raw.starttime) * (1000 / LINUX_CLK_TCK),
      priority: num(raw.priority),
      nice: num(raw.nice),
      group,
      isGui,
      isKernel,
      isDsh,
    };
  }

  /**
   * Map one `systeminformation.processes()` row to the contract shape (non-Linux).
   * @param {any} proc - Raw row.
   * @param {number} memTotal - Total memory in bytes.
   * @returns {object} the process row.
   */
  function processRowFromSysteminformation(proc, memTotal) {
    const pid = num(proc?.pid);
    const name = typeof proc?.name === 'string' && proc.name !== '' ? proc.name : `pid ${pid}`;
    const cmd = typeof proc?.command === 'string' && proc.command !== '' ? proc.command : name;
    const user = typeof proc?.user === 'string' ? proc.user : null;
    const uid = user === 'root' || user === 'SYSTEM' ? 0 : null;
    const state = ['running', 'sleeping', 'blocked', 'stopped', 'zombie'].includes(proc?.state) ? proc.state : 'unknown';
    const memBytes = Math.max(0, num(proc?.memRss));
    const started = typeof proc?.started === 'string' ? Date.parse(proc.started) : Number.NaN;
    const isKernel = false;
    const isDsh = pid === hostPid;
    const isGui = GUI_ALLOWLIST.has(name);
    // Same precedence as the /proc mapper: the Host process is `app`.
    const group = isDsh ? 'app' : (uid === 0 || isKernel ? 'system' : (isGui ? 'app' : 'background'));
    return {
      pid,
      ppid: num(proc?.parentPid),
      name,
      user,
      uid,
      state,
      cpu: round1(percent(num(proc?.cpu))),
      memBytes,
      memPercent: memTotal > 0 ? round2(percent((memBytes / memTotal) * 100)) : 0,
      threads: num(proc?.threads),
      cmd,
      started: Number.isFinite(started) ? started : null,
      priority: num(proc?.priority),
      nice: num(proc?.nice),
      group,
      isGui,
      isKernel,
      isDsh,
    };
  }

  /**
   * Aggregate per-state counts and thread totals.
   * @param {object[]} rows - Process rows.
   * @returns {{ all: number, running: number, sleeping: number, blocked: number,
   *   zombie: number, stopped: number, threads: number }} the summary.
   */
  function summarize(rows) {
    const summary = { all: rows.length, running: 0, sleeping: 0, blocked: 0, zombie: 0, stopped: 0, threads: 0 };
    for (const row of rows) {
      if (row.state === 'running') summary.running += 1;
      else if (row.state === 'sleeping') summary.sleeping += 1;
      else if (row.state === 'blocked') summary.blocked += 1;
      else if (row.state === 'zombie') summary.zombie += 1;
      else if (row.state === 'stopped') summary.stopped += 1;
      summary.threads += num(row.threads);
    }
    return summary;
  }

  /**
   * Compute CPU percentages from two `/proc/stat` snapshots.
   * @param {any} before - Baseline counters, or null.
   * @param {any} after - Current counters.
   * @returns {{ load: number, user: number, system: number, idle: number, nice: number,
   *   irq: number, cores: number[], totalDelta: number }} the deltas.
   */
  function cpuDelta(before, after) {
    const empty = { load: 0, user: 0, system: 0, idle: 0, nice: 0, irq: 0, cores: [], totalDelta: 0 };
    if (before === null || before === undefined || after === null || after === undefined) return empty;
    const totalDelta = after.total - before.total;
    if (!Number.isFinite(totalDelta) || totalDelta <= 0) return empty;
    const share = (current, baseline) => percent(((current - baseline) / totalDelta) * 100);
    const cores = Array.isArray(after.cores)
      ? after.cores.map((core, index) => {
        const base = before.cores?.[index];
        if (base === undefined) return 0;
        const delta = core.total - base.total;
        if (!Number.isFinite(delta) || delta <= 0) return 0;
        return percent(((delta - (core.idle - base.idle)) / delta) * 100);
      })
      : [];
    const idleDelta = after.idle - before.idle;
    return {
      load: percent(100 - (idleDelta / totalDelta) * 100),
      user: share(after.user, before.user),
      system: share(after.system, before.system),
      idle: percent((idleDelta / totalDelta) * 100),
      nice: share(after.nice, before.nice),
      irq: share(after.irq, before.irq),
      cores,
      totalDelta,
    };
  }

  /**
   * Network rows with rates, from `/proc/net/dev` deltas.
   * @param {{ iface: string, rx_bytes: number, tx_bytes: number }[]} rows - Current counters.
   * @param {Map<string, { rx: number, tx: number }>|undefined} baseline - Previous counters.
   * @param {number} elapsedSec - Seconds since the previous sample.
   * @returns {{ ifaces: object[], total: object }} the network block.
   */
  function networkView(rows, baseline, elapsedSec) {
    const ifaces = [];
    const total = { rx_bytes: 0, tx_bytes: 0, rx_sec: 0, tx_sec: 0 };
    for (const row of rows) {
      if (row.iface === 'lo') continue;
      const before = baseline?.get(row.iface);
      const rxSec = before !== undefined && elapsedSec > 0 ? Math.max(0, (row.rx_bytes - before.rx) / elapsedSec) : 0;
      const txSec = before !== undefined && elapsedSec > 0 ? Math.max(0, (row.tx_bytes - before.tx) / elapsedSec) : 0;
      ifaces.push({
        iface: row.iface,
        operstate: procfs.readOperstate ? procfs.readOperstate(row.iface) : null,
        rx_bytes: row.rx_bytes,
        tx_bytes: row.tx_bytes,
        rx_sec: Math.round(rxSec),
        tx_sec: Math.round(txSec),
      });
      total.rx_bytes += row.rx_bytes;
      total.tx_bytes += row.tx_bytes;
      total.rx_sec += Math.round(rxSec);
      total.tx_sec += Math.round(txSec);
    }
    return { ifaces, total };
  }

  /**
   * Disk I/O rates from `/proc/diskstats` deltas.
   * @param {{ reads: number, writes: number, readMs: number, writeMs: number }} current - Current counters.
   * @param {{ reads: number, writes: number, readMs: number, writeMs: number }|undefined} before - Baseline.
   * @param {number} elapsedSec - Seconds since the previous sample.
   * @returns {Record<string, number>} the diskIO block.
   */
  function diskIoView(current, before, elapsedSec) {
    const elapsedMs = elapsedSec * 1000;
    const delta = (value, baseline) => (before === undefined || elapsedSec <= 0 ? 0 : Math.max(0, value - baseline));
    const rIO_sec = delta(current.reads, before?.reads) / (elapsedSec || 1);
    const wIO_sec = delta(current.writes, before?.writes) / (elapsedSec || 1);
    const rWaitPercent = elapsedMs > 0 ? percent((delta(current.readMs, before?.readMs) / elapsedMs) * 100) : 0;
    const wWaitPercent = elapsedMs > 0 ? percent((delta(current.writeMs, before?.writeMs) / elapsedMs) * 100) : 0;
    return {
      rIO: current.reads,
      wIO: current.writes,
      tIO: current.reads + current.writes,
      rIO_sec: round1(rIO_sec),
      wIO_sec: round1(wIO_sec),
      tIO_sec: round1(rIO_sec + wIO_sec),
      rWaitPercent: round1(rWaitPercent),
      wWaitPercent: round1(wWaitPercent),
      tWaitPercent: round1(percent(rWaitPercent + wWaitPercent)),
    };
  }

  /**
   * The live sample served by `GET /api/snapshot`.
   * @returns {Promise<Record<string, unknown>>} the snapshot payload.
   */
  async function snapshot() {
    const startedMs = now();
    const ts = now();
    /** @type {object[]} */
    let rows = [];
    /** @type {any[]} */
    let fsRows;
    /** @type {any[]} */
    let users;
    /** @type {any} */
    let mem;
    /** @type {any} */
    let cpu;
    /** @type {any} */
    let network;
    /** @type {any} */
    let diskIO;
    /** @type {number|null} */
    let temperature = null;
    /** @type {number} */
    let uptimeSec;
    /** @type {number} */
    let processCount;

    if (procfs.supported) {
      // The very first sample has no jiffy baseline. Measure over a short window
      // instead of reporting the average since boot; it is a one-time ~100 ms
      // cost, after which every sample is a cheap delta.
      let baseline = previous?.cpu ?? null;
      if (baseline === null) {
        baseline = procfs.readCpuStat();
        if (baseline !== null) await sleep(WARMUP_MS);
      }
      const cpuNow = procfs.readCpuStat();
      const rawRows = procfs.readProcessTable();
      const netNow = procfs.readNetDev();
      const diskNow = procfs.readDiskstats();
      temperature = procfs.readTemperature();
      uptimeSec = Math.round(procfs.readUptimeSec());
      [mem, fsRows, users] = await Promise.all([call(() => si.mem(), null, 'mem'), diskUsage(), userList()]);
      const elapsedSec = previous === null ? 0 : Math.max(0, (ts - previous.ts) / 1000);
      const delta = cpuDelta(baseline, cpuNow);
      cpu = {
        load: round1(delta.load),
        user: round1(delta.user),
        system: round1(delta.system),
        idle: round1(delta.idle),
        nice: round1(delta.nice),
        irq: round1(delta.irq),
        cores: delta.cores.map((value) => round1(value)),
        temperature: temperature ?? null,
        processCount: 0,
        threadCount: 0,
        uptimeSec,
      };
      const memTotal = num(mem?.total);
      const passwd = procfs.readPasswd();
      rows = rawRows.map((raw) => processRowFromProcfs(raw, {
        prevTicks: previous?.procTicks,
        totalDelta: delta.totalDelta,
        passwd,
        memTotal,
      }));
      const netBaseline = previous === null
        ? undefined
        : new Map([...previous.net].map(([iface, value]) => [iface, value]));
      network = networkView(netNow, netBaseline, elapsedSec);
      diskIO = diskIoView(diskNow, previous?.disk, elapsedSec);
      processCount = rows.length;
      previous = {
        ts,
        cpu: cpuNow,
        procTicks: new Map(rawRows.map((raw) => [raw.pid, { ticks: raw.utime + raw.stime, starttime: raw.starttime }])),
        net: new Map(netNow.map((row) => [row.iface, { rx: row.rx_bytes, tx: row.tx_bytes }])),
        disk: diskNow,
      };
    } else {
      const [load, procList, memInfo, fsInfo, userRows, netRows, diskRows, tempInfo] = await Promise.all([
        call(() => si.currentLoad(), null, 'currentLoad'),
        call(() => si.processes(), null, 'processes'),
        call(() => si.mem(), null, 'mem'),
        diskUsage(),
        userList(),
        call(() => si.networkStats('*'), [], 'networkStats'),
        call(() => si.disksIO(), null, 'disksIO'),
        call(() => si.cpuTemperature(), null, 'cpuTemperature'),
      ]);
      mem = memInfo;
      fsRows = fsInfo;
      users = userRows;
      temperature = Number.isFinite(Number(tempInfo?.main)) ? round1(Number(tempInfo.main)) : null;
      uptimeSec = Math.round(os.uptime());
      const cores = Array.isArray(load?.cpus) ? load.cpus.map((core) => round1(percent(num(core?.load)))) : [];
      cpu = {
        load: round1(percent(num(load?.currentLoad))),
        user: round1(percent(num(load?.currentLoadUser))),
        system: round1(percent(num(load?.currentLoadSystem))),
        idle: round1(percent(num(load?.currentLoadIdle))),
        nice: round1(percent(num(load?.currentLoadNice))),
        irq: round1(percent(num(load?.currentLoadIrq))),
        cores,
        temperature: temperature ?? null,
        processCount: num(procList?.all),
        threadCount: num(procList?.all) === 0 ? 0 : num(procList?.list?.reduce?.((sum, proc) => sum + num(proc?.threads), 0)),
        uptimeSec,
      };
      const memTotal = num(memInfo?.total);
      rows = (Array.isArray(procList?.list) ? procList.list : []).map((proc) => processRowFromSysteminformation(proc, memTotal));
      const netRowsArray = Array.isArray(netRows) ? netRows : [];
      const ifaces = netRowsArray
        .filter((row) => row?.iface !== 'lo')
        .map((row) => ({
          iface: row.iface,
          operstate: row.operstate ?? null,
          rx_bytes: num(row.rx_bytes),
          tx_bytes: num(row.tx_bytes),
          rx_sec: Math.round(num(row.rx_sec)),
          tx_sec: Math.round(num(row.tx_sec)),
        }));
      const total = { rx_bytes: 0, tx_bytes: 0, rx_sec: 0, tx_sec: 0 };
      for (const row of ifaces) {
        total.rx_bytes += row.rx_bytes;
        total.tx_bytes += row.tx_bytes;
        total.rx_sec += row.rx_sec;
        total.tx_sec += row.tx_sec;
      }
      network = { ifaces, total };
      diskIO = {
        rIO: num(diskRows?.rIO),
        wIO: num(diskRows?.wIO),
        tIO: num(diskRows?.tIO),
        rIO_sec: round1(num(diskRows?.rIO_sec)),
        wIO_sec: round1(num(diskRows?.wIO_sec)),
        tIO_sec: round1(num(diskRows?.tIO_sec)),
        rWaitPercent: round1(percent(num(diskRows?.rWaitPercent))),
        wWaitPercent: round1(percent(num(diskRows?.wWaitPercent))),
        tWaitPercent: round1(percent(num(diskRows?.tWaitPercent))),
      };
      processCount = num(procList?.all, rows.length) || rows.length;
    }

    const summary = summarize(rows);
    history.fold(rows, ts);
    rows.sort((a, b) => b.cpu - a.cpu || b.memBytes - a.memBytes || a.pid - b.pid);
    const visible = rows.slice(0, settings.maxProcesses);
    cpu.processCount = processCount;
    cpu.threadCount = summary.threads;

    const payload = {
      ok: true,
      ts,
      sampleMs: Math.max(0, Math.round(now() - startedMs)),
      intervalMs: settings.refreshIntervalMs,
      cpu,
      mem: memView(mem),
      disks: diskView(fsRows ?? []),
      diskIO,
      network,
      processes: visible,
      processSummary: summary,
      users: (Array.isArray(users) ? users : []).map((user) => ({
        user: user?.user ?? null,
        tty: user?.tty ?? null,
        date: user?.date ?? null,
        time: user?.time ?? null,
        ip: user?.ip ?? '',
        command: user?.command ?? null,
      })),
    };
    return payload;
  }

  /**
   * The slowly changing `GET /api/system` payload.
   * @returns {Promise<Record<string, unknown>>} the system payload.
   */
  async function systemView() {
    const [osInfo, cpuInfo, systemInfo, memInfo, fsRows, nics, gfx] = await Promise.all([
      call(() => si.osInfo(), null, 'osInfo'),
      call(() => si.cpu(), null, 'cpu'),
      call(() => si.system(), null, 'system'),
      call(() => si.mem(), null, 'mem'),
      diskUsage(),
      call(() => si.networkInterfaces(), [], 'networkInterfaces'),
      call(() => si.graphics(), null, 'graphics'),
    ]);
    const cache = cpuInfo?.cache ?? {};
    const controllers = Array.isArray(gfx?.controllers) ? gfx.controllers : [];
    const displays = Array.isArray(gfx?.displays) ? gfx.displays : [];
    const netIfaces = (Array.isArray(nics) ? nics : [])
      .filter((nic) => nic?.iface !== 'lo')
      .map((nic) => ({
        iface: nic?.iface ?? null,
        ifaceName: nic?.ifaceName ?? null,
        ip4: nic?.ip4 ?? null,
        mac: nic?.mac ?? null,
        operstate: nic?.operstate ?? null,
        type: nic?.type ?? null,
        speed: nic?.speed ?? null,
        virtual: nic?.virtual === true,
      }));
    return {
      ok: true,
      hostname: os.hostname(),
      platform: process.platform,
      distro: osInfo === null ? null : `${osInfo.distro ?? ''} ${osInfo.release ?? ''}`.trim() || null,
      release: osInfo?.kernel ?? null,
      arch: osInfo?.arch ?? null,
      kernel: `${os.type()} ${os.release()} ${os.arch()}`,
      manufacturer: typeof systemInfo?.manufacturer === 'string' && systemInfo.manufacturer !== '' ? systemInfo.manufacturer : null,
      model: typeof systemInfo?.model === 'string' && systemInfo.model !== '' ? systemInfo.model : null,
      cpu: {
        manufacturer: cpuInfo?.manufacturer ?? null,
        brand: cpuInfo?.brand ?? null,
        cores: cpuInfo?.cores ?? null,
        physicalCores: cpuInfo?.physicalCores ?? null,
        speedGHz: cpuInfo?.speed ?? null,
        governor: cpuInfo?.governor ?? '',
        cache: {
          l1d: cache.l1d ?? null,
          l1i: cache.l1i ?? null,
          l2: cache.l2 ?? null,
          l3: cache.l3 ?? null,
        },
      },
      memTotal: num(memInfo?.total) || null,
      swapTotal: num(memInfo?.swaptotal) || null,
      disks: (Array.isArray(fsRows) ? fsRows : []).filter(isPhysicalDisk).map((row) => ({
        fs: typeof row?.fs === 'string' ? row.fs : null,
        type: typeof row?.type === 'string' ? row.type : null,
        size: num(row?.size),
        mount: typeof row?.mount === 'string' ? row.mount : null,
      })),
      netIfaces,
      graphics: {
        controllers: controllers.map((controller) => ({
          model: controller?.model ?? null,
          vendor: controller?.vendor ?? null,
          vram: controller?.vram ?? null,
          vramDynamic: controller?.vramDynamic === true,
        })),
        displays: displays.map((display) => ({
          model: display?.model ?? null,
          resolutionX: display?.resolutionX ?? null,
          resolutionY: display?.resolutionY ?? null,
          currentResX: display?.currentResX ?? null,
          currentResY: display?.currentResY ?? null,
          main: display?.main === true,
        })),
      },
      dsh,
    };
  }

  /**
   * The `GET /api/services` payload.
   * @returns {Promise<Record<string, unknown>>} the services payload.
   */
  async function servicesView() {
    const emptyEnrichment = { states: new Map(), descriptions: new Map() };
    const [list, enrichment] = await Promise.all([
      call(() => si.services('*'), [], 'services'),
      call(() => serviceEnrichment(), emptyEnrichment, 'service enrichment'),
    ]);
    const states = enrichment?.states instanceof Map ? enrichment.states : new Map();
    const descriptions = enrichment?.descriptions instanceof Map ? enrichment.descriptions : new Map();
    const services = (Array.isArray(list) ? list : [])
      .map((service) => {
        const name = typeof service?.name === 'string' ? service.name : '';
        // systemd unit files are named `<unit>.service`; systeminformation strips the suffix.
        const unit = name === '' ? '' : (name.endsWith('.service') ? name : `${name}.service`);
        const displayName = descriptions.get(unit) ?? (typeof service?.displayName === 'string' && service.displayName !== '' ? service.displayName : null);
        const startmode = states.get(unit) ?? (typeof service?.startmode === 'string' && service.startmode !== '' ? service.startmode : null);
        return {
          name,
          displayName,
          running: service?.running === true,
          startmode,
          pids: Array.isArray(service?.pids) ? service.pids.filter((pid) => Number.isInteger(pid) && pid > 0) : [],
          cpu: round1(num(service?.cpu)),
          mem: round1(num(service?.mem)),
        };
      })
      .filter((service) => service.name !== '')
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, ts: now(), services };
  }

  /**
   * The `GET /api/startup` payload (read-only).
   * @returns {Promise<Record<string, unknown>>} the startup payload.
   */
  async function startupView() {
    const entries = collectStartupEntries({ platform });
    return { ok: true, ts: now(), entries };
  }

  /**
   * The `GET /api/history` payload.
   * @returns {Record<string, unknown>} the history payload.
   */
  function historyView() {
    return history.view(now());
  }

  /**
   * Resolve the current identity of a pid for the kill guard.
   * @param {number} pid - Process id.
   * @returns {Promise<{ started: number|null, uid: number|null }>} identity.
   */
  async function processIdentity(pid) {
    if (procfs.supported) {
      const identity = procfs.readProcessIdentity(pid);
      return { started: boot + num(identity.starttime) * (1000 / LINUX_CLK_TCK), uid: identity.uid ?? null };
    }
    const listing = await call(() => si.processes(), null, 'processes');
    const hit = Array.isArray(listing?.list) ? listing.list.find((proc) => num(proc?.pid) === pid) : undefined;
    if (hit === undefined) {
      throw Object.assign(new Error(`no process with pid ${pid}`), { code: 'ENOENT' });
    }
    const started = typeof hit.started === 'string' ? Date.parse(hit.started) : Number.NaN;
    const user = typeof hit.user === 'string' ? hit.user : '';
    return {
      started: Number.isFinite(started) ? started : null,
      uid: user === 'root' || user === 'SYSTEM' ? 0 : null,
    };
  }

  /**
   * Guarded process termination for `POST /api/process/kill`.
   *
   * Refusals are stable `HttpError`s matching docs/API.md: bad pid (400), a
   * protected process — pid 1, the Host itself, its parent — (403), a uid-0
   * process while `allowKillSystemProcesses` is false (403), a missing process
   * (404), a stale `startTime` that would signal a recycled pid (409), and a
   * signal that could not be delivered (500).
   * @param {unknown} body - Parsed request body.
   * @returns {Promise<{ pid: number, signal: string }>} what was signalled.
   */
  async function killProcess(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'bad-request', 'send a JSON object with a pid');
    }
    const rawPid = body.pid;
    const pid = typeof rawPid === 'number' ? rawPid : Number.parseInt(String(rawPid ?? ''), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new HttpError(400, 'bad-pid', 'pid must be a positive integer');
    }
    let identity;
    try {
      identity = await processIdentity(pid);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') {
        throw new HttpError(404, 'no-such-process', `no process with pid ${pid}`);
      }
      throw error;
    }
    if (pid === 1 || pid === hostPid || pid === hostPpid) {
      throw new HttpError(403, 'protected-process', `pid ${pid} is protected (pid 1, the Host process, or its parent)`);
    }
    const requested = typeof body.startTime === 'number' ? body.startTime : Number.NaN;
    if (!Number.isFinite(requested) || identity.started === null || Math.abs(identity.started - requested) > START_TOLERANCE_MS) {
      throw new HttpError(409, 'stale-process', 'the process start time does not match; it may have exited and its pid been reused');
    }
    if (identity.uid === 0 && settings.allowKillSystemProcesses !== true) {
      throw new HttpError(403, 'system-process', 'system (uid 0) processes are protected; enable allowKillSystemProcesses to end them');
    }
    const signal = body.signal === undefined ? 'SIGTERM' : String(body.signal).toUpperCase();
    if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      throw new HttpError(400, 'bad-request', 'signal must be SIGTERM or SIGKILL');
    }
    if (signal === 'SIGKILL' && body.force !== true) {
      throw new HttpError(400, 'bad-request', 'SIGKILL requires force: true');
    }
    try {
      await kill(pid, signal);
    } catch (error) {
      throw new HttpError(500, 'kill-failed', error?.message ?? 'the signal could not be delivered');
    }
    return { pid, signal };
  }

  /**
   * Release cached state. The collector owns no timers or handles, so this only
   * drops the references the next mount would rebuild.
   * @returns {void}
   */
  function dispose() {
    previous = null;
    fsCache = undefined;
    usersCache = undefined;
    history.reset();
  }

  return {
    settings,
    startedAt,
    bootTime: boot,
    snapshot,
    system: systemView,
    services: servicesView,
    startup: startupView,
    history: historyView,
    kill: killProcess,
    dispose,
  };
}
