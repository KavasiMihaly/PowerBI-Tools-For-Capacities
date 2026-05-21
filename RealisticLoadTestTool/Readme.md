# Power BI Realistic Load Test Tool

For "realistic user scenario" load testing — simulating users changing slicers, filters, bookmarks, and pausing for "think time" while studying a report — use this tool. It opens N browser instances against an embedded Power BI report and cycles each through the configured filter/bookmark combinations, capturing per-refresh metrics for offline analysis and capacity planning.

## What's new in v1.0 Stage 3

- **Resource monitor sidecar.** `resource-monitor/monitor.js` (Node, no deps) samples host CPU + RAM at 1 Hz, posts to coordinator `POST /host-metrics`, writes a local audit JSONL.
- **Saturation flag.** A 30-second rolling window: when every sample exceeds CPU>90% OR RAM>95%, the flag latches; clears when 30 s of relief follows. Hysteresis built in.
- **Dashboard surfaces it.** Three new stat cards (CPU, RAM, Saturation) and the existing red attention bar lights up when saturated.
- **JSONL stamping.** `RealisticLoadTest.html` polls `/status` every 5s; any record emitted while saturated gets `host_saturated: true`. Filter steady-state analysis by `select(.host_saturated != true)`.

## What's new in v1.0 Stage 2 *(carried forward)*

- **Live coordinator + dashboard** at `http://localhost:8080/dashboard`.
- **Browser dual-writeback** to console + `POST /metric`.
- **Runner depends on coordinator.**
- **B4b architecture-readiness** via `--bind 0.0.0.0 --dev`.

## What's new in v1.0 Stage 1 *(carried forward)*

- **CefSharp / `ChromeWriteBack/` is gone.** Replaced by Node + Playwright at `runner/run.js`. Multi-window MSAL works.
- **Deleted:** `Run_Load_Test_Only.ps1`, `Update_Token_Only.ps1`, `PBIToken.json` template.
- **`Setup_Load_Test.ps1` stripped of token plumbing.** Still works for single-scenario subfolder generation; will be replaced by `Setup.html` in Stage 5.

## What's new in v0.8.0 *(carried forward)*

- **Vendored powerbi-client 2.23.1** — no more dead `cdn.rawgit.com` dependency.
- **MSAL.js in-browser silent token refresh** — once you configure `auth-config.json`, tokens refresh themselves.
- **JSONL structured log output** — one JSON object per line in `Test Results/<run>/<instanceId>.jsonl`. Schema in `_Documentation/JSONL-schema.md`.
- **Off-by-one `numberOfViews` fix.**
- **jQuery removed.**
- **In-page Setup picker** — when `PBIReport.json` has no `reportUrl`, the page shows an in-browser workspace/report picker. Requires `Workspace.Read.All` scope.

## Quick start (Stage 2 — coordinator + runner)

1. **One-time tenant setup:** register an Entra SPA app — see [_Documentation/MSAL-app-registration.md](../_Documentation/MSAL-app-registration.md).
2. **One-time machine setup:**
   ```powershell
   cd RealisticLoadTestTool/runner
   npm install
   npx playwright install chromium
   ```
3. Copy `auth-config.example.json` to `auth-config.json` and fill in your `clientId` + `tenantId`.
4. Configure `PBIReport.json` (or leave `reportUrl` empty for the in-page Setup picker).
5. Start the coordinator (Terminal A — leave running):
   ```powershell
   cd RealisticLoadTestTool/coordinator
   node server.js
   ```
   Open `http://localhost:8080/dashboard` to watch live aggregated metrics.
6. (Optional, recommended) Start the resource monitor (Terminal B — leave running):
   ```powershell
   cd RealisticLoadTestTool/resource-monitor
   node monitor.js
   ```
   Dashboard now shows live host CPU + RAM. Saturation flag stamps `host_saturated:true` on JSONL during overload windows.
7. Run the test (Terminal C):
   ```powershell
   cd RealisticLoadTestTool/runner
   node run.js --concurrency 5
   ```
7. First run only: click **"Sign in with Microsoft"** in the first window. Subsequent windows acquire silently from the shared MSAL cache.
8. Test runs to `numberOfViews` per instance and exits cleanly. Results in `Test Results/<run>/<instanceId>.jsonl`. Dashboard stays live for inspection until you Ctrl+C the coordinator.

See [`runner/README.md`](runner/README.md) and [`coordinator/README.md`](coordinator/README.md) for full options.

### Manual single-window mode (coordinator-only — no Playwright)

The coordinator alone is enough for a single-window manual test, since it serves the HTML *and* receives the browser's `POST /metric` directly:

```powershell
cd RealisticLoadTestTool/coordinator
node server.js
# then open http://localhost:8080/RealisticLoadTest.html in your browser
# the dashboard at http://localhost:8080/dashboard updates in real time
```

