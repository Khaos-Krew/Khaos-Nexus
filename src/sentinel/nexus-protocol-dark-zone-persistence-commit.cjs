'use strict';

const crypto = require('node:crypto');
const { verifyDarkZonePersistenceProposal } = require('./nexus-protocol-dark-zone-persistence-proposal.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function verifyDarkZonePersistenceCommit(proposal, permit, plan, before, after, options = {}) {
  const beforeRevision = Number(before?.revision);
  const afterRevision = Number(after?.revision);
  verifyDarkZonePersistenceProposal(proposal, permit, plan, beforeRevision, options);

  if (!Number.isSafeInteger(beforeRevision) || !Number.isSafeInteger(afterRevision)
    || beforeRevision < 0 || afterRevision < 0) {
    throw new Error('Invalid Dark Zone persistence commit revisions');
  }
  if (beforeRevision !== proposal.expectedRevision || afterRevision !== proposal.nextRevision) {
    throw new Error('Dark Zone persistence commit revision mismatch');
  }

  const beforeAccountId = cleanId(before?.accountId, 'Dark Zone before account id');
  const afterAccountId = cleanId(after?.accountId, 'Dark Zone after account id');
  if (beforeAccountId !== proposal.accountId || afterAccountId !== proposal.accountId) {
    throw new Error('Dark Zone persistence commit account mismatch');
  }

  const beforeState = cleanId(before?.state, 'Dark Zone before state');
  const afterState = cleanId(after?.state, 'Dark Zone after state');
  const beforeMode = cleanId(before?.enrollmentMode || 'solo', 'Dark Zone before enrollment mode');
  const afterMode = cleanId(after?.enrollmentMode || 'solo', 'Dark Zone after enrollment mode');

  if (beforeState !== proposal.currentState || beforeMode !== proposal.currentEnrollmentMode) {
    throw new Error('Dark Zone persistence commit does not start from confirmed state');
  }
  if (afterState !== proposal.nextState || afterMode !== proposal.nextEnrollmentMode) {
    throw new Error('Dark Zone persistence commit does not match confirmed next state');
  }

  const committedAt = Number(options.committedAt ?? Date.now());
  if (!Number.isSafeInteger(committedAt) || committedAt <= 0) {
    throw new Error('Invalid Dark Zone persistence commit timestamp');
  }

  const payload = {
    version: 1,
    kind: 'dark-zone-persistence-commit-verification',
    accountId: proposal.accountId,
    action: proposal.action,
    persistenceProposalDigest: proposal.persistenceProposalDigest,
    beforeRevision,
    afterRevision,
    beforeState,
    afterState,
    beforeEnrollmentMode: beforeMode,
    afterEnrollmentMode: afterMode,
    committedAt,
    durableTransitionVerified: true,
    requiresAuditRecord: true,
    grantsRetryAuthority: false,
    executesServerCommand: false,
    mutatesServerConfiguration: false,
    mutatesPersistence: false,
    readOnly: true
  };

  return Object.freeze({ ...payload, persistenceCommitDigest: digest(payload) });
}

function assertDarkZonePersistenceCommit(verification, proposal, permit, plan, before, after, options = {}) {
  if (!verification || Number(verification.version) !== 1
    || verification.kind !== 'dark-zone-persistence-commit-verification'
    || verification.durableTransitionVerified !== true
    || verification.requiresAuditRecord !== true
    || verification.grantsRetryAuthority !== false
    || verification.executesServerCommand !== false
    || verification.mutatesServerConfiguration !== false
    || verification.mutatesPersistence !== false
    || verification.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(verification.persistenceCommitDigest || '').toLowerCase())) {
    throw new Error('Invalid Dark Zone persistence commit verification');
  }

  const expected = verifyDarkZonePersistenceCommit(proposal, permit, plan, before, after, {
    ...options,
    committedAt: verification.committedAt
  });
  if (JSON.stringify(canonical(verification)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Dark Zone persistence commit verification no longer matches durable transition');
  }
  return true;
}

module.exports = {
  verifyDarkZonePersistenceCommit,
  assertDarkZonePersistenceCommit
};
