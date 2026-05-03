# Modern Power BI / Fabric Load-Testing Landscape (2025-2026)

Research compiled May 2026 to support modernization of the fork of `RealisticLoadTestTool` from Microsoft's [PowerBI-Tools-For-Capacities](https://github.com/microsoft/PowerBI-Tools-For-Capacities) repo. The original tool has been essentially unchanged since 2019 while the SDK, the auth story, and the underlying capacity model (P -> F SKU / Fabric) have all moved on. This document inventories what changed and where the highest-leverage modernization opportunities are.

---

## 1. Power BI JS SDK current state

### Latest version & where to load it from

- The current published package is `powerbi-client` on npm (Microsoft-owned). As of early 2026 the published versions referenced on jsDelivr include `2.22.1` and `2.23.1`, with the package actively maintained (last update March 2026, ~207k weekly downloads) per [npm page](https://www.npmjs.com/package/powerbi-client) and the [jsDelivr page](https://www.jsdelivr.com/package/npm/powerbi-client).
- **`cdn.rawgit.com` is dead** (the service was sunset in October 2019). The current 2019 tool's script tag `https://cdn.rawgit.com/Microsoft/PowerBI-JavaScript/master/dist/powerbi.min.js` no longer resolves and is the single biggest reason the tool will silently fail for new users.
- Recommended replacements:
  - **jsDelivr (pinned version):** `https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js` -- best for reproducibility.
  - **unpkg:** `https://unpkg.com/powerbi-client@2.23.1/dist/powerbi.min.js`.
  - **cdnjs:** [cdnjs.com/libraries/powerbi-client](https://cdnjs.com/libraries/powerbi-client).
  - **Local copy** vendored alongside `RealisticLoadTest.html` -- removes any external CDN dependency for air-gapped customers and is what we should ship by default.

### Major API additions since the 2019 baseline

Confirmed from the [GitHub releases](https://github.com/microsoft/PowerBI-JavaScript/releases) and the [Microsoft Learn refresh-token doc](https://learn.microsoft.com/en-us/javascript/api/overview/powerbi/refresh-token):

| Version | Date | Feature relevant to load testing |
|---|---|---|
| 2.5.0 | Mar 2019 | Bookmark APIs and Export Data APIs introduced (this is the version the existing tool is roughly built against) |
| 2.9.x | 2020 | `powerbi.bootstrap(element, config)` for parallel iframe init |
| 2.16.5 | Mar 2023 | `visualClicked` / `visualSelected` events, page rename, bookmark capture for personalized visuals (`personalizeVisuals`), `SaveAs` `targetWorkspaceId` |
| 2.18.0 | Mar 2023 | `openLinksInNewWindow`, on-load page-level filters, `allPages` option for bookmark capture |
| 2.18.6 | Oct 2023 | `setZoom` / `getZoom` |
| 2.18.7 | Dec 2023 | `getTheme()`; `getPages` / `getActivePage` now return background and wallpaper info |
| **2.19.0** | Feb 2024 | New `'info'` event; ability to rename the global `powerbi` object via `powerBISDKGlobalServiceInstanceName`; access-token-expiry callback wiring |
| **2.20.1** | 2024 | First version where **`accessTokenProvider` event hook** is supported -- the SDK calls a function you supply just before the token would expire and silently swaps it. This is the killer feature for our use case. |
| 2.22.x / 2.23.x | 2025 | Maintenance, dependency updates |

### "loaded" vs "rendered" vs "visualRendered"

Per the [Handle Events](https://learn.microsoft.com/en-us/javascript/api/overview/powerbi/handle-events) doc and [Best Practices for Faster Performance](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-performance-best-practices):

- `loaded` -- fires when the report shell is initialized (the Power BI logo disappears). Marks "iframe & metadata are ready," NOT user-visible data.
- `rendered` -- fires when **all visuals on the active page have finished rendering with actual data**. Re-fires every time the report is re-rendered (filter change, slicer change, bookmark apply). For "user-perceived render complete" this is the right event to time against.
- `visualRendered` -- fires once per visual but is **off by default**; you must pass `settings.visualRenderedEvents = true`. Microsoft explicitly warns to leave it off unless needed because it can be very chatty. Useful for per-visual P95s but increases postMessage noise.
- Important nuance: when a report renders entirely from cached data (no filters/slicers/bookmarks applied), the `rendered` event still fires but the experience is much faster than a "real" load. The 2019 tool's design of *always* changing a filter/slicer/bookmark per cycle is intentional and right -- it forces uncached renders. See section 6.

### Performance counters / `getStats`

There is **no** public `report.getStats()` API on `powerbi-client`. Front-end measurement is limited to wall-clock time between `loaded` -> `rendered` and (optionally) per-`visualRendered` timestamps. For deeper numbers you need backend telemetry: the Fabric Capacity Metrics App ([metrics-app](https://learn.microsoft.com/en-us/fabric/enterprise/metrics-app)), Log Analytics workspace integration on the semantic model, or an XMLA-endpoint Profiler trace. The official guidance in [load-assessment-planning-tool](https://learn.microsoft.com/en-us/power-bi/developer/embedded/load-assessment-planning-tool) is exactly this combination: front-end load tool + Capacity Metrics App for back-end correlation.

### Token refresh: `setAccessToken` and `accessTokenProvider`

Two paths from the [refresh-token docs](https://learn.microsoft.com/en-us/javascript/api/overview/powerbi/refresh-token):

1. **Manual:** `await report.setAccessToken(newAccessToken)` -- swaps the token without reloading the iframe. Available since the 2.x line and well-supported.
2. **Automatic (>= 2.20.1):** pass `eventHooks: { accessTokenProvider: getNewAccessToken }` in the embed config. The iframe calls this function just before the token would expire. Note: per Microsoft docs, **automatic refresh is only supported for "embed for your organization" (AAD token) scenarios, not embed-for-customers**. Our load testing is exactly the AAD/embed-for-org scenario, so we can use it.

### Things in the 2019 tool that are deprecated or stale

Looking at `RealisticLoadTest.html`:

- `https://cdn.rawgit.com/...` -- dead CDN.
- jQuery 1.11.1 from `ajax.googleapis.com` -- 2014-era, has multiple known XSS CVEs (jQuery prototype pollution, `<3.5.0` HTML-injection class). Per the [2025 OSSRA report referenced in security advisories](https://www.herodevs.com/blog-posts/how-to-fix-jquery-ui-vulnerabilities-resolving-cves-in-outdated-versions), jQuery 1.11.x receives no patches. The tool only uses jQuery for `$.parseJSON` and trivial DOM access -- both can be replaced with native `JSON.parse` and `document.querySelector` in ~10 lines, eliminating the dependency entirely.
- The PowerShell-token-paste-into-a-JSON-file workflow is unchanged and is the single biggest UX pain point. Replaceable per section 2.
- `models.TokenType.Aad` is still correct and not deprecated.
- `report.bookmarksManager.apply(name)` signature is unchanged and not deprecated, though `applyState(state)` is now also available for applying captured (in-memory) bookmark states without saving them.
- `LayoutType` enum values still valid; `models.LayoutType.Custom` and the `customLayout` API are recommended where the original tool uses fixed page/visual sizing.

---

## 2. Authentication modernization

### Current best practice (2026) for "embed for your organization"

For a load-testing tool that signs in *as a real user* against a tenant -- which is what our scenario requires to honor row-level security and produce realistic CU draw -- the modern pattern is:

- **MSAL.js 2.x / `@azure/msal-browser` in the page itself.** Acquire an AAD access token for the resource `https://analysis.windows.net/powerbi/api` with delegated scopes such as `Report.Read.All` (or a narrower set) using `acquireTokenSilent` / `acquireTokenPopup` / `acquireTokenRedirect`. The token's lifetime is still ~60-90 min, but MSAL handles silent refresh against a long-lived refresh token transparently. See community sample [PowerBiDevCamp/PowerBiEmbeddingSPA](https://github.com/PowerBiDevCamp/PowerBiEmbeddingSPA).
- **Wire MSAL into the SDK** via `eventHooks: { accessTokenProvider: async () => (await msal.acquireTokenSilent(...)).accessToken }`. The SDK then calls back into MSAL whenever the token is near expiry. **This eliminates the 60-minute manual refresh ritual and the `Update_Token_Only.ps1` script entirely.**

### Service principal for unattended runs

For overnight/CI-style load tests where no human will sit at a browser, a service principal (SP) is preferred:

- Tenant settings required: enable **"Service principals can call Fabric public APIs"** for a security group containing the SP, and grant the SP either workspace member access or admin (per [embed-service-principal docs](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-service-principal)).
- SP can authenticate with a client secret or, more securely, a **certificate** (see [embed-service-principal-certificate](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-service-principal-certificate)).
- Two token paths from there:
  - For "embed for your organization": SP gets an AAD token directly and the page passes `tokenType: models.TokenType.Aad`.
  - For "embed for your customers" (app-owns-data): SP first calls `GenerateToken` REST API to mint an embed token, page uses `tokenType: models.TokenType.Embed`. Embed tokens have configurable lifetime (max ~10 hours) and don't auto-refresh in the same way; `accessTokenProvider` must call your backend to mint a new one.

### Implications for Fabric / F SKU / "embed for your customers"

- All P SKU concepts map cleanly to F SKU (P1 == F64) per [embedded-capacity](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity) and the 2025 [licensing change blog](https://www.microsoft.com/en-us/licensing/news/power-bi-premium-sku-retirement). No JS SDK changes are required for Fabric workspaces; the embed URL and token mechanics are identical.
- Embed tokens generated against an F-capacity-backed workspace are **not subject to the per-Pro-user generation limit** that applies in dev/test (no capacity), so SP+F-capacity is the production-grade combo. ([embed-tokens](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-tokens))

---

## 3. Load testing best practices for Power BI / Fabric capacities

### Microsoft's official guidance

The [Power BI embedded analytics assess load](https://learn.microsoft.com/en-us/power-bi/developer/embedded/load-assessment-planning-tool) page is still the single canonical Microsoft reference and it points at our repo (`PowerBI-Tools-For-Capacities/RealisticLoadTestTool`). Microsoft's stated method is:

1. Use the front-end load tool to drive uncached renders on a non-production capacity.
2. Correlate results with the [Fabric Capacity Metrics App](https://learn.microsoft.com/en-us/fabric/enterprise/metrics-app) (the renamed/upgraded successor to the Premium Capacity Metrics App; both A/EM/P and F SKUs are now reported through it).
3. Optionally connect SQL Server Profiler to the **XMLA endpoint** to capture exact DAX query timings.
4. Use the [Fabric SKU Estimator (Preview)](https://www.microsoft.com/en-us/microsoft-fabric/capacity-estimator) for an initial sizing guess before testing.

### Throttling stages -- the rules our tests must respect

From the [Throttling doc](https://learn.microsoft.com/en-us/fabric/enterprise/throttling) (the most important single page for designing realistic tests):

| Future-CU debt | Stage | Behavior |
|---|---|---|
| <= 10 minutes | Overage protection | No throttling; bursting allowed. |
| 10 - 60 minutes | **Interactive Delay** | Each new interactive request is delayed by 20 seconds at submission. Test runs will appear "slow" but no errors. |
| 60 minutes - 24 hours | **Interactive Rejection** | Interactive requests rejected with `CapacityLimitExceeded`. Background still runs. |
| > 24 hours | **Background Rejection** | All requests rejected; capacity effectively frozen. |

Smoothing windows: **interactive operations smooth over 5-64 minutes** depending on cost; **background operations smooth over 24 hours**. Implication: a load test that runs 30 minutes and shows fine numbers may still leave the capacity in carryforward debt for hours afterward -- our reporting must track this.

### Metrics that matter for a load test

- **CU consumption per operation and smoothed CU%** (Capacity Metrics App, Compute page).
- **Render duration** (front end -- our `rendered` event delta).
- **DAX query duration** (Profiler / Log Analytics).
- **Throttling events** (System events table on Compute page).
- **Evicted memory / memory pressure** for Import semantic models -- a model that gets evicted from RAM will cause the next user's first render to include the cold-cache reload; `Cannot load model due to reaching capacity limits` is the failure code per [throttling doc](https://learn.microsoft.com/en-us/fabric/enterprise/throttling).
- **Carryforward CUs and minutes-to-burndown** after the test completes.

### Concurrency realism

Chris Webb's widely-cited point in [Why load testing Power BI is important](https://blog.crossjoin.co.uk/2023/04/23/why-load-testing-power-bi-is-important/) is that **even in enterprise BI, having more than ~10 truly-simultaneous queries is rare**. So while it's tempting to spin up 50 browsers, the more useful tests are usually 5-15 concurrent users with realistic think time (15-60s between interactions) and varied filter values to defeat caching.

### Cold vs warm cache

- **Cold:** First render after a model is evicted, or after a filter combination that has never been queried. Worst-case, useful for capacity sizing headroom.
- **Warm:** Repeating the same filter combination -- query cache (Premium/F SKU [query caching](https://learn.microsoft.com/en-us/power-bi/connect-data/power-bi-query-caching)) returns results without DAX execution.
- The 2019 tool randomizes filter values precisely so most renders are cold-ish. Good design; preserve it.

---

## 4. Alternative / community load testing tools

### Open-source alternatives

- **k6 (Grafana)** with [k6 browser](https://grafana.com/blog/2025/10/02/a-closer-look-at-grafana-k6-browser-alignment-with-playwright-modern-features-for-frontend-testing-and-what-s-next/). Aligned with Playwright's API, supports hybrid HTTP+browser virtual users, and exports metrics to Prometheus/Grafana/Influx natively. Real strength: aggregated dashboards across many VUs out of the box -- which is exactly what our `.txt`-per-instance approach lacks.
- **Playwright** (Microsoft) for pure browser automation. The [AT&T Israel team described a Playwright + `powerbi-client` approach](https://medium.com/att-israel/finally-automation-testing-for-power-bi-4cbda6f81c26) where Playwright drives the page and the in-page JS uses the SDK to introspect filters/visuals -- gives you both UI control and SDK-level metric access. This is essentially what a modern reincarnation of `ChromeWriteBack` should be.
- **Selenium-based custom-visual tests:** [kamilzakiev/SeleniumVisualTest](https://github.com/kamilzakiev/SeleniumVisualTest) for visual-level testing -- not a load tool but an exemplar of the SDK-introspection pattern.
- **Artillery + Playwright hybrid** as documented by [BrowserStack](https://www.browserstack.com/docs/load-testing/getting-started/hybrid/playwright).
- **pure REST/DAX load** via `ExecuteQueries` REST API or XMLA endpoint -- skips the browser entirely. Useful for back-end-only stress, but **misses the "real user" cost** of iframe init, visual rendering, slicer evaluation, and the JS bridge. Microsoft's `LoadTestingPowerShellTool` (sibling folder in the same repo) is the official PowerShell version of this approach.

### Cloud-based options

- **Azure Load Testing** is general-purpose (JMeter / Locust on managed Azure). Works for the REST/DAX path but doesn't drive embedded reports out of the box. No Power BI-specific module exists.
- **Microsoft does not offer a managed Power BI load-testing service.**

### Strengths / weaknesses of HTML+browser approach vs headless API-only

| | HTML+browser (ours) | API-only (REST/XMLA) |
|---|---|---|
| Realism of CU draw | **High** -- includes visual rendering, iframe overhead, Fabric front-door cost | Lower -- only the DAX/query cost |
| Realism of user think time, slicer evaluation | High | Must be modeled manually |
| Setup complexity | Medium-high (browsers, drivers) | Low |
| Concurrent scale per machine | ~5-15 per browser host | Hundreds per host |
| Captures front-end perceived perf | Yes | No |
| Sensitivity to network/CDN | Yes (intentional -- mirrors reality) | No |

For our tool's mission ("Realistic Load Test"), the browser path is the right one. We just need to modernize the *how*.

---

## 5. Modernization opportunities for our tool

Each item: **what** / **why** / **rough effort**.

### 5.1 Replace dead `rawgit` CDN and ancient jQuery
- **What:** Pin `powerbi-client@2.23.x` from `cdn.jsdelivr.net` (or vendor locally). Remove jQuery entirely; rewrite the ~5 jQuery calls in vanilla JS.
- **Why:** rawgit is 7 years dead -- the tool literally cannot bootstrap on a clean machine today. jQuery 1.11.1 is on virtually every static-analysis "high risk" list ([CVE list](https://www.cvedetails.com/version/1143046/Jquery-Jquery-1.11.1.html)).
- **Effort:** Low (under an hour). Highest-leverage change in the entire backlog.

### 5.2 Upgrade to modern `powerbi-client` (no breaking changes expected)
- **What:** Switch from the master-branch rawgit drop to `powerbi-client@2.23.x` minified bundle.
- **Why:** Gives us `accessTokenProvider`, `setZoom`, `getTheme`, the `info` event, and bug fixes since 2019.
- **Breaking changes to expect:** Minimal. The big API surface (`powerbi.embed`, `models.TokenType.Aad`, `report.on('loaded'...)`, `report.on('rendered'...)`, `bookmarksManager.apply`, `getFilters`/`setFilters`, `getPages`) is back-compatible with 2.5.x. Some TS-only types tightened. Internal global rename safety net (`powerBISDKGlobalServiceInstanceName`) is opt-in. (speculation: minor differences in how errors propagate from the iframe might require minor `.on('error', ...)` handler updates.)
- **Effort:** Low.

### 5.3 In-browser MSAL token refresh -> kill the 60-min ritual
- **What:** Drop a `@azure/msal-browser` script tag, do interactive login on first page load, register `accessTokenProvider` in the embed config to silently refresh.
- **Why:** Eliminates `Update_Token_Only.ps1`, eliminates the manual paste-into-`PBIToken.json` step, lets multi-hour tests run unattended.
- **Effort:** Medium (1 day). Requires registering the client app in the tenant (one-time admin task). For tenants that won't allow that, keep the PowerShell path as a fallback.

### 5.4 Replace CefSharp "ChromeWriteBack" with Playwright + native messaging
- **What:** Two layers:
  - Use **Playwright** (Microsoft, free, MIT) to launch and orchestrate the N browser instances. Replaces both the Chrome-launching PowerShell logic and the custom CefSharp binary.
  - For the in-page -> on-disk metric write-back, use either:
    - `page.on('console', ...)` in Playwright -- the page just `console.log(JSON.stringify(metric))` and Playwright captures it -- zero custom binary.
    - Or `fetch('http://localhost:PORT/log', { method: 'POST', body: ... })` to a tiny local Node/Python collector if we want richer aggregation.
- **Why:** Removes a large compiled artifact (CefSharp binary) that has to be trusted, signed, kept in sync with Chromium versions, and which adds friction to OSS contribution. Gains us screenshots, network capture, video recording, and headless mode for "free."
- **Effort:** Medium-high (1-2 weeks for full migration). Highest long-term value.

### 5.5 Structured logs -- JSON Lines instead of `<br>`-separated `.txt`
- **What:** Each metric event (load start, loaded fired, rendered fired, error) becomes a single JSONL row with `instanceId`, `iso8601 timestamp`, `reportId`, `pageName`, `bookmarkName`, `filterValues`, `loadDurationMs`, `renderDurationMs`, `viewIndex`, `projectName`.
- **Why:** Native ingestion into Log Analytics, Azure Data Explorer, Power BI itself; trivially diff-able; no HTML escaping problems.
- **Effort:** Low.

### 5.6 Real-time aggregated dashboard across all running instances
- **What:** A small local web server (Node/Python ~100 lines) receives the JSONL POSTs from all browser instances, exposes a live aggregated view (or just appends to a single capacity-wide JSONL plus a Power BI direct-query report at `LoadTestResults.pbix`).
- **Why:** Currently we have N `.txt` files that have to be Power-Query'd together post-hoc. Real-time visibility lets you abort a bad run early.
- **Effort:** Medium. Pairs naturally with 5.4.

### 5.7 Centralized YAML/JSON workspace config
- **What:** Replace the per-folder `Filters.json`, `Bookmarks.json`, `Page.json`, `PBIReport.json` pattern with a single `loadtest.yaml` (or `.json`) that lists each scenario:
  ```yaml
  workspace: <id>
  reports:
    - name: Sales
      reportId: ...
      scenarios:
        - { page: Overview, filters: [...], bookmark: bm_q1 }
        - { page: Detail,   filters: [...], bookmark: bm_q2 }
  concurrency: 5
  viewsPerSession: 50
  thinkTimeSec: 15
  ```
- **Why:** Source-control friendly; one file to review in a PR; setup script generates the per-folder files (or skip the folders entirely and pass the scenario via querystring/postMessage).
- **Effort:** Medium.

### 5.8 Service-principal auth path for unattended/CI runs
- **What:** Add a second auth mode: SP+secret or SP+cert, configured via env vars; SP gets an embed token via REST, page consumes it.
- **Why:** Lets us run the load test from Azure DevOps / GitHub Actions on a schedule, against a sacrificial F SKU, and post results to a Fabric workspace.
- **Effort:** Medium. (Requires tenant admin to enable the SP-can-call-Fabric-APIs setting per [enable-service-principal-admin-apis](https://learn.microsoft.com/en-us/fabric/admin/enable-service-principal-admin-apis).)

### 5.9 Fabric Capacity Metrics App integration
- **What:** Tag every embedded session with a unique correlation id (e.g. `instanceID-runId`) and surface it in the JSONL output so we can join to the Capacity Metrics App's operation-level data on `OperationId` / `User`.
- **Why:** Closes the loop from front-end render time to back-end CU cost in a single Power BI report.
- **Effort:** Low-medium (depends on whether we want to write a follow-up report against the Metrics App's semantic model).

### 5.10 Support Fabric workspaces / new SKUs
- **What:** No code changes required for Fabric F SKU workspaces -- the embed URL format and token format are identical. Just ensure the README clarifies F SKU support and the SKU sizing guidance points at the [Fabric SKU Estimator](https://www.microsoft.com/en-us/microsoft-fabric/capacity-estimator) instead of the deprecated Premium calculator.
- **Effort:** Trivial (docs only).

---

## 6. Risks / gotchas / things to NOT change

### Things 2019 got right -- keep them

- **Always rotate filter / slicer / bookmark values per cycle.** This intentionally defeats query cache and the visuals' pre-rendered cached data. Per [embedded performance best practices](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-performance-best-practices): "If filters, bookmarks, or slicers are provided, cached data isn't used and the visuals are rendered only after the visual query has ended." Removing this would make results misleadingly optimistic.
- **One iframe per browser tab.** Don't try to multiplex 10 reports into one tab -- you'll just hit Chrome's per-tab CPU/memory throttling. The Microsoft perf doc advises minimizing iframes for app design but for load testing, *one tab = one simulated user* is the correct mapping.
- **Random think time between interactions.** Mirrors real users; don't hammer.
- **`numberOfViews` session limit (our fork's addition).** Better than running until killed because it gives bounded, comparable runs. Keep.
- **Token-to-the-page pattern via JSON, not embedded in URL.** Tokens in URLs end up in browser history/server logs. Keep as JS variable or, with MSAL, as an in-memory result.

### Things to be careful about

- **Browser quotas:** Chrome rate-limits a lot of internal subsystems per origin (max ~6 connections per host, max open WebSockets, BroadcastChannel limits). At very high concurrency on one machine you start measuring browser limits, not Power BI limits. Microsoft's docs implicitly assume separate machines or VMs for high concurrency.
- **Fabric throttling carries over between runs.** A test that runs to completion may leave the capacity in interactive-delay state for the next run starting 5 minutes later. Always check the Capacity Metrics App "minutes to burndown" before starting a fresh run, or pause/resume the F-capacity to reset (see [throttling -> stop throttling](https://learn.microsoft.com/en-us/fabric/enterprise/throttling)).
- **Memory-eviction behavior is non-linear.** A model evicted mid-test will skew the next render's timing dramatically. Worth marking these in the metrics output (e.g., flag any render >> p95 of the prior 50).
- **`sessionRestart` / iframe memory leaks:** The 2019 tool periodically destroys and re-embeds. With modern Chrome and SDK 2.23 the leaks are much smaller (speculation: SDK has had 7 years of memory cleanup), but for 8+ hour runs a periodic full-tab reload is still a cheap insurance policy.
- **`accessTokenProvider` exception behavior:** Per the [refresh-token doc](https://learn.microsoft.com/en-us/javascript/api/overview/powerbi/refresh-token), the function "should never throw an exception. If it fails to generate a new token, return Null." Our wrapper must catch all MSAL errors and return null, otherwise the iframe will silently desync.
- **Running tests during business hours on shared capacities.** Microsoft explicitly warns against this in the [load-assessment doc](https://learn.microsoft.com/en-us/power-bi/developer/embedded/load-assessment-planning-tool). Document it loudly in the README.

---

## Recommended modernization themes (ranked by value / effort)

1. **Fix the broken CDN + drop jQuery** -- 1 hour, restores basic functionality. (5.1)
2. **Upgrade to `powerbi-client@2.23.x` and switch to `accessTokenProvider`** -- half a day; unlocks every other improvement. (5.2 + 5.3)
3. **Add MSAL.js in-browser token acquisition** -- 1 day; eliminates the single biggest UX pain (60-min token rotation). (5.3)
4. **Migrate to JSONL structured metrics** -- few hours; prerequisite for any aggregation. (5.5)
5. **Replace ChromeWriteBack/CefSharp with Playwright orchestration + console-capture log path** -- 1-2 weeks; deletes a large compiled artifact, unlocks headless mode and CI runs. (5.4)
6. **Centralized YAML/JSON workspace config** -- few days; makes the tool source-control friendly and PR-reviewable. (5.7)
7. **Real-time aggregated dashboard across browser instances** -- ~1 week; turns "post-mortem" runs into "live" runs. (5.6)
8. **Service principal auth path + Capacity Metrics App correlation** -- 1-2 weeks; required for unattended CI/scheduled runs and end-to-end front-to-back reporting. (5.8 + 5.9)
