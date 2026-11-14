/**
 * Processes page: the default Win11 tab. Grouped table (Apps / Background /
 * System), expandable child rows, sortable numeric columns, shared selection,
 * right-click menu and the bottom status bar.
 */
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconChevron, ProcessGlyph } from '../icons.jsx';
import { PageHeader, StatusBar } from '../shell.jsx';
import { EmptyState, ErrorState, HeaderCell, SortHeader } from '../ui.jsx';

const GROUP_ORDER = ['app', 'background', 'system'];
const GROUP_LABELS = { app: 'group.apps', background: 'group.background', system: 'group.system' };
const KNOWN_STATES = new Set(['running', 'sleeping', 'blocked', 'stopped', 'zombie', 'unknown']);

/**
 * @param {any} process - process row.
 * @param {string} key - sort key.
 * @returns {string | number} comparable value.
 */
function sortValue(process, key) {
  switch (key) {
    case 'name':
      return String(process.name ?? '').toLowerCase();
    case 'cpu':
      return process.cpu ?? 0;
    case 'memory':
      return process.memBytes ?? 0;
    case 'disk':
      return 0;
    case 'network':
      return 0;
    default:
      return process.pid ?? 0;
  }
}

/**
 * @param {any} a - process.
 * @param {any} b - process.
 * @param {{key: string, dir: 'asc' | 'desc'}} sort - sort state.
 * @returns {number} comparator result.
 */
function compareProcess(a, b, sort) {
  const left = sortValue(a, sort.key);
  const right = sortValue(b, sort.key);
  let result;
  if (typeof left === 'string' || typeof right === 'string') {
    result = String(left).localeCompare(String(right));
  } else {
    result = left - right;
  }
  if (result === 0) result = (a.pid ?? 0) - (b.pid ?? 0);
  return sort.dir === 'asc' ? result : -result;
}

/**
 * Build the grouped, sorted, expansion-aware view model in one pass.
 * @param {any[]} processes - snapshot processes.
 * @param {{showKernelThreads: boolean, sort: {key: string, dir: 'asc' | 'desc'}, collapsedGroups: Set<string>, collapsedParents: Set<number>}} options - view options.
 * @returns {{groups: any[], visiblePids: number[], totalCount: number}} the view.
 */
function buildView(processes, options) {
  const visible = processes.filter((process) => options.showKernelThreads || process.isKernel !== true);
  const byPid = new Map();
  for (const process of visible) byPid.set(process.pid, process);

  // Resolve every process to the topmost ancestor inside the same group so no
  // row is ever dropped when a parent is itself a child (deeper trees still
  // render one indent level, like Win11).
  const rootOf = new Map();
  for (const process of visible) {
    let current = process;
    for (let guard = 0; guard < 64; guard += 1) {
      const parent = byPid.get(current.ppid);
      if (parent === undefined || parent === current || parent.group !== process.group) break;
      current = parent;
    }
    rootOf.set(process.pid, current);
  }

  const childPids = new Set();
  for (const process of visible) {
    if (rootOf.get(process.pid) !== process) childPids.add(process.pid);
  }

  const childrenOf = new Map();
  for (const process of visible) {
    if (!childPids.has(process.pid)) continue;
    const root = rootOf.get(process.pid);
    const list = childrenOf.get(root.pid) ?? [];
    list.push(process);
    childrenOf.set(root.pid, list);
  }

  const groups = GROUP_ORDER.map((key) => {
    const members = visible.filter((process) => process.group === key);
    const roots = members.filter((process) => !childPids.has(process.pid)).sort((a, b) => compareProcess(a, b, options.sort));
    const collapsed = options.collapsedGroups.has(key);
    const rows = [];
    for (const root of roots) {
      const children = (childrenOf.get(root.pid) ?? []).slice().sort((a, b) => compareProcess(a, b, options.sort));
      const expanded = !options.collapsedParents.has(root.pid);
      rows.push({ process: root, depth: 0, hasChildren: children.length > 0, expanded });
      if (expanded) {
        for (const child of children) rows.push({ process: child, depth: 1, hasChildren: false, expanded: false });
      }
    }
    let cpu = 0;
    let mem = 0;
    for (const process of members) {
      cpu += Number.isFinite(process.cpu) ? process.cpu : 0;
      mem += Number.isFinite(process.memBytes) ? process.memBytes : 0;
    }
    return {
      key,
      labelKey: GROUP_LABELS[key],
      count: members.length,
      collapsed,
      rows: collapsed ? [] : rows,
      totals: { cpu, mem },
    };
  });

  const visiblePids = [];
  for (const group of groups) {
    if (group.collapsed) continue;
    for (const row of group.rows) visiblePids.push(row.process.pid);
  }

  return { groups, visiblePids, totalCount: visible.length };
}

