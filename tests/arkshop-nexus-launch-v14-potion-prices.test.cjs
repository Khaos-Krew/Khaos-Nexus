'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SHOP_ITEMS, SHADOW_RECRUIT_POINTS_PER_HOUR } = require('../src/sentinel/arkshop-nexus-launch-v13-potion-balance-startup.cjs');
const { priceSummary } = require('../src/sentinel/arkshop-nexus-launch-v14-shadow-recruit-potion-prices-startup.cjs');
const runtime = require('../src/sentinel/arkshop-nexus-launch-v14-shadow-recruit-potion-prices-runtime.cjs');

test('potion prices are bounded to 1-12.5 passive Shadow Recruit hours', () => {
  assert.equal(SHADOW_RECRUIT_POINTS_PER_HOUR, 24);
  const summary = priceSummary();
  assert.equal(Object.keys(summary).length, 19);
  assert.equal(summary.gaia_player_health_small.shadowRecruitHours, 1.04);
  assert.equal(summary.gaia_taming.shadowRecruitHours, 12.5);
  assert.equal(summary.apoth_super_crafting.shadowRecruitHours, 12.5);
  for (const [id, spec] of Object.entries(SHOP_ITEMS)) {
    assert.ok(spec.price >= 25 && spec.price <= 300, `${id} has an out-of-band price`);
    assert.ok(summary[id].shadowRecruitHours >= 1 && summary[id].shadowRecruitHours <= 12.5);
  }
});

test('v14 production repricing remains opt-in and restart-free', () => {
  const previous = process.env.ARK_GEN1_ARKSHOP_LAUNCH_V14_POTION_PRICES_ONCE;
  delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V14_POTION_PRICES_ONCE;
  try {
    assert.deepEqual(runtime.installArkShopLaunchV14PotionPricesRuntime(), { enabled: false });
  } finally {
    if (previous === undefined) delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V14_POTION_PRICES_ONCE;
    else process.env.ARK_GEN1_ARKSHOP_LAUNCH_V14_POTION_PRICES_ONCE = previous;
  }
});
