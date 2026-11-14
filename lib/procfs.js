/**
 * Linux `/proc` fast path for the Task Manager Host API.
 *
 * The panel polls a full snapshot every 1.5 s, and the Windows 11 Task Manager
 * feel depends on that snapshot being cheap. `systeminformation` is the mature,
 * MIT-licensed library we standardise on for everything cross-platform (CPU,
 * memory, filesystems, network adapters, graphics, services, users), but its
 * Linux process listing spawns `ps` and takes ~700 ms here — an order of
 * magnitude over the snapshot budget. So on Linux we read the kernel's own
 * files directly:
 *
 *   - one `readdir('/proc')` plus three small files per process
 *     (`stat`, `status`, `cmdline`), ~20 ms for ~200 processes;
 *   - instantaneous CPU% from the delta of `utime+stime` against the delta of
 *     the machine's total jiffies in `/proc/stat` (100 % = the whole machine,
 *     all cores);
 *   - the same jiffy delta gives the aggregate/per-core load percentages, so
 *     the snapshot never waits on `systeminformation.currentLoad()`'s 500 ms
 *     sampling window;
 *   - `/proc/net/dev` and `/proc/diskstats` deltas give the network and disk
 *     rates for free.
 *
 * Everything in this module is pure-ish and dependency-injectable (`readFile`,
 * `readdir`, `platform`) so the parsers and the sampler can be unit-tested on
 * any OS. The module never writes to disk.
 *
 * @module @ds-hu/dsh-task-manager/lib/procfs
 */

import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';

/** `/proc/<pid>/stat` time fields are in USER_HZ, which Linux fixes at 100. */
export const LINUX_CLK_TCK = 100;

/** Used when `/proc/self/auxv` cannot be read (non-Linux, exotic kernels). */
export const FALLBACK_PAGE_SIZE = 4096;

/**
 * File-system types that are not physical disks, so `/system` and `/snapshot`
 * do not advertise the container's overlay root as a drive.
 * @type {ReadonlySet<string>}
 */
const VIRTUAL_FS_TYPES = new Set([
  'autofs', 'binfmt_misc', 'bpf', 'cgroup', 'cgroup2', 'configfs', 'debugfs',
  'devpts', 'devtmpfs', 'efivarfs', 'fusectl', 'fuse.lxcfs', 'hugetlbfs',
  'iso9660', 'mqueue', 'nsfs', 'overlay', 'proc', 'pstore', 'ramfs', 'rootfs',
  'securityfs', 'squashfs', 'sysfs', 'tmpfs', 'tracefs',
]);

/**
 * Whether a `systeminformation.fsSize()` row describes a real disk.
 * @param {{ fs?: unknown, type?: unknown, mount?: unknown }} row - One row.
 * @returns {boolean} whether the panel should show it.
 */
export function isPhysicalDisk(row) {
  const type = typeof row?.type === 'string' ? row.type.toLowerCase() : '';
  if (VIRTUAL_FS_TYPES.has(type)) return false;
  const mount = typeof row?.mount === 'string' ? row.mount : '';
  if (mount.startsWith('/sys') || mount.startsWith('/proc') || mount.startsWith('/dev')) return false;
  if (mount.startsWith('/snap') || mount.startsWith('/var/lib/docker')) return false;
  const fs = typeof row?.fs === 'string' ? row.fs : '';
  if (fs === '' || fs === 'none') return false;
  return true;
}

/**
 * Parse a page size out of the binary `/proc/self/auxv` table (`AT_PAGESZ` = 6).
 * This is exact, unlike deriving it from RSS counters, and costs one read.
 * @param {Buffer|Uint8Array} buffer - Raw auxv bytes.
 * @returns {number|null} the page size in bytes, or null when not found.
 */
export function parseAuxvPageSize(buffer) {
  if (buffer === undefined || buffer === null || typeof buffer.length !== 'number') return null;
  const entry = buffer.length % 16 === 0 ? 16 : 8;
  const word = entry / 2;
  for (let offset = 0; offset + entry <= buffer.length; offset += entry) {
    const type = word === 8
      ? Number(buffer.readBigUInt64LE(offset))
      : buffer.readUInt32LE(offset);
    const value = word === 8
      ? Number(buffer.readBigUInt64LE(offset + word))
      : buffer.readUInt32LE(offset + word);
    if (type === 6 && Number.isFinite(value) && value > 0) return value;
    if (type === 0) break;
  }
  return null;
}

/**
 * Map the single-letter `/proc/<pid>/stat` state to the API vocabulary.
 * `I` (idle kernel thread) reads as sleeping, `X` (dead) as unknown.
 * @param {string} state - Raw state character.
 * @returns {'running'|'sleeping'|'blocked'|'stopped'|'zombie'|'unknown'} mapped state.
 */
