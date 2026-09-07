'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProtocolProgressLedger } = require('../src/sentinel/nexus-protocol-progress.cjs');
const { appendProgressBatch } = require('../src/sentinel/nexus-protocol-progress-batch.cjs');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-protocol-progress-batch-')), 'ledger.json');
}

function event(sourceId, activeMinutes = 1) {
  return {
    runId: 'run-batch',
    accountId: 'acct1',
    sourceId,
    type: 'presence',
    at: Number(sourceId.replace(/\D/g, '') || 1),
    activeMinutes
  };
}

test('progress batch inserts all new events and preserves request ordering', () => {
  const ledger = new ProtocolProgressLedger(tempFile(), { maxEvents: 100 });
  ledger.load();
  const result = appendProgressBatch(ledger, [event('evt1'), event('evt2'), event('evt3')]);
  assert.equal(result.accepted, true);
  assert.equal(result.requestedEvents, 3);
  assert.equal(result.insertedEvents, 3);
  assert.equal(result.duplicateEvents, 0);
  assert.deepEqual(result.results.map((entry) => entry.inserted), [true, true, true]);
  assert.equal(ledger.snapshot().events.length, 3);
});

test('exact replays within and across batches are idempotent', () => {
  const ledger = new ProtocolProgressLedger(tempFile(), { maxEvents: 100 });
  ledger.load();
  appendProgressBatch(ledger, [event('evt1')]);
  const result = appendProgressBatch(ledger, [event('evt1'), event('evt2'), event('evt2')]);
  assert.equal(result.insertedEvents, 1);
  assert.equal(result.duplicateEvents, 2);
  assert.deepEqual(result.results.map((entry) => entry.inserted), [false, true, false]);
  assert.equal(ledger.snapshot().events.length, 2);
});

test('conflicting replay rejects the entire batch before any new event is appended', () => {
  const ledger = new ProtocolProgressLedger(tempFile(), { maxEvents: 100 });
  ledger.load();
  appendProgressBatch(ledger, [event('evt1', 5)]);
  const before = ledger.snapshot();
  assert.throws(() => appendProgressBatch(ledger, [event('evt2'), event('evt1', 50), event('evt3')]), /Conflicting Protocol progress event replay in batch/);
  assert.deepEqual(ledger.snapshot(), before);
});

test('conflicting duplicate inside a batch fails closed without partial mutation', () => {
  const ledger = new ProtocolProgressLedger(tempFile(), { maxEvents: 100 });
  ledger.load();
  const before = ledger.snapshot();
  assert.throws(() => appendProgressBatch(ledger, [event('evt1', 5), event('evt1', 50), event('evt2')]), /within batch/);
  assert.deepEqual(ledger.snapshot(), before);
});

test('capacity overflow rejects the whole batch before the ledger changes', () => {
  const ledger = new ProtocolProgressLedger(tempFile(), { maxEvents: 100 });
  ledger.load();
  const seed = [];
  for (let i = 0; i < 99; i += 1) seed.push(event(`evt${i + 1}`));
  appendProgressBatch(ledger, seed);
  const before = ledger.snapshot();
  assert.throws(() => appendProgressBatch(ledger, [event('evt100'), event('evt101')]), /batch rejected before mutation/);
  assert.deepEqual(ledger.snapshot(), before);
});

test('malformed later input rejects the batch before earlier valid input mutates the ledger', () => {
  const ledger = new ProtocolProgressLedger(tempFile(), { maxEvents: 100 });
  ledger.load();
  const before = ledger.snapshot();
  assert.throws(() => appendProgressBatch(ledger, [event('evt1'), { ...event('evt2'), type: 'invalid' }]), /event type/);
  assert.deepEqual(ledger.snapshot(), before);
});
