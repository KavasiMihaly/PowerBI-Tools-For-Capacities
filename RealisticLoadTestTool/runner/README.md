# RealisticLoadTest Runner (v1.0 Stage 2)

Node + Playwright orchestrator. Connects to the coordinator (Stage 2), launches N Chromium contexts, captures per-page metrics, writes per-instance JSONL files, and POSTs the same records to the coordinator as a backup channel.

## Why this exists

Replaces `Run_Load_Test_Only.ps1` + `ChromeWriteBack/` (CefSharp, deleted in Stage 1). HTML is served over `http://localhost` so MSAL works in every window — the multi-window auth limitation from v0.8 is gone.

## Install (one-time)

```powershell
cd RealisticLoadTestTool/runner
npm install
npx playwright install chromium    # downloads the browser binary, ~150MB
```

## Run

Stage 2 requires the coordinator to be running first.

```powershell
# Terminal A — coordinator (leave running)
cd RealisticLoadTestTool/coordinator
node server.js

# Terminal B — actual test
cd RealisticLoadTestTool/runner
node run.js --concurrency 5
```

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--concurrency N` | 1 | Number of parallel browser tabs |
| `--coordinator URL` | `http://localhost:8080` | Coordinator base URL |
| `--headless` | off | Background mode (needs cached MSAL token in the profile dir) |
| `--launch-spacing-sec N` | 5 | Delay between window launches |
| `--no-coordinator-resend` | off | Disable runner's backup `POST /metric` (page-side POSTs still happen) |

> **Entra redirect URI must match the coordinator's exact origin.** Change the coordinator's port → register the new origin in your Entra app. Entra compares as exact strings (host + port + scheme). See `MEMORY.md`.

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

## Limitations (Stage 2)

- **One scenario per run.** The runner reads `RealisticLoadTestTool/PBIReport.json` (single-scenario, multi-instance). Multi-scenario runs come back in **Stage 4** via `loadtest.yaml`.
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
