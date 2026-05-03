# RealisticLoadTest v2 — Phased Modernization Plan

## Context

The `RealisticLoadTestTool/` is a fork of Microsoft's [PowerBI-Tools-For-Capacities](https://github.com/microsoft/PowerBI-Tools-For-Capacities), which has been frozen since August 2019 (3 commits ever). The tool can no longer bootstrap on a clean machine because it loads `powerbi-client` from `cdn.rawgit.com` — a CDN that was sunset in October 2019. On top of that, the user has accumulated a backlog of UX, observability, and scale needs:

1. The on-disk log format is HTML-with-`<br>` separators, requiring regex parsing in Excel.
2. Setup is a PowerShell-prompt wizard — high friction, no review of choices, regex-based JSON injection is fragile.
3. There is no awareness of host CPU/RAM saturation; tests over-spin and silently produce invalid metrics.
4. Deployment is single-machine only; "1000 concurrent users" requires fanning out across many VMs, which the current architecture cannot do.

This plan turns those needs into three incremental releases. Each release is independently usable. v0.8 restores basic function on a 2026 machine; v1.0 adds the new UX layer (web UI + resource monitor + structured logs + live dashboard); v2.0 (design only in this plan) is the distributed architecture that lets ~1000-user tests run across a fleet.

Research backing this plan:
- `_Research/realisticloadtest-fork-vs-upstream.md` — what your fork added on top of Microsoft's original
- `_Research/modern-pbi-loadtest-landscape.md` — modern Power BI JS SDK, MSAL token refresh, Fabric throttling, alternatives (Playwright, k6)
- `_Research/RealisticLoadTest-research-summary.md` — synthesis & ranked themes

User decisions captured during planning:
- **Phasing:** Incremental v0.8 → v1.0 → v2.0
- **UI:** Local web UI in browser (no Electron / WPF)
- **Multi-VM:** Architecture-ready in v1.0; build the IaC layer later
- **Resource monitor:** Log + warn + flag affected metrics (no auto-pause)

---

## Backlog additions (this is what the user asked for)

The very first implementation step (before any code change) is to expand `_Plan/Backlog.md` with the rows below. Backlog is the single tracking surface — every task in this plan must have a corresponding row, and as work moves the State column updates.

| ID | Backlog Item | Epic | Phase | Plan File | Research | State |
|---|---|---|---|---|---|---|
| **B1** | Structured JSONL log output replacing HTML-with-`<br>` | RealisticLoadTest v2 | v0.8 | this plan §v0.8-T4 | research-summary §3 | Backlog |
| **B2** | Local-browser UI (`Setup.html`) replacing PowerShell setup | RealisticLoadTest v2 | v1.0 | this plan §v1.0-T8 | landscape §5.7 | Backlog |
| **B3** | Host resource monitor sidecar (CPU/RAM/network) with saturation flagging | RealisticLoadTest v2 | v1.0 | this plan §v1.0-T10 | (new) | Backlog |
| **B4a** | Single-machine easy-install (winget + zip) | RealisticLoadTest v2 | v1.0 | this plan §v1.0-T12 | (new) | Backlog |
| **B4b** | Multi-VM architecture-ready (coordinator HTTP API, JSONL streaming, design only) | RealisticLoadTest v2 | v1.0 | this plan §v1.0-T11 | landscape §5.6 | Backlog |
| **B4c** | Multi-VM distributed implementation (Playwright + IaC + SP) | RealisticLoadTest v2 | v2.0 | this plan §v2.0 | landscape §5.4, §5.8 | Future |
| T1 | Vendor `powerbi-client@2.23.x`, kill rawgit dependency | RealisticLoadTest v2 | v0.8 | §v0.8-T1 | landscape §1 | Backlog |
| T2 | Drop jQuery — vanilla JS replacements | RealisticLoadTest v2 | v0.8 | §v0.8-T2 | landscape §1 | Backlog |
| T3 | Upgrade SDK to 2.23.x | RealisticLoadTest v2 | v0.8 | §v0.8-T3 | landscape §1 | Backlog |
| T5 | MSAL.js in-browser token refresh via `accessTokenProvider` | RealisticLoadTest v2 | v0.8 | §v0.8-T5 | landscape §2 | Backlog |
| T6 | Fix `numberOfViews` off-by-one (`16/15` bug) | RealisticLoadTest v2 | v0.8 | §v0.8-T6 | fork-vs-upstream §3 | Backlog |
| T7 | Update Readme + UserGuide for v0.8 | RealisticLoadTest v2 | v0.8 | §v0.8-T7 | _ | Backlog |
| T9 | Centralized `loadtest.yaml` config | RealisticLoadTest v2 | v1.0 | §v1.0-T9 | landscape §5.7 | Backlog |
| T11 | Real-time aggregated dashboard (coordinator) | RealisticLoadTest v2 | v1.0 | §v1.0-T11 | landscape §5.6 | Backlog |

