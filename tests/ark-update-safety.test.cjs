'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  parseSteamBuildId,
  analyzeApiDiagnostic,
  parseInstalledModFolders,
  evaluateVerdict
} = require('../src/sentinel/ark-update-safety.cjs');

test('parses Steam build id', () => {
  assert.equal(parseSteamBuildId('"buildid" "24976862"'), '24976862');
});

test('compares dotted versions numerically', () => {
  assert.equal(compareVersions('2.03', '2.03'), 0);
  assert.equal(compareVersions('2.02', '2.03'), -1);
  assert.equal(compareVersions('2.10', '2.9'), 1);
});

test('latest ArkApi lifecycle detects missing offset as failure', () => {
  const result = analyzeApiDiagnostic({
    found: true,
    lifecycle: [
      'old [API][critical] Failed to get the offset of Old.Symbol',
      '[API][info] ARK:SA Api V2.03',
      '[API][info] API was successfully loaded',
      '[API][info] Loaded all plugins',
      '[API][critical] Failed to get the offset of AActor.NotifyActorBeginOverlap(AActor*)'
    ]
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.version, '2.03');
});

test('old missing offset before newest startup does not poison current health', () => {
  const result = analyzeApiDiagnostic({
    found: true,
    lifecycle: [
      '[API][info] ARK:SA Api V2.02',
      '[API][critical] Failed to get the offset of Old.Symbol',
      '[API][info] ARK:SA Api V2.03',
      '[API][info] API was successfully loaded',
      '[API][info] Loaded all plugins'
    ]
  });
  assert.equal(result.status, 'pass');
});

test('active ASA mod folders retain newest installed file id', () => {
  const entries = [
    { type: 'd', name: '123456_7000000', modifyTime: 100 },
    { type: 'd', name: '123456_7000010', modifyTime: 200 },
    { type: 'd', name: '999999_7000020', modifyTime: 300 }
  ];
  assert.deepEqual(parseInstalledModFolders(entries, ['123456']).map((item) => [item.modId, item.fileId]), [['123456', '7000010']]);
});

test('healthy current server is safe', () => {
  const verdict = evaluateVerdict({
    server: { rcon: 'pass' },
    game: { updateAvailable: false },
    api: { health: 'pass', installedVersion: '2.03', latestKnown: '2.03' },
    plugins: { status: 'pass', missing: [] },
    mods: { status: 'pass', pendingCount: 0 }
  });
  assert.equal(verdict.level, 'safe');
});

test('pending game update with unknown mod freshness is hold', () => {
  const verdict = evaluateVerdict({
    server: { rcon: 'pass' },
    game: { updateAvailable: true },
    api: { health: 'pass', installedVersion: '2.03', latestKnown: '2.03' },
    plugins: { status: 'pass', missing: [] },
    mods: { status: 'unknown', pendingCount: 0 }
  });
  assert.equal(verdict.level, 'hold');
  assert.match(verdict.blockers.join(' '), /mod freshness/i);
});

test('pending game update with missing offset is hold', () => {
  const verdict = evaluateVerdict({
    server: { rcon: 'pass' },
    game: { updateAvailable: true },
    api: { health: 'fail', healthSummary: 'missing offset', installedVersion: '2.03', latestKnown: '2.03' },
    plugins: { status: 'pass', missing: [] },
    mods: { status: 'pass', pendingCount: 0 }
  });
  assert.equal(verdict.level, 'hold');
});
