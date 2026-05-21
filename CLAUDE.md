# CLAUDE.md — PowerBI-Tools-For-Capacities

## What this repo is

A fork of Microsoft's [PowerBI-Tools-For-Capacities](https://github.com/microsoft/PowerBI-Tools-For-Capacities) (frozen since Aug 2019). The active subproject is **`RealisticLoadTestTool/`** — a tool that drives realistic, multi-window load tests against Power BI reports to measure capacity behaviour under concurrent user load.

The sibling `LoadTestingPowerShellTool/` is the original Microsoft tool and is **out of scope** for current work.

## What we are currently developing

**Epic: RealisticLoadTest v2 modernization.** Restore the tool to working order on a 2026 machine and rebuild it into a browser-native, multi-instance, observable load-test platform. Three phased releases:

| Release | Status | Goal |
|---|---|---|
| **v0.8** — Quick wins | ✅ Done | Tool works on a clean 2026 machine: kill dead CDN, drop jQuery, upgrade SDK to 2.23.x, MSAL.js auth, JSONL structured logs, fix `numberOfViews` off-by-one. |
| **v1.0** — New UX layer | 🟡 In progress (Stages 1, 2, 2.5 done; 3–6 to do) | Playwright runner replaces CefSharp, live dashboard, resource monitor, YAML config, in-browser setup wizard, easy install. |
| **v2.0** — Distributed | 📋 Design only | Multi-VM coordinator/worker, service principal auth, IaC, Capacity Metrics App correlation. |

### v1.0 stages (revised 2026-05-05)

1. **Stage 1 ✅** — Playwright runner kills CefSharp. `runner/run.js` launches N Chromium contexts at `http://localhost`, captures `console` METRIC lines, writes JSONL. Legacy auth artifacts (`PBIToken.json`, `Update_Token_Only.ps1`, `ChromeWriteBack/`, `Run_Load_Test_Only.ps1`) deleted.
2. **Stage 2 ✅** — Coordinator HTTP API + live dashboard. `coordinator/server.js` aggregates metrics from all runner instances; `coordinator/dashboard.html` polls `/status` every 2s.
3. **Stage 2.5 ✅** — OneDayBI brand applied to all HTML views via shared `lib/onedaybi.css` (B7).
4. **Stage 3 ⏳** — Resource monitor sidecar (`resource-monitor/monitor.js`) flagging CPU/RAM saturation; affected metrics get `host_saturated: true`.
5. **Stage 4 ⏳** — Centralized `loadtest.yaml` config replacing per-folder JSON.
6. **Stage 5 ⏳** — Unified control plane: dashboard becomes the single entry point (sign-in + scenario wizard + launch/stop runs). Absorbs B2 (Setup wizard) + B8 (coordinator spawns runner).
7. **Stage 6 ⏳** — Easy install: `install.ps1`, winget manifest, self-contained release zip.

`_Plan/Backlog.md` is the single source of truth for every task and its state. `_Plan/realisticloadtest-v2.md` is the canonical plan — read this first when picking up work.

## Architecture (v1.0 current state)

```
┌─────────────────────────────────────────────────────────────────┐
│ Operator's machine                                              │
│                                                                 │
│  ┌──────────────────────┐      ┌────────────────────────────┐   │
│  │ runner/run.js        │      │ coordinator/server.js      │   │
│  │ (Node + Playwright)  │      │ (Node static + HTTP API)   │   │
│  │                      │POST  │  /metric, /status,         │   │
│  │  N Chromium contexts │─────▶│  /saturation (Stage 3),    │   │
│  │  http://localhost/   │/metric  /dashboard, /run/* (S5)  │   │
│  │  RealisticLoadTest   │      └────────────┬───────────────┘   │
│  │  .html               │                   │                   │
│  └──────┬───────────────┘                   │                   │
│         │ writes                            │ serves            │
│         ▼                                   ▼                   │
│  Test Results/<run>/                   coordinator/dashboard.html│
│  <instanceId>.jsonl                    (live p50/p95, throughput)│
│                                                                 │
│  resource-monitor/monitor.js (Stage 3) ─POST /saturation──┐     │
│  (psutil-equivalent, 1Hz, host CPU/RAM)                   │     │
└─────────────────────────────────────────────────────────────────┘
                                                            │
                       MSAL.js (browser-side) ───▶ Entra (auth)
                       Power BI JS SDK 2.23.x ────▶ Power BI service
```

Auth is **MSAL-only** as of v0.8 — the dual `PBIToken.json` fallback path was removed.

## Repo layout