These integrate with the 8 themes from prior research (numbered #1–#8 in `_Research/RealisticLoadTest-research-summary.md`). The mapping:

| Theme | v0.8 | v1.0 | v2.0 |
|---|---|---|---|
| #1 Fix dead CDN + drop jQuery | ✅ T1, T2 | | |
| #2 Upgrade SDK to 2.23.x | ✅ T3 | | |
| #3 MSAL.js in-browser token refresh | ✅ T5 | | |
| #4 JSONL structured metrics (= **B1**) | ✅ T4 | | |
| #5 Replace ChromeWriteBack with Playwright | | (design hooks via T11) | ✅ T13 |
| #6 Centralized YAML config | | ✅ T9 | |
| #7 Real-time aggregated dashboard | | ✅ T11 | |
| #8 Service principal + Capacity Metrics App | | | ✅ T14, T17 |
| **B2** Web UI for setup | | ✅ T8 | |
| **B3** Resource monitor | | ✅ T10 | |
| **B4** Easy install / multi-VM | | ✅ T12 (single) | T15, T16 (distributed) |

---

## Implementation order (mandatory)

Per the global Standard Implementation Process (CLAUDE.md), tests must be set up **before** implementation. The first three steps below produce no code changes — only planning and test artifacts. Code changes start at step 4.

1. **Copy this plan into the repo** at `_Plan/realisticloadtest-v2.md` so it's source-controlled and reviewable in PRs. (The original lives outside the repo at `C:\Users\kavas\.claude\plans\cryptic-sparking-micali.md`; the repo copy is the working copy from now on.)
2. **Update backlog** — add all rows from the table above to `_Plan/Backlog.md` so progress is trackable. Backlog Plan-File column points to `_Plan/realisticloadtest-v2.md` with the relevant section anchor.
3. **Write the v0.8 test plan** at `_Test/v0.8-test-plan.md` (full spec below in §Test plans).
4. **Write the v1.0 test plan** at `_Test/v1.0-test-plan.md` (full spec below in §Test plans).
5. **Capture v0.7.1 baseline metrics** — run a 30-min load test on the demo `.pbix` with the current tool. Save the resulting `.txt` files to `_Test/baselines/v0.7.1/` and an analysis summary to `_Test/baselines/v0.7.1-summary.md`. This is the regression-comparison reference for v0.8.
6. **Begin v0.8 implementation** — tasks T1–T7 in order; each task moves its backlog row to In Progress → Done; each task's test in `v0.8-test-plan.md` runs green before the row closes.
7. **v0.8 testing summary** — once all v0.8 tasks ship, write `_Test/v0.8-results.md` per the global process ("Create testing summary. Details the test coverage.").
8. **Repeat steps 3/5–7 for v1.0.**

## Phase v0.8 — Quick Wins (~3–5 days)

Goal: tool works on a clean 2026 machine, no manual token refresh, machine-parseable logs.

### Tasks

**T1. Fix dead CDN.** Replace `https://cdn.rawgit.com/Microsoft/PowerBI-JavaScript/master/dist/powerbi.min.js` with a vendored copy at `RealisticLoadTestTool/lib/powerbi-client.min.js` (pinned to `2.23.x`). No external CDN dependency. Add an SRI hash comment for provenance.

**T2. Drop jQuery.** Remove the `jquery-1.11.1.min.js` script tag. Replace ~5 jQuery calls with native `document.querySelector` / `JSON.parse`. Confirms via grep that no other jQuery usage remains.

**T3. Upgrade SDK to 2.23.x.** Same script swap as T1. Confirm `models.TokenType.Aad`, `report.on('rendered', ...)`, `bookmarksManager.apply()` all still work — these are back-compat with the 2.5-era code already in the file.

**T4. JSONL structured logging (B1).** Replace `divCounter.innerHTML = "..." + "<br>" + "..."` and `CefSharp.PostMessage(divCounter.innerHTML)` with:

```js
const metric = {
  ts: new Date().toISOString(),
  instanceId, runId, projectName,
  reportId, workspaceId, pageName,
  bookmark: bookmarkValue,
  filters: filterValue.filters,
  slicers: filterValue.slicers,
  view: { current: loadCounter, target: numberOfViews },
  durationMs: { current: currentDuration, average: avgDuration },
  thinkTimeSec: thinkTimeSeconds,
  event: 'rendered'  // or 'loaded' | 'error'
};
console.log('METRIC ' + JSON.stringify(metric));
CefSharp.PostMessage(JSON.stringify(metric));   // existing writeback path keeps working
```

The `'METRIC '` prefix on `console.log` makes Playwright `page.on('console')` capture trivial later (T13). Output file becomes `Test Results/<run>/<instanceId>.jsonl`. Keep the metrics-table panel in the HTML for live human view, but data flows from the same metric object.

**T5. MSAL.js in-browser token refresh.** Add `lib/msal-browser-3.x.x.min.js` (vendored). Add `auth-config.json` (template) with `clientId`, `tenantId`, `scopes`. On page load: silent token acquisition; if no cached account, fall back to `acquireTokenPopup`. Wire into the SDK via:

```js
const embedConfig = {
  ...,
  eventHooks: {
    accessTokenProvider: async () => {
      try { return (await msal.acquireTokenSilent(req)).accessToken; }
      catch { return null; }   // SDK requires null on failure, not throw
    }
  }
};
```

`PBIToken.json` becomes unused (kept temporarily as fallback for tenants that won't allow app registration). `Update_Token_Only.ps1` is marked deprecated in the Readme. Document the one-time Entra app registration steps.

**T6. Fix off-by-one in `numberOfViews`.** Real test data shows `16/15` rows. The check `if (loadCounter < numberOfViews) report = powerbi.embed(...)` runs before `loadCounter++`, but the rendered-event handler re-fires after the limit. Add a guard at the top of `EmbedReport()` that returns early once `loadCounter >= numberOfViews`.

**T7. Update docs.** Update `Readme.md` and `UserGuide.html` to reflect: vendored libs (no internet needed at runtime beyond Power BI itself), MSAL setup steps, JSONL format schema, deprecation of `Update_Token_Only.ps1`. Bump footer version to `0.8.0`.

### Files modified (v0.8)

- `RealisticLoadTestTool/RealisticLoadTest.html` (T1, T2, T3, T4, T5, T6)
- `RealisticLoadTestTool/Readme.md` (T7)
- `RealisticLoadTestTool/UserGuide.html` (T7)
- `RealisticLoadTestTool/Update_Token_Only.ps1` (deprecation note, T5)

### Files added (v0.8)

- `RealisticLoadTestTool/lib/powerbi-client-2.23.x.min.js` (vendored)
- `RealisticLoadTestTool/lib/msal-browser-3.x.x.min.js` (vendored)
- `RealisticLoadTestTool/auth-config.json` (template — `clientId`, `tenantId`, `scopes`)
- `RealisticLoadTestTool/auth-config.example.json` (committed example)
- `_Documentation/MSAL-app-registration.md` (one-time Entra setup steps)
- `_Documentation/JSONL-schema.md` (the metric record schema for v0.8)
- `_Test/v0.8-smoke-test.md` (test plan — see Verification)

### Files unchanged (v0.8) — explicit non-goals

- `Setup_Load_Test.ps1` — still works as before; UI replacement is v1.0
- `Run_Load_Test_Only.ps1` — still launches ChromeWriteBack; Playwright is v2.0
- `ChromeWriteBack/` — kept, unchanged

---

## Phase v1.0 — UX layer (~3–4 weeks)

Goal: setup happens in the browser; metrics aggregate live across instances; host saturation is visible.

### Tasks

**T8. Web UI for setup (B2).** New file `RealisticLoadTestTool/Setup.html` plus a tiny local helper for file writes. Flow:
1. User opens `Setup.html` in browser. MSAL login (re-uses T5 config).
2. Page calls Power BI REST APIs (`GET /groups`, `GET /groups/{wsId}/reports`, `GET /reports/{id}/pages`, `GET /reports/{id}/bookmarks`) and presents pickers.
3. User picks workspace → report(s) → pages → bookmarks → fills filters via a UI builder that already knows the report's columns (call `GetDatasetSchema` via `/datasets/{id}/datasources` + DAX `EVALUATE TOPN`).
4. User configures concurrency, views, think time, project name.
5. UI POSTs the resulting `loadtest.yaml` (T9 format) to a small local Node helper (~50 LOC, runs on `127.0.0.1:7878`) which writes it to disk. Same helper later serves T11. **No backend cloud dep — all local.**

**T9. Centralized YAML/JSON workspace config.** Replace per-folder `PBIReport.json` + `Filters.json` + `Bookmarks.json` + `Page.json` with a single `loadtest.yaml`:

```yaml
project: capacity-stress-q2
workspace: 7bbb6481-...
reports:
  - id: 36621bde-...
    name: Sales Overview
    scenarios:
      - page: Overview
        bookmark: bm_q1
        filters: [{ table: DimDate, column: Quarter, values: [Q1, Q2] }]
      - page: Detail
        bookmark: bm_q2
        filters: [{ table: DimDate, column: Quarter, values: [Q3, Q4] }]
concurrency: 5
viewsPerSession: 50
thinkTimeSec: 15
```

The HTML page reads this manifest (passed via querystring or postMessage) and runs the matching scenario. Migration path: setup script translates legacy per-folder configs into a single `loadtest.yaml` automatically on first v1.0 run.

**T10. Resource monitor sidecar (B3).** New `tools/resource-monitor/monitor.py` (~200 LOC, uses `psutil`). Samples CPU%, per-core, RAM%, network I/O once per second. Writes to `Test Results/<run>/host-metrics.jsonl`. If CPU > 90% or RAM > 95% for 30s rolling window, sets a flag `host_saturated: true` in a small status file that `RealisticLoadTest.html` polls and displays as a banner; the JS metric record includes `host_saturated` for any refresh that overlapped a saturation window so analysis can filter out invalid samples. **Does not auto-pause** (per user decision).

**T11. Real-time aggregated dashboard (lays groundwork for v2.0).** Extend the local Node helper from T8 into a small coordinator (~300 LOC). Browser instances POST each metric record to `http://127.0.0.1:7878/metric` (in addition to file logging — both paths write so a coordinator crash doesn't lose data). Coordinator:
- Aggregates a live counters dashboard at `http://127.0.0.1:7878/dashboard` (refreshes every 2s).
- Shows: total refreshes/sec, p50/p95 by report, by scenario; concurrent instance count; any error events; host saturation timeline from T10.
- **Architecture choice:** the coordinator endpoint is HTTP. In v2.0, remote VMs will POST to the *same* endpoint over the network. v1.0 binds to localhost only; v2.0 will add an `--bind 0.0.0.0` mode + auth.

**T12. Single-machine easy install (B4 — local half).** Three deliverables:
- `install.ps1` that downloads the latest release zip, expands to a chosen folder, runs `auth-config.json` setup wizard, registers Setup.html as a desktop shortcut.
- `winget` / `scoop` manifest (the user's preferred installer route — winget is recommended given Windows-only audience).
- A self-contained zip release on GitHub Releases including: HTML, vendored libs, Node helper, ChromeWriteBack (for now), monitor.py, sample `loadtest.yaml`. Single-zip-and-run.

### Files modified (v1.0)

- `RealisticLoadTestTool/RealisticLoadTest.html` (T11 — POST metrics to coordinator)
- `RealisticLoadTestTool/Setup_Load_Test.ps1` (deprecated; auto-redirect users to `Setup.html`)
- `RealisticLoadTestTool/Run_Load_Test_Only.ps1` (read `loadtest.yaml`, launch coordinator + monitor + browsers)

### Files added (v1.0)

- `RealisticLoadTestTool/Setup.html` (T8)
- `RealisticLoadTestTool/loadtest.example.yaml` (T9)
- `RealisticLoadTestTool/coordinator/server.js` (T8 + T11 — single Node script)
- `RealisticLoadTestTool/coordinator/dashboard.html` (T11)
- `tools/resource-monitor/monitor.py` (T10)
- `tools/resource-monitor/requirements.txt` (psutil)
- `install.ps1` (T12)
- `winget-manifest.yaml` (T12)
- `_Documentation/loadtest-yaml-schema.md` (T9)
- `_Test/v1.0-test-plan.md`

### Files removed (v1.0)

- `RealisticLoadTestTool/Filters.json`, `Bookmarks.json`, `Page.json` (replaced by `loadtest.yaml`)
- `RealisticLoadTestTool/Parameter Catalogue/` (per-report templates folder; superseded by YAML scenario blocks)

---

## Phase v2.0 — Distributed (design only in this plan)

Per user decision: build v1.0 architecture so v2.0 is straightforward, but **don't build v2.0 in this plan**. The coordinator from T11 is HTTP-based and JSONL-streaming, which is the only architectural commitment v2.0 needs.

Sketch of v2.0 work for future planning round:

- **T13. Replace ChromeWriteBack with Playwright.** Node script that orchestrates N browser pages, captures `page.on('console')` for `'METRIC '`-prefixed lines (T4 already laid this groundwork), supports headless mode for VMs.
- **T14. Service principal auth.** Cert-based; read SP credentials from env vars / Azure Key Vault on the VM.
- **T15. Bicep/Terraform templates.** N VMs from a template, cloud-init installs Playwright + Node + the tool, registers with the coordinator endpoint over HTTPS.
- **T16. Worker mode for the coordinator.** Workers register with `POST /workers/register`, receive scenario assignment, stream JSONL back. Coordinator handles fan-out and fan-in.
- **T17. Capacity Metrics App correlation.** Tag every embed session with a correlation ID; produce a follow-up Power BI report that joins T11's coordinator output to the Capacity Metrics App's operation log.

---

## Test plans (full content for `_Test/v0.8-test-plan.md` and `_Test/v1.0-test-plan.md`)

These are the full test specs. Steps 3 and 4 of the Implementation Order copy them verbatim into the `_Test/` folder. Each test has: ID, what it verifies, prerequisites, exact steps, pass criteria, fail criteria, traceability back to the backlog row.

### `_Test/v0.8-test-plan.md` content

**Coverage matrix (every backlog row in v0.8 has at least one test):**

| Test ID | Verifies | Backlog rows covered |
|---|---|---|
| TEST-V08-01 | Clean-machine bootstrap (regression baseline) | T1 |
| TEST-V08-02 | jQuery removal — no `$` references remain | T2 |
| TEST-V08-03 | SDK 2.23.x embed works against demo .pbix | T3 |
| TEST-V08-04 | JSONL output schema validity | B1, T4 |
| TEST-V08-05 | JSONL output content correctness vs displayed metrics | B1, T4 |
| TEST-V08-06 | MSAL silent token refresh during 8-hour run | T5 |
| TEST-V08-07 | MSAL fallback to popup on first-run / cache miss | T5 |
| TEST-V08-08 | `accessTokenProvider` returns null on failure (does not throw) | T5 |
| TEST-V08-09 | View-limit fix — `view.current` ends exactly at `numberOfViews` | T6 |
| TEST-V08-10 | Performance regression vs v0.7.1 baseline (within ±5%) | All v0.8 |
| TEST-V08-11 | Browser compatibility: Chrome, Edge, Firefox | T1, T3, T5 |
| TEST-V08-12 | `PBIToken.json` fallback path still works for non-MSAL tenants | T5 |

**Test details (selected — full version goes in `_Test/v0.8-test-plan.md`):**

```
TEST-V08-04: JSONL output schema validity
  Prerequisites:
    - v0.8 build deployed to a fresh test folder
    - Demo .pbix deployed; loadtest configured for numberOfViews=10
  Steps:
    1. Run the test to completion
    2. cd "Test Results/<run>"
    3. cat *.jsonl | jq . > /dev/null
    4. cat *.jsonl | jq -r 'keys | sort | join(",")' | sort -u
  Pass:
    - Step 3 exits 0 with no parse errors
    - Step 4 outputs exactly: bookmark,durationMs,event,filters,instanceId,
      pageName,projectName,reportId,runId,slicers,thinkTimeSec,ts,view,workspaceId
    - No <br> characters anywhere in the file: ! grep -q '<br>' *.jsonl
  Fail:
    - Any line fails JSON parse
    - Schema differs from documented schema in _Documentation/JSONL-schema.md
    - Any <br> tag appears

TEST-V08-06: MSAL silent token refresh during 8-hour run
  Prerequisites:
    - Entra app registration completed; auth-config.json populated
    - Test machine clock is correct
    - numberOfViews set high enough that test runs > 75 min (ensures token expiry)
  Steps:
    1. Open RealisticLoadTest.html in Chrome
    2. Sign in via MSAL popup
    3. Note the token expiry time from devtools (msal cache)
    4. Run for 75+ minutes
    5. After token would have expired, verify refreshes still occur
    6. cat Test Results/<run>/*.jsonl | jq 'select(.event=="error")'
  Pass:
    - All refreshes after the original 60-min mark complete successfully
    - No `auth_failure` or `token_expired` events in JSONL
    - JSONL view.current keeps incrementing past the 60-min mark
  Fail:
    - Any error event with auth/token in detail
    - Refresh count flatlines around the 60-min mark
    - Browser console shows uncaught exception from accessTokenProvider

TEST-V08-09: View-limit off-by-one fix
  Prerequisites:
    - v0.8 build, numberOfViews=15
  Steps:
    1. Run to completion
    2. tail -1 Test Results/<run>/*.jsonl | jq '.view'
  Pass:
    - Output is {"current":15,"target":15}
    - No row in *.jsonl has view.current > 15
  Fail:
    - Any view.current > 15 (this was the v0.7.1 bug — `16/15` rows in real data)

TEST-V08-10: Performance regression vs v0.7.1 baseline
  Prerequisites:
    - _Test/baselines/v0.7.1/ populated (from Implementation Order step 5)
    - v0.7.1 baseline summary documents avg/p50/p95
    - Same demo .pbix, same scenarios, same machine
  Steps:
    1. Run identical scenario on v0.8 build
    2. Parse JSONL: jq '.durationMs.current' *.jsonl | datamash mean 1 perc:50 1 perc:95 1
    3. Compare against baseline summary
  Pass:
    - Mean within ±5% of baseline
    - p95 within ±10% of baseline (allows for noise on slow renders)
  Fail:
    - Any aggregate >10% worse than baseline (investigate before shipping)
```

### `_Test/v1.0-test-plan.md` content

**Coverage matrix:**

| Test ID | Verifies | Backlog rows covered |
|---|---|---|
| TEST-V10-01 | End-to-end browser-only setup flow | B2, T8 |
| TEST-V10-02 | `loadtest.yaml` schema validation | T9 |
| TEST-V10-03 | YAML migration from v0.8 per-folder JSON | T9 |
| TEST-V10-04 | Resource monitor sampling (CPU/RAM/network at 1Hz) | B3, T10 |
| TEST-V10-05 | Resource monitor saturation flagging (CPU > 90% for 30s) | B3, T10 |
| TEST-V10-06 | Saturation flag propagates to in-test metric records | B3, T10 |
| TEST-V10-07 | Live dashboard renders p50/p95 within 2s of new data | T11 |
| TEST-V10-08 | Coordinator HTTP API: POST /metric accepts JSONL line | T11, B4b |
| TEST-V10-09 | Coordinator binds 127.0.0.1 only (security) | T11 |
| TEST-V10-10 | winget install on fresh Windows VM works first try | B4a, T12 |
| TEST-V10-11 | Single-zip release runs without admin rights | B4a, T12 |
| TEST-V10-12 | Architecture readiness: remote curl POST to /metric is accepted (with --bind 0.0.0.0 dev mode) | B4b |

**Test details (selected — full version goes in `_Test/v1.0-test-plan.md`):**

```
TEST-V10-05: Resource monitor saturation flagging
  Prerequisites:
    - v1.0 build, monitor.py running, dashboard at http://127.0.0.1:7878
  Steps:
    1. Start a load test
    2. Open a separate terminal
    3. Run a CPU-burner: yes > /dev/null & x4 (or stress-ng if available)
    4. Wait 35 seconds
    5. Observe dashboard banner
    6. cat Test Results/<run>/host-metrics.jsonl | jq 'select(.host_saturated==true)' | head -1
  Pass:
    - Dashboard shows saturation banner within 30-35s of yes processes starting
    - host-metrics.jsonl has at least one record with host_saturated=true
    - banner clears within 30s of killing yes processes
  Fail:
    - No banner shown
    - host-metrics.jsonl missing host_saturated field

TEST-V10-06: Saturation flag in test-metric records
  Prerequisites:
    - Same as TEST-V10-05
  Steps:
    1. Repeat saturation steps above
    2. cat Test Results/<run>/<instanceId>.jsonl | jq 'select(.host_saturated==true) | .ts' | head -3
    3. Compare timestamps to host-metrics.jsonl saturation window
  Pass:
    - Test-metric rows captured during saturation window have host_saturated=true
    - Test-metric rows outside the window have host_saturated=false (or omitted)

TEST-V10-09: Coordinator security — localhost-only by default
  Prerequisites:
    - v1.0 build running, coordinator on localhost:7878
  Steps:
    1. Get the machine's LAN IP: ip addr | grep inet
    2. From a second machine on the same LAN: curl http://<lan-ip>:7878/dashboard
  Pass:
    - Connection refused / timeout — coordinator does not accept LAN traffic by default
  Fail:
    - HTML returned — coordinator is exposing dashboard to LAN, security regression
```

---

## Verification

End-to-end test plan per phase. Each phase has an explicit pass/fail check.

### v0.8 verification

1. **Clean-machine bootstrap test.** On a fresh Windows VM with only Chrome installed: clone repo, run `Setup_Load_Test.ps1`, run `Update_Token_Only.ps1` (with deprecation warning), run `Run_Load_Test_Only.ps1`. The Power BI report must render. (Pre-T1 baseline test — proves the rawgit issue blocks new users today.)
2. **MSAL silent refresh.** 8-hour test run with `numberOfViews: 1000`. After 60 minutes (when the original token would have expired), refreshes continue without intervention. JSONL log shows no `auth_failure` events.
3. **JSONL validity.** Every line of `<run>/<instanceId>.jsonl` parses with `jq`. Schema matches `_Documentation/JSONL-schema.md`. No `<br>` characters anywhere in the output.
4. **View-limit fix.** Run with `numberOfViews: 15`; final `view.current` in JSONL is exactly 15 (not 16).
5. **Backwards compatibility.** Demo .pbix from this repo runs the same scenario in v0.7.1 and v0.8.0 on the same machine; average refresh time within ±5%.
6. **Browser compatibility.** Chrome, Edge, Firefox all load the page and produce metrics.

### v1.0 verification

1. **End-to-end no-PowerShell flow.** Open `Setup.html` in a browser, log in via MSAL, configure a 2-report 4-scenario test for the demo .pbix, click "Generate". A `loadtest.yaml` appears on disk. Click "Run". Browsers open. Metrics flow to dashboard.
2. **Resource monitor flag test.** While a test is running, deliberately spawn extra Chrome instances to push CPU > 90%. The dashboard shows the saturation banner within 30s. JSONL records during the saturation window have `host_saturated: true`.
3. **Live dashboard.** Open `http://127.0.0.1:7878/dashboard`. Counter increments in real-time as refreshes complete. p95 updates within 2s.
4. **Migration test.** Run `migrate-config.ps1` on an existing v0.8 test folder; resulting `loadtest.yaml` parses and runs to identical metrics.
5. **Easy install.** On a fresh Windows machine: `winget install RealisticLoadTest`. Open the Start Menu shortcut. Tool launches without errors.
6. **Architecture readiness for v2.0** (design check, not full test). Verify the coordinator API: `POST /metric` accepts a JSONL line over the network from a remote curl, responds 200. Document the worker registration endpoint stub even though no worker is built.

### v2.0 verification (design only)

Documented in this plan but no execution. Will be planned separately.

---

## Security considerations

**v0.8:**
- MSAL `clientId` and `tenantId` are NOT secrets; the example file can be committed. Real tenant configs go in `auth-config.json` which must be added to `.gitignore`.
- Vendored libs need SRI hashes; document the source URL and version in a comment at the top of each `lib/*.js` file.
- Tokens stay in memory only (no longer persisted to `PBIToken.json`). The fallback path that uses `PBIToken.json` is left in for tenants without app registration but flagged as not-recommended in docs.
- The SDK requires `accessTokenProvider` to return `null` on failure (not throw) — the wrapper catches all MSAL exceptions and returns null.

**v1.0:**
- Local coordinator binds to `127.0.0.1` only. Adding `--bind 0.0.0.0` for v2.0 will require an auth token mechanism — design decision deferred to v2.0 plan.
- `loadtest.yaml` may contain workspace IDs and report IDs (not secrets but identifying info); add to `.gitignore` template, commit `loadtest.example.yaml` only.
- Resource monitor reads only the local process metrics; no remote calls.
- Setup.html → Node helper communication is on localhost only, but accept origin only from `file://` or `http://localhost:*`.

**v2.0 (design):**
- Service principal cert is the only secret on a VM. Use Azure Managed Identity where possible; if not, bind cert to the VM's local user store and reference by thumbprint.
- Coordinator-worker traffic goes over HTTPS with a per-run pre-shared token (in `loadtest.yaml`).
- IaC templates use Azure RBAC to scope the SP to a single capacity, never tenant admin.

---

## Success criteria

**v0.8 ships when:**
- [ ] Tool loads and runs on a fresh Windows machine with no internet access beyond Power BI itself
- [ ] An 8-hour run completes without manual token refresh
- [ ] All log output is valid JSONL — `cat <run>/*.jsonl | jq .` succeeds
- [ ] No off-by-one in `view.current` field
- [ ] Footer version reads `0.8.0`
- [ ] Updated `Readme.md` and `UserGuide.html` reflect the new flow
- [ ] All v0.8 verification tests pass

**v1.0 ships when:**
- [ ] User can configure and run a new test entirely in browser without opening PowerShell
- [ ] Live dashboard updates p50/p95/throughput in real-time
- [ ] Resource monitor catches a deliberate overload and flags affected metrics
- [ ] Single-zip + winget install on a clean Windows VM works first try
- [ ] Architecture supports v2.0: coordinator HTTP API documented; JSONL streamable; service-principal hook stubbed
- [ ] All v1.0 verification tests pass

**v2.0 (design ship in v1.0):**
- [ ] Architecture document at `_Documentation/v2-distributed-architecture.md` describes the worker/coordinator protocol, IaC layout, and SP auth — ready to plan in detail later

---

## Critical files to modify (full list)

| File | Phase | Change type |
|---|---|---|
| `RealisticLoadTestTool/RealisticLoadTest.html` | v0.8 | T1, T2, T3, T4, T5, T6 — major edit |
| `RealisticLoadTestTool/Readme.md` | v0.8 | rewrite to reflect new flow |
| `RealisticLoadTestTool/UserGuide.html` | v0.8 | rewrite |
| `RealisticLoadTestTool/Setup_Load_Test.ps1` | v1.0 | deprecate; redirect to Setup.html |
| `RealisticLoadTestTool/Run_Load_Test_Only.ps1` | v1.0 | rewrite — read loadtest.yaml, launch coordinator + monitor + browsers |
| `RealisticLoadTestTool/Update_Token_Only.ps1` | v0.8 | deprecation banner |
| `_Plan/Backlog.md` | now | add B1–B4 entries pointing to this plan file |

## Existing patterns to reuse

- The current `CefSharp.PostMessage(...)` writeback hook in `RealisticLoadTest.html:329` and `:457` already provides per-refresh and per-error log channels — repurpose them to emit JSONL strings instead of HTML strings (T4). Same channel; structured payload.
- The metrics-table panel structure (`RealisticLoadTest.html:548–596`) is good UX; keep it for live human view, drive it from the same JSONL record.
- The randomized filter-permutation cycling logic in `RealisticLoadTest.html:149–245` is the design's correctness core — preserve unchanged across all three phases.
- The MSAL-suitable scope `https://analysis.windows.net/powerbi/api/.default` (delegated) and the Power BI REST API endpoints used by `Setup_Load_Test.ps1:101,116` (`Get-PowerBIWorkspace`, `Get-PowerBIReport`) tell us exactly which REST endpoints the new web UI needs to call (`GET /groups`, `GET /groups/{id}/reports`).

## Out of scope (explicit non-goals)

- **Power BI custom visual testing** — different problem domain.
- **Migration of the sibling `LoadTestingPowerShellTool/`** — separate tool, not affected.
- **Mac/Linux support** — Windows-only target; Playwright in v2.0 may incidentally enable cross-platform but not committed.
- **Replacing the demo `.pbix`** — keep as-is; converting to `.pbip` is its own discussion.
- **Power BI Premium → Fabric F SKU sizing guide** — docs-only, can be a separate small task.

---

## Open items I will resolve as I implement (won't block start)

1. Exact `powerbi-client` minor version to pin (will pick the latest stable from npm at v0.8 implementation time).
2. Node vs Python for the coordinator (leaning Node for ecosystem fit with the browser-side JS; final call after a 30-min spike).
3. winget vs scoop vs raw zip for v1.0 install (will produce all three; winget recommended in docs).
