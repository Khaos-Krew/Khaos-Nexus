'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeasonScoreSeal } = require('../src/sentinel/nexus-protocol-score-seal.cjs');
const { buildSeasonFinalizationAdmission, verifySeasonFinalizationAdmission } = require('../src/sentinel/nexus-protocol-season-finalization-admission.cjs');

function digest(char) { return char.repeat(64); }

const season = { id: 'season-1', status: 'closed', endsAt: 1000 };
const manifest = Object.freeze({
  version: 1,
  seasonId: 'season-1',
  ledgerRevision: 7,
  participantCount: 3,
  eligibleCount: 2,
  totalAwardedScore: 150,
  entries: Object.freeze([
    Object.freeze({ runId: 'run-1', accountId: 'acct-a', eligible: true, score: 100, rawScore: 100, processedEvents: 4, snapshotDigest: digest('a') }),
    Object.freeze({ runId: 'run-2', accountId: 'acct-b', eligible: true, score: 50, rawScore: 50, processedEvents: 3, snapshotDigest: digest('b') }),
    Object.freeze({ runId: 'run-2', accountId: 'acct-c', eligible: false, score: 0, rawScore: 25, processedEvents: 1, snapshotDigest: digest('c') })
  ]),
  digest: null,
  readOnly: true,
  rewardAuthority: false,
  mutatesPersistence: false
});

function stablePayload(value) {
  return JSON.stringify({
    version: value.version,
    seasonId: value.seasonId,
    ledgerRevision: value.ledgerRevision,
    participantCount: value.participantCount,
    eligibleCount: value.eligibleCount,
    totalAwardedScore: value.totalAwardedScore,
    entries: value.entries
  });
}

const crypto = require('node:crypto');
const validManifest = Object.freeze({ ...manifest, digest: crypto.createHash('sha256').update(stablePayload(manifest)).digest('hex') });
const seal = createSeasonScoreSeal(season, [
  { rank: 1, accountId: 'acct-a', score: 100, runs: 1 },
  { rank: 2, accountId: 'acct-b', score: 50, runs: 1 }
], { closedAt: 1000, storeRevision: 9 });

test('closed season admits read-only finalization when seal matches eligible manifest scores', () => {
  const admission = buildSeasonFinalizationAdmission(season, seal, validManifest, { admittedAt: 1100 });
  assert.equal(admission.nextAction, 'prepare_read_only_season_publication');
  assert.equal(admission.requiresSeparateRewardAuthorization, true);
  assert.equal(admission.rewardAuthority, false);
  assert.equal(admission.publicationAuthority, false);
  assert.equal(admission.mutatesPersistence, false);
  assert.equal(admission.executesCommands, false);
  assert.equal(verifySeasonFinalizationAdmission(admission, season, seal, validManifest), true);
});

test('score parity mismatch blocks finalization', () => {
  const badSeal = createSeasonScoreSeal(season, [
    { rank: 1, accountId: 'acct-a', score: 101, runs: 1 },
    { rank: 2, accountId: 'acct-b', score: 49, runs: 1 }
  ], { closedAt: 1000, storeRevision: 9 });
  assert.throws(() => buildSeasonFinalizationAdmission(season, badSeal, validManifest, { admittedAt: 1100 }), /does not match eligible participant manifest/);
});

test('open season and cross-season artifacts fail closed', () => {
  assert.throws(() => buildSeasonFinalizationAdmission({ ...season, status: 'active' }, seal, validManifest, { admittedAt: 1100 }), /closed season/);
  assert.throws(() => buildSeasonFinalizationAdmission({ id: 'season-2', status: 'closed', endsAt: 1000 }, seal, validManifest, { admittedAt: 1100 }), /season mismatch/);
});

test('finalization admission cannot predate score sealing close boundary', () => {
  assert.throws(() => buildSeasonFinalizationAdmission(season, seal, validManifest, { admittedAt: 999 }), /admission time/);
});

test('verification rejects reward, publication, persistence, or command authority escalation', () => {
  const admission = buildSeasonFinalizationAdmission(season, seal, validManifest, { admittedAt: 1100 });
  assert.equal(verifySeasonFinalizationAdmission({ ...admission, rewardAuthority: true }, season, seal, validManifest), false);
  assert.equal(verifySeasonFinalizationAdmission({ ...admission, publicationAuthority: true }, season, seal, validManifest), false);
  assert.equal(verifySeasonFinalizationAdmission({ ...admission, mutatesPersistence: true }, season, seal, validManifest), false);
  assert.equal(verifySeasonFinalizationAdmission({ ...admission, executesCommands: true }, season, seal, validManifest), false);
});
