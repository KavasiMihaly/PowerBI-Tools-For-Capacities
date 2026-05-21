#!/usr/bin/env node
/*
 * RealisticLoadTest runner (v1.0 Stage 4).
 *
 * Two modes:
 *   • YAML mode  — `--config <path>` (or `./loadtest.yaml` autodiscovered). Reads the
 *                  scenario manifest, expands to `concurrency × scenarios` tabs, and
 *                  passes each scenario to the page via `?scenario=<base64-JSON>`.
 *   • Legacy mode — no YAML present. Opens `--concurrency N` identical tabs that all
 *                  read `PBIReport.json` (or fall through to the in-page Setup picker).
 *                  Preserves v0.8 / Stage 2 behaviour unchanged for ad-hoc runs.
 *
 * Pipeline (both modes):
 *   1. Verify the coordinator is reachable (GET /status). If not, refuse to start.
 *   2. Launch one persistent Chromium context (shared MSAL token cache across all tabs).
 *   3. Open the resolved number of tabs (see modes above). YAML mode passes per-tab
 *      scenario config via querystring; legacy mode passes nothing.
 *   4. Capture console output; each line starting with "METRIC " is a JSONL record.
 *   5. Append each record to Test Results/<runId>/<instanceId>.jsonl (canonical truth).
 *   6. Backup POST each record to <coordinator>/metric (the page already POSTs itself).
 *   7. Exit when every tab emits event:"view_limit_reached" (or user Ctrl+C).
 *
 * Usage:
 *   # Terminal A:
 *   node ../coordinator/server.js
 *
 *   # Terminal B (YAML mode):
 *   node run.js --config ../loadtest.yaml
 *
 *   # Terminal B (legacy mode):
 *   node run.js --concurrency 5
 *
 * Flags:
 *   --config <path>         # YAML manifest path. If omitted, autodiscovers ../loadtest.yaml; else legacy mode.
 *   --concurrency N         # legacy mode only; YAML mode reads concurrency from the manifest. Default 1.
 *   --coordinator URL       # default http://localhost:8080
 *   --headless              # background mode (requires a previously-cached MSAL token)
 *   --launch-spacing-sec N  # delay between tab launches; default 5
 *   --no-coordinator-resend # disable the runner's backup POST /metric channel
 *
 * Output:
 *   <repo>/Test Results/<runId>/<instanceId>.jsonl
 *   <repo>/Test Results/<runId>/runner.log
 *
 * Exit codes:
 *   0 — all tabs reached view_limit_reached
 *   1 — runtime error (coordinator unreachable, Chromium failed, auth-config missing, YAML invalid)
 *   2 — user interrupt (SIGINT / Ctrl+C); partial JSONL on disk is still valid
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const TOOL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(TOOL_ROOT, '..');
const RESULTS_ROOT = path.join(REPO_ROOT, 'Test Results');

// ----- arg parsing -----
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    } else {
      out._.push(a);
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const CONCURRENCY = parseInt(args.concurrency || args.c || '1', 10);
const COORDINATOR_URL = (args.coordinator || 'http://localhost:8080').replace(/\/+$/, '');
const HEADLESS = !!args.headless;
const LAUNCH_SPACING_MS = parseInt(args['launch-spacing-sec'] || '5', 10) * 1000;
const RESEND_TO_COORDINATOR = !args['no-coordinator-resend'];

// Resolve config mode: explicit --config wins; otherwise autodiscover ../loadtest.yaml; else legacy.
function resolveConfigPath() {
  if (args.config) return path.resolve(args.config);
  const autodiscover = path.join(TOOL_ROOT, 'loadtest.yaml');
  return fs.existsSync(autodiscover) ? autodiscover : null;
}
const CONFIG_PATH = resolveConfigPath();

// ----- run-id / paths -----
function makeRunId() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${String(d.getFullYear()).slice(2)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `RealisticLoadTest - ${stamp}`;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// ----- per-instance JSONL writer -----
function makeWriterRegistry(runDir) {
  const writers = new Map();
  return {
    write(instanceId, recordObj) {
      let entry = writers.get(instanceId);
      if (!entry) {
        const file = path.join(runDir, `${instanceId}.jsonl`);
        entry = { stream: fs.createWriteStream(file, { flags: 'a' }), lastEvent: null };
        writers.set(instanceId, entry);
      }
      entry.stream.write(JSON.stringify(recordObj) + '\n');
      entry.lastEvent = recordObj.event;
    },
    closeAll() {
      for (const { stream } of writers.values()) stream.end();
      writers.clear();
    }
  };
}

// ----- runner-level log -----
function makeRunnerLog(runDir) {
  const file = path.join(runDir, 'runner.log');
  const stream = fs.createWriteStream(file, { flags: 'a' });
  function log(level, msg) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    console.log(line);
    stream.write(line + '\n');
  }
  return {
    info: (m) => log('INFO', m),
    warn: (m) => log('WARN', m),
    error: (m) => log('ERROR', m),
    close: () => stream.end()
  };
}

// ----- coordinator HTTP helpers (no deps) -----
function httpRequest(method, urlStr, body, log) {
  return new Promise((resolve, reject) => {
    const u = url.parse(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.path,
      headers: body ? { 'Content-Type': 'application/x-ndjson', 'Content-Length': Buffer.byteLength(body) } : {}
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function probeCoordinator(coordUrl, log) {
  try {
    const r = await httpRequest('GET', coordUrl + '/status', null, log);
    if (r.status !== 200) throw new Error('GET /status returned HTTP ' + r.status);
    const s = JSON.parse(r.body);
    log.info(`coordinator reachable: uptime=${s.uptimeSec}s buffered=${s.bufferSize}`);
    return true;
  } catch (e) {
    log.error(`coordinator unreachable at ${coordUrl}: ${e.message}`);
    log.error(`start it first:  node ${path.relative(process.cwd(), path.join(TOOL_ROOT, 'coordinator', 'server.js'))}`);
    return false;
  }
}

// ----- pre-flight auth check -----
function preflightAuth(toolRoot, log) {
  const cfgPath = path.join(toolRoot, 'auth-config.json');
  if (!fs.existsSync(cfgPath)) {
    log.error('auth-config.json not found at ' + cfgPath);
    log.error('Copy auth-config.example.json → auth-config.json and fill in clientId + tenantId.');
    return false;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!cfg.clientId || cfg.clientId.startsWith('00000000')) {
      log.error('auth-config.json has placeholder clientId. Fill in real values from your Entra app registration.');
      return false;
    }
  } catch (e) {
    log.error('auth-config.json is not valid JSON: ' + e.message);
    return false;
  }
  return true;
}

// ----- main -----
(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('[runner] Playwright is not installed.');
    console.error('[runner] Run: cd RealisticLoadTestTool/runner && npm install');
    console.error('[runner] Then: npx playwright install chromium');
    process.exit(1);
  }

  const runId = makeRunId();
  const runDir = path.join(RESULTS_ROOT, runId);
  ensureDir(runDir);
  const log = makeRunnerLog(runDir);

  log.info(`runId=${runId}`);
  log.info(`tool root=${TOOL_ROOT}`);
  log.info(`results=${runDir}`);
  log.info(`coordinator=${COORDINATOR_URL} concurrency=${CONCURRENCY} headless=${HEADLESS} launch-spacing=${LAUNCH_SPACING_MS}ms resend=${RESEND_TO_COORDINATOR}`);

  if (!preflightAuth(TOOL_ROOT, log)) { log.close(); process.exit(1); }
  if (!(await probeCoordinator(COORDINATOR_URL, log))) { log.close(); process.exit(1); }

  // ----- resolve tabs (YAML mode vs legacy mode) -----
  let tabs;   // array of { scenarioPayload | null } — one entry per browser tab to spawn
  if (CONFIG_PATH) {
    let validator;
    try {
      validator = require(path.resolve(TOOL_ROOT, 'coordinator', 'loadtest-validator'));
    } catch (e) {
      log.error('failed to load coordinator/loadtest-validator: ' + e.message);
      log.close(); process.exit(1);
    }
    let cfg;
    try {
      cfg = validator.loadAndValidate(CONFIG_PATH);
    } catch (e) {
      log.error('invalid loadtest.yaml at ' + CONFIG_PATH);
      log.error('  ' + e.message);
      log.close(); process.exit(1);
    }
    const expanded = validator.expandToTabs(cfg);
    tabs = expanded.map(t => ({ scenarioPayload: t }));
    log.info(`YAML mode: config=${CONFIG_PATH}`);
    log.info(`YAML mode: ${cfg.reports.length} report(s), ${expanded.length} tabs (concurrency=${cfg.concurrency})`);
  } else {
    tabs = Array.from({ length: CONCURRENCY }, () => ({ scenarioPayload: null }));
    log.info(`legacy mode: ${CONCURRENCY} tab(s) reading PBIReport.json (no YAML found at ${path.join(TOOL_ROOT, 'loadtest.yaml')})`);
  }

  // Persistent context = single shared profile = single MSAL cache shared across all pages.
  const profileDir = path.join(runDir, '.browser-profile');
  ensureDir(profileDir);

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: HEADLESS,
      viewport: { width: 1280, height: 900 }
    });
    log.info('Chromium persistent context launched');
  } catch (e) {
    log.error('failed to launch Chromium: ' + e.message);
    log.error('If this is the first run, you may need: npx playwright install chromium');
    log.close();
    process.exit(1);
  }

  const writers = makeWriterRegistry(runDir);
  const expectedInstances = tabs.length;
  const baseUrl = `${COORDINATOR_URL}/RealisticLoadTest.html`;
  const pages = [];
  let completedCount = 0;

  function tabUrlFor(tab) {
    if (!tab.scenarioPayload) return baseUrl;
    const b64 = Buffer.from(JSON.stringify(tab.scenarioPayload), 'utf8').toString('base64');
    return `${baseUrl}?scenario=${encodeURIComponent(b64)}`;
  }

  function attachConsoleCapture(page, pageIdx) {
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('METRIC ')) {
        const json = text.slice(7);
        try {
          const rec = JSON.parse(json);
          if (rec.instanceId == null) {
            log.warn(`page#${pageIdx}: METRIC line missing instanceId — skipped`);
            return;
          }
          writers.write(rec.instanceId, rec);
          // Backup POST to coordinator (page-side already POSTs; this is the safety net for
          // dropped/throttled fetches). Fire-and-forget, never blocks the test.
          if (RESEND_TO_COORDINATOR) {
            httpRequest('POST', COORDINATOR_URL + '/metric', json, log)
              .catch((e) => { /* coordinator restarted? log occasionally to avoid noise */
                if (Math.random() < 0.02) log.warn(`coordinator resend failed: ${e.message}`);
              });
          }
          if (rec.event === 'view_limit_reached') {
            completedCount++;
            log.info(`page#${pageIdx}: instance ${rec.instanceId} reached view_limit_reached (${completedCount}/${expectedInstances})`);
          } else if (rec.event === 'auth_failure') {
            log.error(`page#${pageIdx}: instance ${rec.instanceId} reported auth_failure: ${rec.errorDetail || ''}`);
          }
        } catch (e) {
          log.warn(`page#${pageIdx}: failed to parse METRIC line: ${e.message}`);
        }
      } else if (msg.type() === 'error') {
        log.warn(`page#${pageIdx} console.error: ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      log.warn(`page#${pageIdx} pageerror: ${err.message}`);
    });
  }

  for (let i = 0; i < tabs.length; i++) {
    const page = await context.newPage();
    attachConsoleCapture(page, i);
    const tab = tabs[i];
    const url = tabUrlFor(tab);
    if (tab.scenarioPayload) {
      const sp = tab.scenarioPayload;
      log.info(`page#${i}: opening ${baseUrl} (scenario: report=${sp.reportName} sIdx=${sp.scenarioIndex} slot=${sp.slot})`);
    } else {
      log.info(`page#${i}: opening ${url}`);
    }
    page.goto(url).catch((e) => log.warn(`page#${i} goto error: ${e.message}`));
    pages.push(page);
    if (i < tabs.length - 1) await new Promise(r => setTimeout(r, LAUNCH_SPACING_MS));
  }

  if (HEADLESS) {
    log.info('headless mode: relies on previously cached MSAL token in ' + profileDir);
  } else {
    log.info('headed mode: sign in via the first window to populate the shared MSAL cache');
  }
  log.info(`live dashboard: ${COORDINATOR_URL}/dashboard`);

  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) return;
    interrupted = true;
    log.info('SIGINT received — shutting down (partial JSONL is still valid)');
  });

  const startMs = Date.now();
  const HARD_TIMEOUT_MS = 24 * 60 * 60 * 1000;
  while (!interrupted) {
    if (completedCount >= expectedInstances) { log.info('all instances complete'); break; }
    if (Date.now() - startMs > HARD_TIMEOUT_MS) { log.warn('hard timeout reached (24h)'); break; }
    await new Promise(r => setTimeout(r, 2000));
  }

  log.info('closing browser context…');
  try { await context.close(); } catch (e) { log.warn('context.close error: ' + e.message); }
  writers.closeAll();
  log.info(`run complete — results in ${runDir}`);
  log.info(`coordinator dashboard remains live at ${COORDINATOR_URL}/dashboard until you Ctrl+C the coordinator`);
  log.close();
  process.exit(interrupted ? 2 : 0);
})().catch((e) => {
  console.error('[runner] fatal: ' + (e.stack || e.message || e));
  process.exit(1);
});
