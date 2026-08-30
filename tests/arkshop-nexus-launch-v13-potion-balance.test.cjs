'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shopEntry, engramRule } = require('../src/sentinel/arkshop-nexus-launch-v11-apothecary-startup.cjs');
const {
  CRAZYS_ITEMS,
  GAIA_ITEMS,
  SHOP_ITEMS,
  SHADOW_RECRUIT_POINTS_PER_HOUR,
  DISABLED_CRAZYS_ENGRAMS,
  LOVE_ENGRAM,
  withBalancedCatalog,
  hasBalancedCatalog,
  applyCraftingBalance,
  hasCraftingBalance
} = require('../src/sentinel/arkshop-nexus-launch-v13-potion-balance-startup.cjs');
const runtime = require('../src/sentinel/arkshop-nexus-launch-v13-potion-balance-runtime.cjs');

test('Love Potion is removed and remaining Crazy potion prices fit the Shadow Recruit earning floor', () => {
  const data = withBalancedCatalog({ managedSections: ['ShopItems'], ShopItems: { apoth_love: { Price: 750 }, keep: { Price: 1 } } });
  assert.equal('apoth_love' in data.ShopItems, false);
  assert.equal(data.ShopItems.keep.Price, 1);
  assert.equal(Object.keys(CRAZYS_ITEMS).length, 7);
  assert.equal(SHADOW_RECRUIT_POINTS_PER_HOUR, 24);
  for (const spec of Object.values(CRAZYS_ITEMS)) assert.ok(spec.price >= 75 && spec.price <= 300);
  assert.equal(hasBalancedCatalog(data), true);
});

test('verified Gaia utility catalog includes instant taming and excludes combat and summon potions', () => {
  assert.equal(Object.keys(GAIA_ITEMS).length, 12);
  assert.equal(GAIA_ITEMS.gaia_taming.price, 300);
  assert.equal(GAIA_ITEMS.gaia_taming.asset, '/PotionsHelpers/Items/Taming/PrimalItemConsumable_Gaia_TamingElixir');
  for (const [id, spec] of Object.entries(GAIA_ITEMS)) {
    assert.match(id, /^gaia_/);
    assert.match(shopEntry(spec).Items[0].Blueprint, /^Blueprint'\/PotionsHelpers\/Items\/.+\..+'$/);
    assert.doesNotMatch(`${id} ${spec.description} ${spec.asset}`, /attack|strength|flying|summon|stealth|death|lust/i);
  }
  assert.equal(Object.keys(SHOP_ITEMS).length, 19);
});

test('Love crafting hide is removed while the other Crazy shop-only restrictions remain exact', () => {
  const input = [
    '[/Script/ShooterGame.ShooterGameMode]',
    engramRule(LOVE_ENGRAM),
    engramRule('EngramEntry_CPInstantBaby_C'),
    'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_KeepMe_C",EngramHidden=True)',
    ''
  ].join('\r\n');
  const next = applyCraftingBalance(input);
  assert.equal(hasCraftingBalance(next), true);
  assert.doesNotMatch(next, new RegExp(LOVE_ENGRAM));
  assert.match(next, /EngramEntry_KeepMe_C/);
  for (const name of DISABLED_CRAZYS_ENGRAMS) assert.equal(next.split(engramRule(name)).length - 1, 1);
  assert.equal(applyCraftingBalance(next), next);
});

test('v13 production mutation remains opt-in', () => {
  const previous = process.env.ARK_GEN1_ARKSHOP_LAUNCH_V13_POTION_BALANCE_ONCE;
  delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V13_POTION_BALANCE_ONCE;
  try {
    assert.deepEqual(runtime.installArkShopLaunchV13PotionBalanceRuntime(), { enabled: false });
  } finally {
    if (previous === undefined) delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V13_POTION_BALANCE_ONCE;
    else process.env.ARK_GEN1_ARKSHOP_LAUNCH_V13_POTION_BALANCE_ONCE = previous;
  }
});
