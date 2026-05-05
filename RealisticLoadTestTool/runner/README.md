# RealisticLoadTest Runner (v1.0 Stage 1)

Node + Playwright orchestrator that replaces `Run_Load_Test_Only.ps1` + `ChromeWriteBack/` (CefSharp).

## Why this exists

The v0.7.1 runner used CefSharp via `file://` URLs. Entra rejects `file://` redirect URIs, so MSAL (the only supported auth path in v0.8) can't run there. This runner serves the HTML over `http://localhost`, so MSAL works in every window. As a side effect, it also kills the entire CefSharp dependency (~200MB of unmanaged binaries) and the dual auth path that came with it.

## Install (one-time)

```powershell
cd RealisticLoadTestTool/runner
npm install
npx playwright install chromium    # downloads the browser binary, ~150MB
```

## Run

```powershell
# 1 instance, headed, default http://localhost:8080
node run.js

# 5 parallel instances against the configured PBIReport.json
node run.js --concurrency 5

# headless background mode (requires a previously-cached MSAL token in the profile dir)
node run.js --concurrency 3 --headless

# pick a different port if 8080 is taken (and ALSO add http://localhost:<port> to your Entra app)
node run.js --port 9000

# override hostname (rare — only if Entra was registered with 127.0.0.1)
node run.js --host 127.0.0.1
```

> **Entra redirect URI must match exactly.** The runner defaults to `http://localhost:8080` because that's what the v0.8 Quick Start told you to register. Entra compares redirect URIs as exact strings (host + port + scheme). Change the port → register the new origin in Entra. Change the host → same. See `MEMORY.md`.

## What you get

```
<repo>/Test Results/
  RealisticLoadTest - <MM-dd-yy_HHmmss>/
    <instanceId>.jsonl       # one file per browser tab — JSONL per the v0.8 schema
    runner.log               # runner-level events (start/stop/auth/errors/completion)
    .browser-profile/        # persistent MSAL cache for this run
```

The JSONL schema is identical to v0.8 (`_Documentation/JSONL-schema.md`). The only difference is *how* the records reach disk: the runner captures `console.log('METRIC ...')` from each page instead of CefSharp.PostMessage.

## First run — interactive sign-in

The first time you run in headed mode, the first browser window will show the "Sign in with Microsoft" button. Click it, complete the popup, and the MSAL token caches in `.browser-profile/` (shared by all pages in the run). Subsequent pages and reloads acquire silently.

For headless runs to work, you must first run **headed at least once** to populate the cache. The runner reuses `.browser-profile/` across runs *only if you point at the same path* (currently it's per-run; future enhancement will allow a shared profile dir).

## Limitations (Stage 1)

- **One scenario per run.** The runner reads `RealisticLoadTestTool/PBIReport.json` (single-scenario, multi-instance). Multi-scenario runs (the old subfolder iteration in `Run_Load_Test_Only.ps1`) come back in **Stage 4** via `loadtest.yaml`.
- **No live aggregation.** Each instance writes its own JSONL; cross-instance dashboards land in **Stage 2** (coordinator).
- **No host-saturation flag.** The `host_saturated` field on metric records arrives in **Stage 3** (resource monitor).
- **No web setup wizard.** Use the in-page Setup picker (when `PBIReport.json` is empty) or edit `PBIReport.json` by hand. Wizard ships in **Stage 5**.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All instances reached `view_limit_reached` — clean run |
| 1 | Runtime error (port in use, Chromium failed to launch, auth-config missing) |
| 2 | User interrupt (Ctrl+C) — partial JSONL on disk is still valid |

## Troubleshooting

- **`Playwright is not installed`** → run `npm install` from this folder.
- **`browserType.launchPersistentContext: Executable doesn't exist`** → run `npx playwright install chromium`.
- **`auth-config.json not found`** → copy `RealisticLoadTestTool/auth-config.example.json` to `auth-config.json` and fill in your `clientId` + `tenantId`.
- **All instances emit `auth_failure`** in headless mode → cached token expired or never existed. Run once headed first.
- **Port 8080 already in use** → pass `--port 9876` (or any free port).

## What was deleted alongside this runner

| Deleted | Why |
|---|---|
| `Run_Load_Test_Only.ps1` | Replaced by `node run.js`. |
| `Update_Token_Only.ps1` | Was already DEAD CODE in v0.8 — MSAL refreshes silently. |
| `PBIToken.json` template | Same — MSAL doesn't read this. |
| `ChromeWriteBack/` (~200MB) | CefSharp gone; Playwright captures console output directly. |
| `CefSharp.PostMessage` writeback in `RealisticLoadTest.html` | Same — `console.log('METRIC ...')` is the single channel. |

Tracking: backlog **T13** (Playwright runner) + **T13a** (legacy delete), both in v1.0 Stage 1.
