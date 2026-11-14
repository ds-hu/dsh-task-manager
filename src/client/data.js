/**
 * Data layer: the same-origin JSON client, polling hooks that respect document
 * visibility, the 60-point graph ring buffers, and localStorage-backed panel
 * preferences.
 *
 * Nothing here touches the DOM at module scope, so the bundle can be loaded in a
 * bare VM (see test/client-smoke.mjs).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const API_BASE = '/dsh-task-manager/api';
export const SETTINGS_KEY = 'dsh.task-manager.settings';
export const NAV_KEY = 'dsh.task-manager.nav';
export const HISTORY_POINTS = 60;

/** Refresh interval choices offered by the settings dialog. */
export const REFRESH_OPTIONS = [1000, 1500, 2000, 3000];

/** Defaults for every persisted setting. */
export const DEFAULT_SETTINGS = {
  refreshIntervalMs: 1500,
  showKernelThreads: false,
  compactRows: false,
};

/**
 * JSON API client. Same origin, relative base, no token.
 * @param {string} [base] - API base.
 * @returns {{ get: (path: string, signal?: AbortSignal) => Promise<any>, post: (path: string, body: unknown) => Promise<any> }} the client.
 */
export function createApi(base = API_BASE) {
  const parse = async (response) => {
    const payload = await response.json().catch(() => undefined);
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error ?? `HTTP ${response.status}`);
      error.code = payload?.code ?? `http-${response.status}`;
      error.status = response.status;
      throw error;
    }
    return payload;
  };
  return {
    get: async (path, signal) => {
      const response = await fetch(`${base}${path}`, {
        signal,
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      return parse(response);
    },
    post: async (path, body) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      return parse(response);
    },
  };
}

/**
 * Read and validate persisted settings.
 * @returns {typeof DEFAULT_SETTINGS} settings.
 */
function readSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (typeof raw !== 'string') return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      refreshIntervalMs: REFRESH_OPTIONS.includes(parsed?.refreshIntervalMs)
        ? parsed.refreshIntervalMs
        : DEFAULT_SETTINGS.refreshIntervalMs,
      showKernelThreads: typeof parsed?.showKernelThreads === 'boolean' ? parsed.showKernelThreads : DEFAULT_SETTINGS.showKernelThreads,
      compactRows: typeof parsed?.compactRows === 'boolean' ? parsed.compactRows : DEFAULT_SETTINGS.compactRows,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persisted settings plus an immediate-apply updater.
 * @returns {[typeof DEFAULT_SETTINGS, (patch: Partial<typeof DEFAULT_SETTINGS>) => void]} the tuple.
 */
export function useSettings() {
  const [settings, setSettings] = useState(readSettings);
  const update = useCallback((patch) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      try {
        globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* private mode: the setting still applies for this session */
      }
      return next;
    });
  }, []);
  return [settings, update];
}

/**
 * Persisted rail state. With no stored choice the panel starts collapsed when it
 * is narrower than 1100 px (measured after mount).
 * @returns {{ collapsed: boolean, toggle: () => void, refine: (width: number) => void }} the rail state.
 */
export function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    let stored = null;
    try {
      stored = globalThis.localStorage?.getItem(NAV_KEY);
    } catch {
      stored = null;
    }
    if (stored === 'collapsed') return true;
    if (stored === 'expanded') return false;
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 1400;
  });

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        globalThis.localStorage?.setItem(NAV_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        /* ignore storage failures */
      }
      return next;
    });
  }, []);

  const refine = useCallback((width) => {
    let stored = null;
    try {
      stored = globalThis.localStorage?.getItem(NAV_KEY);
    } catch {
      stored = null;
    }
    if (stored !== null) return;
    setCollapsed(width > 0 && width < 1100);
  }, []);

  return { collapsed, toggle, refine };
}

/**
 * Poll one endpoint while mounted and visible.
 *
 * Keeps the previous payload during a refresh (no skeleton flash), flags a slow
 * request after 400 ms for the thin progress line, pauses while the document is
 * hidden, and never schedules a timer for `intervalMs == null` (fetch-once).
 *
 * @param {(signal?: AbortSignal) => Promise<any>} fetchFn - stable fetch function.
 * @param {number | null} intervalMs - poll cadence, or null to fetch once.
 * @param {boolean} [enabled] - whether the hook is active.
 * @returns {{ data: any, error: Error | null, loading: boolean, slow: boolean, refresh: () => void }} poll state.
 */
