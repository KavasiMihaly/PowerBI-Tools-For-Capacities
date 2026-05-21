/*
 * TEST-V10-03 round-trip driver.
 *
 * Proves the data pipeline: legacy PBIReport.JSON → migrate.js → loadtest.yaml →
 * validator.expandToTabs → runner base64 encode → HTML decode → legacy reportParameters
 * shape. Every field must round-trip exactly.
 *
 * Run from anywhere:  node _Test/fixtures/v10-03-roundtrip.js
 *
 * What this DOES cover (V10-03 pass criteria):
 *   - "Migration produces a valid loadtest.yaml" — runs validator on the output.
 *   - "Migration loses any filter, bookmark, or page-name detail" (fail criterion) —
 *     compares decoded scenario to the original fixture field-for-field.
 *
 * What this DOES NOT cover (deferred to a real run):
 *   - "Metrics from the migrated run match the original scenario within ±5%" — requires
 *     the v0.7.1 baseline (Backlog row TP3, Pending User Run). Once that exists, a
 *     fresh end-to-end Playwright run on the migrated YAML can be compared to it.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOOL_ROOT = path.join(REPO_ROOT, 'RealisticLoadTestTool');
const FIXTURE_FOLDER = path.join(REPO_ROOT, '_Test', 'fixtures', 'legacy-v08-folder');
const OUT_YAML = path.join(REPO_ROOT, '_Test', 'fixtures', 'legacy-v08-folder.migrated.yaml');

const validator = require(path.join(TOOL_ROOT, 'coordinator', 'loadtest-validator'));

const results = [];
function record(label, pass, detail) {
  results.push({ label, pass, detail });
}
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---- 1. Run migrate.js on the fixture. ----
execFileSync('node', [
  path.join(TOOL_ROOT, 'coordinator', 'migrate.js'),
  FIXTURE_FOLDER,
  '-o', OUT_YAML
], { stdio: ['ignore', 'ignore', 'inherit'] });
record('migrate.js produced output yaml', fs.existsSync(OUT_YAML));

// ---- 2. Validator must accept the produced YAML. ----
let cfg;
try {
  cfg = validator.loadAndValidate(OUT_YAML);
  record('migrated yaml passes validator', true);
} catch (e) {
  record('migrated yaml passes validator', false, e.message);
}

// ---- 3. Expand to tabs (should produce exactly 1 tab: 1 report × 1 scenario × concurrency 1). ----
const tabs = validator.expandToTabs(cfg);
record('expandToTabs produced 1 tab', tabs.length === 1, `got ${tabs.length}`);
const tab = tabs[0];

// ---- 4. Encode tab payload like the runner does. ----
const b64 = Buffer.from(JSON.stringify(tab), 'utf8').toString('base64');
const qsUrl = `http://localhost:8080/RealisticLoadTest.html?scenario=${encodeURIComponent(b64)}`;
record('runner-style URL constructed', /^[A-Za-z0-9_:./?=%+\-]+$/.test(qsUrl));

// ---- 5. Decode it like RealisticLoadTest.html does, then translate to legacy reportParameters shape. ----
function decodeAndTranslate(url) {
  const m = /[?&]scenario=([^&#]+)/.exec(url);
  const scenario = JSON.parse(Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8'));
  const reportUrl = 'https://app.powerbi.com/reportEmbed' +
                    '?reportId=' + encodeURIComponent(scenario.reportId) +
                    '&groupId='  + encodeURIComponent(scenario.workspace) +
                    '&autoAuth=true';
  return {
    reportUrl,
    sessionRestart:   scenario.sessionRestart,
    pageName:         scenario.page || null,
    bookmarkList:     scenario.bookmarks || [],
    numberOfViews:    scenario.viewsPerSession,
    filters:          (scenario.filters || []).map(f => ({
                          filterTable:  f.table,
                          filterColumn: f.column,
                          isSlicer:     !!f.isSlicer,
                          filtersList:  f.values
                      })),
    thinkTimeSeconds: scenario.thinkTimeSec,
    projectName:      scenario.project,
    layoutType:       scenario.layoutType
  };
}
const decoded = decodeAndTranslate(qsUrl);

// ---- 6. Read the original legacy fixture for comparison. ----
function parseLegacy(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  text = text.replace(/^﻿/, '').replace(/^\s*reportParameters\s*=\s*/, '');
  text = text.split('\n').map(line => {
    let inStr = false, q = null;
    for (let i = 0; i < line.length - 1; i++) {
      const c = line[i];
      if (inStr) { if (c === '\\') i++; else if (c === q) { inStr = false; q = null; } }
      else if (c === '"' || c === "'") { inStr = true; q = c; }
      else if (c === '/' && line[i+1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
  const lastBrace = text.lastIndexOf('}');
  return JSON.parse(text.slice(0, lastBrace + 1));
}
const legacy = parseLegacy(path.join(FIXTURE_FOLDER, 'PBIReport.JSON'));

// ---- 7. Field-by-field round-trip checks. ----
// reportUrl: extract workspace + reportId GUIDs and compare to legacy values.
const guidRe = /[0-9a-fA-F-]{36}/g;
const legacyGuids = (legacy.reportUrl.match(guidRe) || []).sort();
const decodedGuids = (decoded.reportUrl.match(guidRe) || []).sort();
record('reportUrl preserves workspace + reportId GUIDs',
  deepEqual(legacyGuids, decodedGuids),
  `legacy=${JSON.stringify(legacyGuids)} decoded=${JSON.stringify(decodedGuids)}`);

record('pageName preserved',   decoded.pageName === legacy.pageName, `${decoded.pageName} vs ${legacy.pageName}`);
record('bookmarkList preserved', deepEqual(decoded.bookmarkList, legacy.bookmarkList));
record('numberOfViews preserved', decoded.numberOfViews === legacy.numberOfViews);
record('thinkTimeSeconds preserved', decoded.thinkTimeSeconds === legacy.thinkTimeSeconds);
record('projectName preserved', decoded.projectName === legacy.projectName);
record('sessionRestart preserved', decoded.sessionRestart === legacy.sessionRestart);

// Filters — deep compare, including nested multi-select sub-lists.
record('filters length preserved', decoded.filters.length === legacy.filters.length);
for (let i = 0; i < legacy.filters.length; i++) {
  const L = legacy.filters[i], D = decoded.filters[i];
  record(`filters[${i}].filterTable preserved`,  L.filterTable  === D.filterTable);
  record(`filters[${i}].filterColumn preserved`, L.filterColumn === D.filterColumn);
  record(`filters[${i}].isSlicer preserved`,     L.isSlicer     === D.isSlicer);
  record(`filters[${i}].filtersList (incl. multi-select) preserved`, deepEqual(L.filtersList, D.filtersList),
    `legacy=${JSON.stringify(L.filtersList)}  decoded=${JSON.stringify(D.filtersList)}`);
}

// ---- Print results ----
let pass = 0, fail = 0;
console.log('TEST-V10-03 — migration round-trip (data path)');
console.log('-'.repeat(80));
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (r.pass) pass++; else fail++;
  console.log(`[${tag}] ${r.label}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log('-'.repeat(80));
console.log(`OVERALL: ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass / ${fail} fail`);
console.log('');
console.log('NOTE: The "metric parity ±5%" portion of TEST-V10-03 is deferred. It requires the');
console.log('      v0.7.1 baseline (Backlog row TP3, Pending User Run). Once that baseline exists,');
console.log('      a Playwright run on the migrated YAML can be aggregate-compared to it.');
process.exit(fail === 0 ? 0 : 1);
