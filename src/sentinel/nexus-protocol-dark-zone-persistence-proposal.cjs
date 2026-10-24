'use strict';

const crypto = require('node:crypto');
const {
  verifyDarkZoneConfirmationPermit
} = require('./nexus-protocol-dark-zone-confirmation.cjs');

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function createDarkZonePersistenceProposal(permit, plan, currentRevision, options = {}) {
  verifyDarkZoneConfirmationPermit(permit, plan, { now: options.now });

  const observedRevision = Number(currentRevision);
  if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
    throw new Error('Invalid Dark Zone observed store revision');
  }
  if (observedRevision !== permit.expectedRevision || observedRevision !== Number(plan.expectedRevision)) {
    throw new Error('Dark Zone store revision changed before persistence proposal');
  }

  const payload = {
    version: 1,
    kind: 'dark-zone-persistence-proposal',
    action: cleanId(plan.action, 'Dark Zone action'),
    accountId: cleanId(plan.accountId, 'account id'),
    expectedRevision: observedRevision,
    nextRevision: observedRevision + 1,
    currentState: cleanId(plan.current?.state, 'current Dark Zone state'),
    currentEnrollmentMode: cleanId(plan.current?.enrollmentMode || 'solo', 'current enrollment mode'),
    nextState: cleanId(plan.next?.state, 'next Dark Zone state'),
    nextEnrollmentMode: cleanId(plan.next?.enrollmentMode || plan.current?.enrollmentMode || 'solo', 'next enrollment mode'),
    confirmationPlanDigest: String(permit.planDigest || '').toLowerCase(),
    stateTokenNonce: cleanId(permit.stateTokenNonce, 'state token nonce'),
    requiresAtomicCompareAndPersist: true,
    requiresAuditRecord: true,
    authorizesOnlyBoundTransition: true,
    persistsState: false,
    mutatesPersistence: false,
    executesServerCommand: false,
    readOnly: true
  };

  return Object.freeze({
    ...payload,
    persistenceProposalDigest: digest(payload)
  });
}

function verifyDarkZonePersistenceProposal(proposal, permit, plan, currentRevision, options = {}) {
  if (!proposal || proposal.kind !== 'dark-zone-persistence-proposal' || proposal.version !== 1
    || proposal.requiresAtomicCompareAndPersist !== true
    || proposal.requiresAuditRecord !== true
    || proposal.authorizesOnlyBoundTransition !== true
    || proposal.persistsState !== false
    || proposal.mutatesPersistence !== false
    || proposal.executesServerCommand !== false
    || proposal.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(proposal.persistenceProposalDigest || '').toLowerCase())) {
    throw new Error('Invalid Dark Zone persistence proposal');
  }

  const expected = createDarkZonePersistenceProposal(permit, plan, currentRevision, options);
  if (JSON.stringify(canonical(proposal)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Dark Zone persistence proposal no longer matches confirmed transition');
  }
  return true;
}

module.exports = {
  createDarkZonePersistenceProposal,
  verifyDarkZonePersistenceProposal
};
