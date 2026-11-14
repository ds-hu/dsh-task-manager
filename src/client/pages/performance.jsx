/**
 * Performance page: resource cards with sparklines, the large canvas graph with
 * a 60-point ring buffer, the optional per-logical-processor grid, and the
 * three-column statistics block for CPU / memory / disk / network / GPU.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { HISTORY_POINTS } from '../data.js';
import { format } from '../i18n.js';
import { PageHeader } from '../shell.jsx';
import { EmptyState, ErrorState } from '../ui.jsx';

/** Canvas palette, keyed by the host colour scheme (never read from the DOM). */
const PALETTE = {
  light: {
    line: '#3b82f6',
    fillTop: 'rgba(59, 130, 246, 0.16)',
    fillBottom: 'rgba(59, 130, 246, 0.02)',
    grid: 'rgba(0, 0, 0, 0.07)',
  },
  dark: {
    line: '#4cc2ff',
    fillTop: 'rgba(76, 194, 255, 0.16)',
    fillBottom: 'rgba(76, 194, 255, 0.02)',
    grid: 'rgba(255, 255, 255, 0.08)',
  },
};

/**
 * Paint one graph onto a canvas with devicePixelRatio scaling.
 * @param {HTMLCanvasElement | null} canvas - target.
 * @param {number[]} points - ring buffer, oldest first.
 * @param {number} max - y-axis maximum.
 * @param {'light' | 'dark'} scheme - colour scheme.
 * @param {boolean} [gridOnly] - draw only the 10x10 grid.
 * @param {boolean} [showGrid] - whether to draw the grid at all.
 * @returns {void}
 */
function drawGraph(canvas, points, max, scheme, gridOnly, showGrid = true) {
  if (!canvas || typeof window === 'undefined') return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const palette = PALETTE[scheme] ?? PALETTE.light;
  context.strokeStyle = palette.grid;
  context.lineWidth = 1;
  for (let index = 1; showGrid && index < 10; index += 1) {
    const x = Math.round((width * index) / 10) + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    const y = Math.round((height * index) / 10) + 0.5;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  if (gridOnly || points.length === 0) return;

  const yMax = Math.max(1, max);
  const span = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((value, index) => {
    const x = index * span;
    const clamped = Math.min(yMax, Math.max(0, value));
    const y = height - (clamped / yMax) * height;
    return [x, y];
  });

  context.beginPath();
  context.moveTo(coords[0][0], height);
  for (const [x, y] of coords) context.lineTo(x, y);
  context.lineTo(coords[coords.length - 1][0], height);
  context.closePath();
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.fillTop);
  gradient.addColorStop(1, palette.fillBottom);
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  context.moveTo(coords[0][0], coords[0][1]);
  for (let index = 1; index < coords.length; index += 1) context.lineTo(coords[index][0], coords[index][1]);
  context.strokeStyle = palette.line;
  context.lineWidth = 1.5;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.stroke();
}

/**
 * Resize-aware canvas graph.
 * @param {{points: number[], max: number, scheme: string, version: number, ariaLabel: string, testid?: string, className?: string, gridOnly?: boolean, title?: string}} props - props.
 * @returns {any} the canvas.
 */
function GraphCanvas(props) {
  const ref = useRef(null);
  const [, setResize] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setResize((value) => value + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    drawGraph(ref.current, props.points, props.max, props.scheme, props.gridOnly === true, props.showGrid !== false);
  }, [props.points, props.max, props.scheme, props.version, props.gridOnly, props.showGrid]);

  return (
    <canvas
      ref={ref}
      className={props.className ?? 'tm-graph'}
      role="img"
      aria-label={props.ariaLabel}
      data-testid={props.testid}
      title={props.title}
    />
  );
}

/**
 * Card sparkline (60x30, no grid).
 * @param {{points: number[], max: number, scheme: string, version: number, ariaLabel: string}} props - props.
 * @returns {any} the canvas.
 */
