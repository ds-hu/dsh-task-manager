# Host API contract (v1)

The Host half registers **one** web-server prefix, `/dsh-task-manager`, and serves
everything under `/dsh-task-manager/api/*`. The browser half is same-origin, so it
calls relative URLs with `fetch()`; there is no RPC client, no token, and no second
listener.

All responses are `application/json; charset=utf-8`, `cache-control: no-store`.
Errors use the envelope `{ "ok": false, "code": "<stable-code>", "error": "<human text>" }`
with a matching HTTP status. Success responses always carry `ok: true` unless noted.

The server is **on-demand**: no background timer runs when nobody polls. `GET
/api/snapshot` computes (or returns a cached sample no older than 800 ms), so an
idle panel costs nothing. The browser polls `/api/snapshot` every 1500 ms while the
panel is mounted and the document is visible.

## `GET /dsh-task-manager/api/health`

```json
{ "ok": true, "name": "task-manager", "version": "0.1.0", "pid": 123, "startedAt": 1700000000000 }
```

## `GET /dsh-task-manager/api/system`

Static or slowly changing information. Host caches it for 300 s.

```json
{
  "ok": true,
  "hostname": "sagiri",
  "platform": "linux",
  "distro": "Ubuntu 26.04 LTS",
  "release": "6.8.0-...",
  "arch": "x64",
  "kernel": "Linux 6.8.0-... x64",
  "manufacturer": "Intel",
  "model": "N100",
  "cpu": {
    "manufacturer": "Intel",
    "brand": "N100",
    "cores": 4,
    "physicalCores": 4,
    "speedGHz": 0.8,
    "governor": "",
    "cache": { "l1d": 0, "l1i": 0, "l2": 0, "l3": 0 }
  },
  "memTotal": 8000000000,
  "swapTotal": 0,
  "disks": [
    { "fs": "/dev/mapper/ubuntu--vg-ubuntu--lv", "type": "ext4", "size": 249000000000, "mount": "/" }
  ],
  "netIfaces": [
    { "iface": "enp2s0", "ifaceName": "enp2s0", "ip4": "192.168.1.2", "mac": "aa:bb:cc:dd:ee:ff", "operstate": "up", "type": "wired", "speed": 1000, "virtual": false }
  ],
  "graphics": {
    "controllers": [{ "model": "Intel UHD Graphics", "vendor": "Intel", "vram": 0, "vramDynamic": true }],
    "displays": [{ "model": "Unknown", "resolutionX": 1920, "resolutionY": 1080, "currentResX": 1920, "currentResY": 1080, "main": true }]
  },
  "dsh": { "version": "0.2.1-rc.5", "pid": 123, "node": "v22.22.1" }
}
```

Fields that the platform cannot answer are `null` (never omitted), so the client can
render a dash without optional chaining.

## `GET /dsh-task-manager/api/snapshot`

The live sample used by every tab. Cached for at most 800 ms and de-duplicated while a
sample is in flight.

```json
{
  "ok": true,
  "ts": 1700000000000,
  "sampleMs": 42,
  "intervalMs": 1500,
  "cpu": {
    "load": 43.2,
    "user": 20.1,
    "system": 12.3,
    "idle": 56.8,
    "nice": 0.0,
    "irq": 0.0,
    "cores": [30.1, 41.2, 50.3, 51.2],
    "temperature": null,
    "processCount": 209,
    "threadCount": 512,
    "uptimeSec": 3355650
  },
  "mem": {
    "total": 8000000000,
    "used": 4000000000,
    "free": 700000000,
    "available": 3400000000,
    "active": 3500000000,
    "buffcache": 2200000000,
    "buffers": 100000000,
    "cached": 2100000000,
    "swapTotal": 0,
    "swapUsed": 0,
    "swapFree": 0,
    "usedPercent": 62.1
  },
  "disks": [
    { "fs": "/dev/mapper/...", "mount": "/", "type": "ext4", "size": 249000000000, "used": 176000000000, "available": 60000000000, "usePercent": 71.2 }
  ],
  "diskIO": {
    "rIO": 0, "wIO": 0, "tIO": 0,
    "rIO_sec": 0, "wIO_sec": 0, "tIO_sec": 0,
    "rWaitPercent": 0, "wWaitPercent": 0, "tWaitPercent": 0
  },
  "network": {
    "ifaces": [
      { "iface": "enp2s0", "operstate": "up", "rx_bytes": 66535660543, "tx_bytes": 121099037889, "rx_sec": 1200, "tx_sec": 800 }
    ],
    "total": { "rx_bytes": 66535660543, "tx_bytes": 121099037889, "rx_sec": 1200, "tx_sec": 800 }
  },
  "processes": [
    {
      "pid": 1,
      "ppid": 0,
      "name": "systemd",
      "user": "root",
      "uid": 0,
      "state": "sleeping",
      "cpu": 0.4,
      "memBytes": 13063168,
      "memPercent": 0.16,
      "threads": 1,
      "cmd": "/usr/lib/systemd/systemd --system --deserialize=12",
      "started": 1699999999000,
      "priority": 19,
      "nice": 0,
      "group": "system",
      "isGui": false,
      "isKernel": false,
      "isDsh": false
    }
  ],
  "processSummary": {
    "all": 209,
    "running": 2,
    "sleeping": 200,
    "blocked": 0,
    "zombie": 0,
    "stopped": 0,
    "threads": 512
  },
  "users": [
    { "user": "root", "tty": "pts/0", "date": "2026-11-14", "time": "15:00", "ip": "", "command": "-bash" }
  ]
}
```

