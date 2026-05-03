# Realistic Load Test Tool — Research Summary

Top-level research summary for the modernization of the `RealisticLoadTestTool/` fork. Pulls together two underlying research docs:

- **Fork vs upstream baseline** — `_Research/realisticloadtest-fork-vs-upstream.md`
- **Modern PBI/Fabric load-testing landscape** — `_Research/modern-pbi-loadtest-landscape.md`

Read this document first, then dive into either of the other two for detail.

---

## TL;DR

The Microsoft upstream tool is **frozen since Aug 2019** (3 commits ever). Your fork (v0.7.1) added significant value on top — view limits, structured per-refresh metrics, the writeback-to-file logging pipeline via a custom CefSharp browser, externalized filter/bookmark templates, and a redesigned UI. But both the upstream and your fork still rely on a **dead CDN** (`cdn.rawgit.com`) and an unmaintained jQuery 1.11.1 — a clean machine cannot bootstrap the tool today.

Beyond that broken foundation, the modern Power BI JS SDK (currently `powerbi-client@2.23.x`) gained two killer features for this tool:
1. **`accessTokenProvider`** event hook (Feb 2024) — the SDK silently swaps tokens before they expire, eliminating the 60-min `Update_Token_Only.ps1` ritual when paired with MSAL.js.
2. Mature `setAccessToken`, bookmark capture, page rename, zoom, and theming APIs.

The ~150 MB `ChromeWriteBack/` CefSharp blob can be replaced cleanly by **Playwright** + `page.on('console')` capture, removing an unsourced binary dependency and unlocking headless mode, screenshots, network capture, and CI-friendly runs.

---

## Where we are today

```
Original Microsoft (2019, frozen)
        │
        ├──► Your fork v0.7.1
        │       + Filters/Bookmarks/Page external templates
        │       + view limit (numberOfViews)
        │       + per-refresh duration + structured metrics table
        │       + CefSharp ChromeWriteBack → .txt log files
        │       + project name, instance ID, self-documenting folder names
        │       + UserGuide.html
        │
        └──► v2 (this modernization effort)
                 ?
```

### What works well — keep these

- **Always rotating filter / slicer / bookmark per cycle** — defeats query cache, forces realistic uncached renders. Microsoft's perf doc explicitly confirms this design.
- **One iframe per browser tab as proxy for one user** — the right realism mapping.
- **`numberOfViews` view-limit** (your addition) — gives bounded, comparable runs.
- **Token in a JS variable, not in URLs** — keeps tokens out of browser history.
- **Capture per-refresh state (page/bookmark/filters/slicers)** — your enhancement makes post-mortem analysis possible.

### What's broken or stale

| Issue | Severity | Source |
|---|---|---|
| `cdn.rawgit.com/Microsoft/PowerBI-JavaScript/master/dist/powerbi.min.js` — CDN sunset Oct 2019 | **Blocker** | Modern landscape §1 |
| jQuery 1.11.1 from 2014 — multiple known CVEs, only used for trivial DOM access | **Security** | Modern landscape §1 |
| Manual 60-min token refresh via `Update_Token_Only.ps1` | UX pain | Modern landscape §2 |
| `ChromeWriteBack.exe` — ~150 MB compiled blob, no source in repo, no provenance | Maintainability | Fork-vs-upstream §2.5 |
| Log format is HTML-with-`<br>` separators, requires regex-parsing in Excel | Analysis pain | Fork-vs-upstream §3 |
| Off-by-one view limit (real data shows `16/15`) | Bug | Fork-vs-upstream §3 |
| Regex-based JSON injection in `Setup_Load_Test.ps1` | Fragile | Fork-vs-upstream §5 |
| Per-folder duplication (50 reports = 50 identical HTML copies) | Repo bloat | Fork-vs-upstream §5 |
| No service-principal / unattended path | CI blocker | Modern landscape §2 |
| No live cross-instance dashboard | Workflow gap | Modern landscape §5.6 |
| `Login-PowerBI` called inside the per-report loop in setup | Re-prompts every report | Fork-vs-upstream §5 |

---

## Modern PBI SDK — what changed since 2019

| Version | Year | Relevance |
|---|---|---|
| 2.5.0 | 2019 | Bookmark APIs (what 2019 tool is built against) |
| 2.9.x | 2020 | `powerbi.bootstrap()` for parallel iframe init |
| 2.16.5–2.18.x | 2023 | `setZoom`/`getZoom`, `getTheme()`, `personalizeVisuals`, page rename |
| 2.19.0 | Feb 2024 | New `'info'` event |
| **2.20.1** | 2024 | **`accessTokenProvider` event hook** — silent token refresh for AAD scenarios |
| 2.22.x / 2.23.x | 2025 | Maintenance |

