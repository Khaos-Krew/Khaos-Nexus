'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('v0.41 bridge freeze script preserves the published stable updater identity', () => {
  const source = read('scripts/freeze-v0.41-nexus-core.cjs');
  assert.match(source, /pkg\.version = '0\.41\.0'/);
  assert.match(source, /displayVersion: '0\.41\.0-B'/);
  assert.match(source, /publicTag: 'v0\.41\.0-B'/);
  assert.match(source, /generateUpdatesFilesForAllChannels = true/);
  assert.match(source, /channel: 'latest'/);
  assert.match(source, /Khaos-Nexus-Setup-0\.41\.0-B/);
  assert.match(source, /Khaos-Nexus-Portable-0\.41\.0-B/);
});

test('v0.41.1 acceptance freeze script targets the opt-in Test/Beta updater feed', () => {
  const source = read('scripts/freeze-v0.41.1-hotfix.cjs');
  assert.match(source, /pkg\.version = '0\.41\.1'/);
  assert.match(source, /displayVersion: '0\.41\.1-B'/);
  assert.match(source, /publicTag: 'v0\.41\.1-B'/);
  assert.match(source, /channel: 'beta'/);
  assert.match(source, /rollbackTag: 'v0\.41\.0-B'/);
  assert.match(source, /generateUpdatesFilesForAllChannels = true/);
  assert.match(source, /Khaos-Nexus-Setup-0\.41\.1-B/);
  assert.match(source, /Khaos-Nexus-Portable-0\.41\.1-B/);
});

test('stable remains the default updater channel and test channel is explicit opt-in', () => {
  const source = read('main/brand-update-extension.cjs');
  assert.match(source, /normalizeUpdateChannel/);
  assert.match(source, /=== 'test' \? 'test' : 'stable'/);
  assert.match(source, /this\.updater\.channel = channel === 'test' \? 'beta' : 'latest'/);
  assert.match(source, /this\.updater\.allowPrerelease = channel === 'test'/);
  assert.match(source, /releases\?per_page=30/);
  assert.match(source, /!item\.prerelease/);
  assert.match(source, /return super\.checkPortableRelease\(\)/);
});

test('pre-update backup remains mandatory after channel support', () => {
  const source = read('main/brand-update-extension.cjs');
  assert.match(source, /createAutomaticBackup\('pre-update'\)/);
  assert.match(source, /verifyBackup\(backup\.filePath\)/);
  assert.match(source, /Installation was cancelled and the current version remains active/);
});

test('Windows acceptance candidate freezes v0.41.1 and verifies beta updater metadata', () => {
  const workflow = read('.github/workflows/windows-build.yml');
  assert.match(workflow, /freeze-v0\.41\.1-hotfix\.cjs/);
  assert.match(workflow, /KHAOS_REQUIRE_UPDATER_METADATA: '1'/);
  assert.match(workflow, /Smoke-test clean installer/);
  assert.match(workflow, /Smoke-test packaged full startup readiness/);
  assert.match(workflow, /Verify Test\/Beta updater metadata/);
  assert.match(workflow, /dist\/beta\.yml/);
});

test('protected v0.41.0 bridge publisher remains immutable rollback evidence', () => {
  const workflow = read('.github/workflows/nexus-core-test-release.yml');
  const tests = workflow.indexOf('Run complete tests');
  const cleanInstall = workflow.indexOf('Smoke-test clean installer');
  const verifyMetadata = workflow.indexOf('Verify in-app update metadata');
  const tag = workflow.indexOf('Create immutable release tag');
  const publish = workflow.indexOf('Publish in-app update release');
  assert.ok(tests >= 0);
  assert.ok(cleanInstall > tests);
  assert.ok(verifyMetadata > cleanInstall);
  assert.ok(tag > verifyMetadata);
  assert.ok(publish > tag);
  assert.match(workflow, /gh release create v0\.41\.0-B/);
  assert.match(workflow, /--latest/);
  assert.match(workflow, /releases\/latest/);
});

test('v0.41.0 release notes preserve the stable bridge safety contract', () => {
  const notes = read('release-notes/v0.41.0.md');
  assert.match(notes, /in-app update testing/i);
  assert.match(notes, /mandatory verified pre-update backups/i);
  assert.match(notes, /does not move desktop authority to Railway/i);
  assert.match(notes, /refuses automatic destructive replay/i);
});

test('v0.41.1 acceptance notes keep Palworld restart and beta exposure gated', () => {
  const notes = read('release-notes/v0.41.1.md');
  assert.match(notes, /opt-in Test\/Beta update channel/i);
  assert.match(notes, /v0\.41\.0-B remains the Stable\/latest rollback point/i);
  assert.match(notes, /Automatic Palworld maintenance restart remains disabled/i);
  assert.match(notes, /fail closed/i);
});
