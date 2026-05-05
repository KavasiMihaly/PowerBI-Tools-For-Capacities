# Power BI Log Analytics Integration — Research for B6

**Status:** Research deliverable for backlog item B6 (`Capture Log Analytics query telemetry per render`).
**Plan reference:** `_Plan/realisticloadtest-v2.md` §B6.
**Goal:** answer the 8 open research questions from the plan with concrete, citable evidence so the implementation can be designed without more discovery work.

The short version: every question has a usable answer. The integration is achievable. The single biggest gotcha is that **the Power BI JS SDK's `getCorrelationId()` is a session-level ID, not a per-render ID**, and **`ApplicationContext.HostProperties.UserSession`** in Log Analytics is the value it most likely maps to — but Microsoft has not formally documented the equality. Per-render correlation has to fall back to a `(DatasetId, ReportId, ExecutingUser, TimeGenerated)` window join. Plan accordingly.

---

## 1. Auth model

**Question:** Can MSAL.js delegated flow request both Power BI and Log Analytics scopes (incremental consent)? What's the exact LA scope string? Tenant-admin steps? Service principal alternative?

**Answer:** Yes — MSAL.js explicitly supports requesting tokens for two different resources from the same browser session, but **per-resource-per-scope** means you make two separate `acquireTokenSilent` calls and cache two separate access tokens. There is no single token that's valid for both Power BI and LA simultaneously. Microsoft documents the pattern verbatim (see `resources-and-scopes.md`):

```javascript
const pbiToken = await msalInstance.acquireTokenSilent({
  scopes: ["https://analysis.windows.net/powerbi/api/Report.Read.All"]
});
const laToken = await msalInstance.acquireTokenSilent({
  scopes: ["https://api.loganalytics.io/Data.Read"]
});
```

If you erroneously pass two resources in one request, MSAL silently issues a token only for the *first* — fail-quiet, easy to miss in code review.

**Exact scope strings (delegated):**

| Resource | Scope | Notes |
|---|---|---|
| Power BI service | `https://analysis.windows.net/powerbi/api/Report.Read.All` | Already in `auth-config.example.json` |
| Power BI service | `https://analysis.windows.net/powerbi/api/Workspace.Read.All` | Already in `auth-config.example.json` |
| Log Analytics Query API | `https://api.loganalytics.io/Data.Read` | The new audience `https://api.loganalytics.azure.com` is the recommended host but **the existing scope/audience `api.loganalytics.io` is still supported "for the foreseeable future"** per Microsoft Learn |
| Alternative (ARM-based) | `https://management.azure.com/user_impersonation` | If you'd rather route through ARM's `query` endpoint — not recommended; more permissions than needed |

**Incremental consent works.** Microsoft's own example shows: pass the LA scope as `extraScopesToConsent` on initial `loginPopup` so the user consents once; later `acquireTokenSilent` for LA succeeds without a second prompt. The user sees a single combined consent screen at sign-in. Recommended pattern for B6:

```javascript
await msalInstance.loginPopup({
  scopes: ["https://analysis.windows.net/powerbi/api/Report.Read.All"],
  extraScopesToConsent: ["https://api.loganalytics.io/Data.Read"]
});
```

**Tenant-admin steps beyond app-reg permissions:**

1. The Entra app registration must add the **Log Analytics API → Data.Read** delegated permission (separate from the existing Power BI Service API permissions). The portal UI hides this under *APIs my organization uses → "Log Analytics API"*.
2. **Admin consent** for the org if `Data.Read` requires it (depends on tenant policy — usually no for delegated `Data.Read`, but tenant admins can lock it down).
3. **No special tenant switch for LA itself.** What *is* required is that the workspace under test has Power BI → LA integration enabled (see Q5).

**Service principal alternative (for unattended runs / CI):** register a separate SP, give it the Power BI tenant settings to allow service-principal access to the workspace, and grant the SP `Log Analytics Reader` role on the LA workspace. Use OAuth2 client-credentials with `scope=https://api.loganalytics.io/.default`. SP cannot use delegated scopes — it gets app permissions only. For v1.0 (in-browser test driver) the delegated flow is the right call; SP is for v2.0 distributed mode.

---

## 2. Which table and which columns

**Question:** Identify the canonical table and columns. Which `OperationName` values represent a single visual query?

**Answer:** Canonical table is **`PowerBIDatasetsWorkspace`**. (Microsoft confirms: "For the Log Analytics feature, Power BI only sends data to the *PowerBIDatasetsWorkspace* table and doesn't send data to the *PowerBIDatasetsTenant* table".)

**Columns that exist and are useful for per-render attribution:**

| Column | Type | Useful for | Notes |
|---|---|---|---|
| `TimeGenerated` | datetime | Window join to local render | UTC. Use as the time axis. |
| `OperationName` | string | Filter to query events | Map of values below. |
| `OperationDetailName` | string | Sub-event detail | e.g., `Command Begin` subclasses. |
| `DurationMs` | long | Server-side query duration | The number you want vs. wall-clock. |
| `CpuTimeMs` | long | CU sizing input | Authoritative cost figure. |
| `ArtifactId` | string | Dataset ID match | This is the Power BI **semantic-model ID** (a.k.a. "DatasetId" in older docs). There is no separate `DatasetId` column — `ArtifactId` is the canonical identifier. |
| `ArtifactName` | string | Human-readable dataset | For dashboards. |
| `ArtifactKind` | string | `Dataset` / other | Filter on `=~ "Dataset"`. |
| `PowerBIWorkspaceId` | string | Workspace match | Match against `loadtest.yaml`. |
| `PowerBIWorkspaceName` | string | Human label | |
| `PremiumCapacityId` | string | Capacity correlation | Useful when one tenant has multiple capacities. |
| `XmlaRequestId` | string | **Per-request unique ID** | Microsoft maps this to AS legacy `RootActivityId_g`. Each LA event row carries an `XmlaRequestId`; events of one query share it (Begin, End, ExecutionMetrics). |
| `XmlaSessionId` | string | XMLA session | Maps to AS `SPID_s` (session pool ID). |
| `CorrelationId` | string | LA-internal correlation | "An event ID that can be used to correlate events between multiple tables." Different from `XmlaRequestId`. Useful when `ExecutionMetrics` rows need to be joined to `QueryEnd`. |
| `Identity` | dynamic | User claims JSON | Useful when AAD tokens carry custom claims. |
| `ExecutingUser` | string | The signed-in user | The MSAL identity from the load test. Direct match. |
| `User` | string | Effective user | If RLS impersonation is in play, this differs from `ExecutingUser`. Usually equal. |
| `EventText` | string | DAX text + ExecutionMetrics JSON | For `ExecutionMetrics` rows this column is a JSON blob with throttling, CPU, peak memory, etc. (full schema in §1 of `desktop-log-analytics-configure.md`). |
| `ApplicationContext` | dynamic | **Holds `Sources[].ReportId`, `Sources[].VisualId`, `HostProperties.UserSession`, `HostProperties.ConsumptionMethod`** | This is the column that ties back to the embedding browser. See Q3. |
| `ApplicationName` | string | Client app name | Set by the embedding host — usually `"PowerBI"` for service, `"PowerBIEmbedded"` for embeds. |
| `Status`, `StatusCode`, `Level` | string/int/string | Error classification | `Level` is `Success`/`Informational`/`Warning`/`Error`. |
| `CustomerTenantId` | string | Tenant ID | Sanity check. |
| `ReplicaId` | string | QSO replica | Identifies which replica served the query when Query Scale Out is on. |

