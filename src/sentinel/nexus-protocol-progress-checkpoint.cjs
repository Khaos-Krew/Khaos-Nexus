'use strict';

const crypto = require('node:crypto');
const {
  PROGRESS_VERSION,
  normalizeProgressEvent,
  progressEventFingerprint,
  aggregateParticipant
} = require('./nexus-protocol-progress.cjs');

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

function buildProtocolProgressCheckpoint(snapshot = {}, runId, optionsByAccount = {}) {
  if (Number(snapshot.version) !== PROGRESS_VERSION || !Array.isArray(snapshot.events)) {
    throw new Error('Invalid Protocol progress ledger snapshot');
  }
  const run = cleanId(runId, 'protocol run id');
  const revision = Number(snapshot.revision);
  const updatedAt = Number(snapshot.updatedAt);
  if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isFinite(updatedAt) || updatedAt < 0) {
    throw new Error('Invalid Protocol progress ledger checkpoint metadata');
  }

  const ids = new Set();
  const fingerprints = new Map();
  const events = [];
  for (const input of snapshot.events) {
    const event = normalizeProgressEvent(input);
    const fingerprint = progressEventFingerprint(event);
    if (ids.has(event.id)) {
      if (fingerprints.get(event.id) !== fingerprint) throw new Error('Conflicting Protocol progress event in checkpoint');
      throw new Error('Duplicate Protocol progress event in checkpoint');
    }
    ids.add(event.id);
    fingerprints.set(event.id, fingerprint);
    if (event.runId === run) events.push({ event, fingerprint });
  }
  if (!events.length) throw new Error('Protocol progress checkpoint requires run events');

  events.sort((a, b) => a.event.at - b.event.at || a.event.id.localeCompare(b.event.id));
  const grouped = new Map();
  for (const item of events) {
    const list = grouped.get(item.event.accountId) || [];
    list.push(item.event);
    grouped.set(item.event.accountId, list);
  }

  const participants = [...grouped.entries()].map(([accountId, accountEvents]) => {
    const participant = aggregateParticipant(accountEvents, optionsByAccount[accountId] || {});
    return {
      accountId: participant.accountId,
      eligible: participant.eligible,
      eligibilityReasons: [...participant.eligibilityReasons].sort(),
      score: participant.score,
      rawScore: participant.rawScore,
      activeMinutes: participant.activeMinutes,
      objectiveContribution: participant.objectiveContribution,
      killContribution: participant.killContribution,
      deaths: participant.deaths,
      completed: participant.completed,
      presentAtCompletion: participant.presentAtCompletion,
      processedEvents: participant.processedEvents,
      updatedAt: participant.updatedAt
    };
  }).sort((a, b) => a.accountId.localeCompare(b.accountId));

  const payload = {
    version: 1,
    ledgerVersion: PROGRESS_VERSION,
    ledgerRevision: revision,
    ledgerUpdatedAt: updatedAt,
    runId: run,
    eventCount: events.length,
    eventBindings: events.map(({ event, fingerprint }) => ({ id: event.id, fingerprint })),
    participants
  };

  return Object.freeze({ ...payload, checkpointDigest: digest(payload) });
}

function assertProtocolProgressCheckpoint(checkpoint) {
  if (!checkpoint || checkpoint.version !== 1 || !/^[a-f0-9]{64}$/.test(String(checkpoint.checkpointDigest || ''))) {
    throw new Error('Invalid Protocol progress checkpoint');
  }
  const { checkpointDigest, ...payload } = checkpoint;
  const expected = digest(payload);
  if (!crypto.timingSafeEqual(Buffer.from(checkpointDigest, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('Protocol progress checkpoint integrity mismatch');
  }
  return true;
}

module.exports = {
  buildProtocolProgressCheckpoint,
  assertProtocolProgressCheckpoint
};
