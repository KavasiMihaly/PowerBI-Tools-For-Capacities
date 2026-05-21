#!/usr/bin/env node
/*
 * RealisticLoadTest coordinator (v1.0 Stage 2).
 *
 * Long-running web service that:
 *   1. Serves the RealisticLoadTestTool/ folder as static files (replaces the runner's embedded HTTP).
 *   2. Ingests metric records via POST /metric (browser-side fetch + runner-side resend).
 *   3. Aggregates live stats in memory and exposes them via GET /status.
 *   4. Serves a tiny vanilla-JS dashboard at /dashboard that polls /status every 2 s.
 *
 * Endpoints:
 *   GET  /                  → 302 /dashboard
 *   GET  /dashboard         → dashboard.html
 *   GET  /status            → live aggregate JSON
 *   GET  /metrics.jsonl     → dump in-memory ring buffer (append-friendly)
 *   POST /metric            → ingest one or many newline-separated JSON records
 *   GET  /<anything-else>   → static file from RealisticLoadTestTool/
 *
 * Usage:
 *   node server.js                          # localhost only, port 8080 (matches v0.8/Stage 1 default)
 *   node server.js --port 9000              # different port (remember to register origin in Entra)
 *   node server.js --host 127.0.0.1         # rare host override
 *   node server.js --bind 0.0.0.0 --dev     # B4b architecture-readiness: bind all interfaces, log source IPs
 *
 * The coordinator persists across multiple test runs (start once, run many tests against it).
 * In-memory state only — the runner's per-instance JSONL files are canonical truth on disk.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const COORDINATOR_DIR = __dirname;                                     // …/RealisticLoadTestTool/coordinator
const TOOL_ROOT = path.resolve(COORDINATOR_DIR, '..');                 // …/RealisticLoadTestTool

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
const PORT = parseInt(args.port || '8080', 10);
const DEV_MODE = !!args.dev;
const HOST = args.host || (DEV_MODE && args.bind === '0.0.0.0' ? '0.0.0.0' : 'localhost');
// Stage 2 security: localhost by default. --bind 0.0.0.0 --dev opens to LAN with source-IP audit log
// (B4b architecture-readiness). Production multi-VM auth lands in v2.0 (T14).
const ALLOW_LAN = HOST === '0.0.0.0' && DEV_MODE;

// ----- in-memory metric buffer -----
const BUFFER_MAX = 50_000;          // records — enough for several hours of dense runs
const metricBuffer = [];            // every accepted record, FIFO-trimmed at BUFFER_MAX
const instances = new Map();        // instanceId → { lastEvent, view, lastSeen, runId, reportId, projectName }
let acceptedTotal = 0;
let droppedTotal = 0;
const startedAt = new Date();

// ----- host metrics state (Stage 3 — POST /host-metrics) -----
const HOST_METRICS_BUFFER_MAX = 600;       // 10 minutes at 1Hz
const hostMetricsBuffer = [];              // last N samples from the resource monitor
let hostMetricsLatest = null;              // most-recent sample object

function pushMetric(rec) {
  metricBuffer.push(rec);
  if (metricBuffer.length > BUFFER_MAX) metricBuffer.splice(0, metricBuffer.length - BUFFER_MAX);
  acceptedTotal++;
  // Update per-instance state
  if (rec.instanceId != null) {
    const prev = instances.get(rec.instanceId) || {};
    instances.set(rec.instanceId, {
      lastEvent: rec.event,
      view: rec.view,
      lastSeen: rec.ts || new Date().toISOString(),
      runId: rec.runId || prev.runId,
      reportId: rec.reportId || prev.reportId,
      projectName: rec.projectName || prev.projectName,
      workspaceId: rec.workspaceId || prev.workspaceId
    });
  }
}

// ----- aggregations -----
function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

function buildStatus() {
  const now = Date.now();
  const last60sCutoff = now - 60_000;

  // Filter to rendered events only for duration stats; keep all for counters.
  const renders = metricBuffer.filter(r => r.event === 'rendered' && typeof r.durationMs === 'number');
  const steady = renders.filter(r => r.isFirstRender === false);
  const cold = renders.filter(r => r.isFirstRender === true);
  const errors = metricBuffer.filter(r => r.event === 'error');
  const recent = metricBuffer.filter(r => r.ts && new Date(r.ts).getTime() >= last60sCutoff);
  const recentRenders = recent.filter(r => r.event === 'rendered');

  // Sort durations once for all percentile calcs
  const steadySorted = steady.map(r => r.durationMs).sort((a, b) => a - b);
  const coldSorted = cold.map(r => r.durationMs).sort((a, b) => a - b);

  // Per-report rollup (steady-state only — cold renders skew aggregates)
  const byReport = new Map();
  for (const r of steady) {
    if (!r.reportId) continue;
    if (!byReport.has(r.reportId)) byReport.set(r.reportId, { reportId: r.reportId, durations: [], errors: 0 });
    byReport.get(r.reportId).durations.push(r.durationMs);
  }
  for (const r of errors) {
    if (!r.reportId) continue;
    if (!byReport.has(r.reportId)) byReport.set(r.reportId, { reportId: r.reportId, durations: [], errors: 0 });
    byReport.get(r.reportId).errors++;
  }
  const perReport = Array.from(byReport.values()).map(r => {
    const sorted = r.durations.slice().sort((a, b) => a - b);
    return {
      reportId: r.reportId,
      count: r.durations.length,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      meanMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
      errors: r.errors
    };
  }).sort((a, b) => b.count - a.count);

  // Active = anything seen in last 30s and not view_limit_reached
  const activeCutoff = now - 30_000;
  const inst = Array.from(instances.entries()).map(([id, s]) => {
    const lastSeenMs = new Date(s.lastSeen).getTime();
    return {
      instanceId: id,
      runId: s.runId || null,
      reportId: s.reportId || null,
      projectName: s.projectName || null,
      lastEvent: s.lastEvent,
      view: s.view,
      lastSeen: s.lastSeen,
      active: s.lastEvent !== 'view_limit_reached' && lastSeenMs >= activeCutoff
    };
  }).sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1));

  return {
    ts: new Date().toISOString(),
    uptimeSec: Math.round((now - startedAt.getTime()) / 1000),
    acceptedTotal,
    droppedTotal,
    bufferSize: metricBuffer.length,
    bufferMax: BUFFER_MAX,
    instances: inst,
    activeInstanceCount: inst.filter(i => i.active).length,
    aggregate: {
      totalRendered: renders.length,
      totalSteady: steady.length,
      totalCold: cold.length,
      totalErrors: errors.length,
      throughputPerSecLast60s: +(recentRenders.length / 60).toFixed(3),
      steady: {
        p50Ms: percentile(steadySorted, 50),
        p95Ms: percentile(steadySorted, 95),
        p99Ms: percentile(steadySorted, 99),
        meanMs: steadySorted.length ? Math.round(steadySorted.reduce((a, b) => a + b, 0) / steadySorted.length) : null
      },
      coldStart: {
        p50Ms: percentile(coldSorted, 50),
        meanMs: coldSorted.length ? Math.round(coldSorted.reduce((a, b) => a + b, 0) / coldSorted.length) : null
      }
    },
    perReport,
    recentErrors: errors.slice(-20).reverse(), // newest first
    // Host metrics (Stage 3) — fed by POST /host-metrics from resource-monitor/monitor.js.
    // Stale=true if the most recent sample is older than 5s (monitor probably down).
    hostMetrics: hostMetricsLatest
      ? {
          ts: hostMetricsLatest.ts,
          cpuPercent: hostMetricsLatest.cpuPercent,
          memPercent: hostMetricsLatest.memPercent,
          totalMemMb: hostMetricsLatest.totalMemMb,
          freeMemMb: hostMetricsLatest.freeMemMb,
          loadAvg1: hostMetricsLatest.loadAvg1,
          secondsAtThreshold: hostMetricsLatest.secondsAtThreshold || 0,
          stale: (Date.now() - new Date(hostMetricsLatest.ts).getTime()) > 5_000
        }
      : null,
    hostSaturated: !!(hostMetricsLatest && hostMetricsLatest.saturated &&
                      (Date.now() - new Date(hostMetricsLatest.ts).getTime()) <= 5_000)
  };
}

// ----- static file MIME -----
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
  '.map':  'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8'
};

function safeJoin(root, requested) {
  const decoded = decodeURIComponent(requested.split('?')[0]);
  const trimmed = decoded.replace(/^\/+/, '');
  const target = path.normalize(path.join(root, trimmed));
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  return target;
}

function serveStatic(req, res) {
  const reqUrl = url.parse(req.url);
  // Try coordinator's own dir first (so /dashboard finds dashboard.html in the coordinator dir),
  // then fall back to the tool root for HTML / libs / config.
  const candidates = [
    safeJoin(COORDINATOR_DIR, reqUrl.pathname || '/'),
    safeJoin(TOOL_ROOT, reqUrl.pathname || '/')
  ].filter(Boolean);

  let candidate = null;
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      candidate = st.isDirectory() ? path.join(c, 'index.html') : c;
      if (fs.existsSync(candidate)) break;
      candidate = null;
    } catch { /* not found, try next */ }
  }

  if (!candidate) { res.writeHead(404); res.end('Not found: ' + reqUrl.pathname); return; }

  fs.readFile(candidate, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + reqUrl.pathname); return; }
    const ext = path.extname(candidate).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      // Allow the dashboard / runner / browser to fetch from this origin without cross-origin trouble
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type'
    });
    res.end(data);
  });
}

