'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyHealthFromSnapshot, compareArkHealth, buildArkHealthEquivalenceReport } = require('../src/sentinel-v2/ark-health-equivalence.cjs');

test('legacy health normalization matches v2 health semantics', () => {
  const health = legacyHealthFromSnapshot({ serverId: 'gen1', serverName: 'Gen 1', version: '1.2', modIds: ['1', '2'], inventoryAvailable: true, errors: [] });
  assert.deepEqual(health, { serverId: 'gen1', serverName: 'Gen 1', ok: true, degraded: false, version: '1.2', modCount: 2, inventoryAvailable: true, errors: [] });
});

test('ARK equivalence ignores error ordering but detects semantic drift', () => {
  assert.equal(compareArkHealth({ ok: false, degraded: true, modCount: 2, inventoryAvailable: false, errors: ['b', 'a'] }, { ok: false, degraded: true, modCount: 2, inventoryAvailable: false, errors: ['a', 'b'] }).equivalent, true);
  const drift = compareArkHealth({ ok: true, degraded: false, modCount: 3, inventoryAvailable: true, errors: [] }, { ok: true, degraded: false, modCount: 2, inventoryAvailable: true, errors: [] });
  assert.equal(drift.equivalent, false);
  assert.deepEqual(drift.differences, [{ field: 'modCount', v2: 3, legacy: 2 }]);
});

test('ARK equivalence report exposes missing maps without performing writes', () => {
  const report = buildArkHealthEquivalenceReport([
    { health: { serverId: 'gen1', serverName: 'Gen 1', ok: true, degraded: false, modCount: 1, inventoryAvailable: true, errors: [] } },
  ], [
    { serverId: 'gen1', serverName: 'Gen 1', modIds: ['1'], inventoryAvailable: true, errors: [] },
    { serverId: 'astraeos', serverName: 'Astraeos', modIds: [], inventoryAvailable: false, errors: ['offline'] },
  ]);
  assert.equal(report.equivalent, false);
  assert.equal(report.servers, 2);
  assert.equal(report.matched, 1);
  assert.equal(report.drifted, 1);
  assert.equal(report.comparisons.find((item) => item.serverId === 'astraeos').differences[0].field, 'v2Snapshot');
});
