'use strict';

const crypto = require('node:crypto');
const { verifyDiscordStateToken } = require('./nexus-protocol-discord-state-token.cjs');

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function stableDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createDarkZoneConfirmationPermit(plan, token, options = {}) {
  if (!plan || plan.kind !== 'mutation-plan') throw new Error('Invalid Dark Zone mutation plan');
  if (plan.blocked) throw new Error('Blocked Dark Zone mutation cannot receive confirmation authority');
  if (plan.requiresConfirmation !== true) throw new Error('Dark Zone mutation plan does not require confirmation');

  const action = cleanId(plan.action, 'Dark Zone action');
  const accountId = cleanId(plan.accountId, 'account id');
  const expectedRevision = Number(plan.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('Invalid Dark Zone expected revision');
  }
  if (!plan.current || !plan.next) throw new Error('Dark Zone mutation plan is incomplete');

  const currentState = cleanId(plan.current.state, 'current Dark Zone state');
  const currentEnrollmentMode = cleanId(plan.current.enrollmentMode || 'solo', 'current enrollment mode');

  const claims = verifyDiscordStateToken(token, {
    action,
    accountId,
    revision: expectedRevision,
    darkZoneState: currentState,
    enrollmentMode: currentEnrollmentMode
  }, {
    secret: options.secret,
    now: options.now
  });

  const planBinding = {
    action,
    accountId,
    expectedRevision,
    currentState,
    currentEnrollmentMode,
    nextState: cleanId(plan.next.state, 'next Dark Zone state'),
    nextEnrollmentMode: cleanId(plan.next.enrollmentMode || currentEnrollmentMode, 'next enrollment mode')
  };

  return Object.freeze({
    version: 1,
    kind: 'dark-zone-confirmation-permit',
    action,
    accountId,
    expectedRevision,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    stateTokenNonce: claims.nonce,
    planDigest: stableDigest(planBinding),
    requiresAtomicRevisionCheck: true,
    authorizesOnlyBoundPlan: true,
    mutatesPersistence: false,
    executesServerCommand: false,
    readOnly: true
  });
}

function verifyDarkZoneConfirmationPermit(permit, plan, options = {}) {
  if (!permit || permit.kind !== 'dark-zone-confirmation-permit' || permit.version !== 1) {
    throw new Error('Invalid Dark Zone confirmation permit');
  }
  if (!plan || plan.kind !== 'mutation-plan' || plan.blocked || plan.requiresConfirmation !== true) {
    throw new Error('Invalid Dark Zone mutation plan');
  }

  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid Dark Zone confirmation timestamp');
  if (!Number.isSafeInteger(permit.expiresAt) || now > permit.expiresAt) {
    throw new Error('Dark Zone confirmation permit expired');
  }

  const binding = {
    action: cleanId(plan.action, 'Dark Zone action'),
    accountId: cleanId(plan.accountId, 'account id'),
    expectedRevision: Number(plan.expectedRevision),
    currentState: cleanId(plan.current?.state, 'current Dark Zone state'),
    currentEnrollmentMode: cleanId(plan.current?.enrollmentMode || 'solo', 'current enrollment mode'),
    nextState: cleanId(plan.next?.state, 'next Dark Zone state'),
    nextEnrollmentMode: cleanId(plan.next?.enrollmentMode || plan.current?.enrollmentMode || 'solo', 'next enrollment mode')
  };

  if (permit.action !== binding.action || permit.accountId !== binding.accountId
    || permit.expectedRevision !== binding.expectedRevision || permit.planDigest !== stableDigest(binding)) {
    throw new Error('Dark Zone confirmation permit does not match mutation plan');
  }
  if (permit.requiresAtomicRevisionCheck !== true || permit.authorizesOnlyBoundPlan !== true
    || permit.mutatesPersistence !== false || permit.executesServerCommand !== false || permit.readOnly !== true) {
    throw new Error('Unsafe Dark Zone confirmation permit authority');
  }

  return true;
}

module.exports = {
  createDarkZoneConfirmationPermit,
  verifyDarkZoneConfirmationPermit
};