**Auth modernization path:**
- MSAL.js (`@azure/msal-browser`) acquires AAD token in-browser → `eventHooks.accessTokenProvider` swaps tokens silently → `Update_Token_Only.ps1` becomes optional fallback.
- Service principal (cert preferred over secret) for unattended runs; embed-tokens are not subject to per-Pro-user rate limits when on F-capacity.

**Fabric/F-SKU compatibility:** No SDK changes needed. Embed URLs and token mechanics are identical to P SKUs (P1 = F64). Only the README's SKU sizing pointer needs updating to point at the [Fabric SKU Estimator](https://www.microsoft.com/en-us/microsoft-fabric/capacity-estimator) instead of the deprecated Premium calculator.

---

## Throttling rules our test design must respect

From Microsoft's [Throttling doc](https://learn.microsoft.com/en-us/fabric/enterprise/throttling) — these are non-obvious and important:

| Future-CU debt | Stage | Behavior |
|---|---|---|
| ≤ 10 min | Overage protection | No throttling |
| 10–60 min | **Interactive Delay** | Each interactive request delayed 20s — runs look "slow" but no errors |
| 60 min – 24 hr | **Interactive Rejection** | `CapacityLimitExceeded` errors |
| > 24 hr | **Background Rejection** | All requests rejected |

**Implication:** A 30-minute test that "completed fine" can leave the capacity in carryforward debt for hours. The tool should remind the user to check the Capacity Metrics App "minutes to burndown" between runs.

**Concurrency reality check** ([Chris Webb](https://blog.crossjoin.co.uk/2023/04/23/why-load-testing-power-bi-is-important/)): even enterprise BI rarely has > 10 truly simultaneous queries. Realistic tests are 5–15 concurrent users with 15–60s think time, not 50 hammering browsers.

---

## Recommended modernization themes (ranked)

| # | Theme | Effort | Value | Notes |
|---|---|---|---|---|
| 1 | Fix dead CDN + drop jQuery | ~1 hour | Restores basic function | Pin `powerbi-client@2.23.x` from jsDelivr or vendor locally |
| 2 | Upgrade SDK + wire `accessTokenProvider` | ~half day | Unlocks every other improvement | No expected breaking changes |
| 3 | MSAL.js in-browser token refresh | ~1 day | Eliminates 60-min ritual | Requires one-time tenant app registration |
| 4 | JSONL structured metrics | few hours | Prerequisite for aggregation | Native Log Analytics / KQL ingestion |
| 5 | Replace ChromeWriteBack/CefSharp with Playwright | 1–2 weeks | Removes binary blob; gains screenshots/headless/CI | Highest long-term value |
| 6 | Centralized YAML workspace config | few days | Source-control friendly; one-PR review | One file vs. N folder copies |
| 7 | Real-time aggregated dashboard | ~1 week | Live visibility into runs | Pairs with #5 |
| 8 | Service principal auth + Capacity Metrics App correlation | 1–2 weeks | Unattended CI runs; front-to-back reporting | Tenant admin enablement needed |

---

## Suggested next steps

1. **Decide which themes to pursue.** Themes 1–4 are essentially "no-brainer cleanup" (~2 days total) and would already produce a meaningfully better tool. Theme 5 is the architectural shift — worth scoping separately.
2. **Get tenant prerequisites lined up** (if pursuing themes 3 or 8): MSAL app registration with `https://analysis.windows.net/powerbi/api/.default` delegated scope; SP enablement for Fabric APIs.
3. **Write the implementation plan** at `_Plan/realisticloadtest-v2.md` covering: scope (which themes), test strategy (how to validate without a live capacity), security considerations (token handling, MSAL config), success criteria, and rollback path.
4. **Build the test harness first** — `_Test/` folder with: a smoke-test PBIX that's small/cheap, a baseline run on the current tool to capture "before" metrics, and a regression checklist (does the new version produce equivalent metrics on the same report?).
5. **Implement in the order of theme #1 → #4** in a feature branch; smoke test after each step.

---

## Open questions for you

Before writing the plan, a few decisions would shape it heavily:

1. **Scope:** Do you want to land just themes 1–4 (the quick wins, ~2 days) and ship a v0.8, or commit to the bigger Playwright migration (theme 5) for v1.0?
2. **Tenant access:** Can you (or do you have admin access to) register an Entra (AAD) app with Power BI delegated scopes for MSAL? Needed for theme 3.
3. **Backwards compatibility:** Should v2 still support the existing `Test Results/*.txt` log format (for users with `Test Results Analysis.xlsx` workflows), or is a clean break to JSONL acceptable?
4. **CefSharp source:** Do you have the source for `ChromeWriteBack.exe` anywhere, or is it just the compiled binary? (Affects theme 5 — if source exists we can compare behaviour against the Playwright replacement.)
5. **Audience:** Is this primarily for your own consulting use (where you control the environment), or are you publishing it back to GitHub as a community-maintained alternative? Affects how much we need to invest in "fallback for tenants without MSAL app registration" etc.

Answer these and I'll draft the plan at `_Plan/realisticloadtest-v2.md`.