### Process semantics

- `cpu` is **instantaneous, as a percentage of the whole machine** (all cores = 100),
  computed from the delta of `/proc/<pid>/stat` `utime+stime` against the delta of the
  machine's total jiffies. First sample after mount may report `0`; the second sample
  (1.5 s later) is the first accurate one.
- `memBytes` is resident set size (`VmRSS` / `rss * pageSize`), not virtual size.
- `state` is one of `running | sleeping | blocked | stopped | zombie | unknown`.
- `group` is one of `app | background | system`:
  - `system` — uid 0 (or a kernel thread with no command line);
  - `app` — an interactive process: it owns a tty, or its name is in the GUI
    allowlist, or it is the DSH host process itself;
  - `background` — everything else.
- `started` is an epoch-milliseconds approximation derived from boot time +
  `/proc/<pid>/stat` starttime; it is used to reject a recycled PID when killing.
- `cmd` is the full command line when cheaply available, otherwise the process name.
- The list is sorted by `cpu` descending, then `memBytes` descending, and contains
  every process the Host can see (typically 150–400 rows).

## `GET /dsh-task-manager/api/services`

Cached for 15 s. On Linux this is `systemctl list-units` via systeminformation; on
other platforms the same call returns the platform's service list.

```json
{
  "ok": true,
  "ts": 1700000000000,
  "services": [
    { "name": "ssh", "displayName": "OpenBSD Secure Shell server", "running": true, "startmode": "enabled", "pids": [1234], "cpu": 0.1, "mem": 1.2 }
  ]
}
```

## `GET /dsh-task-manager/api/startup`

Cached for 60 s. On Linux: XDG autostart entries plus enabled systemd units. On other
platforms: the platform startup list when systeminformation provides one, otherwise an
empty array.

```json
{
  "ok": true,
  "ts": 1700000000000,
  "entries": [
    { "name": "ssh", "path": "/lib/systemd/system/ssh.service", "source": "systemd", "enabled": true, "type": "service", "impact": "low" }
  ]
}
```

## `GET /dsh-task-manager/api/history`

App history accumulated by the Host since it started serving snapshots. It folds each
snapshot into per-process-name totals, so it is real data rather than a placeholder.

```json
{
  "ok": true,
  "ts": 1700000000000,
  "since": 1699999000000,
  "apps": [
    { "name": "node", "cpuSeconds": 123.4, "peakMemBytes": 490000000, "lastSeen": 1700000000000, "samples": 42 }
  ]
}
```

## `POST /dsh-task-manager/api/process/kill`

Same-origin JSON only (`origin` must match the Host, `content-type: application/json`).
Body:

```json
{ "pid": 1234, "startTime": 1699999999000, "signal": "SIGTERM" }
```

`startTime` must equal the `started` value the client last saw; this rejects a recycled
PID. The Host refuses, with a stable code:

| status | code | reason |
| --- | --- | --- |
| 400 | `bad-pid` | pid is not a positive integer |
| 403 | `protected-process` | pid 1, the Host process itself, or its parent |
| 403 | `system-process` | uid 0 and `allowKillSystemProcesses` is false (default) |
| 404 | `no-such-process` | `/proc/<pid>` is gone |
| 409 | `stale-process` | `startTime` does not match the current process |
| 500 | `kill-failed` | the signal could not be delivered |

Success: `{ "ok": true, "pid": 1234, "signal": "SIGTERM" }`.

`signal` defaults to `SIGTERM`; `SIGKILL` is accepted only when the request also sets
`"force": true`, so the UI's two-step confirmation is visible in the request.

## Configuration

`Config` (optional row config) is a plain object:

| field | type | default | meaning |
| --- | --- | --- | --- |
| `allowKillSystemProcesses` | boolean | `false` | permit ending uid-0 processes |
| `refreshIntervalMs` | number | `1500` | browser poll interval hint, clamped 500–10000 |
| `maxProcesses` | number | `400` | cap on rows returned in `processes` |
| `sampleCacheMs` | number | `800` | snapshot cache window |

The Host validates and clamps every value; an invalid row config falls back to the
defaults instead of failing activation.
