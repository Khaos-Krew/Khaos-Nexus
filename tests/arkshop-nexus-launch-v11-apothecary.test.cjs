'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  APOTHECARY_ITEMS,
  DISABLED_ENGRAMS,
  shopEntry,
  withPotionCatalog,
  hasPotionCatalog,
  engramRule,
  applyCraftingRestrictions,
  hasCraftingRestrictions
} = require('../src/sentinel/arkshop-nexus-launch-v11-apothecary-startup.cjs');
const runtime = require('../src/sentinel/arkshop-nexus-launch-v11-apothecary-runtime.cjs');

test('planned Apothecary uses verified native item delivery and balanced positive prices', () => {
  assert.equal(Object.keys(APOTHECARY_ITEMS).length, 8);
  for (const spec of Object.values(APOTHECARY_ITEMS)) {
    const entry = shopEntry(spec);
    assert.equal(entry.Type, 'item');
    assert.ok(entry.Price >= 750 && entry.Price <= 5000);
    assert.equal(entry.Items.length, 1);
    assert.equal(entry.Items[0].Amount, 1);
    assert.equal(entry.Items[0].ForceBlueprint, false);
    assert.match(entry.Items[0].Blueprint, /^Blueprint'\/CrazysPotions\/.+\..+'$/);
    assert.equal('Command' in entry.Items[0], false);
  }
});

test('Engram Unlocker is not sold and every planned shop potion is present exactly once', () => {
  const data = withPotionCatalog({ managedSections: ['ShopItems'], ShopItems: { existing: { Price: 1 }, apoth_engram_unlocker: { Price: 1 } } });
  assert.equal(data.ShopItems.existing.Price, 1);
  assert.equal('apoth_engram_unlocker' in data.ShopItems, false);
  assert.equal(hasPotionCatalog(data), true);
  data.ShopItems.apoth_love.Price += 1;
  assert.equal(hasPotionCatalog(data), false);
});

test('Game.ini potion rules hide crafting while preserving unrelated repeated overrides', () => {
  const input = [
    '[/Script/ShooterGame.ShooterGameMode]',
    'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_KeepMe_C",EngramHidden=False)',
    'OverrideNamedEngramEntries=(EngramClassName="EngramEntry_CPLovePotion_C",EngramHidden=False)',
    '',
    '[Other.Section]',
    'Value=True',
    ''
  ].join('\r\n');
  const next = applyCraftingRestrictions(input);
  assert.equal(hasCraftingRestrictions(next), true);
  assert.match(next, /EngramEntry_KeepMe_C/);
  assert.match(next, /\r\n\[Other\.Section\]/);
  for (const name of DISABLED_ENGRAMS) assert.equal(next.split(engramRule(name)).length - 1, 1);
  assert.equal(applyCraftingRestrictions(next), next);
});

test('Engram Unlocker remains explicitly hidden but excluded from the shop catalog', () => {
  assert.ok(DISABLED_ENGRAMS.includes('EngramEntry_CPEngramUnlockerPotion_C'));
  assert.equal(Object.values(APOTHECARY_ITEMS).some((spec) => /EngramUnlock/i.test(spec.asset)), false);
});

test('Apothecary live migration is opt-in and does not auto-restart ARK', () => {
  const previous = process.env.ARK_GEN1_ARKSHOP_LAUNCH_V11_APOTHECARY_ONCE;
  delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V11_APOTHECARY_ONCE;
  try {
    assert.deepEqual(runtime.installArkShopLaunchV11ApothecaryRuntime(), { enabled: false });
    assert.equal(runtime.ENV_KEY, 'ARK_GEN1_ARKSHOP_LAUNCH_V11_APOTHECARY_ONCE');
    const source = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/arkshop-nexus-launch-v11-apothecary-runtime.cjs'), 'utf8');
    assert.doesNotMatch(source, /restartserver|doexit|saveworld/i);
  } finally {
    if (previous === undefined) delete process.env.ARK_GEN1_ARKSHOP_LAUNCH_V11_APOTHECARY_ONCE;
    else process.env.ARK_GEN1_ARKSHOP_LAUNCH_V11_APOTHECARY_ONCE = previous;
  }
});
