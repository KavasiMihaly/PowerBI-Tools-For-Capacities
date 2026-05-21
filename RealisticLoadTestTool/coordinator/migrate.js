#!/usr/bin/env node
/*
 * Legacy v0.8 folder → loadtest.yaml migrator (v1.0 Stage 4 / T9 / TEST-V10-03).
 *
 * Reads a legacy test folder containing PBIReport.JSON (and optionally PBIToken.JSON
 * which is ignored — auth is MSAL-only from v0.8 onward) and writes an equivalent
 * loadtest.yaml.
 *
 * Usage:
 *   node coordinator/migrate.js <legacy-folder>                # writes ./loadtest.yaml
 *   node coordinator/migrate.js <legacy-folder> -o <out.yaml>  # explicit output
 *   node coordinator/migrate.js <legacy-folder> --stdout       # print to stdout
 *
 * Exit codes:
 *   0 — migration succeeded; output written and re-validated
 *   1 — input not found / unparseable / missing required field (workspace can't be derived)
 */

const fs = require('fs');
const path = require('path');
const { validate } = require('./loadtest-validator');

// js-yaml is in ../runner/node_modules — single shared install.
const yaml = require(path.resolve(__dirname, '..', 'runner', 'node_modules', 'js-yaml'));

function die(msg) {
  console.error(`[migrate] ${msg}`);
  process.exit(1);
}

// ---- arg parsing ----
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.error('Usage: node migrate.js <legacy-folder> [-o <out.yaml>] [--stdout]');
  process.exit(args.length === 0 ? 1 : 0);
}
const legacyFolder = path.resolve(args[0]);
let outPath = path.resolve(process.cwd(), 'loadtest.yaml');
let toStdout = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '-o' || args[i] === '--out') { outPath = path.resolve(args[++i]); }
  else if (args[i] === '--stdout') { toStdout = true; }
}

if (!fs.existsSync(legacyFolder) || !fs.statSync(legacyFolder).isDirectory()) {
  die(`not a directory: ${legacyFolder}`);
}

// ---- parse legacy PBIReport.JSON ----
// The file is JavaScript ("reportParameters = { ... };") not pure JSON. Strip the prefix,
// the trailing semicolon, and any // comments before JSON.parse.
function parseLegacyReportFile(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  text = text.replace(/^﻿/, '');            // BOM
  text = text.replace(/^\s*reportParameters\s*=\s*/, '');
  text = text.replace(/^\s*var\s+reportParameters\s*=\s*/, '');
  // Strip // comments (not inside strings — naive but correct for this file format).
  text = text.split('\n').map(line => {
    const idx = findCommentStart(line);
    return idx >= 0 ? line.slice(0, idx) : line;
  }).join('\n');
  // Strip trailing semicolons + everything after the closing brace.
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace >= 0) text = text.slice(0, lastBrace + 1);
  return JSON.parse(text);
}

function findCommentStart(line) {
  let inStr = false, quote = null;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) { inStr = false; quote = null; }
    } else {
      if (ch === '"' || ch === "'") { inStr = true; quote = ch; }
      else if (ch === '/' && line[i + 1] === '/') return i;
    }
  }
  return -1;
}

// Candidate files — prefer per-folder PBIReport.JSON, then a top-level one.
const candidates = [
  path.join(legacyFolder, 'PBIReport.JSON'),
  path.join(legacyFolder, 'PBIReport.json'),
];
const reportFile = candidates.find(p => fs.existsSync(p));
if (!reportFile) {
  die(`PBIReport.JSON not found in ${legacyFolder}`);
}

let legacy;
try {
  legacy = parseLegacyReportFile(reportFile);
} catch (e) {
  die(`failed to parse ${reportFile}: ${e.message}`);
}

