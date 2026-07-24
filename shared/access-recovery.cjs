'use strict';

const RECOVERY_PHRASE = 'UNLOCK KHAOS NEXUS';

function normalizeRecoveryPhrase(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isRecoveryPhraseValid(value) {
  return normalizeRecoveryPhrase(value) === RECOVERY_PHRASE;
}

function isLockedAccess(access) {
  return Boolean(access?.enabled && !access?.canView && access?.role === 'locked');
}

module.exports = {
  RECOVERY_PHRASE,
  normalizeRecoveryPhrase,
  isRecoveryPhraseValid,
  isLockedAccess
};