```
RealisticLoadTestTool/          # The active tool — all v2 work happens here
├── RealisticLoadTest.html      # The embed page — MSAL auth + Power BI JS SDK + metric emission
├── UserGuide.html              # End-user docs (branded)
├── Readme.md                   # Tool-level changelog & version notes
├── auth-config.json            # MSAL clientId/tenantId/scopes (gitignored)
├── auth-config.example.json    # Committed template
├── lib/                        # Vendored deps + OneDayBI brand CSS
│   ├── powerbi-client-2.23.1.min.js
│   ├── msal-browser-3.27.0.min.js
│   ├── onedaybi.css
│   └── onedaybi-logo-{dark,light}.svg
├── runner/                     # Stage 1: Playwright runner
│   ├── run.js                  # Launches N contexts, captures METRIC lines, writes JSONL
│   ├── package.json
│   └── README.md
├── coordinator/                # Stage 2: HTTP API + live dashboard
│   ├── server.js               # Static file server + /metric, /status endpoints
│   ├── dashboard.html          # Live p50/p95/throughput dashboard
│   └── README.md
├── resource-monitor/           # Stage 3 (in progress): host CPU/RAM sidecar
│   ├── monitor.js
│   └── README.md
├── Setup_Load_Test.ps1         # Legacy per-folder scenario setup (deprecated by Stage 5)
├── PBIReport.json              # Legacy per-folder embed config (replaced by loadtest.yaml in Stage 4)
├── Filters.json / Bookmarks.json / Page.json   # Legacy — will be removed in Stage 4
└── Test Results/<run>/         # Output: <instanceId>.jsonl per Chromium context

LoadTestingPowerShellTool/      # Original Microsoft tool — out of scope
Help/, doc_images/              # Legacy assets from upstream

_Plan/                          # Canonical plans (source-controlled)
├── Backlog.md                  # Single tracking surface for all tasks
└── realisticloadtest-v2.md     # The plan driving current work

_Research/                      # Research outputs (read these before designing)
_Test/                          # Test plans + per-stage results (v1.0-S1, S2, S2.5 done)
_Documentation/                 # JSONL schema, MSAL app registration, design docs
_Agent Logs/                    # Auto-generated by hooks — do not edit
```

## Key conventions (this repo)

- **JSONL schema** lives in `_Documentation/JSONL-schema.md`. Every browser-side metric event (`rendered`, `loaded`, `error`, `view_limit_reached`, `sessionRestart`) emits one JSON object per line. Different event types have different key sets — the schema doc has a per-event-type expected-key table. Cold-start renders are marked `isFirstRender: true`.
- **`console.log('METRIC ' + JSON.stringify(...))`** is the wire protocol between the browser embed and the Node runner. The `'METRIC '` prefix is what `runner/run.js` matches on via `page.on('console')`.
- **MSAL config** is centralized in `auth-config.json` (gitignored). Required scopes: `https://analysis.windows.net/powerbi/api/Report.Read.All`, `https://analysis.windows.net/powerbi/api/Workspace.Read.All`. Tokens cache in `localStorage`.
- **Entra redirect URIs are matched as exact strings** — host + port + scheme + path. See `MEMORY.md` for the multiple incidents this caused.
- **MSAL popups must fire from a user gesture.** Bootstrap silently first; only show a "Sign in" button to trigger the popup. Never call `acquireTokenPopup` from `DOMContentLoaded`.
- **Coordinator binds `127.0.0.1` only by default.** `--bind 0.0.0.0 --dev` for the v2.0 architecture-readiness check; no auth yet.
- **Brand:** OneDayBI digital palette (Microsoft-aligned: Primary Blue + Accent Green) via `lib/onedaybi.css` CSS custom properties. Logos: `onedaybi-logo-dark.svg` (white text, for dark bg) and `onedaybi-logo-light.svg` (navy text, for light bg). All HTML views link to the shared CSS — no inline palettes.

## How to pick up work

1. Read `_Plan/Backlog.md` — find an item in `Backlog` state under the current stage.
2. Open the referenced row in `_Plan/realisticloadtest-v2.md` for full spec, files to touch, and test coverage.
3. If the relevant `_Test/<stage>-test-plan.md` exists, run the listed tests **first** (TDD-flavoured) before implementing — per the global Standard Implementation Process.
4. After implementation, write a stage result file at `_Test/v1.0-S<N>-results.md` summarizing test coverage, pass/fail counts, and any findings.
5. Update the Backlog row's State column to `Done` and add any new findings/lessons to `MEMORY.md`.

## Things that bit us — read `MEMORY.md` before debugging auth

`MEMORY.md` captures gotchas that cost real time:
- MSAL popup-on-load is blocked by all modern browsers (use a button)
- Entra SPA redirect URIs are exact-string matched (port/host/scheme/trailing-slash all matter)
- `auth-config.json` was documented as gitignored but the rule was missing (verify with `git check-ignore` before trusting prose)

## Out of scope (explicit non-goals)

- Migrating or modernizing `LoadTestingPowerShellTool/` (different tool).
- Mac/Linux support — Windows-only. Playwright may incidentally enable cross-platform but it's not committed.
- Replacing the demo `.pbix` with a `.pbip` source — separate discussion.
- Power BI custom visual testing — different problem domain.
- Fabric F SKU sizing guide — docs-only, separate task.
