'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileSnapshotStore, canonical, checksum } = require('../shared/nexus-core/snapshot-store.cjs');
const { FileOperationStore } = require('../shared/nexus-core/operation-store.cjs');
const { NexusCoreService } = require('../main/services/nexus-core-service.cjs');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('snapshot store writes checksummed projection state and loads it intact', () => {
  const directory = tempRoot('khaos-core-snapshot-');
  const store = new FileSnapshotStore({ directory });
  const saved = store.save('scheduler', {
    schemaVersion: 3,
    sequence: 42,
    createdAt: '2026-08-11T08:30:00Z',
    state: { servers: [{ id: 'rag-01', online: true }], count: 1 }
  });
  assert.match(saved.checksum, /^[a-f0-9]{64}$/);
  const loaded = store.load('scheduler');
  assert.equal(loaded.sequence, 42);
  assert.equal(loaded.schemaVersion, 3);
  assert.deepEqual(loaded.state, { servers: [{ id: 'rag-01', online: true }], count: 1 });
});

test('snapshot checksum is deterministic across object key order and rejects tampering', () => {
  const first = { alpha: 1, nested: { z: true, a: 'x' } };
  const second = { nested: { a: 'x', z: true }, alpha: 1 };
  assert.equal(canonical(first), canonical(second));
  assert.equal(checksum(first), checksum(second));

  const directory = tempRoot('khaos-core-snapshot-tamper-');
  const store = new FileSnapshotStore({ directory });
  store.save('core', { sequence: 1, state: { status: 'ready' } });
  const filePath = path.join(directory, 'core.json');
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  record.state.status = 'tampered';
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  assert.throws(() => store.load('core'), (error) => error.code === 'NEXUS_SNAPSHOT_CORRUPT');
});

test('snapshot store rejects non-JSON projection values', () => {
  const store = new FileSnapshotStore({ directory: tempRoot('khaos-core-snapshot-json-') });
  assert.throws(() => store.save('bad', { sequence: 1, state: { value: undefined } }), /cannot be undefined/);
  assert.throws(() => store.save('bad-date', { sequence: 1, state: { value: new Date() } }), /plain objects/);
});

test('operation store marks a crash-interrupted operation uncertain and never reacquires it', () => {
  const directory = tempRoot('khaos-core-operation-recovery-');
  const firstStore = new FileOperationStore({
    directory,
    now: () => '2026-08-11T08:40:00.000Z'
  });
  const action = {
    operationId: 'op-uncertain-1',
    action: 'game.server.restart',
    correlationId: 'corr-uncertain-1',
    idempotencyKey: 'restart:rag-01:uncertain-test'
  };
  assert.equal(firstStore.begin(action).acquired, true);

  const restartedStore = new FileOperationStore({
    directory,
    now: () => '2026-08-11T08:41:00.000Z'
  });
  const recovery = restartedStore.reconcileInterrupted();
  assert.equal(recovery.interrupted, 1);
  const recovered = restartedStore.read(action.idempotencyKey);
  assert.equal(recovered.state, 'uncertain');
  assert.equal(recovered.errorCode, 'NEXUS_OPERATION_INTERRUPTED');
  assert.equal(recovered.reconciledAt, '2026-08-11T08:41:00.000Z');
  assert.equal(restartedStore.begin(action).acquired, false);
  assert.equal(restartedStore.begin(action).record.state, 'uncertain');
});

test('completed operations stay completed during recovery', () => {
  const directory = tempRoot('khaos-core-operation-complete-');
  const store = new FileOperationStore({ directory, now: () => '2026-08-11T08:50:00.000Z' });
  const action = {
    operationId: 'op-complete-1',
    action: 'game.server.save',
    correlationId: 'corr-complete-1',
    idempotencyKey: 'save:rag-01:complete-test'
  };
  store.begin(action);
  store.complete(action, { status: 'succeeded', error: null });
  const recovery = store.reconcileInterrupted();
  assert.equal(recovery.completed, 1);
  assert.equal(recovery.interrupted, 0);
  assert.equal(store.read(action.idempotencyKey).state, 'completed');
});

test('NexusCoreService exposes recovery attention and supports checksummed snapshots', () => {
  const dataDirectory = tempRoot('khaos-core-service-recovery-');
  const operationDirectory = path.join(dataDirectory, 'nexus-core', 'operations');
  const store = new FileOperationStore({ directory: operationDirectory, now: () => '2026-08-11T09:00:00.000Z' });
  store.begin({
    operationId: 'op-service-interrupted',
    action: 'hosted.server.power',
    correlationId: 'corr-service-interrupted',
    idempotencyKey: 'hosted:restart:service-test'
  });

  const core = new NexusCoreService({ dataDirectory });
  assert.equal(core.publicSnapshot().status, 'attention');
  assert.equal(core.publicSnapshot().recovery.interruptedOperations, 1);
  const saved = core.saveSnapshot('core-health', { ready: true });
  assert.equal(saved.sequence, core.journal.stats().lastSequence);
  assert.equal(core.loadSnapshot('core-health').state.ready, true);
});
