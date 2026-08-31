'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planMerge, backupName, validateApprovedTarget } = require('../src/sentinel/arkshop-gen1-mysql-import.cjs');

const row = (EosId, Points = 0, Kits = '{}', TotalSpent = 0) => ({ EosId, Points, Kits, TotalSpent });

test('MAP1 merge inserts only missing identities and preserves matching target rows', () => {
  const result = planMerge([row('A', 10), row('B', 20)], [row('A', 10), row('MAP2', 30)]);
  assert.equal(result.matching, 1);
  assert.equal(result.conflicts, 0);
  assert.deepEqual(result.missing.map((entry) => entry.EosId), ['B']);
});

test('MAP1 merge fails closed on overlapping balance, kit, or spend drift', () => {
  assert.equal(planMerge([row('A', 10)], [row('A', 11)]).conflicts, 1);
  assert.equal(planMerge([row('A', 10, '{"x":1}')], [row('A', 10, '{}')]).conflicts, 1);
  assert.equal(planMerge([row('A', 10, '{}', 2)], [row('A', 10, '{}', 3)]).conflicts, 1);
});

test('backup names are deterministic safe identifiers', () => {
  assert.match(backupName('production/run 1'), /^NexusBackup_ArkShopPlayers_[a-f0-9]{12}$/);
});

test('import accepts only the approved Citadel target', () => {
  const approved = { host: '167.235.134.46', port: 3306, database: 'khaosk_nexus', user: 'khaosk_48289', password: 'x', table: 'ArkShopPlayers' };
  assert.doesNotThrow(() => validateApprovedTarget(approved));
  assert.throws(() => validateApprovedTarget({ ...approved, host: 'other' }), /approved Citadel/);
});
