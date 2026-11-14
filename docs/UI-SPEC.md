# Win11 Task Manager UI specification

The panel lives in the Host `main` slot under the key `task-manager`, and its
sidebar entry lives in `sidebar.panellist` with the same id. It must read as the
**Windows 11 (22H2+) Task Manager**, not as a generic dashboard: same left rail,
same command row, same tables, same graphs, same bottom status bar.

Reference material (not committed; readable on this machine):

- `/tmp/tm-ref/task-mgr-cpu.png` — Microsoft's Performance tab, light theme.
- `/tmp/tm-ref/task-mgr-process-detail.png` — Microsoft's Details table.
- The user's own Processes screenshot (attached to the request) shows the exact
  columns, group headers, and bottom status bar to reproduce.

## Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ [icon] 任务管理器                                  [刷新] [⋯]          │  title row 44px
├──────┬───────────────────────────────────────────────────────────────┤
│ ☰    │  Processes | Performance | ... page                           │
│ ▣ 进程│                                                               │
│ ◔ 性能│  page content, fills the rest, own scroll region              │
│ ⟲ 应用…│                                                               │
│ ⇧ 启动│                                                               │
│ 👥 用户│                                                               │
│ ≡ 详细│                                                               │
│ ⚙ 服务│                                                               │
│      │                                                               │
│ ⚙ 设置│                                                               │
└──────┴───────────────────────────────────────────────────────────────┘
```

- Root `.tm-root`: `display:flex; flex-direction:column; height:100%; min-height:0;
  overflow:hidden;` — the main slot gives it the full centre column.
- Title row: 44 px, app glyph 20 px, title 14 px/600, right-side icon buttons
  (refresh, overflow menu). Bottom border `1px solid var(--tm-divider)`.
- Body: `display:flex; flex:1; min-height:0`.
- Left rail: expanded 196 px (icon + label), collapsed 48 px (icon + tooltip).
  Default collapsed below 1100 px of panel width, expanded above. A hamburger at
  the top toggles it; persist the choice in `localStorage["dsh.task-manager.nav"]`.
  Active item: 3 px accent bar on the left, rounded 4 px tinted background,
  accent-coloured icon and label. Rail background is the sidebar fill
  (`--dsw-specific-sidebar-fill`), which keeps the panel inside the host theme.
- Content column: `flex:1; min-width:0; display:flex; flex-direction:column;`
  Page header 48 px (page title 20 px/600), then the page body scrolls.

## Palette

Define these on `.tm-root` (light) and `.tm-root[data-theme="dark"]`; the client
sets `data-theme` from `ctx.theme.getTheme().active.colorScheme` and follows
`theme/change`. Do not read the DOM for theme.

| variable | light | dark |
| --- | --- | --- |
| `--tm-bg` | `#f3f3f3` | `#202020` |
| `--tm-surface` | `#ffffff` | `#272727` |
| `--tm-surface-alt` | `#f7f7f7` | `#2d2d2d` |
| `--tm-text` | `#1b1b1b` | `#ffffff` |
| `--tm-text-secondary` | `#5c5c5c` | `#b9b9b9` |
| `--tm-divider` | `#e5e5e5` | `#3a3a3a` |
| `--tm-accent` | `#0067c0` | `#4cc2ff` |
| `--tm-accent-soft` | `#e5f1fb` | `#1d3a52` |
| `--tm-row-hover` | `#f0f0f0` | `#2f2f2f` |
| `--tm-row-selected` | `#cce4f7` | `#294a66` |
| `--tm-grid` | `#e8e8e8` | `#3a3a3a` |
| `--tm-graph` | `#3b82f6` | `#4cc2ff` |
| `--tm-graph-fill` | `rgba(59,130,246,.16)` | `rgba(76,194,255,.16)` |
| `--tm-danger` | `#c42b1c` | `#ff99a4` |

Font: `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif`.
Numbers: `font-variant-numeric: tabular-nums`. Body text 13 px, secondary 12 px,
column headers 12 px/600, page title 20 px/600, performance values 20 px/300.

## Pages

### 进程 (Processes) — default