// ---- extract workspace + reportId from reportUrl ----
// Power BI embed URLs:
//   https://app.powerbi.com/reportEmbed?reportId=<guid>&groupId=<guid>&...
// or the user can paste a v2 / preview URL — pull GUIDs by name where possible.
function extractGuidParam(urlStr, paramName) {
  const m = new RegExp(`[?&]${paramName}=([0-9a-fA-F\\-]{36})`).exec(urlStr || '');
  return m ? m[1] : null;
}
const reportUrl = legacy.reportUrl || '';
const workspaceId = extractGuidParam(reportUrl, 'groupId');
const reportId    = extractGuidParam(reportUrl, 'reportId');

if (!workspaceId) {
  die(`couldn't extract workspace (groupId) from reportUrl="${reportUrl}". ` +
      `Edit PBIReport.JSON to use the standard embed URL form ` +
      `(https://app.powerbi.com/reportEmbed?reportId=<guid>&groupId=<guid>).`);
}
if (!reportId) {
  die(`couldn't extract reportId from reportUrl="${reportUrl}".`);
}

// ---- translate filters ----
function translateFilters(legacyFilters) {
  if (!Array.isArray(legacyFilters)) return [];
  return legacyFilters.map((f, i) => {
    if (!f || typeof f !== 'object') {
      die(`filters[${i}] is not an object`);
    }
    return {
      table:    f.filterTable,
      column:   f.filterColumn,
      isSlicer: !!f.isSlicer,
      values:   f.filtersList || []
    };
  });
}

// ---- build the new config ----
// One folder = one report with one scenario. Multi-report YAMLs are written by hand
// (or eventually by the Stage 5 Setup wizard).
const project = legacy.projectName || path.basename(legacyFolder);
const cfg = {
  project,
  workspace: workspaceId,
  concurrency: 1,                              // legacy folder has no concurrency notion; default to 1
  viewsPerSession: legacy.numberOfViews ?? 10,
  thinkTimeSec:    legacy.thinkTimeSeconds ?? 0,
  sessionRestart:  legacy.sessionRestart ?? 100,
  layoutType:      legacy.layoutType || 'Master',
  reports: [{
    id: reportId,
    name: project,                             // legacy has no separate report name; reuse project
    scenarios: [{
      page:      legacy.pageName || undefined,
      bookmarks: Array.isArray(legacy.bookmarkList) && legacy.bookmarkList.length ? legacy.bookmarkList : undefined,
      filters:   translateFilters(legacy.filters)
    }]
  }]
};

// Drop empty filter arrays so the YAML stays tidy
if (cfg.reports[0].scenarios[0].filters.length === 0) {
  delete cfg.reports[0].scenarios[0].filters;
}
// Drop optional defaults if they equal the schema default
if (cfg.sessionRestart === 100)   delete cfg.sessionRestart;
if (cfg.layoutType === 'Master')  delete cfg.layoutType;
if (cfg.reports[0].scenarios[0].page === undefined) delete cfg.reports[0].scenarios[0].page;
if (cfg.reports[0].scenarios[0].bookmarks === undefined) delete cfg.reports[0].scenarios[0].bookmarks;

// Validate before we write — a broken migration should fail loudly here, not later.
try {
  validate(cfg);
} catch (e) {
  die(`migrated config fails schema validation: ${e.message}`);
}

const HEADER = [
  '# Migrated from legacy v0.8 folder by coordinator/migrate.js',
  `# Source folder: ${path.relative(process.cwd(), legacyFolder)}`,
  `# Generated:     ${new Date().toISOString()}`,
  '#',
  '# Review and edit before running. See _Documentation/loadtest-yaml-schema.md.',
  ''
].join('\n');

const body = yaml.dump(cfg, { lineWidth: 120, noRefs: true });
const out = HEADER + body;

if (toStdout) {
  process.stdout.write(out);
} else {
  fs.writeFileSync(outPath, out, 'utf8');
  console.error(`[migrate] wrote ${outPath} (${cfg.reports.length} report, ${cfg.reports[0].scenarios.length} scenario)`);
}
