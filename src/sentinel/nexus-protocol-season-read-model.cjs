'use strict';

const { verifySeasonScoreSeal } = require('./nexus-protocol-score-seal.cjs');

function clean(value, max = 96) {
  return String(value ?? '').trim().slice(0, max);
}

function nonNegativeInteger(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function buildProtocolSeasonReadModel(season, manifest, scoreSeal = null) {
  if (!season || !['active', 'closed'].includes(String(season.status || ''))) {
    throw new Error('Protocol season read model requires active or closed season');
  }
  if (!manifest || Number(manifest.version) !== 1 || manifest.seasonId !== season.id
    || manifest.seasonStatus !== season.status || !Array.isArray(manifest.entries)) {
    throw new Error('Protocol season read model requires matching checkpoint manifest');
  }

  const checkpointCount = nonNegativeInteger(manifest.checkpointCount, 'checkpoint count');
  if (checkpointCount !== manifest.entries.length) throw new Error('Protocol season checkpoint count mismatch');
  const eventCount = manifest.entries.reduce((sum, entry) => sum + nonNegativeInteger(entry.eventCount, 'event count'), 0);
  const participantCount = manifest.entries.reduce((sum, entry) => sum + nonNegativeInteger(entry.participantCount, 'participant count'), 0);

  let scoreFinalized = false;
  let leaderboard = [];
  if (scoreSeal !== null) {
    if (season.status !== 'closed') throw new Error('Active Protocol season cannot expose a final score seal');
    if (!verifySeasonScoreSeal(scoreSeal)
      || scoreSeal.seasonId !== season.id
      || Number(scoreSeal.storeRevision) !== Number(manifest.storeRevision)) {
      throw new Error('Protocol season score seal does not match checkpoint manifest');
    }
    scoreFinalized = true;
    leaderboard = scoreSeal.entries.slice(0, 10).map((entry) => Object.freeze({ ...entry }));
  }

  return Object.freeze({
    version: 1,
    seasonId: clean(season.id),
    seasonName: clean(season.name || season.id, 120),
    status: season.status,
    storeRevision: nonNegativeInteger(manifest.storeRevision, 'store revision'),
    checkpointCount,
    eventCount,
    participantCount,
    scoreFinalized,
    leaderboard: Object.freeze(leaderboard),
    rewardPlanningEligible: false,
    executesRewards: false,
    mutatesPersistence: false,
    readOnly: true
  });
}

function protocolSeasonView(model) {
  if (!model || model.readOnly !== true || model.mutatesPersistence !== false || model.executesRewards !== false) {
    throw new Error('Invalid Protocol season read model');
  }
  const lines = [
    `Status: **${model.status === 'closed' ? 'Closed' : 'Active'}**`,
    `Checkpointed runs: **${model.checkpointCount}**`,
    `Recorded progress events: **${model.eventCount}**`,
    `Participant records: **${model.participantCount}**`,
    `Protocol Score: **${model.scoreFinalized ? 'Finalized' : 'In progress'}**`
  ];
  if (model.leaderboard.length) {
    lines.push('', ...model.leaderboard.slice(0, 5).map((row) => `#${row.rank} • ${clean(row.accountId, 48)} — **${row.score}** pts`));
  }
  return {
    title: `Nexus Protocol • ${clean(model.seasonName, 80)}`,
    description: lines.join('\n'),
    footer: { text: `Read-only season snapshot • store revision ${model.storeRevision}` }
  };
}

module.exports = { buildProtocolSeasonReadModel, protocolSeasonView };
