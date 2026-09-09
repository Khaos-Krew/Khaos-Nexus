'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkEquivalenceEvidence } = require('../src/sentinel-v2/ark-equivalence-evidence.cjs');

test('records matched equivalence as durable audit evidence', async () => {
  const entries = [];
  const evidence = new ArkEquivalenceEvidence({ auditStore: { async append(entry) { entries.push(entry); return { ...entry, persisted: true, auditId: 42 }; } } });
  const result = await evidence.record({ equivalent: true, servers: 2, matched: 2, drifted: 0, checkedAt: '2026-09-09T21:00:00.000Z', comparisons: [] }, { correlationId: 'eq-1' });
  assert.equal(entries[0].action, 'sentinel.ark.health_equivalence.matched');
  assert.equal(entries[0].correlationId, 'eq-1');
  assert.equal(result.persisted, true);
  assert.equal(result.auditId, 42);
});

test('records bounded semantic drift details for review', async () => {
  const entries = [];
  const evidence = new ArkEquivalenceEvidence({ auditStore: { async append(entry) { entries.push(entry); return { ...entry, persisted: false }; } } });
  const result = await evidence.record({
    equivalent: false,
    servers: 1,
    matched: 0,
    drifted: 1,
    comparisons: [{ serverId: 'gen1', serverName: 'Gen 1', equivalent: false, differences: [{ field: 'modCount', v2: 8, legacy: 7 }] }],
  });
  assert.equal(entries[0].action, 'sentinel.ark.health_equivalence.drifted');
  assert.deepEqual(entries[0].details.drift[0].differences, [{ field: 'modCount', v2: 8, legacy: 7 }]);
  assert.equal(result.drifted, 1);
  assert.equal(result.persisted, false);
});