export function mapProcessState(state) {
  switch (state) {
    case 'R': return 'running';
    case 'S':
    case 'I': return 'sleeping';
    case 'D':
    case 'W': return 'blocked';
    case 'T':
    case 't': return 'stopped';
    case 'Z': return 'zombie';
    default: return 'unknown';
  }
}

/**
 * Parse one `/proc/<pid>/stat` line.
 *
 * `comm` is wrapped in parentheses and may itself contain spaces and
 * parentheses (`(Web Content)`, `(pool-/usr/lib)`, …), so the only safe split
 * is the first `(` and the last `)`; everything after that is positional.
 * @param {string} text - One stat line.
 * @param {number} [fallbackPid] - Pid to use when the leading number is unreadable.
 * @returns {null|{ pid: number, comm: string, state: string, ppid: number, ttyNr: number,
 *   utime: number, stime: number, priority: number, nice: number, threads: number,
 *   starttime: number, rss: number }} the parsed fields.
 */
export function parseProcStat(text, fallbackPid) {
  if (typeof text !== 'string' || text === '') return null;
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const head = Number.parseInt(text.slice(0, open).trim(), 10);
  const pid = Number.isInteger(head) ? head : fallbackPid;
  const comm = text.slice(open + 1, close);
  const rest = text.slice(close + 1).trim().split(/\s+/u);
  if (rest.length < 22) return null;
  const int = (index) => {
    const value = Number.parseInt(rest[index], 10);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    pid: Number.isInteger(pid) ? pid : 0,
    comm,
    state: rest[0] ?? '?',
    ppid: int(1),
    ttyNr: int(4),
    utime: int(11),
    stime: int(12),
    priority: int(15),
    nice: int(16),
    threads: int(17),
    starttime: int(19),
    rss: int(21),
  };
}

/**
 * Extract the real uid from `/proc/<pid>/status` (`Uid:\treal\teffective\tsaved\tfs`).
 * @param {string} text - Status file contents.
 * @returns {number|null} the real uid, or null.
 */
export function parseProcStatusUid(text) {
  if (typeof text !== 'string') return null;
  const match = /^Uid:\s+(\d+)/mu.exec(text);
  if (match === null) return null;
  const uid = Number.parseInt(match[1], 10);
  return Number.isFinite(uid) ? uid : null;
}

/**
 * Parse `/proc/stat` into aggregate and per-core jiffy counters.
 *
 * `total` is the sum of the first eight fields (user … steal); guest time is
 * already counted inside user/nice, so it is deliberately not added again.
 * `idle` is idle + iowait, matching what "CPU not busy" means for the panel.
 * @param {string} text - `/proc/stat` contents.
 * @returns {null|{ total: number, idle: number, user: number, nice: number,
 *   system: number, irq: number, cores: { total: number, idle: number }[] }} counters.
 */
export function parseCpuStat(text) {
  if (typeof text !== 'string' || text === '') return null;
  let aggregate = null;
  const cores = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const parts = line.trim().split(/\s+/u);
    if (parts.length < 5) continue;
    const values = parts.slice(1).map((value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    const total = values.slice(0, 8).reduce((sum, value) => sum + value, 0);
    const idle = (values[3] ?? 0) + (values[4] ?? 0);
    if (parts[0] === 'cpu') {
      aggregate = {
        total,
        idle,
        user: values[0] ?? 0,
        nice: values[1] ?? 0,
        system: values[2] ?? 0,
        irq: (values[5] ?? 0) + (values[6] ?? 0),
      };
    } else if (/^cpu\d+$/u.test(parts[0])) {
      cores.push({ total, idle });
    }
  }
  if (aggregate === null) return null;
  return { ...aggregate, cores };
}

/**
 * Parse `/proc/net/dev` into cumulative byte counters.
 * @param {string} text - `/proc/net/dev` contents.
 * @returns {{ iface: string, rx_bytes: number, tx_bytes: number }[]} one row per interface.
 */
export function parseNetDev(text) {
  if (typeof text !== 'string') return [];
  const rows = [];
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const iface = line.slice(0, colon).trim();
    if (iface === '') continue;
    const fields = line.slice(colon + 1).trim().split(/\s+/u);
    if (fields.length < 9) continue;
    const rx = Number.parseInt(fields[0], 10);
    const tx = Number.parseInt(fields[8], 10);
    rows.push({
      iface,
      rx_bytes: Number.isFinite(rx) ? rx : 0,
      tx_bytes: Number.isFinite(tx) ? tx : 0,
    });
  }
  return rows;
}

/** Whole physical block devices; partitions and device-mapper would double count. */
const WHOLE_DISK = /^(?:sd[a-z]+|hd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+|md\d+)$/u;