// ----- request body reader -----
function readBody(req, maxBytes = 5_000_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  // X-Forwarded-For only trusted in dev mode (single-hop LAN scenario)
  if (DEV_MODE && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// ----- main request handler -----
async function handle(req, res) {
  const reqUrl = url.parse(req.url);
  const pathOnly = reqUrl.pathname || '/';

  // CORS preflight (POST from browser may trigger one if Content-Type is fancy)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathOnly === '/') {
    res.writeHead(302, { Location: '/dashboard' });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathOnly === '/dashboard') {
    // Explicit route so we don't depend on URL→file resolution heuristics.
    fs.readFile(path.join(COORDINATOR_DIR, 'dashboard.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('dashboard.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && pathOnly === '/status') {
    const body = JSON.stringify(buildStatus());
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && pathOnly === '/metrics.jsonl') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    for (const r of metricBuffer) res.write(JSON.stringify(r) + '\n');
    res.end();
    return;
  }

  if (req.method === 'POST' && pathOnly === '/host-metrics') {
    try {
      const raw = await readBody(req);
      const sample = JSON.parse(raw);
      if (typeof sample !== 'object' || sample === null) throw new Error('not an object');
      sample.__receivedAt = new Date().toISOString();
      hostMetricsLatest = sample;
      hostMetricsBuffer.push(sample);
      if (hostMetricsBuffer.length > HOST_METRICS_BUFFER_MAX) {
        hostMetricsBuffer.splice(0, hostMetricsBuffer.length - HOST_METRICS_BUFFER_MAX);
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ accepted: 1, saturated: !!sample.saturated }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && pathOnly === '/host-metrics') {
    // Return the recent samples ring-buffer for any UI that wants to plot it.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ latest: hostMetricsLatest, recent: hostMetricsBuffer }));
    return;
  }

  if (req.method === 'POST' && pathOnly === '/metric') {
    try {
      const raw = await readBody(req);
      const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
      let accepted = 0;
      const errors = [];
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (typeof rec !== 'object' || rec === null) throw new Error('not an object');
          // Coordinator stamps the source IP (helpful for B4b LAN runs)
          if (DEV_MODE) rec.__sourceIp = clientIp(req);
          pushMetric(rec);
          accepted++;
        } catch (e) {
          droppedTotal++;
          errors.push(e.message);
          if (errors.length <= 5) console.warn(`[coordinator] dropped metric line: ${e.message} :: ${line.slice(0, 200)}`);
        }
      }
      if (DEV_MODE && ALLOW_LAN) {
        console.log(`[coordinator] POST /metric from ${clientIp(req)}: accepted=${accepted} rejected=${errors.length}`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ accepted, rejected: errors.length }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Default: static file from coordinator dir or tool root
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405); res.end('Method not allowed');
}

// ----- startup -----
(function start() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      console.error('[coordinator] unhandled: ' + (e.stack || e.message));
      try { res.writeHead(500); res.end('Internal error'); } catch { /* ignore */ }
    });
  });

  server.on('error', (e) => {
    console.error('[coordinator] server error: ' + e.message);
    if (e.code === 'EADDRINUSE') {
      console.error(`[coordinator] port ${PORT} is already in use — pass --port <free-port> AND register the new origin in your Entra SPA app`);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? '<all interfaces>' : HOST;
    console.log(`[coordinator] listening on http://${displayHost}:${PORT}`);
    console.log(`[coordinator] dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`[coordinator] tool root: ${TOOL_ROOT}`);
    if (ALLOW_LAN) {
      console.log('[coordinator] ⚠ DEV MODE — bound to all interfaces, accepting LAN POSTs (B4b readiness check)');
      console.log('[coordinator] ⚠ no auth — DO NOT leave running in this mode unattended');
    } else {
      console.log('[coordinator] localhost only (default). Use --bind 0.0.0.0 --dev for B4b readiness check.');
    }
    console.log('[coordinator] reminder: register http://localhost:' + PORT + ' as a redirect URI on your Entra SPA app');
  });

  process.on('SIGINT', () => {
    console.log('[coordinator] SIGINT — shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
})();
