/**
 * The table pages: App history, Startup apps, Users, Details and Services.
 * Every table is a plain CSS grid with sticky header, memoized rows and a
 * search field where the spec asks for one.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProcessGlyph } from '../icons.jsx';
import { PageHeader } from '../shell.jsx';
import { EmptyState, ErrorState, HeaderCell, SearchField, SortHeader } from '../ui.jsx';

const KNOWN_STATES = new Set(['running', 'sleeping', 'blocked', 'stopped', 'zombie', 'unknown']);

/**
 * @param {string} state - process state.
 * @param {any} t - translator.
 * @returns {string} localized state.
 */
function stateLabel(state, t) {
  return t(`state.${KNOWN_STATES.has(state) ? state : 'unknown'}`);
}

/**
 * Loading state for a whole page.
 * @param {{title: string, t: any}} props - props.
 * @returns {any} the page.
 */
function LoadingPage(props) {
  return (
    <div className="tm-page">
      <PageHeader title={props.title} />
      <EmptyState spinner title={props.t('empty.loading')} />
    </div>
  );
}

/**
 * Error state for a whole page.
 * @param {{title: string, t: any, error: any, onRetry: () => void}} props - props.
 * @returns {any} the page.
 */
function ErrorPage(props) {
  return (
    <div className="tm-page">
      <PageHeader title={props.title} />
      <ErrorState
        title={props.t('empty.error')}
        detail={props.error?.message}
        retryLabel={props.t('action.retry')}
        onRetry={props.onRetry}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App history                                                         */
/* ------------------------------------------------------------------ */

/**
 * App history page.
 * @param {any} props - page props.
 * @returns {any} the page.
 */
export function AppHistoryPage(props) {
  const { t, fmt, history, loading, error } = props;
  const apps = Array.isArray(history?.apps) ? history.apps : [];
  const collecting = apps.length === 0 || apps.every((app) => (app.samples ?? 0) < 2);

  return (
    <div className="tm-page">
      <PageHeader title={t('title.appHistory')} />
      <div className="tm-page-body">
        <div className="tm-scroll" data-testid="tm-app-history-table">
          {collecting ? (
            <EmptyState spinner title={t('empty.appHistory')} />
          ) : (
            <div className="tm-table" role="table" aria-label={t('title.appHistory')}>
              <div className="tm-table-header tm-grid-history" role="row">
                <HeaderCell label={t('history.name')} />
                <HeaderCell label={t('history.cpuTime')} numeric />
                <HeaderCell label={t('history.network')} numeric />
                <HeaderCell label={t('history.peakMemory')} numeric />
                <HeaderCell label={t('history.lastSeen')} numeric />
              </div>
              {apps.map((app) => (
                <div className="tm-table-row tm-grid-history" role="row" key={app.name}>
                  <div className="tm-cell tm-cell-name" role="cell">
                    <span className="tm-cell-icon" aria-hidden="true" style={{ color: 'var(--tm-text-secondary)' }}>
                      <ProcessGlyph size={16} />
                    </span>
                    <span className="tm-cell-name-text">{app.name}</span>
                  </div>
                  <div className="tm-cell tm-cell-num" role="cell">
                    {fmt.cpuTime(app.cpuSeconds)}
                  </div>
                  <div className="tm-cell tm-cell-num" role="cell">
                    {fmt.dash()}
                  </div>
                  <div className="tm-cell tm-cell-num" role="cell">
                    {fmt.memory(app.peakMemBytes)}
                  </div>
                  <div className="tm-cell tm-cell-num" role="cell">
                    {fmt.dateTime(app.lastSeen)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="tm-footnote">{t('history.note')}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Startup apps                                                        */
/* ------------------------------------------------------------------ */

const IMPACT_KEYS = { low: 'startup.impact.low', medium: 'startup.impact.medium', high: 'startup.impact.high' };

/**
 * Startup apps page (read-only).
 * @param {any} props - page props.
 * @returns {any} the page.
 */
export function StartupPage(props) {
  const { t, startup, loading, error } = props;
  const entries = Array.isArray(startup?.entries) ? startup.entries : [];

  if (loading && startup === null) return <LoadingPage title={t('title.startup')} t={t} />;
  if (error !== null && startup === null) {
    return <ErrorPage title={t('title.startup')} t={t} error={error} onRetry={props.onRefresh} />;
  }

  return (
    <div className="tm-page">
      <PageHeader title={t('title.startup')} />
      <div className="tm-page-body">
        <div className="tm-scroll" data-testid="tm-startup-table">
          {entries.length === 0 ? (
            <EmptyState title={t('empty.startup')} />
          ) : (
            <div className="tm-table" role="table" aria-label={t('title.startup')}>
              <div className="tm-table-header tm-grid-startup" role="row">
                <HeaderCell label={t('col.name')} />
                <HeaderCell label={t('startup.publisherPath')} />
                <HeaderCell label={t('col.status')} />
                <HeaderCell label={t('startup.impact')} />
              </div>
              {entries.map((entry, index) => (
                <div className="tm-table-row tm-grid-startup" role="row" key={`${entry.name}-${index}`}>
                  <div className="tm-cell tm-cell-name" role="cell">
                    <span className="tm-cell-icon" aria-hidden="true" style={{ color: 'var(--tm-text-secondary)' }}>
                      <ProcessGlyph size={16} />
                    </span>
                    <span className="tm-cell-name-text">{entry.name}</span>
                  </div>
                  <div className="tm-cell" role="cell" title={entry.path}>
                    {entry.path ?? '—'}
                  </div>
                  <div className="tm-cell tm-cell-status" role="cell">
                    {entry.enabled === true ? t('startup.enabled') : t('startup.disabled')}
                  </div>
                  <div className="tm-cell tm-cell-status" role="cell">
                    {IMPACT_KEYS[entry.impact] !== undefined ? t(IMPACT_KEYS[entry.impact]) : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="tm-footnote">{t('startup.note')}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

/**
 * Map a systeminformation startmode to a dictionary key.
 * @param {string | undefined} startmode - start mode.
 * @returns {string} dictionary key.
 */
function startModeKey(startmode) {
  const value = String(startmode ?? '').toLowerCase();
  if (value === '') return null;
  if (value === 'enabled' || value === 'enabled-runtime' || value === 'auto' || value === 'automatic') return 'services.auto';
  if (value === 'masked') return 'services.disabled';
  // static / indirect / generated / alias are unit-file states, not "enabled"
  // or "disabled": Win11 would call these Manual.
  return 'services.manual';
}

/**
 * Services page (read-only).
 * @param {any} props - page props.
 * @returns {any} the page.
 */
export function ServicesPage(props) {
  const { t, fmt, services, loading, error } = props;
  const [query, setQuery] = useState('');
  const entries = Array.isArray(services?.services) ? services.services : [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter(
      (entry) =>
        String(entry.name ?? '').toLowerCase().includes(needle) ||
        String(entry.displayName ?? '').toLowerCase().includes(needle),
    );
  }, [entries, query]);

  if (loading && services === null) return <LoadingPage title={t('title.services')} t={t} />;
  if (error !== null && services === null) {
    return <ErrorPage title={t('title.services')} t={t} error={error} onRetry={props.onRefresh} />;
  }

  return (
    <div className="tm-page">
      <PageHeader title={t('title.services')} />
      <div className="tm-toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('services.search')}
          clearLabel={t('action.close')}
          testid="tm-search"
        />
      </div>
      <div className="tm-page-body">
        <div className="tm-scroll" data-testid="tm-services-table">
          {entries.length === 0 ? (
            <EmptyState title={t('empty.services')} />
          ) : filtered.length === 0 ? (
            <EmptyState title={t('empty.search')} />
          ) : (
            <div className="tm-table" role="table" aria-label={t('title.services')}>
              <div className="tm-table-header tm-grid-services" role="row">
                <HeaderCell label={t('col.name')} />
                <HeaderCell label={t('col.pid')} />
                <HeaderCell label={t('col.description')} />
                <HeaderCell label={t('col.status')} />
                <HeaderCell label={t('col.startType')} />
              </div>
              {filtered.map((entry) => (
                <div className="tm-table-row tm-grid-services" role="row" key={entry.name}>
                  <div className="tm-cell tm-cell-name" role="cell">
                    <span className="tm-cell-icon" aria-hidden="true" style={{ color: 'var(--tm-text-secondary)' }}>
                      <ProcessGlyph size={16} />
                    </span>
                    <span className="tm-cell-name-text">{entry.name}</span>
                  </div>
                  <div className="tm-cell" role="cell">
                    {Array.isArray(entry.pids) && entry.pids.length > 0 ? fmt.pid(entry.pids[0]) : '—'}
                  </div>
                  <div className="tm-cell" role="cell" title={entry.displayName ?? undefined}>
                    {entry.displayName ?? '—'}
                  </div>
                  <div className="tm-cell tm-cell-status" role="cell">
                    {entry.running === true ? t('state.running') : t('state.stopped')}
                  </div>
                  <div className="tm-cell tm-cell-status" role="cell">
                    {startModeKey(entry.startmode) === null ? '—' : t(startModeKey(entry.startmode))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="tm-footnote">{t('services.note')}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

/**
 * Aggregate session and process rows per user.
 * @param {any} snapshot - snapshot payload.
 * @returns {Array<{user: string, sessions: any[], cpu: number, memBytes: number, memPercent: number, processes: number}>} users.
 */
function aggregateUsers(snapshot) {
  const sessions = Array.isArray(snapshot?.users) ? snapshot.users : [];
  const processes = Array.isArray(snapshot?.processes) ? snapshot.processes : [];
  const totalMem = snapshot?.mem?.total ?? 0;
  const map = new Map();
  const sessionUsers = new Set(sessions.map((session) => (session.user === '' || session.user === undefined || session.user === null ? '—' : String(session.user))));

  const ensure = (user) => {
    const key = user === '' || user === undefined || user === null ? '—' : String(user);
    let entry = map.get(key);
    if (entry === undefined) {
      entry = { user: key, sessions: [], cpu: 0, memBytes: 0, memPercent: 0, processes: 0 };
      map.set(key, entry);
    }
    return entry;
  };

  for (const session of sessions) ensure(session.user).sessions.push(session);
  for (const process of processes) {
    const key = process.user === '' || process.user === undefined || process.user === null ? '—' : String(process.user);
    // Service accounts (uid < 1000) are not signed-in users; keep them out of
    // the Users tab unless the host reports an actual session for them.
    if (process.uid !== undefined && process.uid !== null && process.uid < 1000 && !sessionUsers.has(key)) continue;
    const entry = ensure(process.user);
    entry.cpu += Number.isFinite(process.cpu) ? process.cpu : 0;
    entry.memBytes += Number.isFinite(process.memBytes) ? process.memBytes : 0;
    entry.processes += 1;
  }

  const users = [...map.values()];
  const clamp = (value) => Math.min(100, Math.max(0, value));
  for (const entry of users) {
    // RSS is summed per process; shared pages can push a raw sum above physical
    // memory, so clamp the derived percentage into a real 0-100 range.
    entry.memPercent = totalMem > 0 ? clamp((entry.memBytes / totalMem) * 100) : 0;
    entry.cpu = clamp(entry.cpu);
  }
  users.sort((a, b) => b.sessions.length - a.sessions.length || b.cpu - a.cpu);
  return users;
}

/**
 * Users page.
 * @param {any} props - page props.
 * @returns {any} the page.
 */
export function UsersPage(props) {
  const { t, fmt, snapshot, loading, error } = props;
  const users = useMemo(() => aggregateUsers(snapshot), [snapshot]);
  const sessions = Array.isArray(snapshot?.users) ? snapshot.users : [];

  if (loading && snapshot === null) return <LoadingPage title={t('title.users')} t={t} />;
  if (error !== null && snapshot === null) {
    return <ErrorPage title={t('title.users')} t={t} error={error} onRetry={props.onRefresh} />;
  }

  return (
    <div className="tm-page">
      <PageHeader title={t('title.users')} />
      <div className="tm-page-body">
        <div className="tm-scroll">
          {users.length === 0 ? (
            <EmptyState title={t('empty.users')} />
          ) : (
            <>
              <div className="tm-users" data-testid="tm-users-list">
                {users.map((user) => (
                  <div className="tm-user-card" key={user.user}>
                    <span className="tm-user-avatar" aria-hidden="true">
                      {user.user.slice(0, 1)}
                    </span>
                    <div className="tm-user-info">
                      <span className="tm-user-name">{user.user}</span>
                      <span className="tm-user-meta">
                        {user.sessions.length > 0
                          ? user.sessions
                              .map((session) => session.ip || session.tty || '—')
                              .filter((value, index, all) => all.indexOf(value) === index)
                              .join(' · ')
                          : '—'}
                      </span>
                    </div>
                    <div className="tm-user-metrics">
                      <div className="tm-user-metric">
                        <span className="tm-user-metric-label">{t('users.sessionCount')}</span>
                        <span className="tm-user-metric-value">{fmt.integer(user.sessions.length)}</span>
                      </div>
                      <div className="tm-user-metric">
                        <span className="tm-user-metric-label">{t('users.cpuUsage')}</span>
                        <span className="tm-user-metric-value">{fmt.percent(user.cpu)}</span>
                      </div>
                      <div className="tm-user-metric">
                        <span className="tm-user-metric-label">{t('users.memUsage')}</span>
                        <span className="tm-user-metric-value">{fmt.percent(user.memPercent)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="tm-section-title">{t('users.sessions')}</div>
              <div className="tm-table" role="table" aria-label={t('users.sessions')} data-testid="tm-sessions-table">
                <div className="tm-table-header tm-grid-users" role="row">
                  <HeaderCell label={t('col.user')} />
                  <HeaderCell label={t('col.status')} />
                  <HeaderCell label={t('col.client')} />
                  <HeaderCell label={t('col.sessionType')} />
                </div>
                {sessions.length === 0 ? (
                  <EmptyState title={t('empty.users')} />
                ) : (
                  sessions.map((session, index) => {
                    const tty = String(session.tty ?? '');
                    return (
                      <div className="tm-table-row tm-grid-users" role="row" key={`${session.user}-${tty}-${index}`}>
                        <div className="tm-cell" role="cell">
                          {session.user}
                        </div>
                        <div className="tm-cell tm-cell-status" role="cell">
                          {t('users.active')}
                        </div>
                        <div className="tm-cell" role="cell">
                          {session.ip || tty || '—'}
                        </div>
                        <div className="tm-cell tm-cell-status" role="cell">
                          {tty.startsWith('pts') ? t('users.remote') : tty === '' ? '—' : t('users.console')}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Details                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {any} process - process row.
 * @param {string} key - sort key.
 * @returns {string | number} comparable value.
 */
function detailValue(process, key) {
  switch (key) {
    case 'name':
      return String(process.name ?? '').toLowerCase();
    case 'pid':
      return process.pid ?? 0;
    case 'state':
      return String(process.state ?? '');
    case 'user':
      return String(process.user ?? '').toLowerCase();
    case 'cpu':
      return process.cpu ?? 0;
    case 'memory':
      return process.memBytes ?? 0;
    case 'threads':
      return process.threads ?? 0;
    case 'priority':
      return process.priority ?? 0;
    case 'command':
      return String(process.cmd ?? '').toLowerCase();
    case 'disk':
    case 'network':
    default:
      return 0;
  }
}

/**
 * @param {any} a - process.
 * @param {any} b - process.
 * @param {{key: string, dir: 'asc' | 'desc'}} sort - sort state.
 * @returns {number} comparator.
 */
function compareDetail(a, b, sort) {
  const left = detailValue(a, sort.key);
  const right = detailValue(b, sort.key);
  let result;
  if (typeof left === 'string' || typeof right === 'string') result = String(left).localeCompare(String(right));
  else result = left - right;
  if (result === 0) result = (a.pid ?? 0) - (b.pid ?? 0);
  return sort.dir === 'asc' ? result : -result;
}

/**
 * One Details row.
 * @param {{process: any, selected: boolean, t: any, fmt: any, onSelect: (pid: number) => void, onContextMenu: (process: any, x: number, y: number) => void}} props - props.
 * @returns {any} the row.
 */
const DetailRow = memo(
  function DetailRow(props) {
    const { process, selected, t, fmt } = props;
    const ref = useRef(null);
    useEffect(() => {
      if (selected && ref.current) ref.current.scrollIntoView({ block: 'nearest' });
    }, [selected]);
    return (
      <div
        className="tm-table-row tm-grid-details"
        role="row"
        aria-selected={selected}
        ref={ref}
        data-testid="tm-detail-row"
        onClick={() => props.onSelect(process.pid)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onSelect(process.pid);
          props.onContextMenu(process, event.clientX, event.clientY);
        }}
      >
        <div className="tm-cell tm-cell-name" role="cell">
          <span className="tm-cell-icon" aria-hidden="true" style={{ color: 'var(--tm-text-secondary)' }}>
            <ProcessGlyph size={16} />
          </span>
          <span className="tm-cell-name-text">{process.name}</span>
        </div>
        <div className="tm-cell" role="cell">
          {fmt.pid(process.pid)}
        </div>
        <div className="tm-cell tm-cell-status" role="cell">
          {stateLabel(process.state, t)}
        </div>
        <div className="tm-cell" role="cell">
          {process.user ?? '—'}
        </div>
        <div className="tm-cell tm-cell-num" role="cell">
          {fmt.percent(process.cpu)}
        </div>
        <div className="tm-cell tm-cell-num" role="cell">
          {fmt.memory(process.memBytes)}
        </div>
        <div className="tm-cell tm-cell-num" role="cell">
          {fmt.diskRate(0)}
        </div>
        <div className="tm-cell tm-cell-num" role="cell">
          {fmt.mbps(0)}
        </div>
        <div className="tm-cell tm-cell-num" role="cell">
          {fmt.integer(process.threads)}
        </div>
        <div className="tm-cell tm-cell-num" role="cell">
          {fmt.integer(process.priority)}
        </div>
        <div className="tm-cell" role="cell" title={process.cmd}>
          {process.cmd ?? '—'}
        </div>
      </div>
    );
  },
  (previous, next) => {
    if (previous.selected !== next.selected || previous.t !== next.t || previous.fmt !== next.fmt) return false;
    if (previous.onSelect !== next.onSelect || previous.onContextMenu !== next.onContextMenu) return false;
    const a = previous.process;
    const b = next.process;
    return (
      a.pid === b.pid &&
      a.name === b.name &&
      a.state === b.state &&
      a.user === b.user &&
      a.cpu === b.cpu &&
      a.memBytes === b.memBytes &&
      a.threads === b.threads &&
      a.priority === b.priority &&
      a.cmd === b.cmd
    );
  },
);

/**
 * Details page: searchable, sortable full process table with horizontal scroll.
 * @param {any} props - page props.
 * @returns {any} the page.
 */
export function DetailsPage(props) {
  const { t, fmt, snapshot, loading, error, selectedPid, settings } = props;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'cpu', dir: 'desc' });

  const rows = useMemo(() => {
    const processes = Array.isArray(snapshot?.processes) ? snapshot.processes : [];
    const visible = settings.showKernelThreads ? processes : processes.filter((process) => process.isKernel !== true);
    const needle = query.trim().toLowerCase();
    const filtered =
      needle === ''
        ? visible
        : visible.filter(
            (process) =>
              String(process.name ?? '').toLowerCase().includes(needle) ||
              String(process.pid ?? '').includes(needle) ||
              String(process.user ?? '').toLowerCase().includes(needle) ||
              String(process.cmd ?? '').toLowerCase().includes(needle),
          );
    return filtered.slice().sort((a, b) => compareDetail(a, b, sort));
  }, [snapshot, settings.showKernelThreads, query, sort]);

  const onSort = useCallback((key) => {
    setSort((previous) =>
      previous.key === key
        ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' || key === 'user' || key === 'command' || key === 'state' ? 'asc' : 'desc' },
    );
  }, []);

  const onSelect = useCallback((pid) => props.onSelect(pid), [props.onSelect]);
  const onContextMenu = useCallback(
    (process, x, y) => props.onContextMenu(process, x, y),
    [props.onContextMenu],
  );

  if (loading && snapshot === null) return <LoadingPage title={t('title.details')} t={t} />;
  if (error !== null && snapshot === null) {
    return <ErrorPage title={t('title.details')} t={t} error={error} onRetry={props.onRefresh} />;
  }

  return (
    <div className="tm-page">
      <PageHeader title={t('title.details')} />
      <div className="tm-toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('details.search')}
          clearLabel={t('action.close')}
          testid="tm-search"
        />
      </div>
      <div className="tm-page-body">
        <div className="tm-scroll" data-testid="tm-details-table">
          <div className="tm-table" role="table" aria-label={t('title.details')}>
            <div className="tm-table-header tm-grid-details" role="row">
              <SortHeader label={t('col.name')} sortKey="name" sort={sort} onSort={onSort} />
              <SortHeader label={t('col.pid')} sortKey="pid" sort={sort} onSort={onSort} numeric />
              <SortHeader label={t('col.status')} sortKey="state" sort={sort} onSort={onSort} />
              <SortHeader label={t('col.user')} sortKey="user" sort={sort} onSort={onSort} />
              <SortHeader label={t('col.cpu')} sortKey="cpu" sort={sort} onSort={onSort} numeric />
              <SortHeader label={t('col.memory')} sortKey="memory" sort={sort} onSort={onSort} numeric />
              <SortHeader label={t('col.disk')} sortKey="disk" sort={sort} onSort={onSort} numeric />
              <SortHeader label={t('col.network')} sortKey="network" sort={sort} onSort={onSort} numeric />
              <SortHeader label={t('col.threads')} sortKey="threads" sort={sort} onSort={onSort} numeric />
              <SortHeader label={t('col.priority')} sortKey="priority" sort={sort} onSort={onSort} numeric />
              <SortHeader label={t('col.command')} sortKey="command" sort={sort} onSort={onSort} />
            </div>
            {rows.length === 0 ? (
              <EmptyState title={query.trim() === '' ? t('empty.processes') : t('empty.search')} />
            ) : (
              rows.map((process) => (
                <DetailRow
                  key={process.pid}
                  process={process}
                  selected={process.pid === selectedPid}
                  t={t}
                  fmt={fmt}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