/**
 * One process row. Memoized on the fields it paints so a 1.5 s poll only
 * re-renders rows whose numbers actually changed.
 * @param {{row: any, selected: boolean, t: any, fmt: any, onSelect: (pid: number) => void, onContextMenu: (process: any, x: number, y: number) => void, onToggleParent: (pid: number) => void}} props - props.
 * @returns {any} the row.
 */
const ProcessRow = memo(
  function ProcessRow(props) {
    const { row, selected, t, fmt } = props;
    const process = row.process;
    const ref = useRef(null);
    const stateKey = KNOWN_STATES.has(process.state) ? process.state : 'unknown';

    useEffect(() => {
      if (selected && ref.current) ref.current.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    return (
      <div
        className="tm-table-row tm-grid-processes"
        role="row"
        aria-selected={selected}
        tabIndex={-1}
        ref={ref}
        data-testid="tm-process-row"
        data-pid={process.pid}
        onClick={() => props.onSelect(process.pid)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onSelect(process.pid);
          props.onContextMenu(process, event.clientX, event.clientY);
        }}
      >
        <div className="tm-cell tm-cell-name" role="cell">
          {row.depth > 0 ? <span className="tm-indent" aria-hidden="true" /> : null}
          {row.hasChildren ? (
            <button
              type="button"
              className="tm-chevron-btn"
              aria-label={row.expanded ? t('action.collapse') : t('action.expand')}
              aria-expanded={row.expanded}
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleParent(process.pid);
              }}
            >
              <span className="tm-chevron" data-open={row.expanded}>
                <IconChevron size={10} />
              </span>
            </button>
          ) : (
            <span className="tm-chevron-btn" aria-hidden="true" />
          )}
          <span
            className="tm-cell-icon"
            aria-hidden="true"
            style={{ color: process.group === 'app' ? 'var(--tm-accent)' : 'var(--tm-text-secondary)' }}
          >
            <ProcessGlyph size={16} />
          </span>
          <span className="tm-cell-name-text">{process.name}</span>
        </div>
        <div className="tm-cell tm-cell-status" role="cell">
          {t(`state.${stateKey}`)}
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
      </div>
    );
  },
  (previous, next) => {
    if (
      previous.selected !== next.selected ||
      previous.t !== next.t ||
      previous.fmt !== next.fmt ||
      previous.onSelect !== next.onSelect ||
      previous.onContextMenu !== next.onContextMenu ||
      previous.onToggleParent !== next.onToggleParent ||
      previous.row.depth !== next.row.depth ||
      previous.row.hasChildren !== next.row.hasChildren ||
      previous.row.expanded !== next.row.expanded
    ) {
      return false;
    }
    const a = previous.row.process;
    const b = next.row.process;
    return (
      a.pid === b.pid &&
      a.name === b.name &&
      a.state === b.state &&
      a.cpu === b.cpu &&
      a.memBytes === b.memBytes &&
      a.group === b.group
    );
  },
);

/**
 * Group header row with totals in the same columns as the rows.
 * @param {{group: any, t: any, fmt: any, onToggle: (key: string) => void}} props - props.
 * @returns {any} the row.
 */
function GroupRow(props) {
  const { group, t, fmt } = props;
  return (
    <div
      className="tm-group-row tm-grid-processes"
      role="row"
      aria-expanded={!group.collapsed}
      data-testid="tm-process-group"
      data-group={group.key}
      onClick={() => props.onToggle(group.key)}
    >
      <div className="tm-group-label" role="rowheader">
        <span className="tm-chevron" data-open={!group.collapsed} aria-hidden="true">
          <IconChevron size={11} />
        </span>
        <span className="tm-group-label-text">{`${t(group.labelKey)} (${group.count})`}</span>
      </div>
      <div className="tm-cell" role="cell" />
      <div className="tm-cell tm-cell-num" role="cell">
        {fmt.percent(group.totals.cpu)}
      </div>
      <div className="tm-cell tm-cell-num" role="cell">
        {fmt.memory(group.totals.mem)}
      </div>
      <div className="tm-cell tm-cell-num" role="cell">
        {fmt.diskRate(0)}
      </div>
      <div className="tm-cell tm-cell-num" role="cell">
        {fmt.mbps(0)}
      </div>
    </div>
  );
}

/**
 * Processes page.
 * @param {any} props - page props.
 * @returns {any} the page.
 */
