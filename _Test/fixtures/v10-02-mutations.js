/*
 * TEST-V10-02 driver: validate loadtest.example.yaml, then apply 3 mutations and
 * confirm each is rejected with an actionable field-named error.
 *
 * Run from RealisticLoadTestTool/:  node ../_Test/fixtures/v10-02-mutations.js
 */
const path = require('path');
const fs = require('fs');

const TOOL_ROOT = path.resolve(__dirname, '..', '..', 'RealisticLoadTestTool');
const validator = require(path.join(TOOL_ROOT, 'coordinator', 'loadtest-validator'));
const yaml = require(path.join(TOOL_ROOT, 'runner', 'node_modules', 'js-yaml'));

const examplePath = path.join(TOOL_ROOT, 'loadtest.example.yaml');
const exampleText = fs.readFileSync(examplePath, 'utf8');
const exampleCfg = yaml.load(exampleText);

const results = [];
function check(label, fn, expectedFragment) {
  try {
    fn();
    results.push({ label, pass: false, reason: 'no error thrown' });
  } catch (e) {
    const pass = expectedFragment ? e.message.includes(expectedFragment) : true;
    results.push({ label, pass, message: e.message });
  }
}

// 0. Baseline — example must validate clean.
try {
  validator.validate(exampleCfg);
  results.push({ label: 'baseline: example.yaml validates clean', pass: true });
} catch (e) {
  results.push({ label: 'baseline: example.yaml validates clean', pass: false, message: e.message });
}

// 1. Missing workspace.
check('mut1: remove workspace', () => {
  const cfg = JSON.parse(JSON.stringify(exampleCfg));
  delete cfg.workspace;
  validator.validate(cfg);
}, 'workspace');

// 2. Malformed filters — replace first filter with a string.
check('mut2: filters[0] is not an object', () => {
  const cfg = JSON.parse(JSON.stringify(exampleCfg));
  cfg.reports[0].scenarios[0].filters[0] = 'oops';
  validator.validate(cfg);
}, 'filters[0]');

// 3. Negative concurrency.
check('mut3: concurrency = -1', () => {
  const cfg = JSON.parse(JSON.stringify(exampleCfg));
  cfg.concurrency = -1;
  validator.validate(cfg);
}, 'concurrency');

// 4-7. Additional documented mutations for thoroughness.
check('mut4: remove reports', () => {
  const cfg = JSON.parse(JSON.stringify(exampleCfg));
  delete cfg.reports;
  validator.validate(cfg);
}, 'reports');

check('mut5: reports[0].id not a GUID', () => {
  const cfg = JSON.parse(JSON.stringify(exampleCfg));
  cfg.reports[0].id = 'not-a-guid';
  validator.validate(cfg);
}, 'reports[0].id');

check('mut6: viewsPerSession = 0', () => {
  const cfg = JSON.parse(JSON.stringify(exampleCfg));
  cfg.viewsPerSession = 0;
  validator.validate(cfg);
}, 'viewsPerSession');

check('mut7: layoutType = Banana', () => {
  const cfg = JSON.parse(JSON.stringify(exampleCfg));
  cfg.layoutType = 'Banana';
  validator.validate(cfg);
}, 'layoutType');

// Print results table.
let allPass = true;
console.log('TEST-V10-02 — schema validation mutations');
console.log('-'.repeat(80));
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  allPass = allPass && r.pass;
  console.log(`[${tag}] ${r.label}`);
  if (r.message) console.log(`       error: ${r.message}`);
  if (r.reason)  console.log(`       reason: ${r.reason}`);
}
console.log('-'.repeat(80));
console.log(allPass ? 'OVERALL: PASS' : 'OVERALL: FAIL');
process.exit(allPass ? 0 : 1);
