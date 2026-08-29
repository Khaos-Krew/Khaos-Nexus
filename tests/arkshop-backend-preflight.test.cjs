'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeRows, compareBackendStats, runArkShopBackendPreflight, safeLogSummary } = require('../src/sentinel/arkshop-backend-preflight.cjs');

const columns = { id: 'EosId', points: 'Points', kits: 'Kits' };

function stats(rows) {
  return summarizeRows(rows, columns);
}

test('summary hashes identity/state without exposing player identifiers', () => {
  const result = stats([
    { EosId: 'EOS-AAA', Points: 100, Kits: '{"starter":0}' },
    { EosId: 'EOS-BBB', Points: 0, Kits: '{}' }
  ]);
  assert.equal(result.rows, 2);
  assert.equal(result.rowsWithPoints, 1);
  assert.equal(result.rowsWithKits, 1);
  assert.match(result.identityDigest, /^[a-f0-9]{64}$/);
  assert.match(result.stateDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('EOS-AAA'), false);
});

test('exact state match is the only populated case safe to switch automatically', () => {
  const a = stats([{ EosId: 'EOS-AAA', Points: 100, Kits: '{}' }]);
  const b = stats([{ EosId: 'EOS-AAA', Points: 100, Kits: '{}' }]);
  assert.deepEqual(compareBackendStats(a, b), { safeToSwitch: true, mode: 'exact-state-match' });
});

test('preflight distinguishes empty target, state drift, and player-set mismatch', () => {
  const sqlite = stats([{ EosId: 'EOS-AAA', Points: 100, Kits: '{}' }]);
  const empty = stats([]);
  const drift = stats([{ EosId: 'EOS-AAA', Points: 200, Kits: '{}' }]);
  const other = stats([{ EosId: 'EOS-BBB', Points: 100, Kits: '{}' }]);

  assert.equal(compareBackendStats(sqlite, empty).mode, 'sqlite-authoritative-mysql-empty');
  assert.equal(compareBackendStats(sqlite, drift).mode, 'same-players-state-drift');
  assert.equal(compareBackendStats(sqlite, other).mode, 'backend-player-set-mismatch');
  assert.equal(compareBackendStats(sqlite, drift).safeToSwitch, false);
});

test('injected live preflight returns only aggregate backend summaries', async () => {
  const mysql = { backend: 'mysql', ...stats([{ EosId: 'EOS-AAA', Points: 100, Kits: '{}' }]) };
  const sqlite = { backend: 'sqlite', ...stats([{ EosId: 'EOS-AAA', Points: 100, Kits: '{}' }]) };
  const result = await runArkShopBackendPreflight({
    mysqlReader: async () => mysql,
    sqliteReader: async () => sqlite
  });
  assert.equal(result.comparison.mode, 'exact-state-match');
  const log = safeLogSummary(result);
  assert.match(log, /safeToSwitch=true/);
  assert.equal(log.includes('EOS-AAA'), false);
});
