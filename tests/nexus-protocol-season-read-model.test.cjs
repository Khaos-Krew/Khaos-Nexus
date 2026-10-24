'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeasonScoreSeal } = require('../src/sentinel/nexus-protocol-score-seal.cjs');
const {
  buildProtocolSeasonReadModel,
  protocolSeasonView
} = require('../src/sentinel/nexus-protocol-season-read-model.cjs');

function manifest(status = 'active', revision = 12) {
  return {
    version: 1,
    seasonId: 's1',
    seasonStatus: status,
    storeRevision: revision,
    checkpointCount: 2,
    entries: [
      { runId: 'run-a', eventCount: 8, participantCount: 3 },
      { runId: 'run-b', eventCount: 5, participantCount: 2 }
    ]
  };
}

test('active season read model summarizes persisted progress without mutation authority', () => {
  const model = buildProtocolSeasonReadModel({ id: 's1', name: 'Season One', status: 'active' }, manifest());
  assert.equal(model.checkpointCount, 2);
  assert.equal(model.eventCount, 13);
  assert.equal(model.participantCount, 5);
  assert.equal(model.scoreFinalized, false);
  assert.equal(model.rewardPlanningEligible, false);
  assert.equal(model.executesRewards, false);
  assert.equal(model.mutatesPersistence, false);
  assert.equal(model.readOnly, true);

  const view = protocolSeasonView(model);
  assert.match(view.title, /Season One/);
  assert.match(view.description, /Protocol Score: \*\*In progress\*\*/);
  assert.equal(view.components, undefined);
});

test('closed season can expose only a matching verified Protocol Score seal', () => {
  const season = { id: 's1', name: 'Season One', status: 'closed', endsAt: 9000 };
  const seal = createSeasonScoreSeal(season, [
    { rank: 1, accountId: 'acct1', score: 120, runs: 2 },
    { rank: 2, accountId: 'acct2', score: 90, runs: 2 }
  ], { storeRevision: 12, closedAt: 9000 });
  const model = buildProtocolSeasonReadModel(season, manifest('closed', 12), seal);
  assert.equal(model.scoreFinalized, true);
  assert.equal(model.leaderboard.length, 2);
  assert.equal(model.leaderboard[0].accountId, 'acct1');
  assert.match(protocolSeasonView(model).description, /#1 • acct1 — \*\*120\*\* pts/);
});

test('rejects score seal from another store revision', () => {
  const season = { id: 's1', status: 'closed', endsAt: 9000 };
  const seal = createSeasonScoreSeal(season, [{ rank: 1, accountId: 'acct1', score: 10, runs: 1 }], {
    storeRevision: 11,
    closedAt: 9000
  });
  assert.throws(() => buildProtocolSeasonReadModel(season, manifest('closed', 12), seal), /does not match checkpoint manifest/);
});

test('active season rejects a final score seal', () => {
  const closed = { id: 's1', status: 'closed', endsAt: 9000 };
  const seal = createSeasonScoreSeal(closed, [{ rank: 1, accountId: 'acct1', score: 10, runs: 1 }], {
    storeRevision: 12,
    closedAt: 9000
  });
  assert.throws(() => buildProtocolSeasonReadModel({ id: 's1', status: 'active' }, manifest('active', 12), seal), /Active Protocol season/);
});

test('fails closed on mismatched manifests and impossible persisted counts', () => {
  assert.throws(() => buildProtocolSeasonReadModel({ id: 's2', status: 'active' }, manifest()), /matching checkpoint manifest/);
  const bad = manifest();
  bad.checkpointCount = 3;
  assert.throws(() => buildProtocolSeasonReadModel({ id: 's1', status: 'active' }, bad), /checkpoint count mismatch/);
});
