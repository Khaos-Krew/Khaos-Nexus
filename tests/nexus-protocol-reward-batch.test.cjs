'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeasonScoreSeal } = require('../src/sentinel/nexus-protocol-score-seal.cjs');
const { buildSeasonRewardPlans } = require('../src/sentinel/nexus-protocol-season-rewards.cjs');
const { createRewardBatchManifest, verifyRewardBatchManifest } = require('../src/sentinel/nexus-protocol-reward-batch.cjs');

function rewardBatch() {
  const seal = createSeasonScoreSeal(
    { id: 'season-1', status: 'closed', endsAt: 1000 },
    [
      { rank: 1, accountId: 'acct-1', score: 900, runs: 8 },
      { rank: 2, accountId: 'acct-2', score: 700, runs: 6 }
    ],
    { storeRevision: 12, closedAt: 1000 }
  );
  return buildSeasonRewardPlans(seal, { 'acct-1': 'EOS_1111', 'acct-2': 'EOS_2222' }, {
    createdAt: 1100,
    tiers: [{ maxRank: 1, rewardId: 'season_champion' }, { maxRank: 2, rewardId: 'season_elite' }]
  });
}

test('creates a deterministic non-executable manifest bound to the season seal', () => {
  const batch = rewardBatch();
  const left = createRewardBatchManifest(batch, { createdAt: 1200 });
  const right = createRewardBatchManifest(batch, { createdAt: 1200 });

  assert.equal(left.digest, right.digest);
  assert.equal(left.sealDigest, batch.sealDigest);
  assert.equal(left.dryRun, true);
  assert.equal(left.executable, false);
  assert.equal(left.entries.length, 2);
  assert.equal(left.entries[0].eosId, 'EOS_1111');
  assert.equal(verifyRewardBatchManifest(left), true);
});

test('detects reward command or recipient tampering', () => {
  const manifest = createRewardBatchManifest(rewardBatch(), { createdAt: 1200 });
  const changedCommand = JSON.parse(JSON.stringify(manifest));
  changedCommand.entries[0].command = 'RA.Reward EOS_1111 different_reward';
  assert.equal(verifyRewardBatchManifest(changedCommand), false);

  const changedAccount = JSON.parse(JSON.stringify(manifest));
  changedAccount.entries[0].accountId = 'acct-other';
  assert.equal(verifyRewardBatchManifest(changedAccount), false);

  const changedEos = JSON.parse(JSON.stringify(manifest));
  changedEos.entries[0].eosId = 'EOS_9999';
  assert.equal(verifyRewardBatchManifest(changedEos), false);
});

test('rejects executable or non-dry-run input plans', () => {
  const batch = rewardBatch();
  const altered = JSON.parse(JSON.stringify(batch));
  altered.plans[0].plan.dryRun = false;
  assert.throws(() => createRewardBatchManifest(altered), /dry-run plans only/);
});

test('rejects reward metadata that disagrees with the encoded command', () => {
  const batch = rewardBatch();
  const altered = JSON.parse(JSON.stringify(batch));
  altered.plans[0].rewardId = 'different_reward';
  assert.throws(() => createRewardBatchManifest(altered), /reward id does not match command/);
});

test('rejects duplicate accounts, duplicate ranks, and invalid numeric standings', () => {
  const batch = rewardBatch();
  const duplicateAccount = JSON.parse(JSON.stringify(batch));
  duplicateAccount.plans[1].accountId = duplicateAccount.plans[0].accountId;
  assert.throws(() => createRewardBatchManifest(duplicateAccount), /Duplicate Protocol reward account/);

  const duplicateRank = JSON.parse(JSON.stringify(batch));
  duplicateRank.plans[1].rank = duplicateRank.plans[0].rank;
  assert.throws(() => createRewardBatchManifest(duplicateRank), /Duplicate Protocol reward rank/);

  const invalidRank = JSON.parse(JSON.stringify(batch));
  invalidRank.plans[0].rank = 'not-a-rank';
  assert.throws(() => createRewardBatchManifest(invalidRank), /Invalid Protocol reward rank/);

  const invalidScore = JSON.parse(JSON.stringify(batch));
  invalidScore.plans[0].score = -1;
  assert.throws(() => createRewardBatchManifest(invalidScore), /Invalid Protocol reward score/);
});
