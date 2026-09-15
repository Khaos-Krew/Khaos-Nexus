'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MemberVerificationStore } = require('../src/sentinel/member-verification-store.cjs');

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'o9-mv-'));
  return { root, store: new MemberVerificationStore({ root }) };
}

const ACTOR = '111111111111111111';
const TARGET = '222222222222222222';

test('ensurePending creates pending and never auto-verifies', () => {
  const { store } = tempStore();
  const row = store.ensurePending(TARGET, { actorId: ACTOR });
  assert.equal(row.state, 'pending');
  assert.equal(store.get(TARGET).state, 'pending');
  assert.equal(store.grant(TARGET, { actorId: ACTOR, reason: 'ok' }).ok, true);
  assert.equal(store.get(TARGET).state, 'verified');
});

test('grant only from pending; rejected cannot go direct to verified', () => {
  const { store } = tempStore();
  store.ensurePending(TARGET);
  store.reject(TARGET, { actorId: ACTOR, reason: 'nope' });
  const denied = store.grant(TARGET, { actorId: ACTOR, reason: 'try' });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'rejected-must-reopen');
  const reopened = store.reopen(TARGET, { actorId: ACTOR, reason: 'appeal' });
  assert.equal(reopened.ok, true);
  assert.equal(store.get(TARGET).state, 'pending');
  assert.equal(store.grant(TARGET, { actorId: ACTOR, reason: 'ok' }).ok, true);
});

test('reject and revoke require reason and write audit prior→new', () => {
  const { store, root } = tempStore();
  store.ensurePending(TARGET);
  assert.throws(() => store.reject(TARGET, { actorId: ACTOR, reason: '' }));
  store.reject(TARGET, { actorId: ACTOR, reason: 'deny' });
  store.reopen(TARGET, { actorId: ACTOR });
  store.grant(TARGET, { actorId: ACTOR, reason: 'ok' });
  assert.throws(() => store.revoke(TARGET, { actorId: ACTOR, reason: '' }));
  const revoked = store.revoke(TARGET, { actorId: ACTOR, reason: 'abuse' });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.priorState, 'verified');
  assert.equal(revoked.newState, 'rejected');
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'member-verifications.json'), 'utf8'));
  assert.ok(raw.audit.some((e) => e.action === 'member-verify-revoke' && e.priorState === 'verified' && e.newState === 'rejected'));
  assert.ok(raw.audit.every((e) => e.actorId && e.targetId && e.at));
});