export function ProcessesPage(props) {
  const { t, fmt, snapshot, loading, error, settings, selectedPid } = props;
  const [sort, setSort] = useState({ key: 'cpu', dir: 'desc' });
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [collapsedParents, setCollapsedParents] = useState(() => new Set());

  const view = useMemo(
    () =>
      buildView(snapshot?.processes ?? [], {
        showKernelThreads: settings.showKernelThreads,
        sort,
        collapsedGroups,
        collapsedParents,
      }),
    [snapshot, settings.showKernelThreads, sort, collapsedGroups, collapsedParents],
  );

  const selectedProcess = useMemo(
    () => (snapshot?.processes ?? []).find((process) => process.pid === selectedPid) ?? null,
    [snapshot, selectedPid],
  );

  const onSort = useCallback((key) => {
    setSort((previous) =>
      previous.key === key
        ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  }, []);

  const onToggleGroup = useCallback((key) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onToggleParent = useCallback((pid) => {
    setCollapsedParents((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }, []);

  const onSelect = useCallback((pid) => props.onSelect(pid), [props.onSelect]);
  const onContextMenu = useCallback(
    (process, x, y) => props.onContextMenu(process, x, y),
    [props.onContextMenu],
  );

  const onKeyDown = (event) => {
    const pids = view.visiblePids;
    if (pids.length === 0) return;
    const index = pids.indexOf(selectedPid);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = index === -1 ? (delta === 1 ? 0 : pids.length - 1) : Math.min(pids.length - 1, Math.max(0, index + delta));
      props.onSelect(pids[nextIndex]);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      props.onSelect(event.key === 'Home' ? pids[0] : pids[pids.length - 1]);
      return;
    }
    if (selectedProcess === null) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      props.onEndTask(selectedProcess);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      props.onProperties(selectedProcess);
    }
  };

  const header = <PageHeader title={t('title.processes')} />;

  if (loading && snapshot === null) {
    return (
      <div className="tm-page">
        {header}
        <EmptyState spinner title={t('empty.loading')} />
      </div>
    );
  }

  if (error !== null && snapshot === null) {
    return (
      <div className="tm-page">
        {header}
        <ErrorState
          title={t('empty.error')}
          detail={error.message}
          retryLabel={t('action.retry')}
          onRetry={props.onRefresh}
        />
      </div>
    );
  }

  const statusItems = [
    `${t('status.processes')}: ${fmt.integer(view.totalCount)}`,
    `${t('status.cpu')}: ${fmt.percentInt(snapshot?.cpu?.load)}`,
    `${t('status.memory')}: ${fmt.percentInt(snapshot?.mem?.usedPercent)}`,
    `${t('status.disk')}: ${fmt.percentInt(snapshot?.diskIO?.tWaitPercent)}`,
    `${t('status.network')}: ${fmt.mbps((snapshot?.network?.total?.rx_sec ?? 0) + (snapshot?.network?.total?.tx_sec ?? 0))}`,
  ];

  return (
    <div className="tm-page">
      {header}
      <div className="tm-page-body">
        <div
          className="tm-scroll"
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label={t('title.processes')}
          data-testid="tm-process-table"
        >
          <div className="tm-table" role="table" aria-label={t('title.processes')} aria-rowcount={view.totalCount}>
            <div className="tm-table-header tm-grid-processes" role="row">
              <SortHeader label={t('col.name')} sortKey="name" sort={sort} onSort={onSort} testid="tm-sort-name" />
              <HeaderCell label={t('col.status')} />
              <SortHeader label={t('col.cpu')} sortKey="cpu" sort={sort} onSort={onSort} numeric testid="tm-sort-cpu" />
              <SortHeader
                label={t('col.memory')}
                sortKey="memory"
                sort={sort}
                onSort={onSort}
                numeric
                testid="tm-sort-memory"
              />
              <SortHeader label={t('col.disk')} sortKey="disk" sort={sort} onSort={onSort} numeric testid="tm-sort-disk" />
              <SortHeader
                label={t('col.network')}
                sortKey="network"
                sort={sort}
                onSort={onSort}
                numeric
                testid="tm-sort-network"
              />
            </div>
            {view.totalCount === 0 ? (
              <EmptyState title={t('empty.processes')} />
            ) : (
              view.groups.map((group) => (
                <Fragment key={group.key}>
                  <GroupRow group={group} t={t} fmt={fmt} onToggle={onToggleGroup} />
                  {group.rows.map((row) => (
                    <ProcessRow
                      key={row.process.pid}
                      row={row}
                      selected={row.process.pid === selectedPid}
                      t={t}
                      fmt={fmt}
                      onSelect={onSelect}
                      onContextMenu={onContextMenu}
                      onToggleParent={onToggleParent}
                    />
                  ))}
                </Fragment>
              ))
            )}
          </div>
        </div>
        <StatusBar
          items={statusItems}
          endTaskLabel={t('action.endTask')}
          endTaskDisabled={selectedProcess === null}
          onEndTask={() => (selectedProcess === null ? undefined : props.onEndTask(selectedProcess))}
        />
      </div>
    </div>
  );
}
