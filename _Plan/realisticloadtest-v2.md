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

**T5a. Sign-in button (popup must originate from a user gesture).** *Discovered during first end-to-end smoke test on 2026-05-05.* The MSAL `acquireTokenPopup` call in T5 was wired to fire automatically during page bootstrap. Modern browsers (Chrome/Edge/Firefox) silently block any popup that isn't triggered synchronously from a user click — the result was `popup_window_error` on every first-time load.

Fix: split `acquireToken()` into `acquireTokenSilent()` (used by bootstrap and by the SDK's runtime `accessTokenProvider` hook) and `acquireTokenInteractive()` (only ever called from a button click handler). Bootstrap flow becomes: try silent first → if a token comes back, proceed; if MSAL is configured but silent missed (no cached account), show a "Sign in with Microsoft" button and wait for a click; if no MSAL at all, fall back to the legacy error path. After the click, the popup opens cleanly because the browser sees a real user gesture. After the first successful sign-in the token caches in `localStorage`, so subsequent visits acquire silently with no button or popup.

Also locked down: `tokenProvider()` (the SDK runtime hook called minutes before token expiry) is now silent-only. Popping up a sign-in window mid-test would be hostile.

Lesson recorded in `MEMORY.md`. Backlog row: T5a.

**T5b. Remove legacy `PBIToken.json` auth path (MSAL becomes mandatory).** *Decided 2026-05-05 after the legacy fallback was confirmed working but added unwanted dual-path complexity.*

The original v0.8 plan called for backwards-compatibility: when `auth-config.json` was missing, the page would fall back to reading a token from `PBIToken.json` (refreshed every 60 min by `Update_Token_Only.ps1`). After getting MSAL working end-to-end, the user opted to drop the legacy path entirely. Reasoning:
- MSAL is the modern, sustainable auth model. Two paths means two test surfaces and two bug surfaces forever.
- The legacy path required users to *remember* to run `Update_Token_Only.ps1` every hour — exactly the friction MSAL was meant to eliminate.
- Tenants that can't register an Entra SPA app are a small minority and can stay on v0.7.1 (or wait for v1.0 service-principal options).

Fix in `RealisticLoadTest.html`:
- Remove `<script src="PBIToken.json">` tag — `accessToken` global no longer defined.
- Remove the legacy fallback in `acquireTokenSilent()`. Function now early-returns null if `msalApp` is null.
- Simplify bootstrap error path: when MSAL isn't configured, show a clear "configure auth-config.json" message instead of "Run Update_Token_Only.ps1 (legacy) or…".
- `updateAuthBanner()` no longer dispatches between "legacy mode" and "MSAL mode" — banner is hidden by default and only shown by `showAuthError()`.

**Multi-window concurrency consequence (accepted by user):** `Run_Load_Test_Only.ps1` launches CefSharp `ChromeWriteBack` windows via `file://` URLs. Entra rejects `file://` redirect URIs, so MSAL physically cannot work in CefSharp. Without the legacy `PBIToken.json` fallback, multi-window runs have no working auth path in v0.8. **Resolution: wait for v1.0 Playwright runner (T13), which uses Chromium with `http://localhost` and supports MSAL natively.** Documented in the Readme with a clear ⚠️ banner.

**Files kept on disk (deleted in v1.0):**
- `RealisticLoadTestTool/PBIToken.json` (template — only because `Setup_Load_Test.ps1` still emits per-folder copies)
- `RealisticLoadTestTool/Update_Token_Only.ps1` (banner now reads "v0.8 DEAD CODE — script will be deleted in v1.0")
- `RealisticLoadTestTool/ChromeWriteBack/`
- PBIToken-writing logic inside `Setup_Load_Test.ps1`

These get deleted as backlog row T13a alongside the Playwright migration.

**Test plan impact:**
- TEST-V08-12 (legacy fallback) removed — there's nothing to test. Test count drops from 12 → 11.
- T5 coverage matrix row updated to drop V08-12.
- Exit criteria updated to require all 11 active tests Pass.

**Removed from "What's new in v0.8":** the `Backwards-compatible` bullet. Replaced with an explicit "Legacy `PBIToken.json` auth path removed" bullet plus a multi-window-broken warning at the top of the Readme.

Backlog row: T5b. Pair v1.0 cleanup tracked as T13a.

**T4b. JSONL schema refinement — drop average, flag first render.** *Discovered while analysing the first ad-hoc test on 2026-05-05.* Original v0.8 emit had `durationMs: { current: 1341, average: 6222 }` per record. Two problems:

1. `average` is an aggregate, not a measurement — derivable from `current` values at analysis time. Emitting it per record duplicates information and complicates the schema.
2. The first render after a page load incurs cold-start cost (auth handshake + SDK init + initial iframe load). Including it in the same series as steady-state renders skews aggregates. Dropping it would lose the "first user impression" data point — which IS valuable, just for a different question.

Fix:
- Flatten `durationMs` to a plain integer (ms). Aggregates stay out of the wire format.
- Add `isFirstRender: boolean`. `true` for the first `rendered` event after every page load (including periodic `sessionRestart` reloads, since each is a fresh user experience). `false` thereafter. Lets analysis split warmup from steady state without guessing.
- Remove the on-screen "Average Refresh" cell (same reasoning — the live UI was carrying the same useless aggregate). Keep "Current Refresh" with a `(cold start)` suffix when `isFirstRender` is true.

Impact:
- Test plan TEST-V08-04 updated — different events now legitimately have different key sets (rendered has +2 keys, error has +2 keys, etc.). The old "all rows have exactly the same 14 keys" expectation was wrong even before T4b.
- JSONL schema doc updated with new shape, parsing tips for steady-state-only aggregates, and the per-event-type expected-key-set table.

Backlog row: T4b.

**T7b. In-page Setup picker (MVP of B2/T8).** *Discovered during first end-to-end smoke test on 2026-05-05.* User opened `RealisticLoadTest.html` directly with the empty template `PBIReport.json` in place and got `Embed Url is required`. The original PowerShell setup (`Setup_Load_Test.ps1`) had a workspace/report picker; v0.8 dropped users into a "configure JSON by hand or run PowerShell" cliff for ad-hoc tests.

Fix: add an in-page Setup panel that's shown when `reportParameters.reportUrl` is empty. Flow:
1. After MSAL token (silent or click), check if `embedUrl` is set.
2. If empty → call `GET /v1.0/myorg/groups` (Power BI REST), populate workspace dropdown.
3. On workspace select → call `GET /v1.0/myorg/groups/{id}/reports`, populate report dropdown.
4. User picks report + sets `numberOfViews`, `thinkTimeSeconds`, `projectName`.
5. Click "Start Test" → override module-scope globals with picker values, hide panel, run `EmbedReport()`.

Filter/bookmark/page UI is **deferred to T8 (v1.0)** — this is the MVP for ad-hoc workspace+report selection only. Repeatable scenarios with filters still use `Setup_Load_Test.ps1` (writes per-test subfolders). The picker complements the PowerShell flow, doesn't replace it.

New scope requirement: `Workspace.Read.All` (delegated, admin-consented). If only `Report.Read.All` is granted, the picker shows a permission error pointing to `_Documentation/MSAL-app-registration.md`. Both `auth-config.example.json` and the MSAL doc updated to require this.

REST helpers: tiny `pbiFetch(token, path)` wrapper that calls `https://api.powerbi.com/v1.0/myorg<path>` with the bearer token; throws on non-2xx with status + first 300 chars of body for diagnostics.

Backlog row: T7b. Future filter/bookmark/page-picker work continues under T8.

### Files modified (v0.8)

- `RealisticLoadTestTool/RealisticLoadTest.html` (T1, T2, T3, T4, T4b, T5, T5a, T5b, T6, T7b)
- `RealisticLoadTestTool/Readme.md` (T7, T5a, T5b, T7b, T4b)
- `RealisticLoadTestTool/UserGuide.html` (T7, T5a, T7b)
- `_Documentation/JSONL-schema.md` (T4, T4b)
- `_Documentation/MSAL-app-registration.md` (T5, T5a, T5b, T7b)
- `_Test/v0.8-test-plan.md` (TP1, T4b — TEST-V08-04 updated for per-event key sets; T5b — TEST-V08-12 removed)
- `RealisticLoadTestTool/Update_Token_Only.ps1` (T5b — banner upgraded to "v0.8 DEAD CODE")
- `RealisticLoadTestTool/auth-config.example.json` (T7b — added `Workspace.Read.All` scope)
- `RealisticLoadTestTool/auth-config.json` (T7b — added `Workspace.Read.All` scope)
- `_Documentation/MSAL-app-registration.md` (T7, T5a, T7b)
- `.gitignore` (T5 — added `RealisticLoadTestTool/auth-config.json`; doc had claimed it was ignored but rule was missing)

### Files added (v0.8)

- `RealisticLoadTestTool/lib/powerbi-client-2.23.x.min.js` (vendored)
- `RealisticLoadTestTool/lib/msal-browser-3.x.x.min.js` (vendored)
- `RealisticLoadTestTool/auth-config.json` (template — `clientId`, `tenantId`, `scopes`)
- `RealisticLoadTestTool/auth-config.example.json` (committed example)
- `_Documentation/MSAL-app-registration.md` (one-time Entra setup steps)
- `_Documentation/JSONL-schema.md` (the metric record schema for v0.8)
- `_Test/v0.8-test-plan.md` (test plan — see TP1)
- `MEMORY.md` (lessons captured during v0.8 smoke testing — MSAL popup-on-load, exact-string redirect URI matching, gitignore claims-vs-reality)

### Files unchanged (v0.8) — explicit non-goals

- `Setup_Load_Test.ps1` — still works as before; UI replacement is v1.0. The in-page T7b picker is a complement (ad-hoc), not a replacement (no filters/bookmarks).
- `Run_Load_Test_Only.ps1` — still launches ChromeWriteBack; Playwright is v2.0
- `ChromeWriteBack/` — kept, unchanged

### B5 — Capture report-render errors as a feature *(Research)*

**Status:** Backlog / Research — not yet scoped.

**Origin (2026-05-05):** During the first ad-hoc test run via the in-page Setup picker, the DevTools console showed a Power BI iframe-internal warning:

```
Expected value to be of type number, but found null instead.
  at <blob-url>:1
```

The render still completed (`durationMs: 21106` was emitted), so our existing `report.on('error')` SDK-level handler caught nothing. The warning came from inside the embedded iframe — a visual or measure produced a null where a numeric value was expected. This kind of report-quality issue is **invisible to the load test today**: timings come back, JSONL fills, capacity metrics look fine, but the report has a broken visual nobody can see.

For capacity stress testing this matters because:
- A report that errors on certain filter combinations will skew capacity metrics (errored visuals don't run queries → misleadingly low CU)
- Tenants running this tool to evaluate report scalability want to know "this report has visual X failing on slicer combination Y" *as part of the same run*, not in a separate manual investigation
- Visuals that silently fail in production are a real source of user-reported "the dashboard is broken" tickets that load testing could catch in advance

**Open research questions (must answer before designing):**

1. **What error / warning surfaces does the Power BI JS SDK actually expose?**
   - `report.on('error')` — SDK-level (already wired). What event types does it fire?
   - `report.on('visualRendered')` / `report.on('visualClicked')` — per-visual events. Do they carry error state?
   - `report.on('dataSelected')` / `report.on('rendered')` — do these have an error sub-channel?
   - `console` capture from inside the iframe — possible? Cross-origin restrictions likely block it.
   - The `dataLoaded` event — does it surface query failures?
   - `getErrors()` method on visuals/pages — exists?
2. **What's the difference between an iframe-internal validation log and an actual SDK error?** The "Expected value to be of type number" line came from a `blob:` URL inside the iframe. Cross-origin SOP almost certainly prevents us from reading those console messages from the parent page. Is there a postMessage channel the SDK exposes?
3. **What's the right granularity?** Per-visual error events (lots of noise, hard to aggregate)? Per-page error counts? Per-render summary (`renderErrors: number`)?
4. **JSONL schema impact.** Add a new `event: "render_error"` record? Add a `renderErrors: count` field on existing `rendered` events? Both?
5. **Performance impact.** Each additional event listener costs cycles; subscribing to per-visual events for 50 visuals × 1000 renders × 10 instances is non-trivial.
6. **What does the Power BI Capacity Metrics App already show for failed visuals?** If it already attributes failures, our load-test surfacing might be redundant.

**Hypothetical implementation sketch (subject to research outcome):**

```js
// On embed:
report.on('error', emitErrorMetric);     // already wired
report.on('visualRendered', evt => {
    if (evt.detail && evt.detail.error) emitErrorMetric(evt);
});
// New JSONL event type:
{ "event": "render_error", "visualName": "...", "errorCode": "...", "errorDetail": "..." }
```

**Deliverables when this graduates from Research → In Progress:**
- A research doc at `_Research/pbi-sdk-error-surfaces.md` answering the questions above
- A design proposal in this plan (new section §v?.?-B5)
- A test plan addition (TEST-V?-?? for the new event capture)

**Phase placement:** TBD — most likely v0.9 (a v0.8.x patch series) if the SDK already exposes enough hooks, or v1.0 if it requires the resource-monitor sidecar to bridge the iframe boundary.

Backlog row: B5.

---

### B6 — Capture Log Analytics query telemetry *(Research)*

**Status:** Backlog / Research — not yet scoped.

**Origin (2026-05-05):** Discussed alongside B5 while looking at what *real* root-cause data load tests should produce. Today the JSONL captures wall-clock render duration per cycle. That tells you "render took 6 s" but not "*why* — was it a slow DAX query, a slow SE scan, capacity throttling, a redirect to a different node?" The answers all live in Power BI's backend telemetry, surfaced via **workspace-level Log Analytics integration** (settings → Azure connections → Log Analytics).

When LA is connected to the workspace under test, every report query fires a record to the customer's Log Analytics workspace with: DAX query text, duration, SE/FE split, dataset, user, activity ID, capacity ID, throttling state, error code, and more (full schema in the `PowerBIDatasetsWorkspace` table). If the load test pulls these records back and joins them per render via Activity ID, capacity-stress runs become *root-cause* investigations instead of just timing distributions.

**Why it matters for capacity stress testing:**
- A 6 s render breaks down into "5.2 s DAX, 0.8 s rendering" vs "0.3 s DAX, 5.7 s capacity throttling delay" — completely different fixes (model tuning vs capacity sizing) but same wall-clock number from the JS SDK
- Slow visuals on specific filter combinations are usually one slow SE scan; LA shows you the exact query text so you can repro in DAX Studio without guessing
- Capacity CU consumption per render lets you correlate "this filter combination costs 12 CU each" — usable for sizing decisions
- Throttling events that happen mid-test are invisible to the JS SDK (it just sees longer renders); LA shows them explicitly with `OperationDetailName: "ThrottlingDelay"`

**Open research questions (must answer before designing):**

1. **Auth model.** LA queries hit `https://api.loganalytics.io` (or via `https://management.azure.com` + ARM API). Different audience than Power BI service — needs a **separate MSAL scope** (`https://api.loganalytics.io/Data.Read` or `https://management.azure.com/user_impersonation`). Can the same MSAL flow request both scopes (incremental consent)? Or does this need a service principal for unattended runs?
2. **What table and what columns?** `PowerBIDatasetsWorkspace` is the main one. Confirm: which columns identify a single visual query vs a refresh vs a metadata fetch. The `OperationName` enum has many values — only some are query-related.
3. **Correlation key.** Power BI exposes an Activity ID at the dataset query level (in LA) and at the report render level (in the JS SDK via `report.getCorrelationId()` or similar — needs verification). Does the chain hold reliably? What's the fallback if Activity IDs don't match (e.g., same DAX served from cache)?
4. **Latency.** LA records typically appear **2–5 minutes after the event** (sometimes longer under load). The load test would need to either:
   (a) wait until run end, then bulk-fetch and join asynchronously to a separate `<instanceId>.la.jsonl` file, OR
   (b) poll LA during the run with a delay buffer, accepting partial enrichment
5. **Permissions / config the user must provide.** LA workspace ID, subscription ID, resource group, and Read access for the test identity. Make this an opt-in section in `auth-config.json` (e.g., `logAnalytics: { workspaceId, subscriptionId, resourceGroup, scope }` — absent = feature disabled).
6. **JSONL schema impact.** Two options:
   (a) New event type `event: "render_telemetry"` with full LA columns, joined by `activityId`. Keeps the live `rendered` event lean.
   (b) Enrich `rendered` events post-hoc by rewriting the JSONL — fragile, breaks "append-only" property.
   Option (a) is cleaner; produces a sibling `.la.jsonl` file per instance.
7. **Cost.** LA queries are billed per GB scanned. A 30-min load test produces O(thousands) of records. Estimate: well under $1 per run for typical scenarios, but worth measuring.
8. **Failure mode when LA isn't configured.** Most users won't have LA wired up. Feature must degrade silently to current behaviour — a one-line console message ("LA enrichment disabled — no `logAnalytics` block in `auth-config.json`") is enough. Never block the test.

**Hypothetical implementation sketch (subject to research outcome):**

```js
// In auth-config.json (optional block):
"logAnalytics": {
    "workspaceId": "00000000-0000-0000-0000-000000000000",
    "subscriptionId": "...",
    "resourceGroup": "...",
    "scope": "https://api.loganalytics.io/Data.Read"
}

// At end of run (view_limit_reached):
const kql = `
PowerBIDatasetsWorkspace
| where TimeGenerated between (datetime("${runStartIso}") .. datetime("${runEndIso}"))
| where DatasetId == "${datasetId}"
| where OperationName in ("QueryEnd", "VisualContainerOnRender", "ProgressReportEnd")
| project TimeGenerated, OperationName, DurationMs, Identity, ActivityId,
          DatasetId, ReportId, CapacityId, OperationDetailName, ErrorCode
`;
const results = await fetch(`https://api.loganalytics.io/v1/workspaces/${laWorkspaceId}/query`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + laToken },
      body: JSON.stringify({ query: kql }) });
