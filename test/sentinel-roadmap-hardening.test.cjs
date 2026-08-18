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
  assert.match(source, /name: 'Backup & Sentinel Update Center'/);
  assert.match(source, /'application-monitor':[\s\S]*requiredRole: 'owner'/);
  assert.match(source, /Owner-only redacted diagnostics/);
  assert.match(source, /sentinel-live-copy\.js/);
  assert.match(source, /sentinel-update-ui\.js/);
  assert.match(source, /sentinel-update-ui\.css/);
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

test('Sentinel dynamic renderer copy cannot regress to the pre-split server, readiness, module or update wording', () => {
  const source = read('renderer/sentinel-live-copy.js');
  assert.match(source, /No Palworld servers configured/);
  assert.match(source, /Palworld REST or legacy RCON/);
  assert.match(source, /sentinel-legacy-module-ui/);
  assert.match(source, /Self-healing Sentinel startup/);
  assert.match(source, /Check Palworld Servers/);
  assert.match(source, /Check Sentinel Updates/);
  assert.match(source, /Download & Verify/);
  assert.match(source, /Install & Restart/);
  assert.match(source, /'operator-console': 'autonomy'/);
  assert.match(source, /'admin-command-center': 'autonomy'/);
  assert.match(source, /'discord-observability': 'observability'/);
  assert.doesNotMatch(source, /Add your first ARK/);
});

test('Sentinel packaged UI requires populated operational module cards, split copy and protected update state', () => {
  const evidence = read('main/startup-smoke-evidence-extension.cjs');
  assert.match(evidence, /moduleCardCount/);
  assert.match(evidence, /moduleCardCount > 0/);
  assert.match(evidence, /roadmapLabels\.length === moduleCardCount/);
  assert.match(evidence, /legacyBaseModuleVisible/);
  assert.match(evidence, /serverCopyScoped/);
  assert.match(evidence, /No Palworld servers configured/);
  assert.match(evidence, /updateSecurity/);
  assert.match(evidence, /document\.getElementById\('sentinelUpdateSecurity'\)/);
  assert.match(evidence, /Operational/);
  assert.match(evidence, /Migrate in progress/);
  assert.match(evidence, /Disabled/);
  assert.match(evidence, /Blocked/);
});

test('Sentinel roadmap is backed by an implemented staged update and rollback release pipeline', () => {
  const roadmap = read('docs/NEXUS-SENTINEL-TEST-ROADMAP.md');
  assert.match(roadmap, /Product boundary and first launch/);
  assert.match(roadmap, /Discord identity and Nexus Sentinel runtime/);
  assert.match(roadmap, /Palworld server registration and read-only health/);
  assert.match(roadmap, /Palworld guarded operations/);
  assert.match(roadmap, /Owner access and Application Monitor/);
  assert.match(roadmap, /Update experience/);
  assert.match(roadmap, /rollback/i);
  assert.match(roadmap, /Home test order/);

  const implementation = read('docs/NEXUS-SENTINEL-ROADMAP-IMPLEMENTATION.md');
  for (let phase = 0; phase <= 10; phase += 1) assert.match(implementation, new RegExp(`Phase ${phase}`));
  assert.match(implementation, /Implemented \/ CI verified/);
  assert.match(implementation, /Implemented \/ live validation required/);
  assert.match(implementation, /vX\.Y\.Z-sentinel/);
  assert.match(implementation, /automatic rollback/i);

  const updater = read('main/sentinel-production-update-extension.cjs');
  const policy = read('shared/sentinel-update-policy.cjs');
  const release = read('.github/workflows/sentinel-release.yml');
  const updateUi = read('renderer/sentinel-update-ui.js');
  assert.match(updater, /createAutomaticBackup\('pre-update'\)/);
  assert.match(updater, /Wait-Health/);
  assert.match(updater, /Restore-Rollback/);
  assert.match(policy, /SENTINEL_TAG/);
  assert.match(release, /v\*-sentinel/);
  assert.match(release, /sentinel:checksums/);
  assert.match(release, /gh release create/);
  assert.match(updateUi, /SHA-256 verified/);
  assert.match(updateUi, /Startup gate/);
  assert.match(updateUi, /update:rollback-status/);
});
