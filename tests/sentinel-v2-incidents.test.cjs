'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { IncidentStore } = require('../src/sentinel-v2/incident-store.cjs');
const { DurableIncidentTracker } = require('../src/sentinel-v2/incidents.cjs');

test('Durable incident tracker restores open incidents after restart', async () => {
  const restored = {
    fingerprint: 'abc123',
    source: 'ark',
    code: 'config-path',
    subject: 'map2',
    message: 'config path rejected',
    severity: 'error',
    status: 'open',
    firstSeenAt: '2026-09-09T12:00:00.000Z',
    lastSeenAt: '2026-09-09T12:05:00.000Z',
    occurrences: 4,
    metadata: {},
  };
  const store = { enabled: true, async listOpen() { return [restored]; } };
  const tracker = new DurableIncidentTracker({ store });
  const open = await tracker.hydrate();
  assert.equal(open.length, 1);
  assert.equal(open[0].fingerprint, 'abc123');
  assert.equal(open[0].occurrences, 4);
});

test('Durable incident tracker persists repeated observations', async () => {
  const persisted = [];
  const store = {
    enabled: true,
    async listOpen() { return []; },
    async observe(incident) {
      persisted.push({ ...incident });
      return { ...incident };
    },
  };
  const tracker = new DurableIncidentTracker({ store });
  await tracker.hydrate();
  const input = { source: 'ark', code: 'config-path', subject: 'map2', message: 'config path rejected', severity: 'error' };
  const first = await tracker.observe(input);
  const second = await tracker.observe(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.incident.occurrences, 2);
  assert.equal(persisted.length, 2);
});

test('Durable incident tracker restores memory when recovery persistence fails', async () => {
  const store = {
    enabled: true,
    async listOpen() { return []; },
    async observe(incident) { return { ...incident }; },
    async recover() { throw new Error('database unavailable'); },
  };
  const tracker = new DurableIncidentTracker({ store });
  const observed = await tracker.observe({ source: 'ark', code: 'offline', subject: 'map1', message: 'server unavailable' });
  await assert.rejects(() => tracker.recover(observed.incident.fingerprint), /database unavailable/);
  assert.equal(tracker.listOpen().length, 1);
  assert.equal(tracker.listOpen()[0].status, 'open');
});

test('IncidentStore is safely disabled without a configured database', async () => {
  const store = new IncidentStore({ database: { enabled: false } });
  assert.equal(store.enabled, false);
  assert.deepEqual(await store.listOpen(), []);
});
