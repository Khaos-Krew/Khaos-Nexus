'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY, mergePlan, backupTableName } = require('../src/sentinel/arkshop-map1-mysql-migration.cjs');

test('MAP1 migration policy is explicit and stable', () => {
  assert.equal(POLICY, 'map1-sqlite-authoritative-v1');
});

test('MAP1 merge preserves MySQL-only players and treats active SQLite as authoritative on overlap', () => {
  const plan = mergePlan(
    [
      { EosId: 'shared', Kits: '{"starter":1}', Points: 228, TotalSpent: 20 },
      { EosId: 'sqlite-only', Kits: '{}', Points: 10, TotalSpent: 0 }
    ],
    [
      { EosId: 'shared', Kits: '{}', Points: 2, TotalSpent: 0 },
      { EosId: 'mysql-only', Kits: '{}', Points: 30, TotalSpent: 0 }
    ]
  );
  assert.equal(plan.insert, 1);
  assert.equal(plan.update, 1);
  assert.equal(plan.preserveMysqlOnly, 1);
  assert.equal(plan.finalRows.size, 3);
  assert.equal(plan.finalRows.get('shared').Points, 228);
  assert.equal(plan.finalRows.get('mysql-only').Points, 30);
});

test('backup table names are bounded SQL identifiers', () => {
  assert.match(backupTableName(new Date('2026-08-31T12:34:56Z')), /^[A-Za-z0-9_]{1,64}$/);
});
