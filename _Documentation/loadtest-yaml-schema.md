# `loadtest.yaml` schema (v1.0 Stage 4)

This is the single source-of-truth config format for RealisticLoadTest runs from v1.0 onward. It replaces the v0.8 per-folder `PBIReport.json` / `Filters.json` / `Bookmarks.json` / `Page.json` files.

A worked example lives at [`RealisticLoadTestTool/loadtest.example.yaml`](../RealisticLoadTestTool/loadtest.example.yaml). Migration of legacy folders is automated via `node coordinator/migrate.js <legacy-folder>`.

## Top-level fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project` | string | yes | — | Free-form label stamped on every metric record as `projectName`. Used to group runs downstream. Must be non-empty. |
| `workspace` | GUID string | yes | — | Power BI workspace (group) ID. All `reports[].id` must live in this workspace. For cross-workspace runs, use multiple YAML files. |
| `concurrency` | positive int | yes | — | Browser tabs per scenario. Total tabs = `concurrency × Σ(scenarios across all reports)`. Must be ≥ 1. |
| `viewsPerSession` | positive int | yes | — | Renders per tab before exit. v0.8 called this `numberOfViews`. Must be ≥ 1. |
| `thinkTimeSec` | non-negative int | yes | — | Seconds between renders (per tab). v0.8 called this `thinkTimeSeconds`. Must be ≥ 0. |
| `sessionRestart` | non-negative int | no | `100` | Full-tab reload cadence (every N renders) to mitigate iframe memory leaks. `0` disables. |
| `layoutType` | enum | no | `"Master"` | Power BI SDK `LayoutType`. One of: `Master`, `Custom`, `MobilePortrait`, `MobileLandscape`. |
| `reports` | array | yes | — | At least one report. See structure below. |

## `reports[]` structure

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | GUID string | yes | Power BI report ID. The runner constructs the embedUrl as `https://app.powerbi.com/reportEmbed?reportId=<id>&groupId=<workspace>`. |
| `name` | string | yes | Human label — surfaced in dashboard `perReport` aggregation and JSONL records. Used only for grouping in analysis. Must be non-empty. |
| `scenarios` | array | yes | At least one scenario per report. See structure below. |

## `scenarios[]` structure

Each scenario is a `(page, bookmarks, filters)` tuple defining what a simulated user looks at. Each scenario spawns `concurrency` browser tabs.

| Field | Type | Required | Notes |
|---|---|---|---|
| `page` | string | no | Power BI page internal name (the GUID-suffixed name, e.g. `ReportSectionAbc123`) — NOT the display name. Get it via `GET /reports/{id}/pages`. Omit to let Power BI pick the default page. |
| `bookmarks` | string array | no | Bookmark IDs to cycle through. Each render flips to the next one (round-robin). Empty or absent = no bookmarks applied. |
| `filters` | array | no | Filter / slicer combinatorics — preserved verbatim from v0.8 semantics. See `filters[]` structure below. |

## `filters[]` structure

| Field | Type | Required | Notes |
|---|---|---|---|
| `table` | string | yes | Power BI table name (e.g. `Calendar`). Must match the dataset's table name exactly. |
| `column` | string | yes | Column within the table. Must match the dataset's column name exactly. |
| `isSlicer` | boolean | yes | `true` targets the visual slicer bar; `false` is a report-level filter applied via the SDK's `filters` parameter. |
| `values` | array | yes | List of values to cycle through. Each entry is either a scalar (single-select) or a nested list (multi-select combined into one selection). |

### `values` semantics — combinatoric cycling

The runner cycles through every combination of (filter₁ value × filter₂ value × …) across all filters in a scenario. For each render, it picks the next combination round-robin.

A scalar in `values` is one selection: `2020` means "Year = 2020". A nested list is a single multi-value selection: `["East Hampshire", "Winchester", "New Forest"]` means "LA Name IN (East Hampshire, Winchester, New Forest)" as one cycle step.

So `values: [2020, 2021, [2019, 2018]]` = three cycle steps: `[Year=2020]`, `[Year=2021]`, `[Year IN (2019, 2018)]`.

## Validation rules (enforced at load time by `coordinator/loadtest-validator.js`)

The validator rejects YAMLs with actionable, field-named errors. Required failures:

| Mutation | Expected error |
|---|---|
| Remove `workspace` | `"workspace is required (top-level)"` |
| Set `concurrency: -1` | `"concurrency must be a positive integer (got -1)"` |
| Replace `filters[0]` with `"oops"` | `"reports[0].scenarios[0].filters[0] must be an object with keys table, column, isSlicer, values"` |
| Remove `reports` | `"reports is required and must be a non-empty array"` |
| Set `reports[0].id` to `"not-a-guid"` | `"reports[0].id must be a GUID"` |
| Set `viewsPerSession: 0` | `"viewsPerSession must be a positive integer (got 0)"` |
| Set `layoutType: "Banana"` | `"layoutType must be one of Master, Custom, MobilePortrait, MobileLandscape (got 'Banana')"` |

GUID validation regex: `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`.

## Field renames from v0.8

| v0.8 (per-folder JSON) | v1.0 (YAML) | Notes |
|---|---|---|
| `numberOfViews` | `viewsPerSession` | Same semantics, name aligned with plan §Stage 4. |
| `thinkTimeSeconds` | `thinkTimeSec` | Same semantics, shorter name. |
| `reportUrl` | (derived) | Runner builds the embed URL from `workspace` + `reports[].id`. |
| `pageName` | `scenarios[].page` | Now per-scenario, not run-wide. |
| `bookmarkList` | `scenarios[].bookmarks` | Now per-scenario, not run-wide. |
| `filters[].filterTable` | `filters[].table` | Drop the `filter` prefix. |
| `filters[].filterColumn` | `filters[].column` | Drop the `filter` prefix. |
| `filters[].filtersList` | `filters[].values` | Drop the `filter` prefix. |
| `projectName` | `project` (top-level) | Move to top-level since one project per file. |

## How the runner consumes the YAML

`node runner/run.js --config <path>` (defaults to `./loadtest.yaml`):

1. Parses YAML via `js-yaml` (safeLoad).
2. Runs the validator. Any failure exits non-zero with the actionable error.
3. Expands into a flat list of `(report, scenario)` pairs.
4. For each pair, spawns `concurrency` Chromium contexts. Each context navigates to `<coordinator>/RealisticLoadTest.html?scenario=<base64-encoded JSON of the scenario>` so the page knows what to render.

## Migration from v0.8

`node coordinator/migrate.js <legacy-folder> [-o <out.yaml>]`:

- Reads `<legacy-folder>/PBIReport.JSON`, extracts the workspace ID from the embed `reportUrl` querystring (`?groupId=…`).
- Writes an equivalent `loadtest.yaml` (one report, one scenario by default).
- Field-by-field translation per the rename table above. Filter `filtersList` (incl. nested arrays) preserved verbatim under `values`.

Round-trip property: running the migrated YAML through the runner produces the same scenario as running the legacy folder under v0.8 (filters, bookmarks, page, view count, think time all preserved).
