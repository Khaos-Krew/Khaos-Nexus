'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeProgressEvent,
  progressEventFingerprint,
  aggregateParticipant,
  ProtocolProgressLedger
} = require('../src/sentinel/nexus-protocol-progress.cjs');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-protocol-progress-')), 'ledger.json');
}

const base = { runId: 'run1', accountId: 'acct1', sourceId: 'evt1', type: 'presence', at: 1000 };

test('progress events are deterministic and reject malformed identities/types', () => {
  const first = normalizeProgressEvent(base);
  const second = normalizeProgressEvent({ ...base, activeMinutes: 5 });
  assert.equal(first.id, second.id);
  assert.notEqual(progressEventFingerprint(first), progressEventFingerprint(second));
  assert.throws(() => normalizeProgressEvent({ ...base, type: 'hack' }), /event type/);
  assert.throws(() => normalizeProgressEvent({ ...base, sourceId: 'bad space' }), /source id/);
});

test('aggregation deduplicates exact replayed events and calculates eligible score once', () => {
  const events = [
    { ...base, activeMinutes: 8 },
    { ...base, activeMinutes: 8 },
    { runId: 'run1', accountId: 'acct1', sourceId: 'evt2', type: 'objective', at: 2000, objectiveContribution: 3 },
    { runId: 'run1', accountId: 'acct1', sourceId: 'evt3', type: 'kill', at: 3000, killContribution: 2 },
    { runId: 'run1', accountId: 'acct1', sourceId: 'evt4', type: 'completion', at: 4000, presentAtCompletion: true }
  ];
  const result = aggregateParticipant(events, { minActiveMinutes: 5 });
  assert.equal(result.processedEvents, 4);
  assert.equal(result.activeMinutes, 8);
  assert.equal(result.objectiveContribution, 3);
  assert.equal(result.killContribution, 2);
  assert.equal(result.eligible, true);
  assert.equal(result.score, 148);
});

test('aggregation fails closed when the same source replays with a different payload', () => {
  assert.throws(() => aggregateParticipant([
    { ...base, activeMinutes: 8 },
    { ...base, activeMinutes: 80 }
  ]), /Conflicting Protocol progress event replay/);
});

test('ineligible participation retains raw score but awards zero Protocol Score', () => {
  const result = aggregateParticipant([
    { ...base, activeMinutes: 1 },
    { runId: 'run1', accountId: 'acct1', sourceId: 'evt2', type: 'objective', at: 2000, objectiveContribution: 10 }
  ], { minActiveMinutes: 5 });
  assert.equal(result.eligible, false);
  assert.equal(result.score, 0);
  assert.ok(result.rawScore > 0);
  assert.ok(result.eligibilityReasons.includes('insufficient_active_time'));
});

test('progress ledger survives restart and ignores exact duplicate event delivery', () => {
  const file = tempFile();
  const ledger = new ProtocolProgressLedger(file);
  ledger.load();
  assert.equal(ledger.append({ ...base, activeMinutes: 6 }).inserted, true);
  assert.equal(ledger.append({ ...base, activeMinutes: 6 }).inserted, false);
  ledger.append({ runId: 'run1', accountId: 'acct1', sourceId: 'evt2', type: 'completion', at: 2000, presentAtCompletion: true, manualContribution: true });
  ledger.save(3000);

  const reloaded = new ProtocolProgressLedger(file);
  const state = reloaded.load();
  assert.equal(state.events.length, 2);
  const participant = reloaded.participant('run1', 'acct1', { minActiveMinutes: 5 });
  assert.equal(participant.eligible, true);
  assert.equal(participant.processedEvents, 2);
});

test('progress ledger rejects a conflicting replay before it can alter participant totals', () => {
  const ledger = new ProtocolProgressLedger(tempFile());
  ledger.load();
  ledger.append({ ...base, activeMinutes: 6 });
  assert.throws(() => ledger.append({ ...base, activeMinutes: 60 }), /Conflicting Protocol progress event replay/);
  assert.equal(ledger.participant('run1', 'acct1', { minActiveMinutes: 5 }).activeMinutes, 6);
});

test('progress ledger load rejects persisted conflicting duplicates', () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    revision: 1,
    updatedAt: 2000,
    events: [
      { ...base, activeMinutes: 6 },
      { ...base, activeMinutes: 60 }
    ]
  }));
  const ledger = new ProtocolProgressLedger(file);
  assert.throws(() => ledger.load(), /Conflicting Protocol progress event replay/);
});

test('aggregation cannot mix runs or accounts', () => {
  assert.throws(() => aggregateParticipant([
    base,
    { ...base, runId: 'run2', sourceId: 'evt2' }
  ]), /cannot mix/);
});

test('progress ledger fails closed at capacity instead of evicting replay history', () => {
  const ledger = new ProtocolProgressLedger(tempFile(), { maxEvents: 100 });
  ledger.load();
  for (let i = 0; i < 100; i += 1) {
    ledger.append({ runId: 'run-capacity', accountId: 'acct1', sourceId: `evt${i}`, type: 'presence', at: i, activeMinutes: 1 });
  }
  assert.equal(ledger.snapshot().events.length, 100);
  assert.throws(() => ledger.append({ runId: 'run-capacity', accountId: 'acct1', sourceId: 'evt100', type: 'presence', at: 100 }), /capacity exceeded/);
  assert.equal(ledger.snapshot().events[0].sourceId, 'evt0');
  assert.equal(ledger.append({ runId: 'run-capacity', accountId: 'acct1', sourceId: 'evt0', type: 'presence', at: 0, activeMinutes: 1 }).inserted, false);
  assert.throws(() => ledger.append({ runId: 'run-capacity', accountId: 'acct1', sourceId: 'evt0', type: 'presence', at: 0, activeMinutes: 99 }), /Conflicting Protocol progress event replay/);
});

test('progress ledger refuses to truncate an oversized persisted journal on restart', () => {
  const file = tempFile();
  const events = [];
  for (let i = 0; i < 101; i += 1) {
    events.push({ runId: 'run-persisted', accountId: 'acct1', sourceId: `evt${i}`, type: 'presence', at: i, activeMinutes: 1 });
  }
  fs.writeFileSync(file, JSON.stringify({ version: 1, revision: 1, updatedAt: 2000, events }));
  const ledger = new ProtocolProgressLedger(file, { maxEvents: 100 });
  assert.throws(() => ledger.load(), /capacity exceeded/);
});