- Page header: `进程` only. Refresh lives in the title row and `结束任务` in the
  bottom status bar (one command per surface, as in Win11 22H2).
- Table header (32 px, sticky): `名称` (flex), `状态` (88), `CPU` (76), `内存` (104),
  `磁盘` (96), `网络` (88). Numeric headers right-aligned and sortable; show ▲/▼.
  The group header rows show the group totals in the same columns, exactly like
  the user's reference (e.g. 应用 (3) with 5.4% / 1,151.0 MB / 0 / 0).
- Groups, in order: `应用`, `后台进程`, `系统进程`; header text is
  `应用 (3)`, `后台进程 (58)`, `系统进程 (12)`, 13 px/600, chevron to collapse.
- Rows: 30 px; 16 px icon, name 13 px, status 12 px secondary
  (`正在运行 / 已挂起 / 正在睡眠 / 已停止 / 僵尸`), CPU as `5.4%`, memory as
  `1,151.0 MB` (one decimal, `GB` above 10 GB), disk `0 MB/秒`, network `0 Mbps`.
  Hover tint; selection tint; keyboard focus ring.
- Child processes: rows whose parent is in the same group are nested one level
  with a 20 px indent and a disclosure chevron on the parent. Expand state is
  local component state; all three groups start expanded (Win11 default) and can
  be collapsed independently.
- Bottom status bar 38 px: `进程: 209` · `CPU: 43%` · `内存: 62%` · `磁盘: 0%` ·
  `网络: 0 Mbps` on the left, `结束任务` on the right (danger hover). The values
  come from the same snapshot as the table.
- Right-click a row: menu with `结束任务`, `复制`, `属性` (properties dialog shows
  PID, parent PID, user, command line, start time, memory, CPU).
- Killing: confirm dialog styled like Win11 (`结束 <name>?` + `结束任务`/`取消`);
  for uid-0 processes the dialog explains that system processes are protected
  unless the plugin config allows it. Show the Host's error message on failure.

### 性能 (Performance)

- Two panes: resource cards (232 px) + detail.
- Cards, in order: CPU, 内存, 磁盘 0, 以太网/Wi-Fi, GPU (only when present).
  Each 64 px: 60×30 sparkline, label 13 px, sub-label 11 px secondary
  (`43% 0.80 GHz`, `4.0/8.0 GB (62%)`, `71%`, `↓ 1.2 ↑ 0.8 Mbps`). Selected card:
  tinted background + 3 px accent bar.
- Detail: title 28 px/300 (`CPU`, `内存`, `磁盘 0 (/)`, `以太网`, `GPU 0`), model
  name right-aligned 12 px secondary; section caption `% 利用率` and `100%`.
- Canvas graph: 10×10 grid lines, 1.5 px line, gradient fill, 60-point ring buffer
  (90 s at 1.5 s). x labels `60 秒` and `0`. Height ~280 px, grows with panel.
- Stats grid below: label/value pairs in 3 columns, value 20 px/300.
  - CPU: 利用率, 速度, 进程, 线程, 句柄, 正常运行时间, 基准速度, 插槽, 内核,
    逻辑处理器, 虚拟化, L1/L2/L3 缓存.
  - 内存: 使用中, 可用, 已提交, 已缓存, 分页池, 非分页池.
  - 磁盘: 活动时间, 平均响应时间, 读取速度, 写入速度, 容量, 类型.
  - 网络: 发送, 接收, 适配器, 连接类型, IPv4, 链路速度.
- A right-click on the graph toggles `显示逻辑处理器`, which draws one mini graph
  per core under the main graph (4–16 small canvases). Optional but implement if
  time allows; default off.

### 应用历史记录 (App history)

- Table: 名称, CPU 时间, 网络, 内存峰值, 上次使用. Data from `/api/history`.
- Until at least two snapshots have been folded in, show a Win11-style empty
  state: `正在收集应用历史记录…` with a small spinner; do not fake numbers.
- Footnote 12 px secondary: `数据自本插件启动后开始累积。`

### 启动应用 (Startup apps)

- Table: 名称, 发布者/路径, 状态 (`已启用` / `已禁用`), 启动影响 (`低` / `中` / `高`).
  Data from `/api/startup`. Read-only: a note explains that enabling/disabling
  system startup entries is left to the operating system.
