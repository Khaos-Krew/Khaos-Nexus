'use strict';

const { verifyParticipantProgressSnapshot } = require('./nexus-protocol-participant-snapshot.cjs');
const { verifyProtocolParticipantDiscordToken } = require('./nexus-protocol-participant-discord-token.cjs');

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function buildProtocolParticipantProgressView(snapshot, token, options = {}) {
  if (!verifyParticipantProgressSnapshot(snapshot)) throw new Error('Invalid Protocol participant progress snapshot');
  const claims = verifyProtocolParticipantDiscordToken(token, snapshot, options);
  const score = finite(snapshot.score, 'Protocol Score');
  const rawScore = finite(snapshot.rawScore, 'raw Protocol Score');
  const view = {
    version: 1,
    kind: 'protocol-participant-progress-view',
    purpose: claims.purpose,
    viewerAccountId: claims.viewerAccountId,
    accountId: snapshot.accountId,
    runId: snapshot.runId,
    ledgerRevision: snapshot.ledgerRevision,
    snapshotDigest: snapshot.digest,
    progress: Object.freeze({
      activeMinutes: finite(snapshot.activeMinutes, 'active minutes'),
      objectiveContribution: finite(snapshot.objectiveContribution, 'objective contribution'),
      killContribution: finite(snapshot.killContribution, 'kill contribution'),
      deaths: finite(snapshot.deaths, 'death count'),
      completed: snapshot.completed === true,
      processedEvents: Math.floor(finite(snapshot.processedEvents, 'processed events'))
    }),
    scoring: Object.freeze({
      eligible: snapshot.eligible === true,
      score,
      rawScore,
      withheldScore: snapshot.eligible === true ? 0 : rawScore
    }),
    updatedAt: finite(snapshot.updatedAt, 'participant update time'),
    visibility: 'ephemeral',
    staleCheckRequired: true,
    readOnly: true,
    authorizesMutation: false,
    rewardAuthority: false,
    mutatesPersistence: false,
    executesServerCommand: false
  };
  if (!view.scoring.eligible && view.scoring.score !== 0) {
    throw new Error('Ineligible Protocol participant view cannot expose awarded score');
  }
  return Object.freeze(view);
}

module.exports = { buildProtocolParticipantProgressView };
