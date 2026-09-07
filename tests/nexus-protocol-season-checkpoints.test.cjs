'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProtocolProgressCheckpoint } = require('../src/sentinel/nexus-protocol-progress-checkpoint.cjs');
const {
  createSeasonCheckpointManifest,
  assertSeasonCheckpointManifest
} = require('../src/sentinel/nexus-protocol-season-checkpoints.cjs');

function checkpoint(runId, sourceId, revision = 7) {
  return buildProtocolProgressCheckpoint({
    version: 1,
    revision,
    updatedAt: 1_725_000_000_000 + revision,
    events: [{
      runId,
      accountId: 'acct-a',
      sourceId,
      type: 'objective',
      at: revision,
      activeMinutes: 12,
      objectiveContribution: 2,
      killContribution: 0,
      deathCount: 0,
      presentAtCompletion: true,
      completed: true
    }]
  }, runId, { 'acct-a': { minActiveMinutes: 10 } });
}

test('binds a Protocol season to exact run checkpoint evidence', () => {
  const alpha = checkpoint('alpha-01', 'alpha-source', 7);
  const extraction = checkpoint('extraction-01', 'extraction-source', 8);
  const manifest = createSeasonCheckpointManifest(
    { id: 'season-01', status: 'active' },
    [extraction, alpha],
    { storeRevision: 12, expectedRunIds: ['extraction-01', 'alpha-01'] }
  );
  assert.equal(manifest.checkpointCount, 2);
  assert.deepEqual(manifest.expectedRunIds, ['alpha-01', 'extraction-01']);
  assert.deepEqual(manifest.entries.map((entry) => entry.runId), ['alpha-01', 'extraction-01']);
  assert.equal(assertSeasonCheckpointManifest(manifest, [alpha, extraction]), true);
});

test('rejects duplicate run evidence in one season manifest', () => {
  const alpha = checkpoint('alpha-01', 'alpha-source', 7);
  const duplicateRun = checkpoint('alpha-01', 'different-source', 8);
  assert.throws(() => createSeasonCheckpointManifest(
    { id: 'season-01', status: 'active' },
    [alpha, duplicateRun],
    { storeRevision: 12 }
  ), /duplicate protocol run checkpoint/i);
});

test('requires an authoritative expected run set before sealing a closed season', () => {
  const alpha = checkpoint('alpha-01', 'alpha-source', 7);
  assert.throws(() => createSeasonCheckpointManifest(
    { id: 'season-01', status: 'closed' },
    [alpha],
    { storeRevision: 12 }
  ), /requires expected run ids/i);
});

test('rejects missing or extra checkpoint evidence against the expected season run set', () => {
  const alpha = checkpoint('alpha-01', 'alpha-source', 7);
  const extraction = checkpoint('extraction-01', 'extraction-source', 8);
  assert.throws(() => createSeasonCheckpointManifest(
    { id: 'season-01', status: 'closed' },
    [alpha],
    { storeRevision: 12, expectedRunIds: ['alpha-01', 'extraction-01'] }
  ), /does not cover expected run set/i);
  assert.throws(() => createSeasonCheckpointManifest(
    { id: 'season-01', status: 'closed' },
    [alpha, extraction],
    { storeRevision: 12, expectedRunIds: ['alpha-01'] }
  ), /does not cover expected run set/i);
});

test('rejects duplicate expected season run identities', () => {
  const alpha = checkpoint('alpha-01', 'alpha-source', 7);
  assert.throws(() => createSeasonCheckpointManifest(
    { id: 'season-01', status: 'closed' },
    [alpha],
    { storeRevision: 12, expectedRunIds: ['alpha-01', 'alpha-01'] }
  ), /duplicate expected protocol run id/i);
});

test('detects manifest tampering and checkpoint substitution', () => {
  const alpha = checkpoint('alpha-01', 'alpha-source', 7);
  const manifest = createSeasonCheckpointManifest(
    { id: 'season-01', status: 'closed' },
    [alpha],
    { storeRevision: 12, expectedRunIds: ['alpha-01'] }
  );
  const tampered = structuredClone(manifest);
  tampered.entries[0].participantCount += 1;
  assert.throws(() => assertSeasonCheckpointManifest(tampered, [alpha]), /integrity mismatch/i);

  const replacement = checkpoint('alpha-01', 'replacement-source', 9);
  assert.throws(() => assertSeasonCheckpointManifest(manifest, [replacement]), /does not match checkpoint evidence/i);
});

test('keeps Protocol store revision distinct from progress ledger revisions', () => {
  const alpha = checkpoint('alpha-01', 'alpha-source', 50);
  const manifest = createSeasonCheckpointManifest(
    { id: 'season-01', status: 'active' },
    [alpha],
    { storeRevision: 3 }
  );
  assert.equal(manifest.storeRevision, 3);
  assert.equal(manifest.entries[0].ledgerRevision, 50);
});
