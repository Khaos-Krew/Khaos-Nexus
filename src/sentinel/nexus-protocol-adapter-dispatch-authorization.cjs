'use strict';

const crypto = require('node:crypto');
const {
  assertAdapterDispatchProposal
} = require('./nexus-protocol-adapter-dispatch-proposal.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function requireSecret(secret) {
  const value = String(secret || '');
  if (Buffer.byteLength(value, 'utf8') < 32) throw new Error('Protocol adapter dispatch signing secret must be at least 32 bytes');
  return value;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', requireSecret(secret)).update(JSON.stringify(canonical(payload))).digest('hex');
}

function issueAdapterDispatchAuthorization(proposal, admission, commandContract, secret, options = {}) {
  assertAdapterDispatchProposal(proposal, admission, commandContract);
  const issuedAt = Number(options.issuedAt ?? Date.now());
  const ttlMs = Number(options.ttlMs ?? 60_000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt < Number(proposal.preparedAt)
    || issuedAt > Number(proposal.expiresAt) || !Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000) {
    throw new Error('Invalid Protocol adapter dispatch authorization window');
  }
  const expiresAt = Math.min(issuedAt + ttlMs, Number(proposal.expiresAt));
  if (expiresAt <= issuedAt) throw new Error('Protocol adapter dispatch authorization has no usable lifetime');

  const payload = {
    version: 1,
    kind: 'protocol-adapter-dispatch-authorization',
    protocolId: proposal.protocolId,
    serverId: proposal.serverId,
    actionId: proposal.actionId,
    actionIndex: proposal.actionIndex,
    adapter: proposal.adapter,
    operation: proposal.operation,
    attemptId: proposal.attemptId,
    proposalDigest: String(proposal.proposalDigest).toLowerCase(),
    permitDigest: String(proposal.permitDigest).toLowerCase(),
    commandDigest: String(proposal.commandDigest).toLowerCase(),
    idempotencyKeyDigest: proposal.idempotencyKeyDigest ?? null,
    issuedAt,
    expiresAt,
    singleUseRequired: true,
    requiresReceiptPersistence: true,
    requiresPostDispatchOutcomeCapture: true,
    authorizesAdapterDispatch: true,
    authorizesRetry: false,
    executesCommand: false,
    persistsReceipt: false,
    mutatesServerConfiguration: false
  };
  return Object.freeze({ ...payload, signatureAlgorithm: 'hmac-sha256', authorizationSignature: sign(payload, secret) });
}

function verifyAdapterDispatchAuthorization(authorization, proposal, admission, commandContract, secret, options = {}) {
  assertAdapterDispatchProposal(proposal, admission, commandContract);
  if (!authorization || Number(authorization.version) !== 1 || authorization.kind !== 'protocol-adapter-dispatch-authorization'
    || authorization.singleUseRequired !== true || authorization.requiresReceiptPersistence !== true
    || authorization.requiresPostDispatchOutcomeCapture !== true || authorization.authorizesAdapterDispatch !== true
    || authorization.authorizesRetry !== false || authorization.executesCommand !== false
    || authorization.persistsReceipt !== false || authorization.mutatesServerConfiguration !== false
    || authorization.signatureAlgorithm !== 'hmac-sha256'
    || !/^[a-f0-9]{64}$/.test(String(authorization.authorizationSignature || '').toLowerCase())) {
    throw new Error('Invalid Protocol adapter dispatch authorization');
  }
  const { authorizationSignature, signatureAlgorithm, ...payload } = authorization;
  const expectedSignature = Buffer.from(sign(payload, secret), 'hex');
  const actualSignature = Buffer.from(String(authorizationSignature).toLowerCase(), 'hex');
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    throw new Error('Protocol adapter dispatch authorization signature mismatch');
  }
  const fields = ['protocolId', 'serverId', 'actionId', 'actionIndex', 'adapter', 'operation', 'attemptId', 'proposalDigest', 'permitDigest', 'commandDigest'];
  for (const field of fields) {
    if (String(authorization[field]) !== String(proposal[field])) {
      throw new Error('Protocol adapter dispatch authorization no longer matches the approved proposal');
    }
  }
  if ((authorization.idempotencyKeyDigest ?? null) !== (proposal.idempotencyKeyDigest ?? null)) {
    throw new Error('Protocol adapter dispatch authorization idempotency binding changed');
  }
  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now < Number(authorization.issuedAt) || now > Number(authorization.expiresAt)
    || Number(authorization.expiresAt) > Number(proposal.expiresAt)) {
    throw new Error('Protocol adapter dispatch authorization is stale or outside its proposal window');
  }
  return true;
}

module.exports = {
  issueAdapterDispatchAuthorization,
  verifyAdapterDispatchAuthorization
};