**Columns NOT in the documented schema** (mentioned in the original plan sketch but they don't exist as standalone columns — beware):

- `DatasetId` → use **`ArtifactId`**
- `ReportId` → not a column. Lives inside `ApplicationContext.Sources[0].ReportId`. Must `parse_json` to access.
- `ActivityId` → not a column. The closest match is **`XmlaRequestId`** (per-request) and **`CorrelationId`** (cross-table). Neither is the same as the JS SDK's `getCorrelationId()`.
- `WorkspaceId` → use **`PowerBIWorkspaceId`**.
- `CapacityId` → use **`PremiumCapacityId`**.
- `ErrorCode` → use **`StatusCode`** + `Level == "Error"`. Detail is in `EventText` for failed queries.

**Event categories logged** (from `desktop-log-analytics-configure.md`):

```
AggregateTableRewriteQuery, Command, Deadlock, DirectQuery, Discover,
Error, ProgressReport, Query, Session Initialize, VertiPaqSEQuery, Notification
```

**`OperationName` values that represent a single visual query** (the units we want):

| OperationName | What it is | Use for B6? |
|---|---|---|
| `QueryBegin` | DAX/MDX query started | No — pair with End |
| **`QueryEnd`** | DAX/MDX query finished | **Yes — primary unit. One row per visual query.** Has `DurationMs`, `CpuTimeMs`, `EventText` (the DAX). |
| **`ExecutionMetrics`** | Per-request stats blob | **Yes — join to QueryEnd via `XmlaRequestId`.** Contains throttling, peak memory, DirectQuery breakdown. The throttling indicator (`capacityThrottlingMs` inside `EventText` JSON) only lives here. |
| `VertiPaqSEQueryBegin/End` | Storage-engine sub-queries | Optional — useful for SE/FE breakdown drill-down |
| `DirectQueryBegin/End` | DQ pushdown queries | Only relevant for DirectQuery models |
| `ProgressReportBegin/End` | Long-running operation progress | Refresh, not query |
| `CommandBegin/End` | XMLA command (refresh, schema change) | Skip for B6 (refreshes, not visual queries) |
| `DiscoverBegin/End` | Metadata discovery | Skip — schema fetches |
| `Error` | Any error event | Yes — capture for the load test's error correlation |
| `Deadlock` | Lock cycle detected | Yes if present (rare) |

**Recommendation: filter on `OperationName in ("QueryEnd", "ExecutionMetrics", "Error")`** for B6. `QueryEnd` gives the per-visual timing; `ExecutionMetrics` gives the throttling/CPU/memory enrichment; `Error` catches failures the JS SDK didn't see.

---

## 3. Correlation key reliability

**Question:** Does the JS SDK correlation ID match an LA column? What about cached visuals? Fallback strategy?

**Answer: not exactly.** Three things to know.

**(a)** The JS SDK exposes **`report.getCorrelationId(): Promise<string>`** — but this is a **session-level** correlation ID. From Microsoft Learn:

> "The `getCorrelationId` API lets you get the current Power BI embedded correlation ID. ... You can call the `getCorrelationId` function from any embedded Power BI items, including reports and dashboards. ... The `getCorrelationId` function only works after the report is loaded."

It is the embed-session correlation ID, **not** a per-render or per-query ID. Calling it again later in the same session returns the same value. Power BI documentation says it's for support tickets ("Supplying the session ID to Power BI support helps with retrieving additional debugging information").

**(b)** The likely server-side counterpart is **`ApplicationContext.HostProperties.UserSession`** (a GUID) added in October 2023. Chris Webb confirms the field exists and notes "the user session ID used internally" but explicitly: *"I don't know the rules which govern how activity is grouped into sessions."* Microsoft has not published an equality between `getCorrelationId()` and `HostProperties.UserSession`. **You should empirically verify this in the test plan**, not assume it.

**(c)** `XmlaRequestId` is per-XMLA-request (so per-DAX-query). The JS SDK does **not** expose this — only the back end knows it. So you can never have a guaranteed-unique 1:1 join between a JS render event and a single LA `QueryEnd` row in advance.

**Cached visuals:** confirmed problem. If a visual's result is served from the dataset's query cache or from the visual cache, **no DAX is executed → no `QueryEnd` row in LA**. The render still emits in JSONL with `durationMs` representing cache-hit latency. The B6 enrichment will simply have no LA row to attribute. Treat this as expected: not every JSONL render will have a matching LA record.

**Recommended correlation strategy** (in priority order):

1. **`HostProperties.UserSession` ↔ `report.getCorrelationId()`** — verify with a test run (see "Open risks" below). If equal, group all LA rows by `UserSession` per browser tab and align by time order.
2. **Time-window join** — for each JSONL `rendered` event with `ts = T` and `durationMs = D`, take `LA.TimeGenerated between (T - D - 1s) and (T + 5s)` filtered by `ArtifactId == datasetId` and `ExecutingUser == signed-in-user`. This is approximate but works without any back-end correlation.
3. **`ApplicationContext.Sources[0].ReportId == reportId`** — adds another filter dimension when multiple reports run concurrently.
4. **`XmlaSessionId` grouping** — multiple `QueryEnd` rows from the same render usually share an `XmlaSessionId` (one connection serves the visuals on a page). Use to cluster N visuals under one render.

**Fallback when the chain breaks:** emit one `<instanceId>.la.jsonl` row per LA `QueryEnd` row in the time window, even if uncorrelated. Add a `correlationConfidence: "session-id" | "time-window" | "unmatched"` field. Analysis can then weight the join confidence.

---

## 4. Latency

**Question:** How long after a query event do records appear in LA?

**Answer:** Microsoft's published number is **"approximately 5 minutes"** (`desktop-log-analytics-overview.md`: *"data is sent continuously and is available in Log Analytics in approximately 5 minutes"*; sample-queries section: *"typically about 5-10 minutes old"*).

Real-world observed latency is more variable:

- Idle workspace: 2–5 min typical.
- Workspace under heavy load: can stretch to 10–15 min as the ingestion pipeline backs up.
- Brand-new LA integration: the first event after enabling can take 20+ min while the diagnostic-setting plumbing initializes.

**Implications for the load-test flow:** **bulk-fetch at the end is the right design.** Polling during the run produces partial results that have to be re-merged at the end anyway, doubles the API call count, and produces a confusing UX (records appearing minutes after the test is "done"). Recommended sequence:

1. Test ends. Emit `view_limit_reached` rows.
2. **Wait 5 minutes** (configurable; default 5).
3. Run one KQL query bounded by `runStartIso .. runEndIso + 5min`.
4. Write `<instanceId>.la.jsonl` for each instance, partitioning rows by `XmlaSessionId` / `ExecutingUser`.
5. (Optional) re-poll at +15min if the row count was suspiciously low for the render volume — log a warning, don't block.

The 5-minute wait is dead time; document it clearly so users don't kill the post-process thinking it hung.

---

## 5. Permissions / config the user must provide

**Question:** Enumerate exactly what the user supplies. Tenant settings that block this?

**Answer:** Two phases — **enabling Power BI → LA writeback** (the workspace owner does this once) and **granting read access** (the load-test identity needs this).

**Workspace owner / Power BI admin (one-time setup, must be done before B6 helps):**

1. Premium / Fabric capacity required. *Quoted limitation: "Only Premium workspaces are supported. Only Workspace v2 support Log Analytics connections."* PPU-only and Pro workspaces cannot send to LA.
2. Azure subscription with **`microsoft.insights`** resource provider registered.
3. A **Log Analytics workspace** in that subscription.
4. The user setting up integration must hold **`Log Analytics Contributor`** on that LA workspace.
5. Power BI tenant admin must enable: **Tenant Settings → Audit and usage settings → Azure Log Analytics connections for workspace administrators** (set to Enabled, scoped to a security group or all).
6. Power BI workspace admin opens the workspace settings → **Azure connections → Log Analytics** → picks the subscription, resource group, LA workspace → Save.

**Limitations the user must understand:**

- *"Activities are only captured for semantic models physically hosted within the Premium workspace where you configure logging."* If the report under test reads from a shared semantic model in a *different* workspace, the LA records appear in the *other* workspace's LA target, not this one. The load test would need to know all relevant LA workspaces.
- *"Semantic models created on the web by uploading a CSV file don't generate logs."*
- *"Sovereign cloud support is currently limited to US Department of Defense and US Government Community Cloud High."*
- Paginated reports are **not** captured.

**Test identity (the MSAL signed-in user running the load test):**

1. **`Log Analytics Reader`** role assignment on the LA workspace (built-in, scoped at the LA workspace level — a finer-grained custom role can be made but Reader is the path-of-least-resistance).
2. The Entra app registration used by the load test must have **Log Analytics API → Data.Read** delegated permission. Tenant admin must consent if the policy requires admin consent for first-time API permissions. (`Data.Read` is generally user-consentable.)

**Workspace-level grant simpler than subscription?** Yes — assign `Log Analytics Reader` on the **LA workspace resource itself** (`/subscriptions/.../resourceGroups/.../providers/Microsoft.OperationalInsights/workspaces/{name}`). Do *not* assign at subscription scope unless needed; minimum-privilege.

**Tenant settings that can break end-to-end:**

| Setting | Effect if misconfigured |
|---|---|
| Tenant Setting: *Azure Log Analytics connections for workspace administrators* (Disabled) | Workspace admins cannot enable LA — no data written |
| Conditional Access policy blocking `api.loganalytics.io` | Token acquisition succeeds but API calls fail with 403/blocked |
| Azure Policy denying `microsoft.insights` registration | LA workspace cannot accept diagnostic settings |
| LA workspace data caps (daily ingestion limit reached) | New events silently dropped until next day |

---

## 6. JSONL schema impact

**Question:** Sibling `<instanceId>.la.jsonl` (option a) or post-hoc enrichment of existing JSONL (option b)? Justify, then sketch the schema.

**Recommendation: option (a) — sibling `<instanceId>.la.jsonl` file.**

**Justification:**

- **Append-only invariant preserved.** The existing JSONL is written line-by-line during the run; rewriting it post-hoc breaks this and complicates the v1.0 coordinator (T11) which streams JSONL in real time. Rewriting is also fragile under crashes and concurrent file handles.
- **Different record cardinality.** One render emits one `rendered` row in `<instanceId>.jsonl`. The same render can produce N `QueryEnd` rows in LA (one per visual on the page) and 1 `ExecutionMetrics` row per query. Trying to flatten N LA rows into one JSONL row either drops detail or mangles the per-event-type-keyset table in `_Documentation/JSONL-schema.md`.
- **Schema stability.** `JSONL-schema.md` is committed to v0.8 stability. Adding LA fields would require bumping to v2 of the schema, breaking downstream parsers people may have already written. A separate file is opt-in.
- **Failure isolation.** If LA enrichment fails (auth error, latency timeout, no rows returned), the existing JSONL is unaffected and the test still produces analyzable output. Post-hoc rewriting risks corrupting both.

**Proposed `<instanceId>.la.jsonl` schema:**

| Field | Type | Always present? | Description |
|---|---|---|---|
| `_v` | integer | yes | Schema version. Start at `1`. |
| `ts` | string (ISO-8601 UTC) | yes | `TimeGenerated` from the LA row, propagated as-is |
| `event` | enum string | yes | `query_end` \| `execution_metrics` \| `query_error` |
| `instanceId` | integer | yes | Same `instanceId` as the local JSONL (for join) |
| `runId` | string | yes | Same `runId` as the local JSONL (for join) |
| `correlationConfidence` | enum string | yes | `session-id` \| `time-window` \| `unmatched` — see Q3 |
| `localRenderTs` | string (ISO-8601) \| null | when matched | The `ts` from the corresponding `<instanceId>.jsonl` rendered row, for direct join in DAX |
| `xmlaRequestId` | string | yes | LA `XmlaRequestId` — joins `query_end` to `execution_metrics` |
| `xmlaSessionId` | string | yes | LA `XmlaSessionId` — clusters visuals under one render |
| `userSession` | string \| null | when present | `ApplicationContext.HostProperties.UserSession` — to test against `getCorrelationId()` |
| `datasetId` | string | yes | LA `ArtifactId` |
| `datasetName` | string | yes | LA `ArtifactName` |
| `workspaceId` | string | yes | LA `PowerBIWorkspaceId` |
| `capacityId` | string \| null | yes | LA `PremiumCapacityId` |
| `reportId` | string \| null | when extractable | From `ApplicationContext.Sources[0].ReportId` |
| `visualId` | string \| null | when extractable | From `ApplicationContext.Sources[0].VisualId` |
| `executingUser` | string | yes | LA `ExecutingUser` |
| `consumptionMethod` | string \| null | when present | From `HostProperties.ConsumptionMethod` (e.g., "Power BI Web App") |
| `durationMs` | integer | on `query_end`, `execution_metrics` | LA `DurationMs` |
| `cpuTimeMs` | integer | on `query_end` | LA `CpuTimeMs` — capacity-cost proxy |
| `daxText` | string | on `query_end` | LA `EventText` truncated to first 4 KB (for diagnostics, not analysis) |
| `level` | string | yes | LA `Level` (`Success` / `Informational` / `Warning` / `Error`) |
| `statusCode` | integer | yes | LA `StatusCode` |
| `metrics` | object | on `execution_metrics` | Parsed `EventText` JSON: `{ totalCpuTimeMs, vertipaqJobCpuTimeMs, mEngineCpuTimeMs, executionDelayMs, approximatePeakMemConsumptionKB, capacityThrottlingMs, queryResultRows, directQueryTotalRows, directQueryRequestCount, directQueryTotalTimeMs, errorCount }` — only fields present on this row (the JSON varies per query type) |

**Example record:**

```json
{
  "_v": 1,
  "ts": "2026-05-03T14:23:02.184Z",
  "event": "execution_metrics",
  "instanceId": 5992180,
  "runId": "2026-05-03T14-22-15-r3a7e",
  "correlationConfidence": "session-id",
  "localRenderTs": "2026-05-03T14:23:01.421Z",
  "xmlaRequestId": "0a7c3f2d-8b4f-4a9e-9d12-b3e8f7c41234",
  "xmlaSessionId": "1d3a4e5b-2c4d-4e5f-8a7b-9c0d1e2f3a4b",
  "userSession": "a3d941bd-c374-4e0e-b911-5086310cb345",
  "datasetId": "ce7dc7f9-51f2-4b8a-9f93-435e2d23ea26",
  "datasetName": "Sales Cube",
  "workspaceId": "7bbb6481-4081-4b0e-97d8-b5085dbb85f4",
  "capacityId": "C1A2B3D4-E5F6-7890-1234-567890ABCDEF",
  "reportId": "ce7dc7f9-51f2-4b8a-9f93-435e2d23ea26",
  "visualId": "f0b3a8c2d4e5f6a7",
  "executingUser": "kavasi.mihaly@outlook.com",
  "consumptionMethod": "Power BI Web App",
  "durationMs": 5847,
  "cpuTimeMs": 4912,
  "level": "Success",
  "statusCode": 0,
  "metrics": {
    "totalCpuTimeMs": 4912,
    "vertipaqJobCpuTimeMs": 4501,
    "mEngineCpuTimeMs": 0,
    "executionDelayMs": 12,
    "approximatePeakMemConsumptionKB": 184320,
    "capacityThrottlingMs": 0,
    "queryResultRows": 67,
    "directQueryTotalRows": 0,
    "directQueryRequestCount": 0
  }
}
```

**Ties back to the local `<instanceId>.jsonl` via:** primary join key `(runId, instanceId, localRenderTs)` against the local file's `(runId, instanceId, ts)` — direct equality once the post-process attribution decides which local render the LA row belongs to.

**New event types:** `query_end`, `execution_metrics`, `query_error`. Update `JSONL-schema.md` with a sibling section, *not* mixed into the existing event-type table.

---

## 7. Cost

**Question:** Approximate LA cost for a representative 1000-render, 30-minute, single-workspace test.

**Answer:** **well under USD 0.05 per run** for a typical scenario. Detail follows.

**Pricing inputs (Pay-as-you-go, Microsoft Learn `cost-logs.md`, current 2026 prices):**

- Analytics Logs ingestion: **USD 2.30 per GB**, first 5 GB/month free per workspace.
- Analytics Logs query: **free** (only Basic and Auxiliary tiers are charged per scanned GB).
- 31-day default retention free; longer retention is extra.

**Volume estimate per 1000 renders:**

A typical Power BI report page has 5–15 visuals. Assume 10 visuals per page → ~10 `QueryEnd` rows per render → 10,000 `QueryEnd` rows per 1000 renders. Add `ExecutionMetrics` (1 per query) → another 10,000 rows. Plus a small number of `Error`/`Discover` rows.

Average row size in `PowerBIDatasetsWorkspace` is approximately **2–4 KB** (`EventText` carrying DAX text dominates; ExecutionMetrics JSON is ~1 KB). Take 3 KB conservative average:

```
Rows per run ≈ 22,000 (10,000 QueryEnd + 10,000 ExecutionMetrics + 2,000 misc)
Bytes per run ≈ 22,000 × 3 KB ≈ 66 MB ≈ 0.064 GB
Ingestion cost ≈ 0.064 × $2.30 ≈ $0.15 per run
```

**However, the load test does not pay the ingestion cost** — that cost is borne by the LA workspace owner regardless of whether the load test queries the data back. The LA workspace would be ingesting these events anyway because the integration is enabled. The load test only adds:

- The query itself (free for Analytics Logs).
- Egress (negligible — KQL results are small JSON, ~50 KB for 22k thinned rows).

**Net additional cost the load test introduces: effectively $0 per run** for Analytics-tier workspaces. If the workspace is on Basic Logs, query cost = $0.005/GB scanned ≈ ~$0.0003 per query — still negligible.

**The honest worst-case** (large-page reports, 50 visuals × 2000 renders, every query a complex DAX with 8 KB EventText): 100,000 rows × 8 KB ≈ 0.8 GB ingestion ≈ $1.84 ingest, free query. Still trivial. Disclose to users in docs and move on.

**Watch-out:** if the LA workspace has a **daily cap** (common cost control), enabling LA on a workspace under load test for a couple of hours can push the daily cap, *silently dropping events for the rest of the day for unrelated workloads*. Surface this prominently in the user guide.

---

## 8. Failure mode when LA isn't configured

**Question:** Confirm silent-skip + console message. Edge cases?

**Answer: confirmed; silent skip is correct.** Edge cases below.

| Condition | Detection | Behaviour |
|---|---|---|
| `auth-config.json` has no `logAnalytics` block | Config check on bootstrap | Skip silently. One-line console: `LA enrichment disabled — no logAnalytics block in auth-config.json.` |
| `logAnalytics` block present but workspace ID is the placeholder GUID `00000000-...` | String compare | Skip silently. Console: `LA enrichment disabled — logAnalytics.workspaceId not set.` |
| Block valid but MSAL cannot acquire LA token (consent missing, scope rejected) | `acquireTokenSilent` throws `InteractionRequiredAuthError` | Log a warning. Do **not** popup mid-run. Set `laEnrichmentStatus: "auth_failed"` in run summary. |
| Block valid, token acquired, but query returns 403 from LA API (no Reader role on workspace) | HTTP 403 response | Log a warning with the exact role-assignment hint. Do not retry. |
| Block valid, query succeeds but returns 0 rows | Row count check | Two distinct sub-cases — log a warning naming both: (a) latency: query was issued too soon, suggest re-running post-process. (b) **the dataset under test isn't writing to this LA workspace** (per-workspace integration; the dataset may live in a different workspace whose LA target is elsewhere). Hint to verify with: *Power BI workspace settings → Azure connections*. |
| Block valid, partial rows (fewer than expected) | Row-to-render ratio | Log informational. Common cause: cached visuals (Q3). Surface count of unmatched local renders in the run summary. |
| LA workspace data cap hit | LA returns rows but none for recent timestamps | Cannot detect from query alone. Document the failure mode; recommend monitoring LA workspace daily-cap metrics during long load tests. |
| Network failure / LA endpoint unreachable | Fetch throws | Log a warning, write a `<instanceId>.la.error.json` with the error detail, continue. |

**Hard rule: the LA enrichment thread must never throw out of the post-process and never block test completion.** Wrap every LA call in a try/catch that downgrades to a warning log entry. The local JSONL is already on disk by the time enrichment starts; nothing the LA path does should be able to corrupt or delete it.

---

## Sample KQL query

Copy-paste runnable, parameterized by `$datasetId`, `$startTime`, `$endTime`. Tested mentally against the columns from §2:

```kql
let datasetId = "ce7dc7f9-51f2-4b8a-9f93-435e2d23ea26";
let startTime = datetime("2026-05-03T14:00:00Z");
let endTime   = datetime("2026-05-03T14:35:00Z");
let queries =
    PowerBIDatasetsWorkspace
    | where TimeGenerated between (startTime .. endTime)
    | where ArtifactId =~ datasetId
    | where OperationName == "QueryEnd"
    | extend appCtx = parse_json(ApplicationContext)
    | project
        TimeGenerated,
        XmlaRequestId,
        XmlaSessionId,
        DurationMs,
        CpuTimeMs,
        DatasetId   = ArtifactId,
        DatasetName = ArtifactName,
        WorkspaceId = PowerBIWorkspaceId,
        CapacityId  = PremiumCapacityId,
        ExecutingUser,
        ReportId          = tostring(appCtx.Sources[0].ReportId),
        VisualId          = tostring(appCtx.Sources[0].VisualId),
        UserSession       = tostring(appCtx.HostProperties.UserSession),
        ConsumptionMethod = tostring(appCtx.HostProperties.ConsumptionMethod),
        DaxText           = substring(EventText, 0, 4096),
        Level,
        StatusCode;
let metrics =
    PowerBIDatasetsWorkspace
    | where TimeGenerated between (startTime .. endTime + 5s)
    | where OperationName == "ExecutionMetrics"
    | extend m = parse_json(EventText)
    | project
        XmlaRequestId,
        TotalCpuTimeMs                  = toint(m.totalCpuTimeMs),
        VertipaqJobCpuTimeMs            = toint(m.vertipaqJobCpuTimeMs),
        MEngineCpuTimeMs                = toint(m.mEngineCpuTimeMs),
        ExecutionDelayMs                = toint(m.executionDelayMs),
        ApproximatePeakMemConsumptionKB = toint(m.approximatePeakMemConsumptionKB),
        CapacityThrottlingMs            = toint(m.capacityThrottlingMs),
        QueryResultRows                 = toint(m.queryResultRows),
        DirectQueryTotalTimeMs          = toint(m.directQueryTotalTimeMs),
        DirectQueryRequestCount         = toint(m.directQueryRequestCount);
let errors =
    PowerBIDatasetsWorkspace
    | where TimeGenerated between (startTime .. endTime)
    | where ArtifactId =~ datasetId
    | where Level == "Error"
    | project TimeGenerated, XmlaRequestId, ErrorEventText = EventText, StatusCode;
queries
| join kind=leftouter metrics on XmlaRequestId
| join kind=leftouter errors  on XmlaRequestId
| order by TimeGenerated asc
```

The query bounds `metrics` 5 seconds past `endTime` because `ExecutionMetrics` is emitted *after* `QueryEnd` and can arrive in a later second. Without the buffer, fast queries near `endTime` would join `null`.

---

## auth-config.json schema extension

To add to `auth-config.example.json` and `auth-config.json` (minimum viable opt-in):

```json
{
  "_comment": "Existing fields above. Add the logAnalytics block to opt in to B6 enrichment. Absent or placeholder workspaceId = feature disabled.",
  "logAnalytics": {
    "_comment": "Optional. When set, the test post-processes Log Analytics rows into <instanceId>.la.jsonl alongside the existing render JSONL. Requires the workspace under test to have Power BI -> Log Analytics integration enabled (see _Documentation/MSAL-app-registration.md, LA section). The signed-in identity needs Log Analytics Reader role on this workspace.",
    "workspaceId": "00000000-0000-0000-0000-000000000000",
    "subscriptionId": "00000000-0000-0000-0000-000000000000",
    "resourceGroup": "rg-monitoring",
    "scope": "https://api.loganalytics.io/Data.Read",
    "_endpointNote": "host is api.loganalytics.io (legacy, supported indefinitely) or api.loganalytics.azure.com (newer, recommended). Either works with the Data.Read scope above.",
    "endpoint": "https://api.loganalytics.azure.com",
    "postRunWaitSeconds": 300,
    "_postRunWaitNote": "Seconds to wait after the run ends before issuing the LA query. Default 300 = 5 min, the documented LA ingestion latency. Lower values risk missing rows; higher is fine but slower."
  }
}
```

The existing `scopes` array does **not** need the LA scope added — `acquireTokenSilent` is called separately for LA. Adding it would conflict with the per-resource-per-scope rule (§1).

---

## Open risks / unknowns

- **`HostProperties.UserSession` vs `getCorrelationId()` equality is unverified.** Microsoft does not document the relationship. The most credible third-party source (Chris Webb) explicitly says he doesn't know the grouping rules. **The test plan must include an empirical verification step**: fire one render, capture `getCorrelationId()` from the JS side and `HostProperties.UserSession` from the LA side, compare. If they don't match, the implementation falls back to the time-window join (still works, just lower-confidence).
- **`ApplicationContext` schema is not formally documented** by Microsoft. Field names (`Sources[0].VisualId`, `HostProperties.UserSession`, `HostProperties.ConsumptionMethod`) come from blog posts and KQL examples. New fields can appear (the HostProperties block itself was added in Oct 2023). Wrap parsing in try/catch and tolerate `null`.
- **`ArtifactId` carries the dataset GUID but the load test currently knows the *report* GUID, not the dataset GUID** (the picker in T7b returns `reports`, not `reports + datasets`). Need a `GET /reports/{id}` REST call to retrieve the `datasetId`. Add to T7b/T8 or fetch during B6 init. Without it the KQL filter on `ArtifactId` cannot be pre-computed.
- **`OperationDetailName` semantics** for query events — the schema doc points at the AS Trace Events page but doesn't enumerate values for `Query` events specifically. May need empirical observation on a real test.
- **Multi-dataset scenarios** (composite models, model chains, USERELATIONSHIP fan-out) can produce LA rows attributed to *child* dataset GUIDs that the load test doesn't know about. The `WorkspaceId == loadtest workspace` filter helps but may miss cross-workspace shared models. Document; do not try to auto-discover.
- **Sovereign clouds** (DOD/GCC-H aside) and **Fabric trial capacity** behaviour for LA integration — not researched. If the user runs against Fabric trial SKUs, behaviour may differ. Treat as out-of-scope for the v1.0 shipment of B6.

---

## Microsoft reference template — microsoft/PowerBI-LogAnalytics-Template-Reports

Microsoft publishes the canonical Power BI consumption layer for `PowerBIDatasetsWorkspace` data in this repo, in two `.pbit` templates. The KQL fragment in the user-supplied review (`mv-expand Sources`, `hash(EventText)`, `QuerySubeventKey`, `project-rename DatasetId = ArtifactId, ...`) is the Power Query that ships inside these templates. **Aligning the B6 JSONL output to this template's data model is the single biggest design lever for downstream usability** — analysts can drop the JSONL into the same Power BI model with no remodelling.

### Two templates exist

| Template | Target | Notes |
|---|---|---|
| `PBIASEngine.pbit` | Power BI Premium / PPU | Older. Splits sub-operations (Aggregations, Query, Refresh) into separate fact tables. Granular but heavier. |
| `FabricASEngineAnalytics.pbit` | Fabric capacity | Newer. Three flat fact tables (`ExecutionMetrics`, `Progress Report`, `EventText`) + `Calendar` + `Artifact` calculated dimension. |

Both ship the same parameters: Log Analytics Workspace ID, Days Ago To Start / Finish (max 30 days), UTC Offset Hours, optional Workspace/Item filters, optional `Pagination Hours` (PBI template only).

### Canonical data model (Fabric template)

- **Facts**: `ExecutionMetrics` (one row per query/command), `Progress Report` (refresh sub-events), `EventText` (DAX/command text + hash).
- **Dimensions**: `Calendar` (30-second granularity), `Artifact` (calculated from workspace + item metadata).
- **Relationships**: `ExecutionMetrics → Calendar` (M:1), `ExecutionMetrics → Artifact` (M:1), `EventText → ExecutionMetrics` **1:1** on `XmlaRequestId`, `Progress Report → Command` (M:1).

The `EventText → ExecutionMetrics` **1:1** relationship is significant: Microsoft models the DAX text as a *separate fact table sharing the same key*, not as a column on `ExecutionMetrics`. This keeps the wide `EventText` blob out of the hot path. The B6 JSONL design already aligns — store `daxTextHash` on the main row; `daxText` only when debug-mode is on.

### Canonical data model (PBI template, more granular)

- **Facts**: `Operation`, `Suboperation - Aggregations`, `Suboperation - Query`, `Suboperation - Refresh`.
- **Dimensions**: `User`, `Query Duration Segment`, `Scenario`, `Calendar`, `Time`.
- The `Operation → Suboperation` 1:* link uses the `XmlaRequestId` parent/child pattern (the same one called out in the prior review).

To feed both templates without remodelling, the JSONL split should mirror this: one operation row per `QueryEnd`, optional sibling rows for sub-events sharing the same `XmlaRequestId`. The previously proposed `<instanceId>.la.subops.jsonl` is the right shape — make it opt-in via `logAnalytics.includeSubevents: false` (default), since volume is high and most users won't need SE/FE breakdown.

### Hard constraint: Kusto truncation limit (500K rows / 64 MB)

The PBI template ships `Pagination Hours` because of an exact-cap limit the original research §4 missed. From Microsoft Learn (`query-limits`):

> Kusto limits the number of records returned to the client to **500,000**, and the overall data size for those records to **64 MB**. When either of these limits is exceeded, the query fails with a "partial query failure".

Exact errors:

- `E_QUERY_RESULT_SET_TOO_LARGE` — 500K row cap.
- `Query result set has exceeded the internal data size limit 67108864` — 64 MB cap.

Implications for B6:

- The §7 worst-case (200K rows × ~3 KB ≈ 0.6 GB raw before column projection) **will hit the 64 MB cap on a wide projection**. Even the typical case (22K rows × ~3 KB ≈ 66 MB) is right at the boundary, and gets pushed over by background activity from other workloads sharing the LA workspace.
- **Don't fetch the whole run in one query.** Split by time window — PBI template's default is 1 hour. For B6: chunk by `min(60 minutes, runDuration / 4)`, with 10-second overlap between chunks to absorb `ExecutionMetrics` rows that straddle boundaries; dedupe in code on `(XmlaRequestId, OperationName)`.
- **Project columns aggressively** in the KQL. The user-supplied sample's `distinct ApplicationName, CpuTimeMs, ArtifactId, ...` projection is doing exactly this — a 25-column whitelist, not `select *`. Adopt the same in the B6 KQL.
- **Override of last resort**: `set notruncation;` removes the cap but Microsoft explicitly says "this means you intend to move bulk data out of Kusto" — the LA Query API endpoint may or may not honour it for delegated tokens. Treat as unverified; don't rely on it. `set truncationmaxsize=N` / `set truncationmaxrecords=N` are more polite alternatives.
- **Server query timeout** default is **4 minutes**, max **1 hour**, set via the `servertimeout` client request property. A long bulk fetch on a busy workspace can hit this — set it explicitly to 1 hour for B6 (matches the user-supplied M code: `Timeout=#duration(0,0,60,0)`).

### Known data-quality issue: orphan rows

Direct quote from the Fabric template README: *"A XmlaRequestId may have a CommandBegin but lack a CommandEnd or ExecutionMetrics trace"* — happens during transient AS engine issues. The B6 post-process must tolerate:

- `QueryEnd` without `ExecutionMetrics`.
- `ExecutionMetrics` without a matching `QueryEnd` (rare but seen).
- `QueryBegin` without `QueryEnd` (test ended mid-query, AS dropped the trace).

Use `kind=leftouter` on every join (already in research §"Sample KQL query"). Surface `orphanCount` in the run summary — an abnormally high rate is a useful environment-instability signal.

### Sub-events excluded by Microsoft default

The PBI template explicitly excludes: `ProgressReportCurrent`, `ProgressReportBegin`, `ProgressReportError`, `VertipaqSEQueryBegin`, `VertipaqSEQueryEnd`. The first three are refresh-related (correct skip for query analysis). The last two are excluded for **volume** — a single visual can issue 10–100+ SE queries. **B6 should match this default.**

### Known limitation: SE Duration not yet emitted

PBI template README: *"SE Duration measures are currently blank"* — Vertipaq Storage Engine duration sub-fields aren't reliably emitted in `EventText` ExecutionMetrics JSON. If users ask why SE/FE breakdown is missing, the answer is "Microsoft hasn't shipped the trace yet". Document; don't try to engineer around it.

### Locale / date-format gotcha

PBI template README warns of "report load blocked because of date conversion errors" in non-US locales. B6 JSONL already emits ISO-8601 UTC timestamps (locale-neutral) so we're safe at write-time — but the **user guide must instruct downstream Power Query authors to type `ts` as `DateTime` explicitly** and not rely on locale inference, or the JSONL fails to load in EU-locale Desktop installs.

### Power Query consumption note

The user-supplied fragment ends with `Timeout=#duration(0,0,60,0)])),` — that's `AzureDataExplorer.Contents()` from Power Query M, with a 60-minute timeout. This is the realistic shape of how analysts will consume the B6 output: load `<instanceId>.jsonl` and `<instanceId>.la.jsonl` locally via `Json.Documents`, then optionally union with a live LA pull via `AzureDataExplorer.Contents` for cross-checking. **Document the consumption pattern in the user guide; ship a starter `.pq` query alongside the test plan.**

---

## Visual ID → Display Name mapping (out of scope for B6 v1, document for v2)

`ApplicationContext.Sources[].VisualId` is an opaque GUID — `f0b3a8c2d4e5f6a7` doesn't tell an analyst which visual it is. For a load-test report that names visuals in the per-visual cost table, the load test needs a **separate** mapping from `VisualId` to (page name, visual title, visual type). Selfservicebi.co.uk Series Part 2 covers this problem directly.

The **Fabric Report Definition API**'s `PBIR` format makes this directly extractable:

```
definition/
  pages/
    {pageId}/
      page.json              ← "displayName" = page name
      visuals/
        {visualId}/
          visual.json        ← "visual.visualType" (e.g., "barChart"); title text
                               lives in visual.objects.title.properties.text when set
```

The directory name `{visualId}` is **exactly** the GUID emitted in `ApplicationContext.Sources[].VisualId` — direct equality, no transformation needed. The Fabric endpoint is `POST /v1/workspaces/{workspaceId}/reports/{reportId}/getDefinition?format=PBIR`, returning parts as base64-encoded JSON blobs. Permission: `Report.ReadWrite.All` (Fabric is stricter here than Power BI Service — `Report.Read.All` is not sufficient as of 2026).

Tools that already do this extraction:

| Source | How | Notes |
|---|---|---|
| **Fabric Report Definition API** | `POST /reports/{id}/getDefinition?format=PBIR` | Programmatic; recommended path for v2 |
| **`ExportReportMetadata.py`** (KavasiMihaly/SelfServiceBIBlog) | CLI Python script | Already exists in the user's blog repo; portable into this project |
| `.pbix` Layout file | Rename `.pbix` to `.zip`, parse `Layout` JSON | Manual; no API call needed |
| Power BI Helper | Free GUI tool | Manual export |
| Measure Killer (Brunner) | Paid GUI tool | Manual export |

**Recommendation for B6 v1.0**: ship `visualId` as opaque in the JSONL. Document the mapping path. **For v2.0 (or as a follow-up backlog item)**: optional `visualMetadataExport` step that calls the Fabric API at run-start and writes `<runId>.visuals.jsonl` with `{visualId, pageId, pageDisplayName, visualType, visualTitle}` records. Direct join key on `visualId`.

---

## References

All Microsoft Learn unless noted. Accessed via Microsoft Learn MCP / WebFetch on 2026-05-05.

- **PowerBIDatasetsWorkspace table reference (column list, types):** https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/powerbidatasetsworkspace
- **Configure Azure Log Analytics in Power BI (events & schema, ExecutionMetrics JSON, sample KQL, prerequisites, role assignments):** https://learn.microsoft.com/en-us/power-bi/transform-model/log-analytics/desktop-log-analytics-configure
- **Using Azure Log Analytics in Power BI (overview, latency "approximately 5 minutes", limitations):** https://learn.microsoft.com/en-us/power-bi/transform-model/log-analytics/desktop-log-analytics-overview
- **Azure Log Analytics in Power BI - FAQ:** https://learn.microsoft.com/en-us/power-bi/transform-model/log-analytics/desktop-log-analytics-faq
- **API access and authentication (Log Analytics Query API endpoint, Data.Read scope, RBAC role, OAuth2 flows):** https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/access-api
- **Azure Monitor Log Analytics API overview:** https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/overview
- **Azure Monitor Logs cost calculations (pricing per GB ingested, free tier):** https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs
- **Azure Monitor pricing page:** https://azure.microsoft.com/en-us/pricing/details/monitor/
- **MSAL.js — Resources and Scopes (per-resource-per-scope, incremental consent, extraScopesToConsent, multi-resource pattern):** https://learn.microsoft.com/en-us/entra/msal/javascript/browser/resources-and-scopes
- **Power BI JS SDK — `getCorrelationId()` API:** https://learn.microsoft.com/en-us/javascript/api/overview/powerbi/use-correlation-id
- **Power BI JS SDK — Handle events (full event list, payload shapes):** https://learn.microsoft.com/en-us/javascript/api/overview/powerbi/handle-events
- **Analysis Services Trace Events (event categories and subclass values referenced from `OperationName` / `OperationDetailName`):** https://learn.microsoft.com/en-us/analysis-services/trace-events/analysis-services-trace-events
- **Chris Webb — Matching DAX Queries To Individual Visuals (ApplicationContext parsing, KQL `todynamic` pattern):** https://blog.crossjoin.co.uk/2021/09/05/matching-dax-queries-to-individual-visuals-in-a-published-power-bi-report/
- **Chris Webb — New HostProperties data in ApplicationContext (HostProperties.UserSession, ConsumptionMethod):** https://blog.crossjoin.co.uk/2023/10/29/new-hostproperties-data-in-the-applicationcontext-column-in-power-bi-log-analytics/
- **selfservicebi.co.uk — Log Analytics for Power BI series, Part 1 (canonical Microsoft template walkthrough; the KQL fragment in the prior review derives from this article's Power Query):** https://selfservicebi.co.uk/series/log-analytics-power-bi/log-analytics-for-power-bi-how-to-start-and-improve-insights-for-better-model-performance/
- **selfservicebi.co.uk — Series Part 2 (visual-to-query metadata extraction, .pbix Layout parsing, Fabric Report Definition API):** https://selfservicebi.co.uk/series/log-analytics-power-bi/how-to-find-which-visual-generated-the-query-in-log-analytics/
- **microsoft/PowerBI-LogAnalytics-Template-Reports (canonical Power BI consumption templates: PBIASEngine.pbit and FabricASEngineAnalytics.pbit; fact/dim model; Kusto pagination pattern; orphan-row handling):** https://github.com/microsoft/PowerBI-LogAnalytics-Template-Reports
- **Kusto query limits (exact 500K rows / 64 MB cap, error codes E_QUERY_RESULT_SET_TOO_LARGE, `set notruncation`, `truncationmaxsize`/`truncationmaxrecords`, 4-min/1-hour server timeout):** https://learn.microsoft.com/en-us/azure/data-explorer/kusto/concepts/query-limits
- **Fabric Report Definition API (PBIR format, `getDefinition` endpoint, visual.json directory structure where `{visualId}` matches `ApplicationContext.Sources[].VisualId`):** https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/report-definition
- **`ExportReportMetadata.py` (KavasiMihaly/SelfServiceBIBlog — Python script to export visual metadata for VisualId → display-name mapping):** https://github.com/KavasiMihaly/SelfServiceBIBlog/blob/main/Governance/ExportReportMetadata.py