function Sparkline(props) {
  return (
    <GraphCanvas
      points={props.points}
      max={props.max}
      scheme={props.scheme}
      version={props.version}
      ariaLabel={props.ariaLabel}
      className="tm-perf-card-canvas"
      showGrid={false}
    />
  );
}

/**
 * Build every resource card + detail descriptor from the two payloads.
 * @param {any} snapshot - snapshot payload.
 * @param {any} system - system payload.
 * @param {any} t - translator.
 * @param {any} fmt - formatters.
 * @param {any} history - ring buffers.
 * @returns {any[]} resources.
 */
function buildResources(snapshot, system, t, fmt, history) {
  const cpu = snapshot?.cpu ?? {};
  const mem = snapshot?.mem ?? {};
  const diskIO = snapshot?.diskIO ?? {};
  const disk = Array.isArray(snapshot?.disks) ? snapshot.disks[0] : undefined;
  const network = snapshot?.network ?? {};
  const iface = Array.isArray(network.ifaces) ? network.ifaces.find((entry) => entry.operstate === 'up') ?? network.ifaces[0] : undefined;
  const info = system?.cpu ?? {};
  const controllers = Array.isArray(system?.graphics?.controllers) ? system.graphics.controllers : [];
  const netLabel = iface?.type === 'wireless' ? t('perf.wifi') : t('perf.network');
  const netMax = Math.max(8, history.netMax);

  const resources = [
    {
      key: 'cpu',
      testid: 'tm-perf-cpu',
      label: t('perf.cpu'),
      sub: `${fmt.percentInt(cpu.load)} ${fmt.ghz(info.speedGHz)}`,
      title: t('perf.cpu'),
      model: [info.manufacturer, info.brand].filter(Boolean).join(' '),
      caption: t('perf.utilization'),
      topLabel: '100%',
      max: 100,
      series: history.cpu,
      ariaLabel: t('perf.graphLabel'),
      stats: [
        { label: t('perf.stats.utilization'), value: fmt.percent(cpu.load) },
        { label: t('perf.stats.speed'), value: fmt.ghz(info.speedGHz) },
        { label: t('perf.stats.processes'), value: fmt.integer(cpu.processCount) },
        { label: t('perf.stats.threads'), value: fmt.integer(cpu.threadCount) },
        { label: t('perf.stats.handles'), value: fmt.dash() },
        { label: t('perf.stats.uptime'), value: fmt.uptime(cpu.uptimeSec) },
        { label: t('perf.stats.baseSpeed'), value: fmt.ghz(info.speedGHz) },
        { label: t('perf.stats.sockets'), value: fmt.dash() },
        { label: t('perf.stats.cores'), value: fmt.integer(info.physicalCores) },
        { label: t('perf.stats.logical'), value: fmt.integer(info.cores) },
        { label: t('perf.stats.virtualization'), value: fmt.dash() },
        { label: t('perf.stats.l1'), value: fmt.kilobytes(info.cache?.l1d) },
        { label: t('perf.stats.l2'), value: fmt.kilobytes(info.cache?.l2) },
        { label: t('perf.stats.l3'), value: fmt.kilobytes(info.cache?.l3) },
      ],
    },
    {
      key: 'mem',
      testid: 'tm-perf-mem',
      label: t('perf.memory'),
      sub: fmt.memoryPair(mem.used, mem.total, mem.usedPercent),
      title: t('perf.memory'),
      model: '',
      caption: t('perf.utilization'),
      topLabel: '100%',
      max: 100,
      series: history.mem,
      ariaLabel: t('perf.graphLabel'),
      stats: [
        { label: t('perf.stats.inUse'), value: fmt.memory(mem.used) },
        { label: t('perf.stats.available'), value: fmt.memory(mem.available) },
        {
          label: t('perf.stats.committed'),
          value: fmt.memoryPair((mem.used ?? 0) + (mem.swapUsed ?? 0), (mem.total ?? 0) + (mem.swapTotal ?? 0)),
        },
        { label: t('perf.stats.cached'), value: fmt.memory(mem.cached) },
        { label: t('perf.stats.pagedPool'), value: fmt.dash() },
        { label: t('perf.stats.nonPagedPool'), value: fmt.dash() },
      ],
    },
    {
      key: 'disk',
      testid: 'tm-perf-disk',
      label: `${t('perf.disk')} 0`,
      sub: fmt.percentInt(diskIO.tWaitPercent),
      title: format(t('perf.diskTitle'), { index: 0, mount: disk?.mount ?? fmt.dash() }),
      model: disk?.type ?? '',
      caption: t('perf.utilization'),
      topLabel: '100%',
      max: 100,
      series: history.disk,
      ariaLabel: t('perf.graphLabel'),
      stats: [
        { label: t('perf.stats.activeTime'), value: fmt.percent(diskIO.tWaitPercent) },
        { label: t('perf.stats.avgResponse'), value: fmt.dash() },
        { label: t('perf.stats.readSpeed'), value: fmt.diskRate(diskIO.rIO_sec) },
        { label: t('perf.stats.writeSpeed'), value: fmt.diskRate(diskIO.wIO_sec) },
        { label: t('perf.stats.capacity'), value: fmt.capacity(disk?.size) },
        { label: t('perf.stats.type'), value: disk?.type ?? fmt.dash() },
      ],
    },
    {
      key: 'net',
      testid: 'tm-perf-net',
      label: netLabel,
      sub: `↓ ${fmt.mbpsShort(network.total?.rx_sec)} ↑ ${fmt.mbpsShort(network.total?.tx_sec)} ${t('unit.mbps')}`,
      title: netLabel,
      model: iface?.ifaceName ?? iface?.iface ?? '',
      caption: t('perf.utilization'),
      topLabel: `${fmt.integer(netMax)} ${t('unit.mbps')}`,
      max: netMax,
      series: history.net,
      ariaLabel: t('perf.graphLabel'),
      stats: [
        { label: t('perf.stats.send'), value: fmt.mbps(network.total?.tx_sec) },
        { label: t('perf.stats.receive'), value: fmt.mbps(network.total?.rx_sec) },
        { label: t('perf.stats.adapter'), value: iface?.ifaceName ?? iface?.iface ?? fmt.dash() },
        {
          label: t('perf.stats.connection'),
          value: iface?.type === 'wired' ? t('perf.conn.wired') : iface?.type === 'wireless' ? t('perf.conn.wireless') : fmt.dash(),
        },
        { label: t('perf.stats.ipv4'), value: iface?.ip4 ?? fmt.dash() },
        {
          label: t('perf.stats.linkSpeed'),
          value: typeof iface?.speed === 'number' ? `${fmt.integer(iface.speed)} ${t('unit.mbps')}` : fmt.dash(),
        },
      ],
    },
  ];

  controllers.forEach((controller, index) => {
    resources.push({
      key: `gpu${index}`,
      testid: `tm-perf-gpu-${index}`,
      label: `GPU ${index}`,
      sub: controller?.model ?? '',
      title: format(t('perf.gpuTitle'), { index }),
      model: [controller?.vendor, controller?.model].filter(Boolean).join(' '),
      caption: t('perf.utilization'),
      topLabel: fmt.dash(),
      max: 100,
      series: [],
      ariaLabel: t('perf.graphLabel'),
      stats: [
        { label: t('perf.stats.model'), value: controller?.model ?? fmt.dash() },
        { label: t('perf.stats.vendor'), value: controller?.vendor ?? fmt.dash() },
        { label: t('perf.stats.vram'), value: controller?.vram ? fmt.capacity(controller.vram) : fmt.dash() },
      ],
    });
  });

  return resources;
}

