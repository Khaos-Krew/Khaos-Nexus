'use strict';

const crypto = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function assertPreparation(preparation) {
  if (!preparation || Number(preparation.version) !== 1 || preparation.kind !== 'protocol-adapter-fresh-attempt-preparation'
    || preparation.requiresFreshPreflight !== true || preparation.requiresFreshAdapterPermit !== true
    || preparation.requiresNewIdempotencyEvaluation !== true || preparation.reusesPriorPermit !== false
    || preparation.reusesPriorPreflight !== false || preparation.grantsRetryAuthority !== false
    || preparation.executesCommand !== false || preparation.persistsReceipt !== false
    || preparation.mutatesServerConfiguration !== false || preparation.readOnly !== true
    || !/^[a-f0-9]{64}$/.test(String(preparation.preparationDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol fresh-attempt preparation for admission');
  }
}

function buildAdapterFreshAttemptAdmission(preparation, preflight, permit, options = {}) {
  assertPreparation(preparation);
  if (!preflight || Number(preflight.version) !== 1 || preflight.ready !== true || preflight.executesCommands !== false
    || !Array.isArray(preflight.actions) || preflight.blockers?.length !== 0) {
    throw new Error('Invalid fresh Protocol executor preflight for admission');
  }
  if (!permit || Number(permit.version) !== 1 || permit.allowed !== true
    || permit.requiresCommandRevalidation !== true || permit.requiresReceiptPersistence !== true
    || permit.executesCommand !== false || permit.mutatesServerConfiguration !== false
    || !/^[a-f0-9]{64}$/.test(String(permit.permitDigest || '').toLowerCase())) {
    throw new Error('Invalid fresh Protocol adapter permit for admission');
  }

  const action = preflight.actions[Number(permit.actionIndex)];
  if (!action || action.allowed !== true || action.actionId !== permit.actionId || action.index !== permit.actionIndex) {
    throw new Error('Fresh Protocol permit is not bound to the admitted preflight action');
  }
  if (preparation.protocolId !== preflight.protocolId || preparation.protocolId !== permit.protocolId
    || preparation.serverId !== preflight.serverId || preparation.serverId !== permit.serverId
    || preparation.actionId !== permit.actionId || preparation.adapter !== permit.adapter
    || action.plugin !== permit.adapter) {
    throw new Error('Fresh Protocol attempt inputs do not describe the same adapter action');
  }
  if (Number(preflight.envelopeCreatedAt) < Number(preparation.preparedAt)
    || Number(permit.issuedAt) < Number(preparation.preparedAt)) {
    throw new Error('Protocol fresh attempt reused stale preflight or permit state');
  }
  if (!['new_action', 'retry_failed_action'].includes(String(permit.attemptReason))) {
    throw new Error('Protocol fresh attempt permit has an invalid attempt classification');
  }

  const admittedAt = Number(options.now ?? permit.issuedAt);
  if (!Number.isFinite(admittedAt) || admittedAt < Number(permit.issuedAt) || admittedAt > Number(permit.expiresAt)) {
    throw new Error('Invalid Protocol fresh attempt admission time');
  }

  const payload = {
    version: 1,
    kind: 'protocol-adapter-fresh-attempt-admission',
    preparationDigest: String(preparation.preparationDigest).toLowerCase(),
    protocolId: preparation.protocolId,
    serverId: preparation.serverId,
    actionId: preparation.actionId,
    adapter: preparation.adapter,
    attemptId: preparation.attemptId,
    permitDigest: String(permit.permitDigest).toLowerCase(),
    attemptReason: permit.attemptReason,
    admittedAt,
    requiresFreshCommandContract: true,
    requiresReceiptPersistence: true,
    reusesPriorPermit: false,
    reusesPriorPreflight: false,
    grantsRetryAuthority: false,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false,
    readOnly: true
  };
  return Object.freeze({ ...payload, admissionDigest: digest(payload) });
}

function assertAdapterFreshAttemptAdmission(admission, preparation, preflight, permit) {
  if (!admission || Number(admission.version) !== 1 || admission.kind !== 'protocol-adapter-fresh-attempt-admission'
    || admission.requiresFreshCommandContract !== true || admission.requiresReceiptPersistence !== true
    || admission.reusesPriorPermit !== false || admission.reusesPriorPreflight !== false
    || admission.grantsRetryAuthority !== false || admission.executesCommand !== false
    || admission.persistsReceipt !== false || admission.mutatesServerConfiguration !== false
    || admission.readOnly !== true || !/^[a-f0-9]{64}$/.test(String(admission.admissionDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol fresh attempt admission');
  }
  const expected = buildAdapterFreshAttemptAdmission(preparation, preflight, permit, { now: admission.admittedAt });
  if (JSON.stringify(canonical(admission)) !== JSON.stringify(canonical(expected))) {
    throw new Error('Protocol fresh attempt admission no longer matches fresh executor state');
  }
  return true;
}

module.exports = { buildAdapterFreshAttemptAdmission, assertAdapterFreshAttemptAdmission };
