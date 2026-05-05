# JSONL Output Schema (v0.8)

Each test run writes one or more `.jsonl` files (JSON Lines) under `Test Results/<run>/`. One JSON object per line. No outer array, no `<br>` tags, no HTML escaping.

## File naming

```
Test Results/
  <Workspace> - <Report> - <MM-dd-yy_HHmmss>/
    <instanceId>.jsonl
```

Multiple browser instances launched against the same scenario each get their own file, distinguished by `instanceId`.

## Record shape

Every line is one JSON object with the following shape:

```json
{
  "ts": "2026-05-03T14:23:01.421Z",
  "event": "rendered",
  "instanceId": 5992180,
  "runId": "2026-05-03T14-22-15-r3a7e",
  "projectName": "capacity-stress-q2",
  "workspaceId": "7bbb6481-4081-4b0e-97d8-b5085dbb85f4",
  "reportId": "ce7dc7f9-51f2-4b8a-9f93-435e2d23ea26",
  "pageName": "ReportSection4a5c2bece009792aceb0",
  "bookmark": "Bookmarkb4d346f134e7c6d89de3",
  "filters": [],
  "slicers": [
    {
      "selector": { "$schema": "http://powerbi.com/product/schema#slicerTargetSelector", "target": { "table": "Calendar", "column": "Year" } },
      "state":    { "filters": [ { "$schema": "http://powerbi.com/product/schema#basic", "target": { "table": "Calendar", "column": "Year" }, "operator": "In", "values": [2021] } ] }
    }
  ],
  "view":          { "current": 3, "target": 15 },
  "durationMs":    6101,
  "isFirstRender": false,
  "thinkTimeSec":  1
}
```

The first `rendered` event after every page load (including the periodic `sessionRestart` reload) sets `isFirstRender: true`. This isolates cold-start cost (auth + SDK init + first iframe load) from steady-state refresh time. Cold start is intentionally retained — it represents real user "first impression" latency — but flagged so post-run analysis can split warmup from steady-state without guessing.

## Field reference

| Field | Type | Always present? | Description |
|---|---|---|---|
| `ts` | string (ISO-8601 UTC) | yes | Timestamp the record was emitted |
| `event` | enum string | yes | `loaded`, `rendered`, `error`, `view_limit_reached`, `auth_failure` |
| `instanceId` | integer | yes | Random 7-digit ID per browser tab; lets you separate concurrent instances in pooled analyses |
| `runId` | string | yes | One per launch of `Run_Load_Test_Only.ps1` (or v1.0 coordinator). Lets you join across instances |
| `projectName` | string | yes | Free-text tag set in `loadtest.yaml` / setup wizard, for reporting |
| `workspaceId` | string (GUID) | yes | Power BI workspace ID |
| `reportId` | string (GUID) | yes | Power BI report ID |
| `pageName` | string \| null | yes | Internal page section ID (`ReportSection...`); `null` when default page |
| `bookmark` | string \| null | yes | Bookmark ID being applied this cycle; `null` if no bookmarks configured |
| `filters` | array | yes | Report-level filters applied this cycle (Power BI JS SDK basic-filter shape) |
| `slicers` | array | yes | Slicer states applied this cycle (Power BI JS SDK slicer-state shape) |
| `view.current` | integer | yes | 1-based view counter for this instance |
| `view.target` | integer | yes | `numberOfViews` configured for this scenario |
| `durationMs` | number (integer ms) | only on `event: rendered` | Wall-clock between previous `rendered` and this `rendered`, minus think time. Emitted as a flat integer. Aggregates (mean / p50 / p95 / per-bookmark) are derived downstream — never emitted per-record. |
| `isFirstRender` | boolean | only on `event: rendered` | `true` for the first `rendered` event after a page load (cold start). `false` thereafter. Lets analysis split warmup from steady-state. |
| `thinkTimeSec` | integer | yes | `thinkTimeSeconds` from config |
| `errorDetail` | string | only on `event: error` | SDK error detail message |
| `errorCode` | string | only on `event: error` | SDK error code (e.g., `LoadReportFailed`) |
| `host_saturated` | boolean | added in v1.0 only | True if the host's resource monitor flagged saturation during this refresh |

## Event semantics

| Event | When it fires |
|---|---|
| `loaded` | First time the iframe shell is initialized for this instance. Once per session. Sparse fields. |
| `rendered` | After every successful refresh, including the first one. **This is the durations-eligible event.** |
| `error` | When the SDK fires an `error` event from the iframe. Test continues if recoverable. |
| `view_limit_reached` | When `view.current >= view.target`. Final record this instance writes; ends the loop. |
| `auth_failure` | When `accessTokenProvider` returns null (caught failure). Test stops. |

## Schema stability

The schema is stable for the v0.8 line. Any breaking change goes into v0.9 (or a new schema version field). The current implicit version is `1`. v1.0 may add a top-level `_v: 2` field once the host_saturated flag becomes routine.

## Parsing tips

```bash
# All steady-state durations (excluding cold-start renders)
jq 'select(.event=="rendered" and .isFirstRender==false) | .durationMs' *.jsonl

# Just the cold-start renders (first impression latency per page load)
jq 'select(.event=="rendered" and .isFirstRender==true) | .durationMs' *.jsonl

# Steady-state mean (computed downstream, not emitted)
jq -s 'map(select(.event=="rendered" and .isFirstRender==false) | .durationMs) | add/length' *.jsonl

# Errors only
jq 'select(.event=="error")' *.jsonl

# Per-bookmark p95 (steady-state)
jq -s '[.[] | select(.event=="rendered" and .isFirstRender==false)] | group_by(.bookmark) | map({ bookmark: .[0].bookmark, p95: (sort_by(.durationMs) | .[length*0.95 | floor].durationMs) })' *.jsonl

# Schema sanity check (per event type — different events have different keys)
jq -r '"\(.event)\t\(keys | sort | join(","))"' *.jsonl | sort -u
```

Expected key sets:

| Event | Keys (sorted) |
|---|---|
| `loaded` | `bookmark,event,filters,instanceId,pageName,projectName,reportId,runId,slicers,thinkTimeSec,ts,view,workspaceId` (13) |
| `rendered` | `bookmark,durationMs,event,filters,instanceId,isFirstRender,pageName,projectName,reportId,runId,slicers,thinkTimeSec,ts,view,workspaceId` (15) |
| `error` | base 13 + `errorCode,errorDetail` (15) |
| `view_limit_reached` | base 13 (13) |
| `auth_failure` | base 13 + `errorDetail` (14) |

In Power BI: use `Json.Document` on each line via `Lines.FromBinary`, then expand. The HTML-with-`<br>` parsing dance from `Test Results Analysis.xlsx` is no longer required.