/**
 * Sum the whole-disk counters in `/proc/diskstats`.
 *
 * Field layout (1-based after the device name): reads completed, reads merged,
 * sectors read, ms reading, writes completed, …, ms writing. Only whole disks
 * are summed so a partition does not count its parent's I/O twice.
 * @param {string} text - `/proc/diskstats` contents.
 * @returns {{ reads: number, writes: number, readMs: number, writeMs: number }} totals.
 */
export function parseDiskstats(text) {
  const totals = { reads: 0, writes: 0, readMs: 0, writeMs: 0 };
  if (typeof text !== 'string') return totals;
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 14) continue;
    const name = fields[2];
    if (!WHOLE_DISK.test(name)) continue;
    const reads = Number.parseInt(fields[3], 10);
    const readMs = Number.parseInt(fields[6], 10);
    const writes = Number.parseInt(fields[7], 10);
    const writeMs = Number.parseInt(fields[10], 10);
    totals.reads += Number.isFinite(reads) ? reads : 0;
    totals.readMs += Number.isFinite(readMs) ? readMs : 0;
    totals.writes += Number.isFinite(writes) ? writes : 0;
    totals.writeMs += Number.isFinite(writeMs) ? writeMs : 0;
  }
  return totals;
}

/**
 * Parse `/etc/passwd` into a uid → user name map.
 * @param {string} text - `/etc/passwd` contents.
 * @returns {Map<number, string>} the mapping.
 */
export function parsePasswd(text) {
  const users = new Map();
  if (typeof text !== 'string') return users;
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length < 3) continue;
    const uid = Number.parseInt(fields[2], 10);
    if (!Number.isFinite(uid)) continue;
    users.set(uid, fields[0]);
  }
  return users;
}

/**
 * Compute a process's instantaneous CPU percentage of the whole machine.
 *
 * `totalJiffies` is the machine-wide delta over the same window (all cores),
 * so one saturated core on a four-core box reports 25 %, exactly like the
 * Windows 11 Task Manager. A missing/older baseline (new pid, or a reused pid
 * whose `starttime` changed) reports 0 instead of a bogus spike.
 * @param {{ ticks: number, starttime: number }|undefined} previous - Baseline for this pid.
 * @param {{ ticks: number, starttime: number }} current - Current counters.
 * @param {number} totalJiffies - Machine-wide jiffy delta over the window.
 * @returns {number} percentage, unrounded (callers round for JSON).
 */
export function computeProcessCpu(previous, current, totalJiffies) {
  if (previous === undefined || previous === null) return 0;
  if (!Number.isFinite(totalJiffies) || totalJiffies <= 0) return 0;
  if (previous.starttime !== current.starttime) return 0;
  const delta = current.ticks - previous.ticks;
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return (delta / totalJiffies) * 100;
}

/**
 * Derive the kernel page size from `/proc/self/auxv`.
 * @param {(path: string) => Buffer} readBuffer - Buffer reader.
 * @returns {number} the page size in bytes.
 */
export function detectPageSize(readBuffer) {
  try {
    const parsed = parseAuxvPageSize(readBuffer('/proc/self/auxv'));
    if (parsed !== null) return parsed;
  } catch {
    // fall through to the x86_64/aarch64 default
  }
  return FALLBACK_PAGE_SIZE;
}

/**
 * Build the Linux `/proc` sampler.
 *
 * Every reader is injectable so tests never touch the real filesystem:
 * `readFile(path)` returns UTF-8 text, `readBuffer(path)` returns bytes,
 * `readdir(path)` returns names. On non-Linux the sampler reports
 * `supported: false` and the metrics layer falls back to `systeminformation`.
 *
 * @param {object} [options] - Injection points.
 * @param {(path: string) => string} [options.readFile] - Text reader.
 * @param {(path: string) => Buffer} [options.readBuffer] - Binary reader.
 * @param {(path: string) => string[]} [options.readdir] - Directory reader.
 * @param {string} [options.platform] - `process.platform` override.
 * @param {number} [options.pageSize] - Page size override.
 * @returns {object} the sampler.
 */
