'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  NexusProtocolStore,
  normalizeState,
  participantKey
} = require('../src/sentinel/nexus-protocol-store.cjs');

function tempFile(name = 'protocol.json') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-protocol-')), name);
}

test('store persists seasons, runs, participants, Dark Zone state and audit across restart', () => {
  const file = tempFile();
  const store = new NexusProtocolStore(file);
  store.load();
  store.upsertSeason({ id: 'season-1', name: 'Season One', startsAt: 1000, endsAt: 5000, status: 'active' });
  store.upsertRun({ id: 'run-1', protocolId: 'alpha_purge', seasonId: 'season-1', map: 'Genesis 1', state: 'active', startedAt: 1200 });
  store.upsertParticipant({
    runId: 'run-1', accountId: 'acct-1', discordId: '123', eosId: 'EOS_ABC', activeMinutes: 20,
    objectiveContribution: 3, killContribution: 4, deaths: 1, completed: true,
    presentAtCompletion: true, eligible: true, score: 220, updatedAt: 2000
  });
  store.upsertDarkZone({ accountId: 'acct-1', state: 'enlisted', enrollmentMode: 'solo', effectiveAt: 1500, changedAt: 1400, registeredTameIds: ['dino-1'] });
  store.audit('participant.scored', 'acct-1', 'run-1 score=220', 'sentinal', 2100);
  const saved = store.save(2200);
  assert.equal(saved.revision, 1);

  const restarted = new NexusProtocolStore(file);
  const loaded = restarted.load();
  assert.equal(loaded.seasons['season-1'].status, 'active');
  assert.equal(loaded.protocolRuns['run-1'].map, 'Genesis 1');
  assert.equal(loaded.participants[participantKey('run-1', 'acct-1')].score, 220);
  assert.equal(loaded.darkZone['acct-1'].registeredTameIds[0], 'dino-1');
  assert.equal(loaded.audit[0].type, 'participant.scored');
});

test('leaderboard aggregates only eligible participants from runs in the requested season', () => {
  const store = new NexusProtocolStore(tempFile());
  store.load();
  store.upsertSeason({ id: 's1', startsAt: 1, endsAt: 100, status: 'active' });
  store.upsertSeason({ id: 's2', startsAt: 101, endsAt: 200, status: 'planned' });
  store.upsertRun({ id: 'r1', protocolId: 'alpha_purge', seasonId: 's1', state: 'active', startedAt: 2 });
  store.upsertRun({ id: 'r2', protocolId: 'anomaly', seasonId: 's1', state: 'active', startedAt: 3 });
  store.upsertRun({ id: 'r3', protocolId: 'community', seasonId: 's2', state: 'active', startedAt: 102 });

  store.upsertParticipant({ runId: 'r1', accountId: 'a', eligible: true, score: 100, updatedAt: 10 });
  store.upsertParticipant({ runId: 'r2', accountId: 'a', eligible: true, score: 80, updatedAt: 11 });
  store.upsertParticipant({ runId: 'r1', accountId: 'b', eligible: true, score: 150, updatedAt: 12 });
  store.upsertParticipant({ runId: 'r2', accountId: 'c', eligible: false, score: 999, updatedAt: 13 });
  store.upsertParticipant({ runId: 'r3', accountId: 'd', eligible: true, score: 1000, updatedAt: 14 });

  assert.deepEqual(store.leaderboard('s1'), [
    { rank: 1, accountId: 'a', score: 180, runs: 2 },
    { rank: 2, accountId: 'b', score: 150, runs: 1 }
  ]);
});

test('store fails closed on unsupported versions, invalid identifiers and orphan records', () => {
  assert.throws(() => normalizeState({ version: 2 }), /Unsupported/);
  const store = new NexusProtocolStore(tempFile());
  store.load();
  assert.throws(() => store.upsertRun({ id: 'r1', protocolId: 'alpha_purge', seasonId: 'missing' }), /Unknown season/);
  assert.throws(() => store.upsertParticipant({ runId: 'missing', accountId: 'acct', score: 1 }), /Unknown protocol run/);
  assert.throws(() => store.upsertDarkZone({ accountId: '../escape' }), /Invalid account id/);
});

test('save uses a private atomic snapshot and increments revision', () => {
  const file = tempFile();
  const store = new NexusProtocolStore(file);
  store.load();
  store.save(100);
  store.save(200);
  assert.equal(store.snapshot().revision, 2);
  assert.equal(store.snapshot().updatedAt, 200);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).revision, 2);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});