// Write to <instanceId>.la.jsonl
```

**Deliverables when this graduates from Research → In Progress:**
- A research doc at `_Research/pbi-log-analytics-integration.md` answering the 8 questions above, including a real KQL query that returns useful columns and a sample joined record
- A design proposal in this plan (new section §v?.?-B6)
- A test plan addition for opt-in coverage (TEST-V?-?? — runs only when LA is configured)
- Auth-config.json schema extension and example values

**Phase placement:** TBD — likely v1.0 (it complements the resource monitor B3, where local CPU/RAM joins server-side query telemetry for end-to-end attribution) or pulled later into v2.0 (where the multi-VM coordinator already needs a place to receive heterogeneous data streams).

Backlog row: B6.

---

### Known v0.8 limitations (carry into v0.8.x or v1.0)

- **Per-test subfolders run by `Setup_Load_Test.ps1` / `Run_Load_Test_Only.ps1`** still ship the v0.7.1 HTML — those folders existed before v0.8 and were not regenerated. The vendored `lib/` and `auth-config.json` live at the tool root, so a new subfolder created by v0.8 `Setup_Load_Test.ps1` would also need either `../lib/`-style relative paths in the HTML or its own copies of `lib/` and `auth-config.json`. **Backlog item to add:** wire setup script to handle this. Until fixed, the v0.8 HTML is only correct when run from the tool root.
- **In-page Setup picker has no filter/bookmark/page UI** — that's T8 in v1.0.
- **`/groups` returns first 1000** — no pagination yet. Tenants with >1000 workspaces will see a truncated list.

---

## Phase v1.0 — REVISED 2026-05-05: vertical slices, Playwright-first

**Why this revision:** The original v1.0 ordering (T9 → T11 → T10 → T8 → T12) treated CefSharp as a v2.0 problem. After v0.8 shipped, the dual auth path (MSAL for single-window + the now-removed PBIToken.json fallback for CefSharp multi-window) made CefSharp the single largest source of complexity and the *reason* multi-window MSAL is broken. Pulling Playwright (T13) forward as Stage 1 deletes CefSharp on day 1, fixes multi-window auth, and unlocks T13a immediately. Each stage below is independently shippable and end-to-end testable.

### Stage 1 — Playwright runner kills CefSharp (T13 + T13a moved up from v2.0)

**Goal:** Identical user experience to v0.8 (existing `PBIReport.json` / `Filters.json` configs) but launched by Node + Playwright instead of `Run_Load_Test_Only.ps1` + CefSharp.

**Build:**
- `runner/run.js` — Node + Playwright. Launches N Chromium contexts at `http://localhost:PORT/RealisticLoadTest.html`, captures `page.on('console')` for `'METRIC '`-prefixed lines (the prefix is already in v0.8 — T4 laid this groundwork), writes `Test Results/<run>/<instanceId>.jsonl`.
- Tiny static file server inside the runner so HTML is served via `http://localhost` (MSAL-compatible — solves the multi-window auth problem from T5b).
- `runner/package.json` (Playwright + nothing else).

