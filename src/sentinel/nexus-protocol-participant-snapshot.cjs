'use strict';

const crypto = require('node:crypto');

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function stablePayload(snapshot) {
  return JSON.stringify({
    version: snapshot.version,
    ledgerRevision: snapshot.ledgerRevision,
    runId: snapshot.runId,
    accountId: snapshot.accountId,
    activeMinutes: snapshot.activeMinutes,
    objectiveContribution: snapshot.objectiveContribution,
    killContribution: snapshot.killContribution,
    deaths: snapshot.deaths,
    completed: snapshot.completed,
    eligible: snapshot.eligible,
    score: snapshot.score,
    rawScore: snapshot.rawScore,
    processedEvents: snapshot.processedEvents,
    updatedAt: snapshot.updatedAt
  });
}

function createParticipantProgressSnapshot(participant, ledgerSnapshot) {
  if (!participant || !ledgerSnapshot || !Array.isArray(ledgerSnapshot.events)) {
    throw new Error('Protocol participant snapshot requires participant and ledger state');
  }
  const runId = cleanId(participant.runId, 'protocol run id');
  const accountId = cleanId(participant.accountId, 'account id');
  const ledgerRevision = Math.max(0, Math.floor(finiteNonNegative(ledgerSnapshot.revision, 'ledger revision')));
  const relatedEvents = ledgerSnapshot.events.filter((event) => event?.runId === runId && event?.accountId === accountId);
  const processedEvents = Math.floor(finiteNonNegative(participant.processedEvents, 'processed event count'));
  if (relatedEvents.length !== processedEvents) {
    throw new Error('Protocol participant snapshot event count mismatch');
  }
  const latestEventAt = relatedEvents.reduce((max, event) => Math.max(max, finiteNonNegative(event?.at, 'progress event time')), 0);
  const updatedAt = finiteNonNegative(participant.updatedAt, 'participant update time');
  if (latestEventAt !== updatedAt) throw new Error('Protocol participant snapshot update time mismatch');

  const snapshot = {
    version: 1,
    ledgerRevision,
    runId,
    accountId,
    activeMinutes: finiteNonNegative(participant.activeMinutes, 'active minutes'),
    objectiveContribution: finiteNonNegative(participant.objectiveContribution, 'objective contribution'),
    killContribution: finiteNonNegative(participant.killContribution, 'kill contribution'),
    deaths: finiteNonNegative(participant.deaths, 'death count'),
    completed: Boolean(participant.completed),
    eligible: Boolean(participant.eligible),
    score: finiteNonNegative(participant.score, 'Protocol Score'),
    rawScore: finiteNonNegative(participant.rawScore, 'raw Protocol Score'),
    processedEvents,
    updatedAt,
    readOnly: true,
    rewardAuthority: false,
    mutatesPersistence: false
  };
  if (!snapshot.eligible && snapshot.score !== 0) {
    throw new Error('Ineligible Protocol participant cannot carry awarded score');
  }
  snapshot.digest = crypto.createHash('sha256').update(stablePayload(snapshot)).digest('hex');
  return Object.freeze(snapshot);
}

function verifyParticipantProgressSnapshot(snapshot) {
  if (!snapshot || snapshot.readOnly !== true || snapshot.rewardAuthority !== false || snapshot.mutatesPersistence !== false) return false;
  if (!/^[a-f0-9]{64}$/.test(String(snapshot.digest || ''))) return false;
  try {
    return crypto.createHash('sha256').update(stablePayload(snapshot)).digest('hex') === snapshot.digest;
  } catch {
    return false;
  }
}

module.exports = { createParticipantProgressSnapshot, verifyParticipantProgressSnapshot };
