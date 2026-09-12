'use strict';

const crypto = require('node:crypto');
const { createNexusEconomyPurchaseWorkerIntake } = require('./nexus-economy-purchase-worker-intake.cjs');

const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const HEX_64 = /^[a-f0-9]{64}$/;

function reject(reason, actionId = null) {
  return Object.freeze({
    ok: false,
    claimReady: false,
    claimPermitted: false,
    executionPermitted: false,
    reason,
    actionId,
    claimRequest: null
  });
}

function digestCanonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function validateTicket(ticket) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) return 'invalid-worker-ticket';
  for (const key of ['ticketId', 'intakeDigest', 'actionId', 'idempotencyKey', 'correlationId', 'subject']) {
    if (typeof ticket[key] !== 'string') return `invalid-ticket-${key}`;
  }
  if (!SAFE_ID.test(ticket.ticketId) || !SAFE_ID.test(ticket.actionId) || !SAFE_ID.test(ticket.idempotencyKey) || !SAFE_ID.test(ticket.correlationId) || !SAFE_ID.test(ticket.subject)) {
    return 'invalid-worker-ticket-identity';
  }
  if (!HEX_64.test(ticket.intakeDigest)) return 'invalid-ticket-intake-digest';
  if (ticket.claimPermitted !== false || ticket.executionPermitted !== false) return 'unsafe-worker-ticket-flags';
  return null;
}

function createNexusEconomyPurchaseWorkerClaimRequest() {
  const intake = createNexusEconomyPurchaseWorkerIntake();

  return Object.freeze({
    prepare(action, suppliedTicket) {
      const regenerated = intake.prepare(action);
      if (!regenerated.ok) return reject(regenerated.reason, regenerated.actionId);

      const ticketError = validateTicket(suppliedTicket);
      if (ticketError) return reject(ticketError, regenerated.actionId);

      const expected = regenerated.ticket;
      const identityKeys = ['ticketId', 'intakeDigest', 'actionId', 'idempotencyKey', 'correlationId', 'subject', 'recordId', 'requestId', 'orderId', 'planId'];
      for (const key of identityKeys) {
        if (suppliedTicket[key] !== expected[key]) return reject(`worker-ticket-${key}-mismatch`, regenerated.actionId);
      }

      const canonical = {
        schemaVersion: 1,
        actionId: expected.actionId,
        ticketId: expected.ticketId,
        intakeDigest: expected.intakeDigest,
        expectedStatus: 'requested',
        nextStatus: 'running',
        idempotencyKey: expected.idempotencyKey,
        correlationId: expected.correlationId,
        subject: expected.subject
      };
      const claimDigest = digestCanonical(canonical);

      const claimRequest = Object.freeze({
        ...canonical,
        claimId: `claim_${claimDigest.slice(0, 24)}`,
        claimDigest,
        compareAndSet: Object.freeze({
          expectedStatus: 'requested',
          nextStatus: 'running'
        }),
        claimPermitted: false,
        executionPermitted: false
      });

      return Object.freeze({
        ok: true,
        claimReady: true,
        claimPermitted: false,
        executionPermitted: false,
        reason: 'purchase-worker-claim-request-ready',
        actionId: expected.actionId,
        claimRequest
      });
    }
  });
}

module.exports = {
  createNexusEconomyPurchaseWorkerClaimRequest,
  validateTicket
};