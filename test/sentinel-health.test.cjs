'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HEALTH_STATES,
  normalizeHealthState,
  deriveHealthState,
  healthTransition,
  healthLabel
} = require('../shared/sentinel-health.cjs');

test('public health normalizes to exactly Online, Offline, or Maintenance', () => {
  assert.equal(normalizeHealthState('online'), HEALTH_STATES.ONLINE);
  assert.equal(normalizeHealthState('recovered'), HEALTH_STATES.ONLINE);
  assert.equal(normalizeHealthState('restarting'), HEALTH_STATES.MAINTENANCE);
  assert.equal(normalizeHealthState('repairing'), HEALTH_STATES.MAINTENANCE);
  assert.equal(normalizeHealthState('degraded'), HEALTH_STATES.OFFLINE);
  assert.equal(normalizeHealthState('partial'), HEALTH_STATES.OFFLINE);
  assert.equal(normalizeHealthState('unknown'), HEALTH_STATES.OFFLINE);
});

test('recovery flow moves Offline to Maintenance while retries remain', () => {
  assert.equal(deriveHealthState({ reachable: false, recovering: true, retryCount: 0, retryLimit: 3 }), 'maintenance');
  assert.equal(deriveHealthState({ reachable: false, recovering: true, retryCount: 2, retryLimit: 3 }), 'maintenance');
});

test('successful recovery becomes Online and exhausted recovery returns Offline', () => {
  assert.equal(deriveHealthState({ reachable: true, recovering: true, retryCount: 1, retryLimit: 3 }), 'online');
  assert.equal(deriveHealthState({ reachable: false, recovering: true, retryCount: 3, retryLimit: 3 }), 'offline');
  assert.equal(deriveHealthState({ reachable: false, maintenance: true, retryCount: 5, retryLimit: 3 }), 'offline');
});

test('health transitions identify actual state changes', () => {
  const first = healthTransition('offline', 'recovering', '2026-08-27T00:00:00.000Z');
  assert.deepEqual(first, {
    previous: 'offline',
    next: 'maintenance',
    changed: true,
    time: '2026-08-27T00:00:00.000Z'
  });
  assert.equal(healthTransition('starting', 'maintenance').changed, false);
});

test('public labels use the approved Nexus indicators', () => {
  assert.equal(healthLabel('online'), '🟢 Online');
  assert.equal(healthLabel('offline'), '🔴 Offline');
  assert.equal(healthLabel('maintenance'), '🟡 Maintenance');
  assert.equal(healthLabel('maintenance', { uppercase: true, includeEmoji: false }), 'MAINTENANCE');
});
