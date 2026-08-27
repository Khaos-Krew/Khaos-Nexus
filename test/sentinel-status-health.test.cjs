'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStatusSnapshot, renderStatusPanel } = require('../shared/status-panels.cjs');

test('legacy degraded snapshots fail closed to Offline', () => {
  const snapshot = normalizeStatusSnapshot({ status: 'degraded', serverName: 'Nexus Server' });
  assert.equal(snapshot.status, 'offline');
  const payload = renderStatusPanel({ id: 'status' }, snapshot, { includeButtons: false });
  assert.equal(payload.embeds[0].fields.find((field) => field.name === 'Status').value, 'OFFLINE');
  assert.doesNotMatch(JSON.stringify(payload), /DEGRADED/);
});

test('recovery snapshots render the Maintenance public state', () => {
  const snapshot = normalizeStatusSnapshot({ status: 'recovering', serverName: 'Nexus Server' });
  assert.equal(snapshot.status, 'maintenance');
  const payload = renderStatusPanel({ id: 'status' }, snapshot, { includeButtons: false });
  assert.equal(payload.embeds[0].fields.find((field) => field.name === 'Status').value, 'MAINTENANCE');
});
