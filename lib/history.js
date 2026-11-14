/**
 * Per-process-name application history for the Task Manager panel.
 *
 * The Host has no durable state and no background timer, so "app history" is
 * accumulated in memory from the snapshots it actually serves: every fresh
 * sample is folded into one bucket per process name, adding the CPU time that
 * sample accounts for and keeping the peak resident set. This makes the 应用历史
 * page real data (as the contract requires) while keeping an idle panel free.
 *
 * The table is bounded: once `maxEntries` names are tracked, the least
 * recently seen name is evicted, so a machine that churns through short-lived
 * processes cannot grow the map without limit. All numbers are derived from
 * process rows, never from the clock alone, so tests can drive it deterministically.
 *
 * @module @ds-hu/dsh-task-manager/lib/history
 */

/** Default cap on tracked process names. */
export const DEFAULT_MAX_ENTRIES = 500;

/** Longest interval credited to one fold, so a long idle gap cannot inflate CPU time. */
export const MAX_FOLD_SECONDS = 30;

/**
 * Round to one decimal place.
 * @param {number} value - Raw number.
 * @returns {number} rounded number.
 */
function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Build the history accumulator.
 *
 * @param {object} [options] - Options.
 * @param {number} [options.since] - Epoch ms the accumulation started (plugin start).
 * @param {number} [options.maxEntries] - Cap on distinct process names.
 * @param {() => number} [options.now] - Clock, injectable for tests.
 * @returns {{ fold: (processes: object[], at?: number) => void,
 *   view: (at?: number) => Record<string, unknown>, size: () => number,
 *   reset: () => void }} the accumulator.
 */
export function createHistory({ since = Date.now(), maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
  /** @type {Map<string, { name: string, cpuSeconds: number, peakMemBytes: number, lastSeen: number, samples: number }>} */
  const apps = new Map();
  /** Epoch ms of the previous fold, or null before the first. */
  let lastFoldAt = null;

  /**
   * Drop the least recently seen bucket to stay under the cap.
   * @returns {void}
   */
  function evictOldest() {
    let oldestKey;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, entry] of apps) {
      if (entry.lastSeen < oldestSeen) {
        oldestSeen = entry.lastSeen;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) apps.delete(oldestKey);
  }

  /**
   * Fold one snapshot's process rows into the per-name totals.
   *
   * `cpu` in a row is a percentage of the whole machine, so CPU seconds are
   * `cpu / 100 * elapsedSeconds`. The elapsed time is the gap between folds,
   * capped at {@link MAX_FOLD_SECONDS}; the first fold credits no CPU time
   * because the row percentages it sees are usually the zero baseline.
   *
   * @param {object[]} processes - Rows from the served snapshot.
   * @param {number} [at] - Epoch ms of this snapshot.
   * @returns {void}
   */
  function fold(processes, at = now()) {
    if (!Array.isArray(processes)) {
      lastFoldAt = at;
      return;
    }
    const elapsed = lastFoldAt === null ? 0 : Math.min(Math.max((at - lastFoldAt) / 1000, 0), MAX_FOLD_SECONDS);
    for (const row of processes) {
      const name = typeof row?.name === 'string' && row.name !== '' ? row.name : 'unknown';
      let entry = apps.get(name);
      if (entry === undefined) {
        if (apps.size >= maxEntries) evictOldest();
        entry = { name, cpuSeconds: 0, peakMemBytes: 0, lastSeen: at, samples: 0 };
        apps.set(name, entry);
      }
      const cpu = Number(row?.cpu);
      if (Number.isFinite(cpu) && cpu > 0) entry.cpuSeconds += (cpu / 100) * elapsed;
      const mem = Number(row?.memBytes);
      if (Number.isFinite(mem) && mem > entry.peakMemBytes) entry.peakMemBytes = mem;
      entry.lastSeen = at;
      entry.samples += 1;
    }
    lastFoldAt = at;
  }

  /**
   * The `/api/history` payload.
   * @param {number} [at] - Epoch ms to stamp the response with.
   * @returns {{ ok: true, ts: number, since: number, apps: object[] }} the view.
   */
  function view(at = now()) {
    const rows = [...apps.values()]
      .map((entry) => ({
        name: entry.name,
        cpuSeconds: round1(entry.cpuSeconds),
        peakMemBytes: Math.round(entry.peakMemBytes),
        lastSeen: entry.lastSeen,
        samples: entry.samples,
      }))
      .sort((a, b) => b.cpuSeconds - a.cpuSeconds || b.peakMemBytes - a.peakMemBytes || a.name.localeCompare(b.name));
    return { ok: true, ts: at, since, apps: rows };
  }

  /** @returns {number} how many names are tracked. */
  function size() {
    return apps.size;
  }

  /** Clear all accumulated history. @returns {void} */
  function reset() {
    apps.clear();
    lastFoldAt = null;
  }

  return { fold, view, size, reset };
}
