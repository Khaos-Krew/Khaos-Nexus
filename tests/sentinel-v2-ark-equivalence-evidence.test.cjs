'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ArkEquivalenceEvidence,
  MATCHED_ACTION,
  DRIFTED_ACTION,
  EVIDENCE_SUBJECT,
} = require('../src/sentinel-v2/ark-equivalence-evidence.cjs');

test('records matched equivalence as durable audit evidence', async () => {
  const entries = [];
  const evidence = new ArkEquivalenceEvidence({ auditStore: { async append(entry) { entries.push(entry); return { ...entry, persisted: true, auditId: 42 }; } } });
  const result = await evidence.record({ equivalent: true, servers: 2, matched: 2, drifted: 0, checkedAt: '2026-09-09T21:00:00.000Z', comparisons: [] }, { correlationId: 'eq-1' });
  assert.equal(entries[0].action, MATCHED_ACTION);
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
  assert.equal(entries[0].action, DRIFTED_ACTION);
  assert.deepEqual(entries[0].details.drift[0].differences, [{ field: 'modCount', v2: 8, legacy: 7 }]);
  assert.equal(result.drifted, 1);
  assert.equal(result.persisted, false);
});

test('loads restart-safe equivalence samples from durable audit history', async () => {
  const listCalls = [];
  const evidence = new ArkEquivalenceEvidence({
    auditStore: {
      async list(options) {
        listCalls.push(options);
        return [
          {
            auditId: 10,
            occurredAt: '2026-09-09T21:00:00.000Z',
            action: MATCHED_ACTION,
            subject: EVIDENCE_SUBJECT,
            details: { equivalent: true, servers: 2, matched: 2, drifted: 0, checkedAt: '2026-09-09T20:59:59.000Z' },
            persisted: true,
          },
          {
            auditId: 11,
            occurredAt: '2026-09-09T21:05:00.000Z',
            action: DRIFTED_ACTION,
            subject: EVIDENCE_SUBJECT,
            details: { equivalent: false, servers: 2, matched: 1, drifted: 1 },
            persisted: true,
          },
        ];
      },
    },
  });

  const history = await evidence.history({ since: '2026-09-09T20:00:00Z', limit: 100 });
  assert.deepEqual(listCalls[0], {
    actions: [MATCHED_ACTION, DRIFTED_ACTION],
    subject: EVIDENCE_SUBJECT,
    since: '2026-09-09T20:00:00Z',
    limit: 100,
  });
  assert.equal(history.length, 2);
  assert.equal(history[0].checkedAt, '2026-09-09T20:59:59.000Z');
  assert.equal(history[0].equivalent, true);
  assert.equal(history[0].persisted, true);
  assert.equal(history[1].checkedAt, '2026-09-09T21:05:00.000Z');
  assert.equal(history[1].equivalent, false);
  assert.equal(history[1].drifted, 1);
  assert.equal(history[1].auditId, 11);
});
