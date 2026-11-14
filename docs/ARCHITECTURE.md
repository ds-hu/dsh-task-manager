# Architecture

## What this plugin is

`@ds-hu/dsh-task-manager` is a DSH **bundle**: a Host plugin plus a browser
plugin, installed into a profile like any other bundle. It adds one left-sidebar
entry (`任务管理器` / `Task Manager`) and one `main` panel that renders a Windows 11
Task Manager look-alike.

```
┌──────────────────────────── DSH Host process ────────────────────────────┐
│ lib/index.js  (apply)                                                    │
│   └─ ctx.webServer.register({ kind: 'prefix', path: '/dsh-task-manager' })│
│        └─ lib/api.js  ── on-demand JSON routes ──► lib/metrics.js         │
│                                  │                    ├─ lib/procfs.js     │
│                                  │                    └─ systeminformation │
│                                  └─ lib/history.js (in-memory fold)       │
└──────────────────────────────────────────────────────────────────────────┘
                                   ▲  same-origin fetch()
┌──────────────────────────── Browser page ────────────────────────────────┐
│ lib/client.js  (generated from src/client/**)                            │
│   ├─ sidebar.panellist  id=task-manager  → rail icon + label             │
│   └─ main               key=task-manager → Win11 panel                   │
└──────────────────────────────────────────────────────────────────────────┘
```

There is no second listener, no RPC client, no durable state and no disk write.
Uninstalling the bundle removes every trace.

## Why this monitoring library

The requirement was an existing, mature, high-performance, lightweight,
cross-platform system-monitoring library whose code can be used directly.

Candidates considered:

| library | license | stars | native deps | verdict |
| --- | --- | --- | --- | --- |
| **systeminformation** | MIT | ~26k | none | **chosen** |
| pidusage | MIT | ~600 | none | per-PID only; would need a second list library |
| ps-list | MIT | ~700 | none | process list only; no CPU/memory/disk/network |
| node-os-utils | MIT | ~1k | none | thin wrapper; no process table |
| os-utils | MIT | ~300 | none | unmaintained, CPU/memory only |

`systeminformation` is the de-facto standard: no native compilation, one
dependency, Linux/macOS/Windows, and every metric this panel needs (CPU, memory,
filesystems, disk I/O, network, services, graphics, users, processes). Its MIT
license is compatible with this package's MIT license; attribution lives in
`NOTICE` and the license text in `LICENSE`.

### The one place we do not use it directly

`systeminformation.processes()` costs roughly **600 ms** per call on the
reference 4-core N100 host: it spawns `ps -axo …` and then runs a second
`/proc/stat` + per-PID `/proc/<pid>/stat` pass. At a 1.5 s refresh that is ~40 %
of a core just to draw the table — not "lightweight".

The plugin therefore keeps `systeminformation` as the cross-platform source of
truth, and adds a **Linux fast path** (`lib/procfs.js`) that reads the same
kernel files in one pass (~10–30 ms for ~250 processes) and computes the same
numbers. On other platforms the Host falls back to
`systeminformation.processes()`, so the plugin still works, just with the
upstream cost. This is documented rather than hidden: `snapshot.sampleMs` is in
every response.

No upstream code was copied into this repository; the fast path is an original
procfs reader, and systeminformation remains an unmodified runtime dependency.

## Data flow and performance

- **On demand.** No timer runs in the Host. `/api/snapshot` samples when the
  browser asks, caches the result for 800 ms (configurable), and de-duplicates
  concurrent requests. An idle panel costs zero CPU.
- **Visible only.** The browser polls every 1.5 s while the panel is mounted and
  `document.visibilityState === 'visible'`; it stops on unmount and when the tab
  is hidden.
- **Layered caches.** Static hardware/OS data 300 s, services 15 s, startup 60 s,
  live snapshot 800 ms.
- **Cheap rendering.** 200–400 process rows are memoized React rows; graphs are
  `<canvas>` with devicePixelRatio scaling and a 60-point ring buffer; no chart
  library is shipped.
- **Bounded memory.** History keeps at most 500 process names; the process list
  is capped by config (`maxProcesses`, default 400).

Measured on the reference host (4 × Intel N100, 8 GB):

| endpoint | typical time | notes |
| --- | --- | --- |
| `/api/health` | < 1 ms | |
| `/api/system` | ~40 ms cold, cached afterwards | hardware/OS |
| `/api/snapshot` | ~20–40 ms | full process table included |
| `/api/services` | ~200 ms cold, cached 15 s | systemd |
| `/api/startup` | ~30 ms | XDG + systemd |
| `/api/history` | < 1 ms | in-memory fold |

## Security

- The API is same-origin only; mutations require `content-type: application/json`
  and a matching `Origin`.
- End-task is guarded: PID 1, the Host process and its parent are refused; uid-0
  processes are refused unless the profile enables
  `allowKillSystemProcesses`; a stale `startTime` (recycled PID) is refused;
  `SIGKILL` requires an explicit `force: true`.
- Services and startup entries are read-only in v1: enabling/disabling system
  services from a web panel is too sharp an edge.
- The plugin never reads credentials, session data or conversation content. It
  only reads OS metrics.

## Compatibility

- DSH: any `0.2.x` runtime with `webServer`, `slots`, `locale` and `theme`
  services (the shipped Web profile provides all four).
- Node: ≥ 20.19.
- OS: Linux (fast path), macOS/Windows (systeminformation fallback). The UI
  itself is platform-neutral and does not claim Windows-only data it cannot
  obtain.

## Publishing

- npm: `@ds-hu/dsh-task-manager` (public, MIT).
- GitHub: `ds-hu/dsh-task-manager`.
- The browser bundle is generated at pack time (`prepack`) and also committed so
  the repository is directly installable from a checkout.