- Empty state when the platform exposes no entries.

### 用户 (Users)

- Cards/rows per logged-in user: round avatar with the first letter, user name,
  会话数, CPU %, 内存 %, plus the sessions table (用户, 状态, 客户端, 会话类型).
- Aggregate from `snapshot.users` and `snapshot.processes` by `user`.

### 详细信息 (Details)

- Search field (`搜索名称、PID、用户`) + table with horizontal scroll.
- Columns: 名称, PID, 状态, 用户名, CPU, 内存, 磁盘, 网络, 线程数, 优先级, 命令行.
  All sortable; 200+ rows must stay smooth (memoized rows, no layout thrash).
- Selection is shared with the Processes page (`selectedPid` lifted to the app).
- Right-click menu: `结束任务`, `复制`, `属性`.

### 服务 (Services)

- Search + table: 名称, PID, 描述, 状态 (`正在运行` / `已停止`), 启动类型
  (`自动` / `手动` / `已禁用`). Data from `/api/services`.
- Read-only with a footnote; no service control API is exposed in v1.

### 设置 (Settings dialog)

- Gear at the rail bottom opens a Win11-style dialog: 刷新间隔 (1 s / 1.5 s / 2 s /
  3 s), 显示内核线程, 紧凑行高, 关于 (version, API base, host platform).
- Persist in `localStorage["dsh.task-manager.settings"]`; apply immediately.
- `Esc` closes, focus is trapped, `role="dialog"` + `aria-modal="true"`.

## Shared behaviours

- Poll `/api/snapshot` on mount, every `refreshIntervalMs`, only while
  `document.visibilityState === "visible"`; fetch `/api/system` once; fetch
  `/api/services`, `/api/startup`, `/api/history` when their page mounts (and
  refresh on their own slow cadence).
- While a fetch is in flight, keep the previous data (no skeleton flash); show a
  thin top progress line only after 400 ms.
- All visible strings go through `t(key)`; ship `zh` and `en` dictionaries.
- Number formatting: `Intl.NumberFormat` with the active locale; memory one
  decimal; percentages one decimal; network in Mbps with one decimal.
- Accessibility: `role="table"`/`row`/`columnheader`/`cell`, `aria-sort`, buttons
  with `aria-label`, dialogs with `role="dialog"`, focus visible, `Esc` closes
  dialogs/menus, arrow keys move the selected process row.
- `prefers-reduced-motion: reduce` disables transitions.
- Test hooks: every interactive surface gets `data-testid`:
  `tm-root`, `tm-nav-processes`, `tm-nav-performance`, `tm-nav-app-history`,
  `tm-nav-startup`, `tm-nav-users`, `tm-nav-details`, `tm-nav-services`,
  `tm-process-table`, `tm-process-row`, `tm-process-group`, `tm-end-task`,
  `tm-status-bar`, `tm-search`, `tm-perf-cpu`, `tm-perf-mem`, `tm-perf-disk`,
  `tm-perf-net`, `tm-graph`, `tm-details-table`, `tm-services-table`,
  `tm-users-list`, `tm-startup-table`, `tm-app-history-table`, `tm-settings`,
  `tm-refresh`.

## Client module shape

`lib/client.js` is generated by `scripts/build-client.mjs` (esbuild) from
`src/client/index.jsx`. It must be one self-registering bundle:

```js
window.__ModuleLoader__.load({
  id: '@ds-hu/dsh-task-manager',
  factory(require) {
    // esbuild CJS output inlined here
    return module.exports; // { inject: ['slots','locale','theme'], apply(ctx) {} }
  },
});
```

`apply(ctx)`:

```js
ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'task-manager: dictionaries');
ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: 'task-manager', locale: NS }, App));
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'task-manager', order: 15, locale: NS,
    label: () => t('panel') }, PanelIcon));
```

`App` receives the injected `{ api, i18n, theme }` face plus the slot kit; the
icon receives `{ size, active }` and must render an 18×18 `currentColor` stroke
glyph (a monitor with a small waveform), no external image.
