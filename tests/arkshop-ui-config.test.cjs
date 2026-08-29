'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateArkShopUiConfig, productionSafe } = require('../src/sentinel/arkshop-ui-config.cjs');

const configPath = path.resolve(__dirname, '../config/ark/arkshopui/nexus-exchange.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

test('Nexus Exchange ArkShopUI config validates without structural errors', () => {
  const result = validateArkShopUiConfig(config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(config.UiKey, 'F3');
  assert.equal(config.ShopName, 'KHAOS NEXUS // EXCHANGE');
  assert.equal(config.DisableSellButton, true);
  assert.equal(config.DisableTradeButton, false);
});

test('Nexus Exchange config remains intentionally blocked from production until portal URL is set', () => {
  const result = productionSafe(config);
  assert.equal(result.productionSafe, false);
  assert.ok(result.blockers.includes('missing-website-url'));
});

test('validator rejects unsafe hotkeys, malformed URLs, and duplicate labels', () => {
  const broken = JSON.parse(JSON.stringify(config));
  broken.UiKey = 'G9';
  broken.DiscordUrl = 'not-a-url';
  broken.OverrideLabels.push({ ItemsTabLabel: 'Duplicate' });
  const result = validateArkShopUiConfig(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes('UiKey')));
  assert.ok(result.errors.some((entry) => entry.includes('DiscordUrl')));
  assert.ok(result.errors.some((entry) => entry.includes('duplicate ItemsTabLabel')));
});
