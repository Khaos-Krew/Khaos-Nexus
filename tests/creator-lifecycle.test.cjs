'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requestMoreInformation,
  revokeCreatorState
} = require('../src/sentinel/creator-lifecycle-extension.cjs');

function fakeStore() {
  const applications = {
    'CCR-0001': { id: 'CCR-0001', userId: '111111111111111111', status: 'pending', reviewReason: '' },
    'CCR-0002': { id: 'CCR-0002', userId: '222222222222222222', status: 'approved', reviewReason: 'Approved.' }
  };
  const profiles = {
    '222222222222222222': { userId: '222222222222222222', applicationId: 'CCR-0002', platforms: ['twitch'] }
  };
  return {
    applications,
    profiles,
    getCreatorApplication(id) { return applications[id] || null; },
    setCreatorApplication(id, value) { applications[id] = value; return value; },
    getCreatorProfile(id) { return profiles[id] || null; },
    removeCreatorProfile(id) { const value = profiles[id] || null; delete profiles[id]; return value; }
  };
}

test('request more information keeps application pending and records audit fields', () => {
  const store = fakeStore();
  const result = requestMoreInformation(store, 'ccr-0001', '999999999999999999', 'Please send your channel schedule.', '2026-08-25T16:00:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(result.application.status, 'pending');
  assert.equal(result.application.informationRequestedBy, '999999999999999999');
  assert.match(result.application.reviewReason, /More information requested/i);
});

test('request more information refuses already decided applications', () => {
  const store = fakeStore();
  const result = requestMoreInformation(store, 'CCR-0002', '999999999999999999', 'extra info');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-pending');
});

test('revoking a creator removes active profile and records revocation on application', () => {
  const store = fakeStore();
  const result = revokeCreatorState(store, '222222222222222222', '999999999999999999', 'Program standards violation.', '2026-08-25T16:05:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(store.getCreatorProfile('222222222222222222'), null);
  assert.equal(store.getCreatorApplication('CCR-0002').status, 'denied');
  assert.equal(store.getCreatorApplication('CCR-0002').revokedBy, '999999999999999999');
  assert.match(store.getCreatorApplication('CCR-0002').reviewReason, /Creator status revoked/i);
});
