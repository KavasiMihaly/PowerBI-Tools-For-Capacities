#!/usr/bin/env node
/*
 * RealisticLoadTest runner (v1.0 Stage 1) — replaces Run_Load_Test_Only.ps1 + CefSharp/ChromeWriteBack.
 *
 * Pipeline:
 *   1. Serve RealisticLoadTestTool/ over http://127.0.0.1:<port> (MSAL-compatible; file:// is rejected by Entra).
 *   2. Launch one persistent Chromium context (shared MSAL token cache across all instances).
 *   3. Open <concurrency> pages, each navigates to /RealisticLoadTest.html.
 *   4. Capture console output; each line that starts with "METRIC " is a JSONL record emitted by the page.
 *   5. Append each record to Test Results/<runId>/<instanceId>.jsonl.
 *   6. Exit when every instance has emitted event:"view_limit_reached" (or the user kills the process).
 *
 * Usage:
 *   node run.js                           # 1 instance, headed, http://localhost:8080
 *   node run.js --concurrency 5           # 5 parallel instances
 *   node run.js --headless                # background mode
 *   node run.js --port 9000 --concurrency 3 --headless
 *   node run.js --host localhost          # default; override only if Entra was registered with 127.0.0.1
 *   node run.js --launch-spacing-sec 5    # delay between window launches (default 5s, matches old PowerShell)
 *
 * IMPORTANT: the host:port the runner serves on MUST exactly match a redirect URI registered
 * on your Entra SPA app — Entra compares as exact strings (host, port, scheme, no trailing /).
 * Defaults match the v0.8 Quick Start (http://localhost:8080) so existing app registrations keep working.
 *
 * Output:
 *   <repo>/Test Results/<runId>/<instanceId>.jsonl   one file per browser tab, one JSON object per line
 *   <repo>/Test Results/<runId>/runner.log           runner-level events (start, stop, errors, completion)
 *
 * Exit codes:
 *   0 — all instances reached view_limit_reached
 *   1 — runtime error (server failed to start, browser launch failed, etc.)
 *   2 — user interrupt (SIGINT / Ctrl+C); partial JSONL on disk is still valid
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const TOOL_ROOT = path.resolve(__dirname, '..');                 // …/RealisticLoadTestTool
const REPO_ROOT = path.resolve(TOOL_ROOT, '..');                 // …/PowerBI-Tools-For-Capacities
const RESULTS_ROOT = path.join(REPO_ROOT, 'Test Results');

// ----- arg parsing (no deps) -----
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
const PORT = parseInt(args.port || args.p || '8080', 10);
// Hostname matters: Entra treats 'localhost' and '127.0.0.1' as different redirect URIs
// (exact-string match — see MEMORY.md). Default 'localhost' matches the v0.8 Quick Start
// recommendation so existing Entra app registrations keep working unchanged.
const HOST = args.host || 'localhost';
const HEADLESS = !!args.headless;
const LAUNCH_SPACING_MS = parseInt(args['launch-spacing-sec'] || '5', 10) * 1000;

// ----- minimal static file server -----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8'
};

function safeJoin(root, requested) {
  // Prevent path traversal: resolve and verify the result still lives under root.
  const decoded = decodeURIComponent(requested.split('?')[0]);
  const trimmed = decoded.replace(/^\/+/, '');
  const target = path.normalize(path.join(root, trimmed));
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  return target;
}

function startServer(rootDir, port, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = url.parse(req.url);
      const target = safeJoin(rootDir, reqUrl.pathname || '/');
      if (!target) { res.writeHead(403); res.end('Forbidden'); return; }

      fs.stat(target, (err, st) => {
        if (err) { res.writeHead(404); res.end('Not found: ' + reqUrl.pathname); return; }
        let filePath = target;
        if (st.isDirectory()) filePath = path.join(target, 'RealisticLoadTest.html');

        fs.readFile(filePath, (err2, data) => {
          if (err2) { res.writeHead(404); res.end('Not found: ' + reqUrl.pathname); return; }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-store'
          });
          res.end(data);
        });
      });
    });
    server.once('error', reject);
    // Bind to the loopback host the user configured (default 'localhost'). Same security
    // stance as the v0.8 manual `python -m http.server` workflow — never reachable off-box.
    server.listen(port, host, () => resolve(server));
  });
}

// ----- run-id / paths -----
function makeRunId() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${String(d.getFullYear()).slice(2)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `RealisticLoadTest - ${stamp}`;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// ----- per-instance JSONL writer (lazy: keyed by in-page instanceId) -----
function makeWriterRegistry(runDir) {
  const writers = new Map(); // instanceId -> { stream, lastEvent }
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
    isComplete(instanceId) {
      const e = writers.get(instanceId);
      return !!e && e.lastEvent === 'view_limit_reached';
    },
    closeAll() {
      for (const { stream } of writers.values()) stream.end();
      writers.clear();
    },
    instanceCount() { return writers.size; }
  };
}

// ----- runner-level log file -----
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

// ----- pre-flight: verify auth-config.json exists with a real clientId -----
function preflightAuth(toolRoot, log) {
  const cfgPath = path.join(toolRoot, 'auth-config.json');
  if (!fs.existsSync(cfgPath)) {
    log.error('auth-config.json not found at ' + cfgPath);
    log.error('Copy auth-config.example.json → auth-config.json and fill in clientId + tenantId.');
    log.error('See _Documentation/MSAL-app-registration.md for one-time Entra setup.');
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
  // Lazy-require playwright so users see a clean error if they haven't run `npm install`.
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('[runner] Playwright is not installed.');
    console.error('[runner] Run: cd RealisticLoadTestTool/runner && npm install');
    console.error('[runner] Then: npx playwright install chromium    (downloads the browser binary, ~150MB)');
    process.exit(1);
  }

  const runId = makeRunId();
  const runDir = path.join(RESULTS_ROOT, runId);
  ensureDir(runDir);
  const log = makeRunnerLog(runDir);

  log.info(`runId=${runId}`);
  log.info(`tool root=${TOOL_ROOT}`);
  log.info(`results=${runDir}`);
  log.info(`concurrency=${CONCURRENCY} headless=${HEADLESS} host=${HOST} port=${PORT} launch-spacing=${LAUNCH_SPACING_MS}ms`);

  if (!preflightAuth(TOOL_ROOT, log)) { log.close(); process.exit(1); }

  let server;
  try {
    server = await startServer(TOOL_ROOT, PORT, HOST);
    log.info(`HTTP server listening on http://${HOST}:${PORT} (root: ${TOOL_ROOT})`);
    log.info(`reminder: this exact origin (http://${HOST}:${PORT}) must be registered as a redirect URI on your Entra SPA app`);
  } catch (e) {
    log.error('failed to start HTTP server: ' + e.message);
    if (e.code === 'EADDRINUSE') {
      log.error(`port ${PORT} is already in use — pass --port <free-port> AND register that exact origin in Entra`);
    }
    log.close();
    process.exit(1);
  }

  // Persistent context = single shared profile = single MSAL cache shared across all pages.
  // First sign-in serves all subsequent pages silently.
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
    server.close();
    log.close();
    process.exit(1);
  }

  const writers = makeWriterRegistry(runDir);
  const expectedInstances = CONCURRENCY;
  const targetUrl = `http://${HOST}:${PORT}/RealisticLoadTest.html`;

  // Track every page so we can close cleanly at the end.
  const pages = [];
  // Track which page-index has finished. We can't key on instanceId until the first METRIC arrives,
  // so we count completion via writers.isComplete(...) at exit-poll time.
  let completedCount = 0;

  function attachConsoleCapture(page, pageIdx) {
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('METRIC ')) {
        const json = text.slice(7); // strip 'METRIC ' prefix
        try {
          const rec = JSON.parse(json);
          if (rec.instanceId == null) {
            log.warn(`page#${pageIdx}: METRIC line missing instanceId — skipped`);
            return;
          }
          writers.write(rec.instanceId, rec);
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

  // Launch pages with spacing (matches old PowerShell 5s default — avoids initialization stampede).
  for (let i = 0; i < CONCURRENCY; i++) {
    const page = await context.newPage();
    attachConsoleCapture(page, i);
    log.info(`page#${i}: opening ${targetUrl}`);
    page.goto(targetUrl).catch((e) => log.warn(`page#${i} goto error: ${e.message}`));
    pages.push(page);
    if (i < CONCURRENCY - 1) {
      await new Promise(r => setTimeout(r, LAUNCH_SPACING_MS));
    }
  }

  // First-run interactive sign-in: in headed mode, the user clicks "Sign in with Microsoft"
  // in the first window. The MSAL token then caches in the shared profile and subsequent
  // pages acquire silently. In headless mode, sign-in is impossible — you must have
  // signed in once via headed mode first (the cache persists in profileDir).
  if (HEADLESS) {
    log.info('headless mode: relies on previously cached MSAL token in ' + profileDir);
    log.info('if no cached token, all instances will emit auth_failure and exit cleanly');
  } else {
    log.info('headed mode: sign in via the first window to populate the shared MSAL cache');
  }

  // ----- completion polling -----
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) return;
    interrupted = true;
    log.info('SIGINT received — shutting down (partial JSONL is still valid)');
  });

  const startMs = Date.now();
  const HARD_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h safety cap
  while (!interrupted) {
    if (completedCount >= expectedInstances) { log.info('all instances complete'); break; }
    if (Date.now() - startMs > HARD_TIMEOUT_MS) { log.warn('hard timeout reached (24h)'); break; }
    await new Promise(r => setTimeout(r, 2000));
  }

  log.info('closing browser context…');
  try { await context.close(); } catch (e) { log.warn('context.close error: ' + e.message); }
  log.info('closing HTTP server…');
  try { server.close(); } catch (e) { /* ignore */ }
  writers.closeAll();
  log.info(`run complete — results in ${runDir}`);
  log.close();
  process.exit(interrupted ? 2 : 0);
})().catch((e) => {
  console.error('[runner] fatal: ' + (e.stack || e.message || e));
  process.exit(1);
});