**Deletes (T13a moved up from v2.0):**
- `RealisticLoadTestTool/PBIToken.json` template
- `RealisticLoadTestTool/Update_Token_Only.ps1`
- `RealisticLoadTestTool/ChromeWriteBack/` (entire directory)
- `RealisticLoadTestTool/Run_Load_Test_Only.ps1` (replaced by `node runner/run.js`)
- PBIToken-writing logic in `Setup_Load_Test.ps1` (script kept, just stripped of legacy token plumbing)
- `CefSharp.PostMessage` writeback path in `RealisticLoadTest.html` (only `console.log('METRIC ' + ...)` remains)

**Vertical test:** Run multi-window (concurrency=2) on the demo `.pbix` using existing `PBIReport.json`. JSONL output matches single-window v0.8 schema. MSAL silent refresh works in all windows.

**Outcome:** CefSharp dead. Auth path is single (MSAL only). T7c (per-test subfolder relative paths) becomes obsolete because HTML is served from a single root.

### Stage 2 — Coordinator HTTP API + live dashboard (T11 / B4b)

**Goal:** Live aggregation across all instances; multi-VM architecture provable.

**Build:**
- Extend Stage 1's static server into `coordinator/server.js`. Endpoints: `POST /metric`, `GET /dashboard`, `GET /status`. Localhost-only by default; `--bind 0.0.0.0 --dev` flag for B4b architecture-readiness check (logs source IP).
- `coordinator/dashboard.html` — vanilla JS, polls `/status` every 2s, shows total throughput, p50/p95 per report, error events, instance count.
- Dual-write: runner writes JSONL to file *and* POSTs each parsed metric to `/metric` (coordinator crash doesn't lose data; coordinator off entirely is fine — file path still works).

**Vertical test:** TEST-V10-07, V10-08, V10-09, V10-12.

### Stage 2.5 — Apply OneDayBI brand to all views (B7)

**Why now:** The dashboard from Stage 2 is the most-looked-at surface in the tool. Stage 5 (`Setup.html`) is the next new HTML to ship. Re-skinning the existing three HTML views (`RealisticLoadTest.html`, `coordinator/dashboard.html`, `UserGuide.html`) once now means Stage 5 inherits the brand from day 1, and we never go back to retro-skin three files.

**Brand source:** `C:\Users\kavas\Documents\GitHub\OneDayBI Marketing\Design\OneDayBI_Brand_Style_Reference.md`. Key elements:
- **Palette:** Navy Dark `#0F172A`, Navy `#1E293B`, Slate `#334155`, Amber `#F59E0B`, Off-White `#F8FAFC`, Light Grey `#E2E8F0`. Replaces the current ad-hoc `#2c3e50` / `#3498db` / `#ecf0f1` palette.
- **Typography:** Arial for headings, Calibri for body (already partially used as `'Segoe UI'` fallbacks — keep Segoe UI as Windows-friendly fallback in `font-family` chains).
- **Visual motifs:** 6px amber top bar on every page; left amber accent bar on cards; subtle card shadows; dark-navy footer with "onedaybi.com".
- **Logo:** `onedaybilogo_dark_transparent.svg` (white text — for navy backgrounds) and `onedaybilogo_transparent.svg` (navy text — for light backgrounds).

**Build:**
- New file `RealisticLoadTestTool/lib/onedaybi.css` — single source of truth for brand tokens. Defines CSS custom properties (`--color-navy`, `--color-amber`, `--font-heading`, etc.) plus reusable component classes (`.card`, `.btn-primary`, `.amber-top-bar`, `.brand-footer`).
- Copy two logo SVGs into `RealisticLoadTestTool/lib/`: `onedaybi-logo-dark.svg` (white text version, for the dark dashboard header) and `onedaybi-logo-light.svg` (navy text version, for light page headers).
- Refactor `RealisticLoadTest.html`: replace inline `<style>` palette with `<link rel="stylesheet" href="lib/onedaybi.css">` + minimal page-specific overrides. Apply amber top bar, amber accent on cards, brand footer.
- Refactor `coordinator/dashboard.html`: same. Header gets the dark logo + amber top bar. Cards get the brand color treatment.
- Refactor `UserGuide.html`: same. Document sections get the brand H1/H2 styles.
- Update version footer to `1.0.0-stage2.5`.

**Out of scope (explicit non-goals):**
- Brand voice / copy edits — separate concern; existing technical copy stays.
- Accessibility audit (contrast ratios, ARIA) — folded into a future enhancement if needed.
- Marketing-site additions — this is product UI only.
- Setup picker / wizard wireframe redesign — Stage 5 will design the wizard from scratch using the brand CSS this stage produces.

**Vertical test:** Visual smoke check —
1. Coordinator dashboard at `/dashboard` shows amber top bar, dark navy header with logo, brand-coloured cards, slate text, amber footer.
2. `RealisticLoadTest.html` shows the same brand treatment.
3. `UserGuide.html` shows the same.
4. Single CSS file (`lib/onedaybi.css`) referenced by all three.
5. No regressions: dashboard still polls /status, embed still renders, in-page Setup picker still works.

**Files added:**
- `RealisticLoadTestTool/lib/onedaybi.css`
- `RealisticLoadTestTool/lib/onedaybi-logo-dark.svg`
- `RealisticLoadTestTool/lib/onedaybi-logo-light.svg`

**Files modified:**
- `RealisticLoadTestTool/RealisticLoadTest.html` (style tag → linked CSS + class additions)
- `RealisticLoadTestTool/coordinator/dashboard.html` (style tag → linked CSS + class additions)
- `RealisticLoadTestTool/UserGuide.html` (style tag → linked CSS + class additions)

**Backlog row:** B7.

**Tooling note:** the repo's `brand-guidelines` skill (multi-brand: onedaybi, selfservicebi) can be invoked to do the actual CSS extraction and apply-to-views work consistently. Spec says `Specify which brand to use (e.g., "onedaybi", ...)` — invoke as `Skill brand-guidelines onedaybi` when implementing.

---

### Stage 3 — Resource monitor sidecar (T10 / B3)

**Goal:** Catch host CPU/RAM saturation that silently invalidates metrics.

**Build:**
- `tools/resource-monitor/monitor.py` — psutil, 1Hz sampling, writes `host-metrics.jsonl`, POSTs saturation status to coordinator's new `/saturation` endpoint.
- `RealisticLoadTest.html` polls coordinator `/status` for current saturation flag, stamps `host_saturated: true` onto any metric record emitted during a saturation window.
- Dashboard shows red banner during saturation.

**Vertical test:** TEST-V10-04, V10-05, V10-06.

### Stage 4 — YAML config + migration (T9)

**Goal:** Replace per-folder JSON files with one `loadtest.yaml`.

**Build:**
- `loadtest.example.yaml`, `_Documentation/loadtest-yaml-schema.md`.
- Runner reads YAML, opens one Chromium context per concurrency slot per scenario.
- `coordinator/migrate.js` — `node migrate.js <v0.8-folder>` produces `loadtest.yaml`.

**Vertical test:** TEST-V10-02, V10-03.

### Stage 5 — Unified control plane + Setup.html (T8 / B2 + B8)

**Decision 2026-05-05 (user-confirmed Option B):** Defer the dashboard-as-control-plane work — single-process unification, dashboard-level sign-in, launch-N-runners-from-dashboard — into this stage rather than inserting a new mid-plan stage. Stages 3 and 4 ship with the two-terminal flow intact; Stage 5 collapses everything into one comprehensive UX.

**Goal:** One-command boot. The dashboard becomes the control plane: sign in, configure, launch, monitor, stop — all from one browser tab. The CLI runner stays available for power users / scripting but the dashboard is the default path.

**Build (control plane — new in Stage 5 per the deferral):**
- **Coordinator spawns the runner.** New endpoints: `POST /run/start` (body: scenario + concurrency / views / think time), `POST /run/stop`, `GET /run/status`. Implementation: `child_process.spawn('node', ['runner/run.js', '--coordinator', selfUrl, ...])`. Multiple concurrent runs allowed; each gets its own runId tracked in coordinator state.
- **Dashboard sign-in.** Top-right "Sign in with Microsoft" button on `/dashboard`. Uses the existing MSAL flow (vendored `msal-browser-3.27.0.min.js`) directly in the dashboard tab. Token cache lives in `localStorage` of the dashboard origin.
- **Token sharing with spawned runners.** Coordinator keeps a single Playwright profile dir at `RealisticLoadTestTool/coordinator/.shared-profile/`. Dashboard pre-warms the profile by calling a coordinator endpoint that uses Playwright server-side to sign in once (or by replaying the dashboard's MSAL token blob into the profile via Playwright's `addInitScript` + `localStorage` seed). The runner switches from per-run profile to this shared profile via a new `--profile-dir` flag. All spawned tabs acquire silently from the shared cache.
- **Launch panel on dashboard.** Form: scenario picker (Stage 5 wizard output), concurrency, views, think time, project name. "Start run" button POSTs to `/run/start`. Live runner stdout streams to a new dashboard panel via Server-Sent Events from `GET /run/<runId>/log/stream`.
- **Stop button** per active run on the dashboard. POSTs to `/run/stop?runId=...`.
- **CLI compatibility preserved.** `node runner/run.js --concurrency 5 --coordinator http://localhost:8080` keeps working unchanged.

**Build (scenario editor — original Stage 5 scope):**
- `RealisticLoadTestTool/Setup.html` (or in-dashboard panel) — extends the in-page picker with page / bookmark / filter UI. Reuses MSAL token from the dashboard sign-in.
- Coordinator `POST /config/save` writes `loadtest.yaml`.
- Wizard flow: workspace → report → page → bookmark → filter builder → save scenario → return to dashboard.
- Delete `Setup_Load_Test.ps1` after parity confirmed.

**Trade-offs accepted by deferring:**
- Stages 3 (resource monitor) and 4 (YAML config) ship + test under the two-terminal model. Their work is unaffected — resource monitor still POSTs to `/saturation`, YAML still drives the runner via CLI.
- The dashboard-spawning code (~200 LOC across coordinator + dashboard) lands all at once in Stage 5 instead of incrementally.

**New backlog row:**
- **B8** — Unified control plane (coordinator spawns runner, dashboard-level sign-in + launcher). Folded into Stage 5 per Option B.

**Vertical test:** TEST-V10-01 (extended) — start with `node server.js`, sign in via dashboard, configure a 2-report scenario via wizard, launch with concurrency=2, watch metrics flow to dashboard, click Stop, verify clean shutdown. Zero PowerShell. Zero second-terminal command.

### Stage 6 — Easy install (T12 / B4a)

**Goal:** One-command install on fresh Windows.

**Build:** `install.ps1`, winget manifest, GitHub Releases zip bundling Node, Playwright browsers, vendored libs, monitor.py.

**Vertical test:** TEST-V10-10, V10-11.

### Backlog impact

| Backlog row | Was | Now |
|---|---|---|
| T13 — Playwright runner | v2.0 | v1.0 Stage 1 |
| T13a — Delete legacy auth artifacts | v1.0 (after T13) | v1.0 Stage 1 (alongside T13) |
| T7c — Per-test-subfolder lib paths | v0.8.1 Backlog | **Obsolete** — Stage 1 serves HTML from a single root |
| **B7 — OneDayBI brand application** | (new, added 2026-05-05) | v1.0 Stage 2.5 — slot between coordinator ship and resource monitor so Stage 5 inherits the brand |
| **B8 — Unified control plane** (single-process boot, dashboard-level sign-in, launch-from-dashboard) | (new, added 2026-05-05) | v1.0 Stage 5 — folded in per user-confirmed Option B (defer rather than insert a new mid-plan stage) |
| T7d — Paginate `/groups` | v0.8.1 Backlog | Unchanged (still v0.8.1) |

---

## Phase v1.0 — ORIGINAL UX layer ordering (superseded 2026-05-05 — kept for context)

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

- ~~**T13. Replace ChromeWriteBack with Playwright.**~~ **Moved to v1.0 Stage 1 on 2026-05-05.** See revised v1.0 section above.
- ~~**T13a. Delete legacy auth artifacts at v1.0 cutover.**~~ **Moved to v1.0 Stage 1 on 2026-05-05** alongside T13.
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
