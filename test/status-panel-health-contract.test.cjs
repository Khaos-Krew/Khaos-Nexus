'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderStatusPanel } = require('../shared/status-panels.cjs');

function statusValue(status) {
  const payload = renderStatusPanel({ id: 'health-contract' }, {
    status,
    serverName: 'Nexus Test',
    game: 'generic',
    connectionLabel: 'Nexus Adapter',
    checkedAt: '2026-08-27T05:15:00.000Z',
  }, { includeButtons: false });
  return payload.embeds[0].fields.find((field) => field.name === 'Status').value;
}

test('legacy status panel renderer uses the exact Sentinel public health contract', () => {
  assert.equal(statusValue('online'), '🟢 Online');
  assert.equal(statusValue('offline'), '🔴 Offline');
  assert.equal(statusValue('maintenance'), '🟡 Maintenance');
});

test('legacy status panel renderer fails unknown/degraded states closed to Offline', () => {
  assert.equal(statusValue('degraded'), '🔴 Offline');
  assert.equal(statusValue('partial'), '🔴 Offline');
  assert.equal(statusValue('unknown'), '🔴 Offline');
});
