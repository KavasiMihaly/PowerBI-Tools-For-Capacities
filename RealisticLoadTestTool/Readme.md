# Power BI Realistic Load Test Tool

For "realistic user scenario" load testing — simulating users changing slicers, filters, bookmarks, and pausing for "think time" while studying a report — use this tool. It opens N browser instances against an embedded Power BI report and cycles each through the configured filter/bookmark combinations, capturing per-refresh metrics for offline analysis and capacity planning.

## What's new in v1.0 Stage 1

- **CefSharp / `ChromeWriteBack/` is gone.** The 200MB unmanaged-binary runner is replaced by a tiny Node + Playwright orchestrator at `runner/run.js`. HTML is served over `http://localhost`, which **fixes multi-window MSAL** (the v0.8 known limitation).
- **`Run_Load_Test_Only.ps1` deleted.** Use `cd runner; node run.js --concurrency N` instead.
- **`Update_Token_Only.ps1` and `PBIToken.json` template deleted.** Both were already DEAD CODE in v0.8 — MSAL refreshes silently.
- **`Setup_Load_Test.ps1` stripped of token plumbing.** Still works for single-scenario subfolder generation; will be replaced by `Setup.html` in Stage 5.
- **One auth path, one writeback channel.** MSAL only; `console.log('METRIC ...')` only. The dual `CefSharp.PostMessage` writeback path is removed.

## What's new in v0.8.0 *(carried forward)*

- **Vendored powerbi-client 2.23.1** — no more dead `cdn.rawgit.com` dependency.
- **MSAL.js in-browser silent token refresh** — once you configure `auth-config.json`, tokens refresh themselves.
- **JSONL structured log output** — one JSON object per line in `Test Results/<run>/<instanceId>.jsonl`. Schema in `_Documentation/JSONL-schema.md`.
- **Off-by-one `numberOfViews` fix.**
- **jQuery removed.**
- **In-page Setup picker** — when `PBIReport.json` has no `reportUrl`, the page shows an in-browser workspace/report picker. Requires `Workspace.Read.All` scope.

## Quick start (Stage 1 — Playwright runner)

1. **One-time tenant setup:** register an Entra SPA app — see [_Documentation/MSAL-app-registration.md](../_Documentation/MSAL-app-registration.md).
2. **One-time machine setup:**
   ```powershell
   cd RealisticLoadTestTool/runner
   npm install
   npx playwright install chromium
   ```
3. Copy `auth-config.example.json` to `auth-config.json` and fill in your `clientId` + `tenantId`.
4. Configure `PBIReport.json` (either edit by hand, or leave `reportUrl` empty and let the in-page Setup picker take over).
5. Run:
   ```powershell
   cd RealisticLoadTestTool/runner
   node run.js --concurrency 5
   ```
6. First run only: click **"Sign in with Microsoft"** in the first window. Subsequent windows acquire silently from the shared MSAL cache.
7. Test runs to `numberOfViews` per instance and exits cleanly. Results in `Test Results/<run>/<instanceId>.jsonl`.

See [`runner/README.md`](runner/README.md) for full runner options (`--headless`, `--port`, `--launch-spacing-sec`).

### Manual single-window mode (no runner)

If you don't want Playwright, you can still serve the HTML manually and open it in your browser of choice:

```powershell
python -m http.server 8080
# then open http://localhost:8080/RealisticLoadTest.html
```

This works for ad-hoc tests and the in-page Setup picker. Multi-window concurrency requires the runner.

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
| `runner/run.js` | Node + Playwright orchestrator (Stage 1) | Replaces `Run_Load_Test_Only.ps1` |

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
- **v1.0 Stage 1 (this release):** Playwright runner, CefSharp deleted, multi-window MSAL works.
- **v1.0 Stage 2:** coordinator HTTP API + live aggregated dashboard.
- **v1.0 Stage 3:** host resource monitor sidecar with saturation flagging.
- **v1.0 Stage 4:** centralized `loadtest.yaml` config + multi-scenario invocation.
- **v1.0 Stage 5:** browser-based `Setup.html` wizard replacing `Setup_Load_Test.ps1`.
- **v1.0 Stage 6:** single-machine easy install (winget / zip).
- **v2.0:** distributed multi-VM scale-out (1000+ concurrent users), service-principal auth, Capacity Metrics App correlation.

See `_Plan/realisticloadtest-v2.md` for the full plan.

## Attribution

- Original Power BI JavaScript embed by [Sergei Gundorov](https://github.com/sergeig888).
- Original `RealisticLoadTestTool` by Microsoft + Artis Consulting (frozen since 2019).
- Fork enhancements and v0.8+ modernization by Mihaly Kavasi.
