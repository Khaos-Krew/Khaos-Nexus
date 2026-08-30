'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { payoutSummary } = require('../src/sentinel/arkshop-nexus-launch-v15-rank-timed-points-startup.cjs');
const runtime = require('../src/sentinel/arkshop-nexus-launch-v15-rank-timed-points-runtime.cjs');

test('v15 payout summary covers every rank and exact Permissions group', () => {
  const summary = payoutSummary();
  assert.equal(Object.keys(summary).length, 6);
  assert.deepEqual(summary['shadow-recruit'], { group: 'NexusShadowRecruit', pointsPerFiveMinutes: 2, pointsPerHour: 24 });
  assert.deepEqual(summary['cipher-runner'], { group: 'NexusCipherRunner', pointsPerFiveMinutes: 4, pointsPerHour: 48 });
});

test('v15 production payout update remains opt-in and restart-free', () => {
  const previous = process.env.ARK_GEN1_ARKSHOP_LAUNCH_V15_RANK_POINTS_ONCE;
  delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V15_RANK_POINTS_ONCE;
  try {
    assert.deepEqual(runtime.installArkShopLaunchV15RankPointsRuntime(), { enabled: false });
  } finally {
    if (previous === undefined) delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V15_RANK_POINTS_ONCE;
    else process.env.ARK_GEN1_ARKSHOP_LAUNCH_V15_RANK_POINTS_ONCE = previous;
  }
});
