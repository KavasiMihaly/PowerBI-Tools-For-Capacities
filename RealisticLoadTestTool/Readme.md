# Power BI Realistic Load Test Tool

For "realistic user scenario" load testing — simulating users changing slicers, filters, bookmarks, and pausing for "think time" while studying a report — use this tool. It opens N browser instances against an embedded Power BI report and cycles each through the configured filter/bookmark combinations, capturing per-refresh metrics for offline analysis and capacity planning.

## What's new in v0.8.0

- **Vendored powerbi-client 2.23.1** — no more dead `cdn.rawgit.com` dependency. The tool runs on a clean machine without internet beyond the Power BI service itself. (Previously the script tag pointed at a CDN that was sunset in October 2019.)
- **MSAL.js in-browser silent token refresh** — once you configure `auth-config.json` with a tenant app registration (one-time admin step), tokens refresh themselves. Goodbye 60-minute `Update_Token_Only.ps1` ritual.
- **JSONL structured log output** — each refresh writes one JSON object per line to `Test Results/<run>/<instanceId>.jsonl`. No more HTML-with-`<br>` parsing in Excel. Schema documented in `_Documentation/JSONL-schema.md`.
- **Off-by-one `numberOfViews` fix** — runs now stop exactly at the configured view count instead of one past.
- **jQuery removed** — eliminated the 2014-vintage `jquery 1.11.1` dependency.
- **In-page Setup picker** — when `PBIReport.json` has no `reportUrl`, the page shows an in-browser workspace/report picker (mirrors the original `Setup_Load_Test.ps1` flow). For ad-hoc tests with no filters/bookmarks. Requires `Workspace.Read.All` scope on the Entra app.
- **Legacy `PBIToken.json` auth path removed** — MSAL is now the only supported auth flow. Tenants that cannot register an Entra SPA app cannot use v0.8.

> **⚠️ Multi-window concurrency is broken in v0.8.** `Run_Load_Test_Only.ps1` launches CefSharp `ChromeWriteBack` windows via `file://`, which Entra rejects as a redirect URI — so MSAL cannot run there. The legacy `PBIToken.json` workaround was removed in v0.8 (backlog T5b), so the parallel-test runner has no working auth path. Use single-browser MSAL via `http://localhost` until **v1.0**, which replaces CefSharp with Playwright (already supports `http://localhost`).

## Quick start (MSAL — the only supported path)

1. Once per tenant: register an Entra SPA app — see [_Documentation/MSAL-app-registration.md](../_Documentation/MSAL-app-registration.md).
2. Copy `auth-config.example.json` to `auth-config.json` and fill in your `clientId` and `tenantId`.
3. Either:
   - **Ad-hoc test:** leave `PBIReport.json` as the empty template — the in-page Setup picker takes over; or
   - **Repeatable scenario:** run `Setup_Load_Test.ps1` to generate per-test subfolders, then edit each subfolder's `PBIReport.json` for filters / slicers / bookmarks / page.
4. Serve over HTTP: `python -m http.server 8080` from this folder. **Not `file://`** — Entra rejects `file://` redirect URIs.
5. Open `http://localhost:8080/RealisticLoadTest.html`. Click **"Sign in with Microsoft"** on first visit (popup opens). Subsequent visits sign in silently from cache.
6. Test runs to `numberOfViews` and stops cleanly. Logs in `Test Results/<run>/<instanceId>.jsonl`.

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
| `PBIToken.json` | **Legacy — no longer read by v0.8 HTML.** Kept in repo only because `Setup_Load_Test.ps1` still emits it; deleted in v1.0 alongside the Playwright migration. | — |
| `Update_Token_Only.ps1` | **Legacy — does nothing useful in v0.8.** The HTML no longer reads the token it refreshes. Kept until v1.0 cleanup. | — |
| `auth-config.json` | MSAL config (gitignored) | Created from `auth-config.example.json`; clientId + tenantId |
| `Filters.json` / `Bookmarks.json` / `Page.json` | Reusable per-report templates | Injected into `PBIReport.json` by `Setup_Load_Test.ps1` |
| `lib/powerbi-client-2.23.1.min.js` | Vendored Power BI JS SDK | Loaded locally |
| `lib/msal-browser-3.27.0.min.js` | Vendored MSAL.js | Loaded locally |

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
- `filters[].filtersList`: each element can be a single value, an array (multi-select), or `null` (in which case the multi-select is "all non-null in the list" — see Microsoft's original docs).
- `pageName`: internal `ReportSection<id>`, NOT the visible tab name. Find it in the URL when the page is open in `app.powerbi.com`.
- `bookmarkList[]`: internal bookmark names, similarly findable in URL.

## Prerequisites

- Windows + PowerShell. Bash equivalents in `Setup.html` will land in v1.0.
- Modern Chrome / Edge / Firefox.
- For MSAL: ability to register an Entra SPA app in your tenant (one-time, requires Global Admin or app-reg-permitted role).
- For the legacy / CefSharp path: the `MicrosoftPowerBIMgmt` PowerShell module installed.

## Roadmap

- **v0.8 (this release):** vendored libs, MSAL, JSONL output, view-limit fix.
- **v1.0:** browser-based setup UI replacing PowerShell, host resource monitor, real-time aggregated dashboard, single-machine easy install (winget/zip).
- **v2.0:** Playwright-orchestrated headless mode, distributed multi-VM scale-out (1000+ concurrent users), service-principal auth path, Capacity Metrics App correlation.

See `_Plan/realisticloadtest-v2.md` for the full plan.

## Attribution

- Original Power BI JavaScript embed by [Sergei Gundorov](https://github.com/sergeig888).
- Original `RealisticLoadTestTool` by Microsoft + Artis Consulting (frozen since 2019).
- Fork enhancements and v0.8+ modernization by Mihaly Kavasi.
