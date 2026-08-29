'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mergeArkShopUiConfig,
  diffArkShopUiConfig,
  deploymentPlan
} = require('../src/sentinel/arkshop-ui-sync.cjs');

const desired = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/ark/arkshopui/nexus-exchange.json'), 'utf8'));

test('ArkShopUI merge preserves unknown live plugin keys', () => {
  const live = {
    UiKey: 'F1',
    ShopName: 'Old Shop',
    FuturePluginSetting: { enabled: true, mode: 'keep-me' }
  };
  const merged = mergeArkShopUiConfig(live, desired);
  assert.equal(merged.UiKey, 'F3');
  assert.equal(merged.ShopName, 'KHAOS NEXUS // EXCHANGE');
  assert.deepEqual(merged.FuturePluginSetting, { enabled: true, mode: 'keep-me' });
});

test('ArkShopUI diff reports only managed branding keys and preserved unknowns', () => {
  const live = { UiKey: 'F1', ShopName: 'Old', PrivateSetting: 123 };
  const diff = diffArkShopUiConfig(live, desired);
  assert.equal(diff.changed, true);
  assert.ok(diff.changedKeys.includes('UiKey'));
  assert.ok(diff.changedKeys.includes('ShopName'));
  assert.deepEqual(diff.preservedUnknownKeys, ['PrivateSetting']);
});

test('deployment plan is safe once plugin/mod/version/live-config checks pass', () => {
  const live = { UiKey: 'F1', ShopName: 'Old' };
  const plan = deploymentPlan({
    liveConfig: live,
    desiredConfig: desired,
    readiness: {
      pluginPresent: true,
      mod942249Active: true,
      arkShopVersion: '1.8',
      arkShopUiVersion: '1.8A',
      liveConfigReadable: true
    }
  });
  assert.equal(plan.safeToApply, true);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.reloadCommand, 'ArkShop.Reload');
  assert.equal(plan.requiresServerRestart, false);
});
