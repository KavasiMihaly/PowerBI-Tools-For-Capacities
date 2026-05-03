# Realistic Load Test Tool — Fork vs. Microsoft Upstream

Research notes documenting the original Microsoft baseline of the Realistic Load Test Tool and every change applied in this fork. Source of truth: `git diff upstream/master..master -- RealisticLoadTestTool/` against `https://github.com/microsoft/PowerBI-Tools-For-Capacities`.

---

## 1. Microsoft upstream baseline

### 1.1 Origin & status
- The upstream repo received its last functional commit in **August 2019** — only 3 commits ever touched `RealisticLoadTestTool/`:
  - `e88c50e` — adding realistic load test tool
  - `b3dab69` — readme updates
  - `c292212` — adding `layoutType` (MobilePortrait / MobileLandscape / Master)
- Original HTML implementation by [Sergei Gundorov](https://github.com/sergeig888); enhancements over the older `LoadTestingPowerShellTool` were contributed by Artis Consulting.
- The repo is essentially **frozen** — no maintenance for 6+ years. Microsoft has not updated it for current Fabric capacities, modern auth patterns, or the deprecation of the rawgit CDN it loads scripts from.

### 1.2 Original components (upstream)
| File | Purpose |
|------|---------|
| `Setup_Load_Test.ps1` (142 lines) | Login to Power BI, select workspace+report, generate one timestamp-named subfolder per report containing copies of html/JSON templates. |
| `Run_Load_Test_Only.ps1` (74 lines) | Launch N Chrome windows pointing at each subfolder's `RealisticLoadTest.html`. Uses raw `start chrome ...` shell calls. |
| `Update_Token_Only.ps1` | Re-fetch AAD token (60-min lifetime) and rewrite `PBIToken.json` in every subfolder. |
| `RealisticLoadTest.html` (490 lines) | Embeds report via `powerbi-client` JS SDK; cycles through filters × bookmarks; updates a single `<div>` with running average refresh time. |
| `PBIReport.json` | Per-test config: reportUrl, sessionRestart, pageName, bookmarkList, filters, thinkTimeSeconds, layoutType. |
| `PBIToken.json` | AAD bearer token. |
| `DemoLoadTest1/`, `DemoLoadTest2/` | Pre-baked sample test folders showing the JSON config format. |

### 1.3 Original capabilities
- **Filter combinatorics**: build a randomized list of all permutations of supplied slicer/filter values (cold-cache pattern); cycle bookmarks within each filter combo.
- **Single-select / multi-select** filters on slicers and report-level filters (text or integer).
- **Sample sessions**: use `sessionStorage` + `location.reload(false)` every `sessionRestart` iterations to mitigate long-session memory leaks.
- **Multi-process Chrome**: separate Chrome user-data-dir per profile, 5-second stagger between window launches, kill all Chrome at end.
- **Layout switching**: MobilePortrait / MobileLandscape / Master.
- **Output**: only on-screen — `divCounter.innerHTML` shows `N refreshes / avg X seconds / Y seconds think time`. No persistent log; you read metrics from the screen and capture them via Premium Capacity Metrics App.

### 1.4 Original limitations
- **No persistent metrics output** — you have to eyeball the average from each browser, or correlate against the Capacity Metrics App after the fact.
- **No per-refresh granularity** — only running average is shown.
- **No view limit** — runs until you manually close all Chrome windows.
- **Indistinguishable concurrent instances** — N browser windows look identical; no instance ID.
- **Manual token refresh ritual** every 60 minutes via PowerShell.
- **rawgit CDN** for `powerbi.min.js` — `cdn.rawgit.com` was sunset in 2019, the script may still load only because it's still served from the GitHub master branch reference.
- **jQuery 1.11.1** dependency (from 2014) — included but barely used.
- **Subfolder names are timestamps only** (`MM-dd-yyyy_HH_mm_ss`) — opaque after a few runs.
- **No Filter/Bookmark templating** — every test config is hand-edited per-folder.

---

## 2. Fork-applied changes (Mihaly Kavasi)

Changes are tagged `//MK` or `//Writeback` in the source. Versioned in the HTML footer as **0.7.1**.

### 2.1 New configuration model — externalised templates
Three new JSON files live alongside the master `PBIReport.json`:
- **`Filters.json`** — the `filters: [...]` block, reusable across many reports.
- **`Bookmarks.json`** — the `bookmarkList: [...]`.
- **`Page.json`** — the `pageName: "..."`.

`Setup_Load_Test.ps1` injects each into the corresponding placeholder line of `PBIReport.json` via regex (e.g., `\/\/"pageName".*"`, `\/\/"bookmarkList".*]`, `"filters".*]`). Placeholders in the master `PBIReport.json` are commented out so the file remains valid JS until injection.

A `Parameter Catalogue/<workspace> - <report>/` folder mirrors this structure — pre-saved templates per known report so the user can copy them into the working dir before running setup.

### 2.2 Setup wizard improvements (`Setup_Load_Test.ps1`)
Added prompts (and corresponding regex injections into PBIReport.json):
- `numberOfViews` per report — the new view-limit per session (see §2.3).
- `thinkTimeSeconds` — formerly only editable post-setup.
- `projectName` — free-text tag that appears in every metric row for traceability.

Subfolder naming changed from `MM-dd-yyyy_HH_mm_ss` to `<workspaceName> - <reportName> - <MM-dd-yy_HHmmss>` — self-documenting. New helper variables `$reportName` / `$workspaceName` capture these from the API response.

### 2.3 RealisticLoadTest.html enhancements
**Visual UI redesign**:
- Dark-themed `header` with title "Realistic User Testing Tool Enhanced".
- New `metrics-panel` with structured `<table>` cells (Project, Report ID, Page, Instance ID, Counter, Current/Average duration, Total runtime, Active Bookmark, Active Filters).
- `embed div` styled with border/shadow/background.
- `footer` with version + attribution back to the Microsoft repo.
- The original `LoadReportCounter` div hidden but kept (still populated for the writeback hook).

**New behaviour**:
- **`numberOfViews` view-limit**: `if (loadCounter < numberOfViews) report = powerbi.embed(...)` — embed loop short-circuits once the configured count is hit. Original ran indefinitely.
- **`instanceID`**: random 7-digit ID generated per page load — distinguishes concurrent browser windows in pooled log files.
- **`projectName`** rendered into every metric row.
- **Per-refresh duration** (`currentDuration`) computed in addition to running average — exposes individual refresh times instead of just trend.
- **Captured state per refresh**: applied `pageName`, `bookmarkValue`, `filterValue.filters`, `filterValue.slicers` are JSON-stringified and shown / logged with each row, so any post-mortem can correlate a slow refresh to the filter combination that caused it.
- **Visible UI helpers**: `panes: { bookmarks: { visible: true }, filters: { expanded: true, visible: true } }` — useful for interactive review.
- **`updateMetricsTable()` helper** rewrites the structured table cells per refresh.
- **Total elapsed runtime** in `H:MM:SS` format.

**Writeback hook**:
- `CefSharp.PostMessage(divCounter.innerHTML)` is invoked at the end of each `EmbedReport()` cycle and on errors. This is what makes file-based logging possible — see §2.5.

### 2.4 PowerShell launcher (`Run_Load_Test_Only.ps1`)
- Replaced raw `start chrome "--user-data-dir=..."` with `Start-Process -FilePath .\ChromeWriteBack\ChromeWriteBack -ArgumentList "<htmlPath> <logPath>"`.
- Per-instance log file written to `Test Results\<workspace> - <report> - <timestamp>.txt`.
- Replaced `--$loopCounter` with `$loopCounter--` (PowerShell-correct decrement) and `sleep` with `Start-Sleep` (alias-cleanup).
- Final teardown kills `ChromeWriteback.exe` instead of `chrome.exe`.

### 2.5 ChromeWriteBack — custom CefSharp browser
`RealisticLoadTestTool/ChromeWriteBack/` contains a compiled CefSharp.WinForms-based custom Chromium browser (~100 DLLs including `CefSharp.dll`, `chrome_elf.dll`, `libcef.dll`, locale packs). Behaviour:
- Takes two CLI args: HTML file path + output log file path.
- Hosts a single `ChromiumWebBrowser` window pointed at the HTML.
- Subscribes to `JavascriptMessageReceived` → appends each message to the log file.

This means each `CefSharp.PostMessage(divCounter.innerHTML)` from JS becomes a line in the per-instance log file. **Source for this binary is not in the repo** — only the compiled output ships.

### 2.6 New documentation
- **`UserGuide.html`** — standalone styled docs page covering install, quick start, configuration, examples, troubleshooting, best practices. Replaces `Readme.md` as primary user-facing docs.
- **`Power BI Load Testing Demo.pbix`** — sample report deployable to a workspace for end-to-end smoke testing.

### 2.7 Removed
- `DemoLoadTest1/`, `DemoLoadTest2/` — sample test folders (the new templating model in `Parameter Catalogue/` makes them redundant).

---

## 3. Test results data model

Each test instance produces a `Test Results/<folder name>.txt` file. Each line is a single refresh's `divCounter.innerHTML` payload — i.e., HTML with `<br>` separators between fields:

```
Report id: ce7dc7f9-...<br>
Instance id: 5992180<br>
Run Time: Tue Feb 04 2025 00:12:04 GMT+0000<br>
1/15 refreshes<br>
6.101 seconds refresh time<br>
6.101 seconds average refresh time<br>
1 seconds think time<br>
Displayed page: "ReportSection..."<br>
Applied bookmark: Bookmarkb4d346f...<br>
Applied filters: []<br>
Applied slicers:[{"selector":{...}}]<br>
Project Name: test<br>
```

Concurrent instances are **interleaved** in separate files (one per launch) — but identifiable via `Instance id`. `Test Results Analysis.xlsx` is the manual analysis path: regex-parse fields out of HTML in Excel and chart them.

**Notable in the data**: counter goes `1/15 ... 16/15` — view limit isn't strictly enforced (off-by-one in `loadCounter < numberOfViews` check vs. `loadCounter++` placement after the embed call). Worth flagging for the upgrade.

---

## 4. Architecture summary diagram (text)

```
                      +-----------------------------+
                      |  Setup_Load_Test.ps1        |
                      |  - Login-PowerBI            |
  Filters.json   --+  |  - List workspaces/reports  |
  Bookmarks.json --|--|  - Prompt: views/think/proj |
  Page.json      --+  |  - Inject templates via     |
                      |    regex → PBIReport.json   |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      | <ws>-<report>-<ts>/         |  one folder per
                      |   RealisticLoadTest.html    |  configured report
                      |   PBIReport.json            |
                      |   PBIToken.json             |
                      +--------------+--------------+
                                     |
   Update_Token_                     |     (every 60 min)
   Only.ps1  -----refreshes PBIToken.json in every subfolder
                                     |
                                     v
                      +-----------------------------+
                      | Run_Load_Test_Only.ps1      |
                      | - For each subfolder:       |
                      |   N x ChromeWriteBack.exe   |
                      |     <html> <log.txt>        |
                      +--------------+--------------+
                                     |
                                     v
        +----------------------------+----------------------------+
        | ChromeWriteBack (CefSharp Chromium wrapper)             |
        |   loads RealisticLoadTest.html                          |
        |   <-- powerbi.embed() with filters/bookmarks/page       |
        |   --> on rendered: setTimeout(EmbedReport, thinkTime)   |
        |   --> CefSharp.PostMessage(divCounter.innerHTML)        |
        |       --> appended to Test Results/<folder>.txt         |
        +---------------------------------------------------------+
```

---

## 5. Pain points / gaps observed

Before the modernization research lands, these are the points already visible from the fork-vs-upstream analysis:

1. **rawgit CDN dependency** — the script `https://cdn.rawgit.com/Microsoft/PowerBI-JavaScript/master/dist/powerbi.min.js` may stop loading at any time. Same for jQuery 1.11.1 from googleapis CDN.
2. **CefSharp binary blob** — ~100 DLLs in repo (~150MB), no source code, no provenance. Hard to maintain, audit, or rebuild.
3. **Token refresh is manual** — break a 60-minute run-time ceiling and a long load test requires babysitting.
4. **Log format is HTML-with-`<br>`** — needs regex parsing in Excel; not analysable as JSONL or CSV without translation.
5. **No live aggregate dashboard** — N browsers each show their own metrics; no cross-instance roll-up while running.
6. **Setup wizard requires per-report re-login** — the loop calls `Login-PowerBI` inside `while($reportCount -gt 0)`, so every additional report re-prompts.
7. **Off-by-one view limit** — `16/15` rows appear in real test data, indicating the limit isn't strictly enforced.
8. **Regex-based JSON injection** — fragile (e.g., a `]` inside a filter value would break the `'"filters".*]'` regex); JSON parsing/manipulation in PowerShell would be safer.
9. **Per-folder config duplication** — every subfolder is a full copy of html + 3 JSON files; 50 reports = 50 HTML copies all identical. A single shared HTML driven by a manifest would be cleaner.
10. **No service principal path** — can't run unattended in Azure DevOps / GitHub Actions / scheduled VMs without an interactive Power BI login.
11. **No Fabric capacity awareness** — capacity SKU detection, CU consumption integration with the Fabric Capacity Metrics App is absent.
12. **Demo .pbix is a binary** — would be friendlier as a Power BI Project (pbip) format for source-controlled review.

The modernization research (in `_Research/modern-pbi-loadtest-landscape.md`, in flight) will inform which of these to prioritize.
