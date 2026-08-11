'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileEventJournal } = require('../shared/nexus-core/event-journal.cjs');

function tempJournal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-journal-'));
  return {
    dir,
    filePath: path.join(dir, 'events.ndjson'),
    journal: new FileEventJournal({ filePath: path.join(dir, 'events.ndjson'), fsync: false })
  };
}

function event(overrides = {}) {
  return {
    eventId: overrides.eventId || 'evt-001',
    type: overrides.type || 'server.status.changed',
    occurredAt: overrides.occurredAt || '2026-08-11T06:10:00Z',
    scope: overrides.scope || { kind: 'server', id: 'rag-01' },
    actor: overrides.actor || { kind: 'system', id: 'nexus-core' },
    source: overrides.source || { kind: 'worker', id: 'ark-adapter' },
    correlationId: overrides.correlationId || 'corr-001',
    causationId: overrides.causationId || null,
    payload: overrides.payload || { status: 'online' }
  };
}

test('event journal appends durable globally and per-scope ordered records', () => {
  const { journal, filePath } = tempJournal();
  const first = journal.append(event());
  const second = journal.append(event({
    eventId: 'evt-002',
    scope: { kind: 'server', id: 'astra-01' },
    correlationId: 'corr-002'
  }));
  const third = journal.append(event({
    eventId: 'evt-003',
    occurredAt: '2026-08-11T06:11:00Z',
    correlationId: 'corr-003',
    payload: { status: 'restarting' }
  }));

  assert.equal(first.record.sequence, 1);
  assert.equal(first.record.scopeSequence, 1);
  assert.equal(second.record.sequence, 2);
  assert.equal(second.record.scopeSequence, 1);
  assert.equal(third.record.sequence, 3);
  assert.equal(third.record.scopeSequence, 2);
  assert.equal(fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).length, 3);

  const reloaded = new FileEventJournal({ filePath, fsync: false });
  assert.deepEqual(reloaded.stats(), {
    journalVersion: 1,
    records: 3,
    scopes: 2,
    lastSequence: 3
  });
});

test('event journal treats an identical event ID as idempotent but rejects conflicting reuse', () => {
  const { journal } = tempJournal();
  const original = event();
  const first = journal.append(original);
  const duplicate = journal.append(original);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record, first.record);
  assert.equal(journal.stats().records, 1);

  assert.throws(() => journal.append(event({ payload: { status: 'offline' } })), (error) => {
    assert.equal(error.code, 'NEXUS_EVENT_ID_CONFLICT');
    return true;
  });
});

test('event journal rejects common secret-bearing fields before persistence', () => {
  const { journal, filePath } = tempJournal();

  assert.throws(() => journal.append(event({
    payload: {
      server: 'rag-01',
      credentials: { rconPassword: 'do-not-write-this' }
    }
  })), (error) => {
    assert.equal(error.code, 'NEXUS_EVENT_JOURNAL_SECRET');
    return true;
  });

  assert.equal(fs.existsSync(filePath), false);
});

test('event journal filters correlation chains and replays deterministic projections', () => {
  const { journal } = tempJournal();
  journal.append(event({ eventId: 'evt-001', correlationId: 'corr-restart', payload: { delta: 1 } }));
  journal.append(event({ eventId: 'evt-002', occurredAt: '2026-08-11T06:11:00Z', correlationId: 'corr-other', payload: { delta: 100 } }));
  journal.append(event({ eventId: 'evt-003', occurredAt: '2026-08-11T06:12:00Z', correlationId: 'corr-restart', payload: { delta: 2 } }));

  const chain = journal.list({ correlationId: 'corr-restart' });
  assert.deepEqual(chain.map((record) => record.event.eventId), ['evt-001', 'evt-003']);

  const projected = journal.replay(
    (state, next) => ({ total: state.total + next.payload.delta, ids: [...state.ids, next.eventId] }),
    { total: 0, ids: [] },
    { correlationId: 'corr-restart' }
  );
  assert.deepEqual(projected, { total: 3, ids: ['evt-001', 'evt-003'] });
});

test('event journal fails closed on corrupt sequence gaps', () => {
  const { filePath } = tempJournal();
  const corruptRecord = {
    journalVersion: 1,
    sequence: 2,
    scopeSequence: 1,
    event: event()
  };
  fs.writeFileSync(filePath, `${JSON.stringify(corruptRecord)}\n`, 'utf8');

  const journal = new FileEventJournal({ filePath, fsync: false });
  assert.throws(() => journal.load(), (error) => {
    assert.equal(error.code, 'NEXUS_EVENT_JOURNAL_CORRUPT');
    return true;
  });
});
