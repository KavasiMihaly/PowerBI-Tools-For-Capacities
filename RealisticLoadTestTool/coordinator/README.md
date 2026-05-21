# RealisticLoadTest Coordinator (v1.0 Stage 2)

Long-running web service that owns the HTTP surface for the load test tool: serves all static files, ingests live metric records, aggregates them in memory, and exposes a vanilla-JS live dashboard.

## Why this exists

Stage 1 had each runner stand up its own embedded HTTP server. That works for one-machine, single-run testing but blocks two needs:

1. **Live cross-instance aggregation** — you can't see throughput / p50 / p95 across all running browser tabs in real time.
2. **Multi-VM scale-out (v2.0)** — workers on remote VMs need a single sink to POST metrics to.

The coordinator solves both. It's a separate, long-running process. Start it once; it persists across many test runs. The runner connects to it on startup; the browser POSTs metrics to it; the dashboard polls it.

## Install (no extra deps beyond Stage 1)

The coordinator uses only Node's built-in `http` and `fs` modules. No `npm install` needed in this folder. If you've already done Stage 1's `npm install` in `runner/`, you're done.

## Run

```powershell
# Terminal A — coordinator (leave running)
cd RealisticLoadTestTool/coordinator
node server.js
# → http://localhost:8080/dashboard

# Terminal B — actual test
cd RealisticLoadTestTool/runner
node run.js --concurrency 5
```

Open `http://localhost:8080/dashboard` in any browser to watch live throughput, p50/p95, per-report breakdown, instance status, and recent errors.

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--port N` | 8080 | Matches v0.8 / Stage 1 default. Change → register the new origin in your Entra app. |
| `--host` | `localhost` | Override only if Entra was registered with `127.0.0.1`. |
| `--bind 0.0.0.0` + `--dev` | off | B4b architecture-readiness: bind all interfaces, log source IP per metric POST. **No auth — never leave running like this.** |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | 302 redirect to `/dashboard` |
| GET | `/dashboard` | Live dashboard (HTML + vanilla JS) |
| GET | `/status` | Aggregate JSON — counters, p50/p95, per-report, instances, recent errors |
| GET | `/metrics.jsonl` | Dump the in-memory ring buffer as NDJSON (download or pipe to `jq`) |
| POST | `/metric` | Ingest one or many newline-separated JSONL records |
| GET | `/<anything>` | Static file from `RealisticLoadTestTool/` (HTML, libs, JSON configs) |

## Two writeback channels (intentional redundancy)

Each metric record is written by **two paths**:

1. **Browser → coordinator** — `RealisticLoadTest.html` POSTs each record from `emitMetric()` via `fetch('/metric', POST)`. Same-origin, no CORS issues.
2. **Browser → console → runner → coordinator** — the page also `console.log`s each record with the `'METRIC '` prefix; the runner's Playwright `page.on('console')` captures it, writes it to the per-instance `.jsonl` file on disk, **and** POSTs it back to `/metric` as a backup.

Disable the runner's backup POST with `node run.js --no-coordinator-resend` if it's noisy in your logs. The page-side POST keeps working.

The disk JSONL files (written by the runner) are **canonical truth**. The coordinator's in-memory buffer is ephemeral live state — restart the coordinator and it's gone. This is intentional: the coordinator stays simple and the disk files are always the analysis-grade source.

## Status JSON shape

```json
{
  "ts": "2026-05-05T02:30:00.000Z",
  "uptimeSec": 3600,
  "acceptedTotal": 1250,
  "droppedTotal": 0,
  "bufferSize": 1250,
  "bufferMax": 50000,
  "instances": [
    { "instanceId": 2711955, "runId": "...", "lastEvent": "rendered", "view": {"current":3,"target":10}, "lastSeen": "...", "active": true }
  ],
  "activeInstanceCount": 3,
  "aggregate": {
    "totalRendered": 30,
    "totalSteady": 27,
    "totalCold": 3,
    "totalErrors": 0,
    "throughputPerSecLast60s": 0.47,
    "steady":     { "p50Ms": 4200, "p95Ms": 7100, "p99Ms": 9800, "meanMs": 4500 },
    "coldStart":  { "p50Ms": 175000, "meanMs": 175000 }
  },
  "perReport": [
    { "reportId": "ce7dc7f9-...", "count": 27, "p50Ms": 4200, "p95Ms": 7100, "meanMs": 4500, "errors": 0 }
  ],
  "recentErrors": [],
  "hostSaturated": false
}
```

## Limitations (Stage 2)

- **In-memory only** — no persistence across coordinator restarts. The runner's per-instance JSONL files survive (they're the canonical truth). Stage 4+ may add an optional aggregate dump on shutdown.
- **No auth** — localhost-only by default mitigates this. The `--bind 0.0.0.0 --dev` mode is for architecture-readiness checks only, not production. v2.0 (T14) adds service-principal auth.
- **No host saturation flag yet** — the `hostSaturated: false` in `/status` is a Stage 3 placeholder. Wired up in the next stage.
- **No per-run history** — only the current ring buffer is summarized. Cross-run comparison must be done from the disk JSONL files.

## Troubleshooting

- **`port 8080 is already in use`** → pass `--port <free>` AND register `http://localhost:<port>` as a redirect URI in your Entra SPA app.
- **Runner says "coordinator unreachable"** → start `node coordinator/server.js` first. Check the URL with `--coordinator http://...`.
- **Dashboard shows "fetch error"** → coordinator probably restarted. The pulse turns orange after 5 s, red after 10 s. Refresh once the coordinator is back up.
- **JSON parse errors in coordinator stderr** → some POST contained invalid NDJSON. Records are dropped; the buffer keeps going. The first 5 dropped lines per session log a snippet to help diagnose.