## Output

Each browser instance writes one `.jsonl` file per launch (JSON Lines — one JSON object per line). Schema:

```json
{"ts":"2026-05-03T14:23:01.421Z","event":"rendered","instanceId":5992180,"runId":"...","projectName":"capacity-stress-q2","workspaceId":"7bbb6481-...","reportId":"ce7dc7f9-...","pageName":"ReportSection...","bookmark":"Bookmark...","filters":[],"slicers":[...],"view":{"current":3,"target":15},"durationMs":6101,"isFirstRender":false,"thinkTimeSec":1}
```

Full schema: `_Documentation/JSONL-schema.md`. Parsing examples (`jq`, Power BI Power Query) included.

## Configuration files

| File | Role | Notes |
|---|---|---|
| `PBIReport.json` | Per-test scenario config | Workspace/report URL, filters, bookmarks, page, view limits |
| `auth-config.json` | MSAL config (gitignored) | Created from `auth-config.example.json`; clientId + tenantId |
| `Filters.json` / `Bookmarks.json` / `Page.json` | Reusable per-report templates | Injected into `PBIReport.json` by `Setup_Load_Test.ps1` |
| `lib/powerbi-client-2.23.1.min.js` | Vendored Power BI JS SDK | Loaded locally |
| `lib/msal-browser-3.27.0.min.js` | Vendored MSAL.js | Loaded locally |
| `runner/run.js` | Node + Playwright orchestrator (Stage 1+) | Replaces `Run_Load_Test_Only.ps1` |
| `coordinator/server.js` | Long-running web service (Stage 2+) | Static files + `/metric` ingest + `/host-metrics` ingest + `/status` aggregate + `/dashboard` |
| `coordinator/dashboard.html` | Vanilla-JS live dashboard (Stage 2+) | Polls `/status` every 2 s |
| `resource-monitor/monitor.js` | Host resource sidecar (Stage 3+) | 1 Hz CPU + RAM sampling, saturation flagging |

## PBIReport.json schema

```json
{
  "reportUrl": "https://app.powerbi.com/reportEmbed?reportId=...&groupId=...",
  "pageName": "ReportSection...",
  "bookmarkList": ["Bookmark1...","Bookmark2..."],
  "filters": [
    {
      "filterTable": "DimDate",
      "filterColumn": "Quarter",
      "isSlicer": true,
      "filtersList": ["Q1","Q2","Q3","Q4"]
    }
  ],
  "thinkTimeSeconds": 1,
  "numberOfViews": 50,
  "sessionRestart": 100,
  "projectName": "my-capacity-test",
  "layoutType": "Master"
}
```

- `numberOfViews` (v0.8 enforced strictly — was off-by-one in v0.7.1).
- `sessionRestart`: every N refreshes, the page does a `location.reload(false)` to mitigate long-session iframe memory leaks. 100 is a sensible default.
- `layoutType`: `Master` / `MobilePortrait` / `MobileLandscape`.
- `filters[].isSlicer`: true → applied as slicer state; false → applied as report-level filter.
- `filters[].filtersList`: each element can be a single value, an array (multi-select), or `null`.
- `pageName`: internal `ReportSection<id>`, NOT the visible tab name.
- `bookmarkList[]`: internal bookmark names.

## Prerequisites

- Windows 10/11.
- Node.js 18+ (for the Stage 1 runner).
- Modern Chrome / Edge / Firefox (for manual / single-window use).
- For MSAL: ability to register an Entra SPA app in your tenant (one-time).

## Roadmap

- **v0.8 (shipped):** vendored libs, MSAL, JSONL output, view-limit fix, in-page Setup picker.
- **v1.0 Stage 1 (shipped):** Playwright runner, CefSharp deleted, multi-window MSAL works.
- **v1.0 Stage 2 (shipped):** coordinator HTTP API + live aggregated dashboard, multi-VM-ready.
- **v1.0 Stage 2.5 (shipped):** OneDayBI brand applied across all views.
- **v1.0 Stage 3 (this release):** host resource monitor sidecar with saturation flagging.
- **v1.0 Stage 4:** centralized `loadtest.yaml` config + multi-scenario invocation.
- **v1.0 Stage 5:** unified control plane (single-process boot, dashboard sign-in + launch panel) + scenario editor.
- **v1.0 Stage 6:** single-machine easy install (winget / zip).
- **v2.0:** distributed multi-VM scale-out (1000+ concurrent users), service-principal auth, Capacity Metrics App correlation.

See `_Plan/realisticloadtest-v2.md` for the full plan.

## Attribution

- Original Power BI JavaScript embed by [Sergei Gundorov](https://github.com/sergeig888).
- Original `RealisticLoadTestTool` by Microsoft + Artis Consulting (frozen since 2019).
- Fork enhancements and v0.8+ modernization by Mihaly Kavasi.