export function createProcfs({
  readFile = (path) => readFileSync(path, 'utf8'),
  readBuffer = (path) => readFileSync(path),
  readdir = (path) => readdirSync(path),
  platform = process.platform,
  pageSize,
} = {}) {
  const supported = platform === 'linux';
  const resolvedPageSize = pageSize ?? (supported ? detectPageSize(readBuffer) : FALLBACK_PAGE_SIZE);

  /** @type {Map<number, string>|undefined} */
  let passwdCache;

  /**
   * Read `/proc/stat` counters.
   * @returns {ReturnType<typeof parseCpuStat>} counters, or null.
   */
  function readCpuStat() {
    try {
      return parseCpuStat(readFile('/proc/stat'));
    } catch {
      return null;
    }
  }

  /**
   * System uptime in seconds from `/proc/uptime`.
   * @returns {number} uptime seconds.
   */
  function readUptimeSec() {
    try {
      const value = Number.parseFloat(readFile('/proc/uptime').split(/\s+/u)[0]);
      return Number.isFinite(value) ? value : Math.round(os.uptime());
    } catch {
      return Math.round(os.uptime());
    }
  }

  /**
   * Read every process visible to this process in one pass.
   *
   * `stat` supplies identity and counters, `status` the real uid (the file is
   * also what makes a racing-exit process detectable: if it is gone we skip the
   * row), `cmdline` the full command line (empty for kernel threads).
   * @returns {object[]} raw rows.
   */
  function readProcessTable() {
    /** @type {string[]} */
    let names;
    try {
      names = readdir('/proc');
    } catch {
      return [];
    }
    const rows = [];
    for (const name of names) {
      if (!/^\d+$/u.test(name)) continue;
      const pid = Number.parseInt(name, 10);
      let stat;
      try {
        stat = parseProcStat(readFile(`/proc/${pid}/stat`), pid);
      } catch {
        continue;
      }
      if (stat === null) continue;
      let uid;
      try {
        uid = parseProcStatusUid(readFile(`/proc/${pid}/status`));
      } catch {
        continue;
      }
      let cmd = '';
      try {
        cmd = readFile(`/proc/${pid}/cmdline`).replace(/\0+/gu, ' ').trim();
      } catch {
        // The process owns no readable command line; keep the row.
      }
      rows.push({
        ...stat,
        name: stat.comm,
        uid,
        cmd,
        rssBytes: Math.max(0, stat.rss) * resolvedPageSize,
      });
    }
    return rows;
  }

  /**
   * Cumulative network byte counters per interface.
   * @returns {{ iface: string, rx_bytes: number, tx_bytes: number }[]} counters.
   */
  function readNetDev() {
    try {
      return parseNetDev(readFile('/proc/net/dev'));
    } catch {
      return [];
    }
  }

  /**
   * Cumulative whole-disk I/O counters.
   * @returns {{ reads: number, writes: number, readMs: number, writeMs: number }} counters.
   */
  function readDiskstats() {
    try {
      return parseDiskstats(readFile('/proc/diskstats'));
    } catch {
      return { reads: 0, writes: 0, readMs: 0, writeMs: 0 };
    }
  }

  /**
   * A plausible package/CPU temperature in °C, when the kernel exposes one.
   * @returns {number|null} degrees Celsius, or null.
   */
  function readTemperature() {
    for (const zone of ['thermal_zone0', 'thermal_zone1']) {
      try {
        const raw = Number.parseFloat(readFile(`/sys/class/thermal/${zone}/temp`));
        if (Number.isFinite(raw) && raw > 0) {
          const celsius = raw > 1000 ? raw / 1000 : raw;
          if (celsius > 0 && celsius < 200) return Math.round(celsius * 10) / 10;
        }
      } catch {
        // no thermal zone here
      }
    }
    return null;
  }

  /**
   * Operational state of one interface, for the network table.
   * @param {string} iface - Interface name.
   * @returns {string|null} e.g. `up`, or null.
   */
  function readOperstate(iface) {
    try {
      const value = readFile(`/sys/class/net/${iface}/operstate`).trim();
      return value === '' ? null : value;
    } catch {
      return null;
    }
  }

  /**
   * Read the identity needed by the kill guard.
   * Throws the underlying `ENOENT` when the pid is gone, which the API maps to
   * `no-such-process`.
   * @param {number} pid - Process id.
   * @returns {{ starttime: number, uid: number|null, comm: string }} identity.
   */
  function readProcessIdentity(pid) {
    const stat = parseProcStat(readFile(`/proc/${pid}/stat`), pid);
    if (stat === null) throw Object.assign(new Error(`cannot parse /proc/${pid}/stat`), { code: 'ENOENT' });
    let uid = null;
    try {
      uid = parseProcStatusUid(readFile(`/proc/${pid}/status`));
    } catch {
      // identity is still usable for the start-time check
    }
    return { starttime: stat.starttime, uid, comm: stat.comm };
  }

  /**
   * uid → user name, read once from `/etc/passwd`.
   * @returns {Map<number, string>} the mapping.
   */
  function readPasswd() {
    if (passwdCache !== undefined) return passwdCache;
    try {
      passwdCache = parsePasswd(readFile('/etc/passwd'));
    } catch {
      passwdCache = new Map();
    }
    return passwdCache;
  }

  return {
    supported,
    pageSize: resolvedPageSize,
    readCpuStat,
    readUptimeSec,
    readProcessTable,
    readNetDev,
    readDiskstats,
    readTemperature,
    readOperstate,
    readProcessIdentity,
    readPasswd,
  };
}
