# Resource Monitor (v1.0 Stage 3)

Long-running Node sidecar that samples host CPU + RAM at 1 Hz, posts each sample to the coordinator (`POST /host-metrics`), and writes a local JSONL audit file. Detects host saturation using a 30-second rolling window so transient spikes don't flag — only sustained pressure does.

## Why this exists

When the host running the load test is itself overloaded (CPU pinned, RAM exhausted), every metric collected during that window is junk — you're measuring browser-tab-can't-get-CPU, not Power-BI-render-time. The monitor flags those windows so post-run analysis can filter them out, and the live dashboard shows a red banner so the operator knows to back off.

## No install needed

Pure Node, no dependencies. Uses Node's built-in `os` module (CPU times, free/total memory). Node 18+ already required by the runner.

## Run

The monitor is a separate process (sidecar). Stage 3 still uses the multi-terminal model — the consolidation into one boot lands in Stage 5.

```powershell
# Terminal A — coordinator (must be up first)
cd RealisticLoadTestTool/coordinator
node server.js

# Terminal B — monitor
cd RealisticLoadTestTool/resource-monitor
node monitor.js

# Terminal C — actual load test
cd RealisticLoadTestTool/runner
node run.js --concurrency 5
```

The monitor runs forever until Ctrl+C. Run it before, during, and after tests — the coordinator's dashboard shows current CPU/RAM regardless of whether a test is in progress.

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--coordinator URL` | `http://localhost:8080` | Where to POST samples |
| `--interval-ms N` | 1000 | Sampling period |
| `--cpu-threshold N` | 90 | % CPU above which counts as overload |
| `--mem-threshold N` | 95 | % RAM used above which counts as overload |
| `--window-sec N` | 30 | Sustained-overload window before saturation flag latches |
| `--no-coordinator` | off | File-only mode (skip POSTs); useful for debugging |
| `--quiet` | off | Suppress per-sample stdout |

## Output

Local audit file (always written):

```
<repo>/Test Results/host-metrics/<startTimestamp>.jsonl
```

Each line:

```json
{
  "ts": "2026-05-05T03:00:00.000Z",
  "cpuPercent": 47.3,
  "memPercent": 62.1,
  "totalMemMb": 32700,
  "freeMemMb": 12410,
  "loadAvg1": 0,
  "saturated": false,
  "samplesInWindow": 30,
  "secondsAtThreshold": 0
}
```

Notes:
- `loadAvg1` is always 0 on Windows (Node's `os.loadavg()` returns zeros) — included for cross-platform symmetry, useful on Linux.
- `samplesInWindow` shows the rolling-window fill (30 once primed).
- `secondsAtThreshold` is the trailing run of consecutive over-threshold samples (diagnostic — when it climbs to 30, `saturated` flips true).

## Saturation logic (latch + relief)

- **Latch true:** every sample in the last `--window-sec` window is over CPU OR memory threshold.
- **Latch false:** every sample in the window is under both thresholds.
- **Hysteresis is built into the window:** a transient spike that lasts < window-sec never trips the flag; a transient drop while genuinely saturated doesn't unlatch it either.

The default 30s window is calibrated for "sustained pressure" — a couple of paint storms or GC pauses won't trigger it.

## How it surfaces in the rest of the system

1. **Dashboard banner.** The coordinator's `/status` includes `hostSaturated: true|false`. The dashboard (`coordinator/dashboard.html`) shows a red attention bar when true.
2. **JSONL records.** `RealisticLoadTest.html` polls `/status` every few seconds for the saturation flag. Any `event: rendered` (or other) record emitted while the flag is true gets stamped `host_saturated: true`. Analysis can filter these out:
   ```bash
   jq 'select(.event=="rendered" and .isFirstRender==false and .host_saturated != true) | .durationMs' *.jsonl
   ```
3. **Cross-file correlation.** Time-join the runner's per-instance JSONL with the monitor's `host-metrics/*.jsonl` on `ts` for full attribution (which slow renders happened during which CPU spike).

## Limitations (Stage 3)

- **No network I/O sampling.** The original Python+psutil plan included net I/O; deferred to Stage 4+ if needed. CPU + RAM is sufficient for "is the host healthy enough to trust the numbers."
- **No per-core breakdown.** Aggregate CPU% only.
- **No GPU.** Power BI rendering is mostly CPU-bound; GPU saturation is rare in practice on a load-test host.
- **One monitor per host.** Multi-VM scenarios (v2.0) will need each VM to run its own monitor and tag samples with a host ID.
- **Coordinator restart loses recent samples.** The coordinator stores only the last N in memory; the local JSONL is the canonical record.
