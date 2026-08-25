'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MINIMUM_LEVEL,
  minimumCreatorLevel,
  evaluateCreatorEligibility,
  eligibilityMessage
} = require('../src/sentinel/creator-level-gate.cjs');

test('creator application level gate defaults to level 10 and is configurable', () => {
  assert.equal(DEFAULT_MINIMUM_LEVEL, 10);
  assert.equal(minimumCreatorLevel({}, {}), 10);
  assert.equal(minimumCreatorLevel({}, { NEXUS_CREATOR_MIN_LEVEL: '15' }), 15);
  assert.equal(minimumCreatorLevel({ discord: { creatorProgram: { minimumLevel: 7 } } }, {}), 7);
});

test('creator eligibility denies below threshold and accepts exact threshold', () => {
  const denied = evaluateCreatorEligibility({ ok: true, profile: { level: 9 } }, 10);
  assert.equal(denied.eligible, false);
  assert.equal(denied.verifiable, true);
  assert.equal(denied.currentLevel, 9);
  assert.match(eligibilityMessage(denied), /Level 10/);

  const accepted = evaluateCreatorEligibility({ ok: true, profile: { level: 10 } }, 10);
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.verifiable, true);
  assert.equal(accepted.reason, 'eligible');
});

test('creator eligibility fails closed when Community XP cannot be verified', () => {
  const result = evaluateCreatorEligibility({ ok: false }, 10);
  assert.equal(result.eligible, false);
  assert.equal(result.verifiable, false);
  assert.equal(result.reason, 'level-unavailable');
  assert.match(eligibilityMessage(result), /could not verify/i);
});

test('creator level configuration is bounded and cannot disable the eligibility requirement', () => {
  assert.equal(minimumCreatorLevel({ discord: { creatorProgram: { minimumLevel: 0 } } }, {}), 1);
  assert.equal(minimumCreatorLevel({ discord: { creatorProgram: { minimumLevel: -20 } } }, {}), 1);
  assert.equal(minimumCreatorLevel({ discord: { creatorProgram: { minimumLevel: 5000 } } }, {}), 1000);
  assert.equal(minimumCreatorLevel({ discord: { creatorProgram: { minimumLevel: 'not-a-level' } } }, {}), DEFAULT_MINIMUM_LEVEL);
});
