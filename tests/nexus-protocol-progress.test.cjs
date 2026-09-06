'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeProgressEvent,
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
  assert.throws(() => normalizeProgressEvent({ ...base, type: 'hack' }), /event type/);
  assert.throws(() => normalizeProgressEvent({ ...base, sourceId: 'bad space' }), /source id/);
});

test('aggregation deduplicates replayed events and calculates eligible score once', () => {
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

test('progress ledger survives restart and ignores duplicate event delivery', () => {
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

test('aggregation cannot mix runs or accounts', () => {
  assert.throws(() => aggregateParticipant([
    base,
    { ...base, runId: 'run2', sourceId: 'evt2' }
  ]), /cannot mix/);
});