/**
 * Performance page.
 * @param {any} props - page props.
 * @returns {any} the page.
 */
export function PerformancePage(props) {
  const { t, fmt, snapshot, system, scheme, history, loading, error } = props;
  const [selectedKey, setSelectedKey] = useState('cpu');
  const [showLogical, setShowLogical] = useState(false);

  const resources = useMemo(
    () => buildResources(snapshot, system, t, fmt, history),
    [snapshot, system, t, fmt, history],
  );

  const selected = resources.find((resource) => resource.key === selectedKey) ?? resources[0];
  const cores = Array.isArray(history.cores) ? history.cores : [];

  if (loading && snapshot === null) {
    return (
      <div className="tm-page">
        <PageHeader title={t('title.performance')} />
        <EmptyState spinner title={t('empty.loading')} />
      </div>
    );
  }

  if (error !== null && snapshot === null) {
    return (
      <div className="tm-page">
        <PageHeader title={t('title.performance')} />
        <ErrorState
          title={t('empty.error')}
          detail={error.message}
          retryLabel={t('action.retry')}
          onRetry={props.onRefresh}
        />
      </div>
    );
  }

  return (
    <div className="tm-page">
      <PageHeader title={t('title.performance')} />
      <div className="tm-page-body">
        <div className="tm-perf">
          <div className="tm-perf-cards" role="tablist" aria-label={t('title.performance')}>
            {resources.map((resource) => (
              <button
                type="button"
                key={resource.key}
                role="tab"
                aria-selected={resource.key === selected.key}
                aria-current={resource.key === selected.key ? 'true' : undefined}
                className="tm-perf-card"
                data-testid={resource.testid}
                onClick={() => setSelectedKey(resource.key)}
              >
                <div className="tm-perf-card-top">
                  <Sparkline
                    points={resource.series}
                    max={resource.max}
                    scheme={scheme}
                    version={history.version}
                    ariaLabel={resource.label}
                  />
                  <span className="tm-perf-card-text">
                    <span className="tm-perf-card-label">{resource.label}</span>
                    <span className="tm-perf-card-sub">{resource.sub}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="tm-perf-detail">
            <div className="tm-perf-head">
              <h2 className="tm-perf-title">{selected.title}</h2>
              <span className="tm-perf-model">{selected.model}</span>
            </div>
            <div className="tm-perf-caption">
              <span>{selected.caption}</span>
              <span>{selected.topLabel}</span>
            </div>
            <div
              className="tm-graph-wrap"
              onContextMenu={(event) => {
                event.preventDefault();
                setShowLogical((value) => !value);
              }}
              title={t('perf.showLogical')}
            >
              <GraphCanvas
                points={selected.series}
                max={selected.max}
                scheme={scheme}
                version={history.version}
                ariaLabel={selected.ariaLabel}
                testid="tm-graph"
                gridOnly={selected.series.length === 0}
              />
            </div>
            <div className="tm-graph-labels">
              <span>{t('perf.60s')}</span>
              <span>{t('perf.0')}</span>
            </div>

            {showLogical && cores.length > 0 ? (
              <div className="tm-logical">
                <div className="tm-logical-title">{t('perf.showLogical')}</div>
                <div className="tm-logical-grid">
                  {cores.map((series, index) => (
                    <div className="tm-logical-item" key={index}>
                      <GraphCanvas
                        points={series}
                        max={100}
                        scheme={scheme}
                        version={history.version}
                        ariaLabel={format(t('perf.coreLabel'), { index: index + 1 })}
                        className="tm-logical-canvas"
                        showGrid={false}
                      />
                      <span className="tm-logical-label">{format(t('perf.coreLabel'), { index: index + 1 })}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="tm-stats">
              {selected.stats.map((stat) => (
                <div className="tm-stat" key={stat.label}>
                  <span className="tm-stat-label">{stat.label}</span>
                  <span className="tm-stat-value">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
