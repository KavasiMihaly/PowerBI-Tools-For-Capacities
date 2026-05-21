#!/usr/bin/env node
/*
 * RealisticLoadTest resource monitor (v1.0 Stage 3 / B3 / T10).
 *
 * Long-running sidecar that samples host CPU + RAM at 1 Hz, posts each sample to the
 * coordinator (POST /host-metrics), and writes a local JSONL audit file.
 *
 * Saturation logic (per the v1.0 plan): rolling 30-second window. When *every* sample
 * in the window has CPU > 90% OR RAM > 95%, the saturation flag latches true. When
 * every sample in the window is back below thresholds, the flag latches false. The
 * 30-sample requirement debounces transient spikes (e.g., Chrome paint storms).
 *
 * Why Node and not Python: keeps the stack one-language, no pip dependency, Node's
 * built-in os module gives both CPU times and memory — enough for saturation.
 *
 * Usage:
 *   node monitor.js                          # default coordinator http://localhost:8080, 1Hz
 *   node monitor.js --coordinator http://...
 *   node monitor.js --interval-ms 500        # faster sampling (saturation window scales)
 *   node monitor.js --cpu-threshold 80       # default 90
 *   node monitor.js --mem-threshold 90       # default 95
 *   node monitor.js --window-sec 60          # default 30
 *   node monitor.js --no-coordinator         # local file only, no POSTs
 *   node monitor.js --quiet                  # suppress per-sample stdout
 *
 * Output:
 *   <repo>/Test Results/host-metrics/<startTimestamp>.jsonl
 *     { ts, cpuPercent, memPercent, totalMemMb, freeMemMb, loadAvg1, saturated, samplesInWindow, secondsAtThreshold }
 *
 * Exit codes:
 *   0 — clean SIGINT shutdown
 *   1 — startup / runtime error
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
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
const COORDINATOR_URL = (args.coordinator || 'http://localhost:8080').replace(/\/+$/, '');
const INTERVAL_MS = parseInt(args['interval-ms'] || '1000', 10);
const CPU_THRESHOLD = parseInt(args['cpu-threshold'] || '90', 10);
const MEM_THRESHOLD = parseInt(args['mem-threshold'] || '95', 10);
const WINDOW_SEC = parseInt(args['window-sec'] || '30', 10);
const SEND_TO_COORDINATOR = !args['no-coordinator'];
const QUIET = !!args.quiet;

const WINDOW_SAMPLES = Math.max(1, Math.round(WINDOW_SEC * 1000 / INTERVAL_MS));

// ----- CPU sampling -----
function readCpuTotals() {
  const cpus = os.cpus();
  let total = 0, idle = 0;
  for (const c of cpus) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return { total, idle };
}

let prevCpu = readCpuTotals();
function sampleCpuPercent() {
  const cur = readCpuTotals();
  const totalDiff = cur.total - prevCpu.total;
  const idleDiff = cur.idle - prevCpu.idle;
  prevCpu = cur;
  if (totalDiff <= 0) return 0;
  return Math.round((1 - idleDiff / totalDiff) * 1000) / 10;  // one decimal
}

function sampleMemPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  return { percent: Math.round((1 - free / total) * 1000) / 10, totalMb: Math.round(total / 1048576), freeMb: Math.round(free / 1048576) };
}

// ----- saturation logic (windowed latch) -----
const sampleWindow = []; // { cpu, mem }
let saturated = false;

function pushSampleAndCheck(cpu, mem) {
  sampleWindow.push({ cpu, mem });
  if (sampleWindow.length > WINDOW_SAMPLES) sampleWindow.shift();

  const overload = (s) => s.cpu > CPU_THRESHOLD || s.mem > MEM_THRESHOLD;
  const allOverload = sampleWindow.length === WINDOW_SAMPLES && sampleWindow.every(overload);
  const allRelief   = sampleWindow.length === WINDOW_SAMPLES && sampleWindow.every(s => !overload(s));

  if (!saturated && allOverload) saturated = true;
  else if (saturated && allRelief) saturated = false;

  // For diagnostic visibility — how many trailing seconds are at-or-above threshold
  let secondsAtThreshold = 0;
  for (let i = sampleWindow.length - 1; i >= 0; i--) {
    if (overload(sampleWindow[i])) secondsAtThreshold++;
    else break;
  }

  return { saturated, samplesInWindow: sampleWindow.length, secondsAtThreshold };
}

// ----- coordinator POST (no deps) -----
function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = url.parse(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.path,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ----- main loop -----
function makeRunStamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

(function main() {
  // Local audit file so analysis can join host-metrics to test JSONL by timestamp.
  const outDir = path.join(RESULTS_ROOT, 'host-metrics');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${makeRunStamp()}.jsonl`);
  const stream = fs.createWriteStream(outFile, { flags: 'a' });

  console.log(`[monitor] sampling every ${INTERVAL_MS}ms; saturation window=${WINDOW_SEC}s (${WINDOW_SAMPLES} samples)`);
  console.log(`[monitor] thresholds: cpu>${CPU_THRESHOLD}% OR mem>${MEM_THRESHOLD}% sustained → saturated`);
  console.log(`[monitor] file: ${outFile}`);
  if (SEND_TO_COORDINATOR) console.log(`[monitor] coordinator: ${COORDINATOR_URL}/host-metrics`);
  else console.log('[monitor] coordinator POST disabled (--no-coordinator)');

  // Prime CPU baseline (first call to sampleCpuPercent uses prevCpu set at module load).
  // Throw away the first reading so the diff is sensible.
  setTimeout(() => sampleCpuPercent(), 100);

  const timer = setInterval(async () => {
    const cpuPercent = sampleCpuPercent();
    const mem = sampleMemPercent();
    const sat = pushSampleAndCheck(cpuPercent, mem.percent);
    const sample = {
      ts: new Date().toISOString(),
      cpuPercent,
      memPercent: mem.percent,
      totalMemMb: mem.totalMb,
      freeMemMb: mem.freeMb,
      loadAvg1: os.loadavg()[0] || 0,        // 0 on Windows but harmless
      saturated: sat.saturated,
      samplesInWindow: sat.samplesInWindow,
      secondsAtThreshold: sat.secondsAtThreshold
    };

    stream.write(JSON.stringify(sample) + '\n');

    if (!QUIET) {
      const flag = sat.saturated ? ' [SATURATED]' : (sat.secondsAtThreshold > 0 ? ` [over for ${sat.secondsAtThreshold}s]` : '');
      console.log(`[${sample.ts}] cpu=${cpuPercent}% mem=${mem.percent}%${flag}`);
    }

    if (SEND_TO_COORDINATOR) {
      postJson(COORDINATOR_URL + '/host-metrics', sample).catch((e) => {
        // Coordinator down: noisy log would flood. Throttle via random sampling.
        if (Math.random() < 0.05) console.warn(`[monitor] POST failed: ${e.message}`);
      });
    }
  }, INTERVAL_MS);

  process.on('SIGINT', () => {
    console.log('[monitor] SIGINT — shutting down');
    clearInterval(timer);
    stream.end(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
})();
