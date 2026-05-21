/*
 * loadtest.yaml schema validator (v1.0 Stage 4 / T9).
 *
 * Loads and validates a loadtest.yaml against the documented schema. Throws a single
 * actionable Error with a field-path-named message on the first violation found.
 *
 * Usage:
 *   const { loadAndValidate, validate } = require('./loadtest-validator');
 *   const cfg = loadAndValidate('/path/to/loadtest.yaml');   // throws on invalid
 *
 * Schema lives at _Documentation/loadtest-yaml-schema.md.
 */

const fs = require('fs');
const path = require('path');

// js-yaml is installed in ../runner/node_modules. Resolve from there so this file is
// usable as a standalone require without forcing the consumer to install js-yaml.
function loadYaml(text) {
  const yaml = require(path.resolve(__dirname, '..', 'runner', 'node_modules', 'js-yaml'));
  return yaml.load(text);
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_LAYOUTS = ['Master', 'Custom', 'MobilePortrait', 'MobileLandscape'];

function fail(pathStr, msg) {
  throw new Error(pathStr ? `${pathStr}: ${msg}` : msg);
}

function isPosInt(v)    { return Number.isInteger(v) && v > 0; }
function isNonNegInt(v) { return Number.isInteger(v) && v >= 0; }
function isNonEmptyStr(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateFilter(f, pathStr) {
  if (f === null || typeof f !== 'object' || Array.isArray(f)) {
    fail(pathStr, 'must be an object with keys table, column, isSlicer, values');
  }
  if (!isNonEmptyStr(f.table))  fail(`${pathStr}.table`,  'must be a non-empty string');
  if (!isNonEmptyStr(f.column)) fail(`${pathStr}.column`, 'must be a non-empty string');
  if (typeof f.isSlicer !== 'boolean') fail(`${pathStr}.isSlicer`, 'must be a boolean');
  if (!Array.isArray(f.values) || f.values.length === 0) fail(`${pathStr}.values`, 'must be a non-empty array');
  for (let i = 0; i < f.values.length; i++) {
    const v = f.values[i];
    // Allow: string | number | boolean | array-of-(string|number|boolean) (for combined multi-select).
    if (Array.isArray(v)) {
      if (v.length === 0) fail(`${pathStr}.values[${i}]`, 'multi-select sub-list must be non-empty');
      for (let j = 0; j < v.length; j++) {
        const t = typeof v[j];
        if (t !== 'string' && t !== 'number' && t !== 'boolean') {
          fail(`${pathStr}.values[${i}][${j}]`, 'multi-select entries must be string/number/boolean');
        }
      }
    } else {
      const t = typeof v;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') {
        fail(`${pathStr}.values[${i}]`, 'must be string/number/boolean or a sub-list of those');
      }
    }
  }
}

function validateScenario(s, pathStr) {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    fail(pathStr, 'must be an object');
  }
  if (s.page !== undefined && !isNonEmptyStr(s.page)) {
    fail(`${pathStr}.page`, 'must be a non-empty string when present');
  }
  if (s.bookmarks !== undefined) {
    if (!Array.isArray(s.bookmarks)) fail(`${pathStr}.bookmarks`, 'must be an array of strings');
    s.bookmarks.forEach((b, i) => {
      if (!isNonEmptyStr(b)) fail(`${pathStr}.bookmarks[${i}]`, 'must be a non-empty string');
    });
  }
  if (s.filters !== undefined) {
    if (!Array.isArray(s.filters)) fail(`${pathStr}.filters`, 'must be an array of filter objects');
    s.filters.forEach((f, i) => validateFilter(f, `${pathStr}.filters[${i}]`));
  }
}

function validateReport(r, pathStr) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) {
    fail(pathStr, 'must be an object');
  }
  if (!isNonEmptyStr(r.id))      fail(`${pathStr}.id`, 'is required');
  if (!GUID_RE.test(r.id))       fail(`${pathStr}.id`, 'must be a GUID');
  if (!isNonEmptyStr(r.name))    fail(`${pathStr}.name`, 'is required and must be a non-empty string');
  if (!Array.isArray(r.scenarios) || r.scenarios.length === 0) {
    fail(`${pathStr}.scenarios`, 'is required and must be a non-empty array');
  }
  r.scenarios.forEach((s, i) => validateScenario(s, `${pathStr}.scenarios[${i}]`));
}

function validate(cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    fail('', 'root must be a YAML mapping (object)');
  }

  if (!isNonEmptyStr(cfg.project))   fail('project',   'is required and must be a non-empty string');
  if (!isNonEmptyStr(cfg.workspace)) fail('workspace', 'is required (top-level)');
  if (!GUID_RE.test(cfg.workspace))  fail('workspace', 'must be a GUID');

  if (!isPosInt(cfg.concurrency))     fail('concurrency',     `must be a positive integer (got ${JSON.stringify(cfg.concurrency)})`);
  if (!isPosInt(cfg.viewsPerSession)) fail('viewsPerSession', `must be a positive integer (got ${JSON.stringify(cfg.viewsPerSession)})`);
  if (!isNonNegInt(cfg.thinkTimeSec)) fail('thinkTimeSec',    `must be a non-negative integer (got ${JSON.stringify(cfg.thinkTimeSec)})`);

  if (cfg.sessionRestart !== undefined && !isNonNegInt(cfg.sessionRestart)) {
    fail('sessionRestart', `must be a non-negative integer (got ${JSON.stringify(cfg.sessionRestart)})`);
  }
  if (cfg.layoutType !== undefined && !VALID_LAYOUTS.includes(cfg.layoutType)) {
    fail('layoutType', `must be one of ${VALID_LAYOUTS.join(', ')} (got ${JSON.stringify(cfg.layoutType)})`);
  }

  if (!Array.isArray(cfg.reports) || cfg.reports.length === 0) {
    fail('reports', 'is required and must be a non-empty array');
  }
  cfg.reports.forEach((r, i) => validateReport(r, `reports[${i}]`));

  return cfg;
}

function loadAndValidate(yamlPath) {
  const abs = path.resolve(yamlPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`loadtest.yaml not found at ${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');
  let parsed;
  try {
    parsed = loadYaml(text);
  } catch (e) {
    throw new Error(`loadtest.yaml failed to parse as YAML: ${e.message}`);
  }
  validate(parsed);
  return parsed;
}

// Apply defaults that the validator allowed to be absent.
function withDefaults(cfg) {
  return {
    sessionRestart: 100,
    layoutType: 'Master',
    ...cfg
  };
}

// Expand the top-level config into a flat list of (report, scenario, slot) tabs.
function expandToTabs(cfg) {
  const out = [];
  const c = withDefaults(cfg);
  for (const report of c.reports) {
    for (let sIdx = 0; sIdx < report.scenarios.length; sIdx++) {
      const scenario = report.scenarios[sIdx];
      for (let slot = 0; slot < c.concurrency; slot++) {
        out.push({
          project: c.project,
          workspace: c.workspace,
          reportId: report.id,
          reportName: report.name,
          scenarioIndex: sIdx,
          slot,
          viewsPerSession: c.viewsPerSession,
          thinkTimeSec: c.thinkTimeSec,
          sessionRestart: c.sessionRestart,
          layoutType: c.layoutType,
          page: scenario.page || null,
          bookmarks: scenario.bookmarks || [],
          filters: scenario.filters || []
        });
      }
    }
  }
  return out;
}

module.exports = { validate, loadAndValidate, withDefaults, expandToTabs, GUID_RE, VALID_LAYOUTS };
