'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('complete roadmap entry activates readiness, transactional backups, isolated updates and no test updater kill-switch', () => {
  const entry = read('main/entry.cjs');
  for (const required of [
    'sentinel-readiness-extension.cjs',
    'sentinel-backup-safety-extension.cjs',
    'sentinel-update-extension.cjs',
    'sentinel-owner-monitor-boundary-extension.cjs',
    'sentinel-bot-supervisor-boundary-extension.cjs'
  ]) assert.match(entry, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(entry, /sentinel-test-update-boundary-extension\.cjs/);
});

test('Readiness Center is guaranteed to be packaged through serialized renderer assets', () => {
  const source = read('main/sentinel-readiness-extension.cjs');
  assert.match(source, /renderer.*readiness\.css/);
  assert.match(source, /renderer.*readiness\.js/);
  assert.match(source, /sentinel-roadmap-finalizer\.js/);
  const readiness = read('renderer/readiness.js');
  assert.match(readiness, /Run Safe Local Self-Test/);
  assert.match(readiness, /It does not contact Discord, GitHub, or any game server/);
  assert.match(readiness, /autonomy:create-backup/);
  assert.match(readiness, /monitor:verify/);
  assert.match(readiness, /autonomy:health-check/);
});

test('Sentinel state hub is serialized before live roadmap subscribers', () => {
  const scope = read('main/sentinel-scope-extension.cjs');
  const hub = scope.indexOf("'renderer', 'state-hub.js'");
  const sentinel = scope.indexOf("'renderer', 'sentinel-scope.js'");
  const roadmap = scope.indexOf("'renderer', 'sentinel-roadmap.js'");
  assert.ok(hub >= 0, 'state-hub.js must be part of the serialized Sentinel bundle');
  assert.ok(hub < sentinel, 'state hub must load before Sentinel scope renderer');
  assert.ok(hub < roadmap, 'state hub must load before roadmap state subscriptions');
});

test('current operational scope contains only completed modules and defers Palworld companion expansion', () => {
  const scope = read('main/sentinel-scope-extension.cjs');
  assert.doesNotMatch(scope.match(/const ACTIVE_MODULES = new Set\(\[[\s\S]*?\]\);/)?.[0] || '', /palworld-companion/);
  assert.match(scope, /Backup, Recovery & Update Center/);
  const finalizer = read('renderer/sentinel-roadmap-finalizer.js');
  assert.match(finalizer, /palworld-companion/);
  assert.match(finalizer, /11 phases implemented/);
});

test('Phase 9 uses integrity-checked transactional restore', () => {
  const source = read('main/sentinel-backup-safety-extension.cjs');
  assert.match(source, /attachBackupIntegrity/);
  assert.match(source, /validateBackupPayload/);
  assert.match(source, /Backup restore was rolled back safely/);
  assert.match(source, /safeStorage\.decryptString/);
  assert.match(source, /post-write validation/);
});

test('Phase 10 separates manual checks from background staging and protects rollback cancellation', () => {
  const source = read('main/sentinel-update-extension.cjs');
  assert.match(source, /selectSentinelRelease/);
  assert.match(source, /updateScope: 'sentinel-only'/);
  assert.match(source, /backgroundDownload: true/);
  assert.match(source, /sentinelUpdateMetadataAsset/);
  assert.match(source, /setFeedURL\(\{ provider: 'generic'/);
  assert.match(source, /configureAutomaticChecks/);
  assert.match(source, /checkAndStage/);
  assert.match(source, /stageAvailableOrCheck/);
  assert.match(source, /prepareRollbackSnapshot/);
  assert.match(source, /startRollbackWatchdog/);
  assert.match(source, /cancelRollbackWatchdog/);
  assert.match(source, /rollbackStatus: 'cancelled'/);
  assert.match(source, /this\.initialStageTimer = this\.initialStageTimer \|\| null/);
  assert.match(source, /startupAccepted/);
  assert.match(source, /Rollback snapshot failed/);
});

test('RC package and CI identify complete roadmap artifacts', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '0.33.0');
  assert.equal(pkg.khaosRelease.displayVersion, '0.33.0-SENTINEL-RC1');
  assert.match(pkg.build.nsis.artifactName, /0\.33\.0-RC1/);
  assert.match(pkg.build.portable.artifactName, /0\.33\.0-RC1/);
  assert.ok(pkg.build.files.includes('!main/sentinel-test-update-boundary-extension.cjs'));

  const workflow = read('.github/workflows/sentinel-test-build.yml');
  assert.match(workflow, /build\/sentinel-roadmap-complete/);
  assert.match(workflow, /Nexus-Sentinel-Complete-Roadmap-RC1/);
  assert.match(workflow, /latest\.yml/);
  assert.match(workflow, /\.exe\.sha256/);
  assert.match(workflow, /Readiness Center did not render/);
  assert.match(workflow, /current-scope Sentinel module is still incomplete/);
});
