'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createParticipantProgressSnapshot } = require('../src/sentinel/nexus-protocol-participant-snapshot.cjs');
const {
  createSeasonParticipantManifest,
  verifySeasonParticipantManifest
} = require('../src/sentinel/nexus-protocol-season-participant-manifest.cjs');

function snapshot(runId, accountId, score, revision = 9) {
  const events = [
    { runId, accountId, at: 100 },
    { runId, accountId, at: 200 }
  ];
  return createParticipantProgressSnapshot({
    runId,
    accountId,
    activeMinutes: 20,
    objectiveContribution: 5,
    killContribution: 1,
    deaths: 0,
    completed: true,
    eligible: true,
    score,
    rawScore: score,
    processedEvents: 2,
    updatedAt: 200
  }, { version: 1, revision, updatedAt: 220, events });
}

test('creates a read-only season manifest from revision-consistent participant snapshots', () => {
  const first = snapshot('run-a', 'acct-1', 40);
  const second = snapshot('run-b', 'acct-2', 60);
  const manifest = createSeasonParticipantManifest(
    { id: 'season-1', status: 'active' },
    [second, first],
    { runIds: ['run-a', 'run-b'], ledgerRevision: 9 }
  );
  assert.equal(manifest.seasonId, 'season-1');
  assert.equal(manifest.ledgerRevision, 9);
  assert.equal(manifest.participantCount, 2);
  assert.equal(manifest.eligibleCount, 2);
  assert.equal(manifest.totalAwardedScore, 100);
  assert.deepEqual(manifest.entries.map((entry) => entry.runId), ['run-a', 'run-b']);
  assert.equal(manifest.readOnly, true);
  assert.equal(manifest.rewardAuthority, false);
  assert.equal(manifest.mutatesPersistence, false);
  assert.equal(verifySeasonParticipantManifest(manifest), true);
});

test('rejects participant snapshots from mixed ledger revisions', () => {
  assert.throws(
    () => createSeasonParticipantManifest(
      { id: 'season-1' },
      [snapshot('run-a', 'acct-1', 40, 9), snapshot('run-b', 'acct-2', 60, 10)]
    ),
    /span ledger revisions/
  );
});

test('rejects snapshots for runs outside the season run set', () => {
  assert.throws(
    () => createSeasonParticipantManifest(
      { id: 'season-1' },
      [snapshot('run-other', 'acct-1', 40)],
      { runIds: ['run-a'] }
    ),
    /outside the season/
  );
});

test('rejects duplicate participant snapshots and invalid snapshot seals', () => {
  const source = snapshot('run-a', 'acct-1', 40);
  assert.throws(
    () => createSeasonParticipantManifest({ id: 'season-1' }, [source, source]),
    /Duplicate Protocol participant snapshot/
  );
  assert.throws(
    () => createSeasonParticipantManifest({ id: 'season-1' }, [{ ...source, score: 999 }]),
    /Invalid Protocol participant snapshot/
  );
});

test('detects manifest score, digest and authority tampering', () => {
  const manifest = createSeasonParticipantManifest({ id: 'season-1' }, [snapshot('run-a', 'acct-1', 40)]);
  assert.equal(verifySeasonParticipantManifest({ ...manifest, totalAwardedScore: 41 }), false);
  assert.equal(verifySeasonParticipantManifest({ ...manifest, digest: '0'.repeat(64) }), false);
  assert.equal(verifySeasonParticipantManifest({ ...manifest, rewardAuthority: true }), false);
  const changedEntries = manifest.entries.map((entry) => ({ ...entry, score: entry.score + 1 }));
  assert.equal(verifySeasonParticipantManifest({ ...manifest, entries: changedEntries, totalAwardedScore: 41 }), false);
});