export function usePoll(fetchFn, intervalMs, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let timer = null;
    let slowTimer = null;
    let controller = null;

    const clearTimers = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (slowTimer !== null) clearTimeout(slowTimer);
      slowTimer = null;
    };

    const schedule = () => {
      if (disposed || intervalMs === null || intervalMs === undefined) return;
      clearTimers();
      timer = setTimeout(() => {
        timer = null;
        if (typeof document === 'undefined' || document.visibilityState === 'visible') run();
      }, intervalMs);
    };

    const run = async () => {
      if (disposed) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      controller = new AbortController();
      slowTimer = setTimeout(() => {
        if (!disposed) setSlow(true);
      }, 400);
      try {
        const value = await fetchFn(controller.signal);
        if (disposed) return;
        setData(value);
        setError(null);
        setLoading(false);
      } catch (reason) {
        if (disposed || reason?.name === 'AbortError') return;
        setError(reason);
        setLoading(false);
      } finally {
        if (slowTimer !== null) clearTimeout(slowTimer);
        slowTimer = null;
        if (!disposed) setSlow(false);
      }
      schedule();
    };

    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      clearTimers();
      if (controller !== null) {
        try {
          controller.abort();
        } catch {
          /* already settled */
        }
        controller = null;
      }
    };

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (typeof document === 'undefined' || document.visibilityState === 'visible') run();

    return () => {
      disposed = true;
      clearTimers();
      if (controller !== null) {
        try {
          controller.abort();
        } catch {
          /* already settled */
        }
        controller = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchFn, intervalMs, enabled, revision]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { data, error, loading, slow, refresh };
}

/**
 * Append to a ring buffer.
 * @param {number[]} array - buffer.
 * @param {number} value - sample.
 * @returns {void}
 */
function push(array, value) {
  array.push(value);
  if (array.length > HISTORY_POINTS) array.shift();
}

/**
 * @param {unknown} value - sample.
 * @returns {number} clamped 0..100 sample.
 */
function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Fold every snapshot into the 60-point series the graphs draw.
 *
 * The returned object is a stable ref; `version` changes whenever new samples
 * were appended, so canvases can depend on a cheap scalar.
 *
 * @param {any} snapshot - `/api/snapshot` payload.
 * @returns {{ cpu: number[], mem: number[], disk: number[], net: number[], cores: number[][], netMax: number, version: number }} history.
 */
export function useHistory(snapshot) {
  const history = useRef({
    cpu: [],
    mem: [],
    disk: [],
    net: [],
    cores: [],
    netMax: 8,
    version: 0,
    ts: 0,
  });
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!snapshot || typeof snapshot !== 'object') return;
    const current = history.current;
    const ts = typeof snapshot.ts === 'number' ? snapshot.ts : 0;
    if (ts !== 0 && ts === current.ts) return;
    current.ts = ts;
    push(current.cpu, clampPercent(snapshot.cpu?.load));
    push(current.mem, clampPercent(snapshot.mem?.usedPercent));
    push(current.disk, clampPercent(snapshot.diskIO?.tWaitPercent));
    const bytesPerSec = (snapshot.network?.total?.rx_sec ?? 0) + (snapshot.network?.total?.tx_sec ?? 0);
    const mbps = Math.max(0, (bytesPerSec * 8) / 1e6);
    push(current.net, mbps);
    current.netMax = Math.max(8, ...current.net) * 1.15;
    const cores = Array.isArray(snapshot.cpu?.cores) ? snapshot.cpu.cores : [];
    current.cores = cores.map((value, index) => {
      const series = current.cores[index] ?? [];
      push(series, clampPercent(value));
      return series;
    });
    current.version += 1;
    setVersion((value) => value + 1);
  }, [snapshot]);

  return history.current;
}

/**
 * Observe the panel width and report the first measurement (used to pick the
 * default rail state when the user has not chosen one).
 * @param {{ current: HTMLElement | null }} ref - panel root ref.
 * @param {(width: number) => void} onMeasure - width callback.
 * @returns {void}
 */
export function usePanelWidth(ref, onMeasure) {
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      onMeasure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, onMeasure]);
}
