'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ShieldStore } = require('../src/sentinel/shield-store.cjs');
const {
  actionId,
  caseButtons,
  casePayload,
  confirmationButtons,
  normalizeCaseId,
  parseActionId,
  parseConfirmId,
  reportRecommended
} = require('../src/sentinel/shield-review.cjs');
const { memberTimeoutMatchesShield, TIMEOUT_MATCH_TOLERANCE_MS } = require('../src/sentinel/shield-review-extension.cjs');

test('Shield case controls use bounded deterministic IDs', () => {
  assert.equal(normalizeCaseId('sec-0007'), 'SEC-0007');
  assert.equal(actionId('SEC-0007', 'safe'), 'shieldcase:SEC-0007:safe');
  assert.deepEqual(parseActionId('shieldcase:SEC-0007:timeout'), { kind: 'action', caseId: 'SEC-0007', action: 'timeout' });
  assert.equal(parseActionId('shieldcase:SEC-0007:delete-everything'), null);
});

test('kick and ban require a separate confirmation control', () => {
  const kick = confirmationButtons('SEC-0007', 'kick');
  const ban = confirmationButtons('SEC-0007', 'ban');
  assert.equal(kick.length, 1);
  assert.equal(ban.length, 1);
  assert.deepEqual(parseConfirmId(kick[0].components[0].custom_id), { kind: 'confirm', caseId: 'SEC-0007', action: 'kick' });
  assert.deepEqual(parseConfirmId(ban[0].components[0].custom_id), { kind: 'confirm', caseId: 'SEC-0007', action: 'ban' });
});

test('open case UI exposes review controls while closed cases expose none', () => {
  const open = { caseId: 'SEC-0001', userId: '900000000000000001', status: 'open', riskState: 'suspicious', score: 60, reasons: [], evidence: [], actions: [], controls: {} };
  assert.equal(caseButtons(open).length, 2);
  assert.match(casePayload(open).content, /SEC-0001/);
  assert.equal(caseButtons({ ...open, status: 'closed' }).length, 0);
});

test('Discord report recommendation is a marker, not a claim that Sentinel filed a report', () => {
  const record = { caseId: 'SEC-0002', userId: '900000000000000002', status: 'open', controls: { reportRecommended: true }, actions: [] };
  assert.equal(reportRecommended(record), true);
  assert.match(casePayload(record).content, /Discord report recommended/);
});

test('Shield store persists structured containment ownership for safe release decisions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-shield-review-'));
  try {
    const store = new ShieldStore(root);
    const created = store.upsertCase('900000000000000010', { state: 'quarantined', score: 95 }, { source: 'test' }, 1000).record;
    store.setCaseControls(created.caseId, {
      quarantineRoleApplied: true,
      shieldTimeoutUntil: '2030-01-01T00:00:00.000Z',
      reportRecommended: true,
      escalated: true
    }, 2000);
    const persisted = store.getCase(created.caseId);
    assert.equal(persisted.controls.quarantineRoleApplied, true);
    assert.equal(persisted.controls.shieldTimeoutUntil, '2030-01-01T00:00:00.000Z');
    assert.equal(persisted.controls.reportRecommended, true);
    assert.equal(persisted.controls.escalated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safe release only clears a timeout that still matches the Shield-owned expiry', () => {
  const now = Date.now();
  const expected = now + 60 * 60_000;
  const record = { controls: { shieldTimeoutUntil: new Date(expected).toISOString() } };
  assert.equal(memberTimeoutMatchesShield({ communicationDisabledUntilTimestamp: expected + TIMEOUT_MATCH_TOLERANCE_MS - 1 }, record, now), true);
  assert.equal(memberTimeoutMatchesShield({ communicationDisabledUntilTimestamp: expected + 10 * 60_000 }, record, now), false);
});
