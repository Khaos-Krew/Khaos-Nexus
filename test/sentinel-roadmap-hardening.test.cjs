'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Sentinel scopes catalog names and Application Monitor role at the product boundary', () => {
  const source = read('main/sentinel-scope-extension.cjs');
  assert.match(source, /function enforceCatalogScope/);
  assert.match(source, /name: 'Palworld Server Control'/);
  assert.match(source, /name: 'Palworld Players & Moderation'/);
  assert.match(source, /name: 'Palworld Status Panels'/);
  assert.match(source, /'application-monitor':[\s\S]*requiredRole: 'owner'/);
  assert.match(source, /Owner-only redacted diagnostics/);
  assert.match(source, /sentinel-live-copy\.js/);
});

test('Sentinel readiness prunes server health that is outside the current Palworld runtime', () => {
  const source = read('main/sentinel-scope-extension.cjs');
  assert.match(source, /class SentinelAutonomyService extends Original/);
  assert.match(source, /pruneServerHealth\(\)/);
  assert.match(source, /getRuntimeBootstrap/);
  assert.match(source, /Object\.entries\(current\)\.filter/);
  assert.match(source, /async checkServers/);
  assert.match(source, /this\.pruneServerHealth\(\);[\s\S]*super\.checkServers/);
});

test('Sentinel dynamic renderer copy cannot regress to the pre-split server and module wording', () => {
  const source = read('renderer/sentinel-live-copy.js');
  assert.match(source, /No Palworld servers configured/);
  assert.match(source, /Palworld REST or legacy RCON/);
  assert.match(source, /sentinel-legacy-module-ui/);
  assert.match(source, /Self-healing Sentinel startup/);
  assert.match(source, /Check Palworld Servers/);
  assert.match(source, /'operator-console': 'autonomy'/);
  assert.match(source, /'admin-command-center': 'autonomy'/);
  assert.match(source, /'discord-observability': 'observability'/);
  assert.doesNotMatch(source, /Add your first ARK/);
});

test('Sentinel packaged UI requires populated operational module cards and split live copy', () => {
  const evidence = read('main/startup-smoke-evidence-extension.cjs');
  assert.match(evidence, /moduleCardCount/);
  assert.match(evidence, /moduleCardCount > 0/);
  assert.match(evidence, /roadmapLabels\.length === moduleCardCount/);
  assert.match(evidence, /legacyBaseModuleVisible/);
  assert.match(evidence, /serverCopyScoped/);
  assert.match(evidence, /No Palworld servers configured/);
  assert.match(evidence, /Operational/);
  assert.match(evidence, /Migrate in progress/);
  assert.match(evidence, /Disabled/);
  assert.match(evidence, /Blocked/);
});

test('Sentinel roadmap contains a staged home acceptance path and smoother update plan', () => {
  const roadmap = read('docs/NEXUS-SENTINEL-TEST-ROADMAP.md');
  assert.match(roadmap, /Product boundary and first launch/);
  assert.match(roadmap, /Discord identity and Nexus Sentinel runtime/);
  assert.match(roadmap, /Palworld server registration and read-only health/);
  assert.match(roadmap, /Palworld guarded operations/);
  assert.match(roadmap, /Owner access and Application Monitor/);
  assert.match(roadmap, /Update experience/);
  assert.match(roadmap, /rollback/i);
  assert.match(roadmap, /Home test order/);
});
