'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECOVERY_PHRASE,
  normalizeRecoveryPhrase,
  isRecoveryPhraseValid,
  isLockedAccess
} = require('../shared/access-recovery.cjs');

test('local recovery requires the exact normalized confirmation phrase', () => {
  assert.equal(RECOVERY_PHRASE, 'UNLOCK KHAOS NEXUS');
  assert.equal(normalizeRecoveryPhrase('  unlock   khaos nexus  '), RECOVERY_PHRASE);
  assert.equal(isRecoveryPhraseValid('unlock khaos nexus'), true);
  assert.equal(isRecoveryPhraseValid('unlock nexus'), false);
  assert.equal(isRecoveryPhraseValid(''), false);
});

test('locked access requires enabled enforcement and no viewer permission', () => {
  assert.equal(isLockedAccess({ enabled: true, role: 'locked', canView: false }), true);
  assert.equal(isLockedAccess({ enabled: false, role: 'local-admin', canView: true }), false);
  assert.equal(isLockedAccess({ enabled: true, role: 'viewer', canView: true }), false);
  assert.equal(isLockedAccess(null), false);
});
