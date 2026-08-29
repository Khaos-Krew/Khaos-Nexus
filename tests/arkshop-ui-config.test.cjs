'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateArkShopUiConfig, productionSafe, validAssetPath } = require('../src/sentinel/arkshop-ui-config.cjs');

const configPath = path.resolve(__dirname, '../config/ark/arkshopui/nexus-exchange.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

test('Nexus Exchange ArkShopUI launch config exposes Sell and validates', () => {
  const result = validateArkShopUiConfig(config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(config.UiKey, 'F3');
  assert.equal(config.ShopName, 'KHAOS NEXUS // EXCHANGE');
  assert.equal(config.DisableSellButton, false);
  assert.equal(config.DisableTradeButton, false);
  assert.equal(config.WebsiteUrl, 'https://discord.gg/ZYAdnbqRHs');
  assert.equal(config.DiscordUrl, 'https://discord.gg/ZYAdnbqRHs');
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'OverrideCurrencyIcon'), false);
});

test('Nexus Exchange launch config is production-safe with verified static SellItems live', () => {
  const result = productionSafe(config);
  assert.equal(result.productionSafe, true);
  assert.deepEqual(result.blockers, []);
});

test('currency icon override accepts Unreal asset paths and rejects remote URLs', () => {
  assert.equal(validAssetPath('/Game/PrimalEarth/CoreBlueprints/Items/Consumables/Icons/Narcotic_Icon'), true);
  assert.equal(validAssetPath('https://example.com/coin.png'), false);
  const broken = JSON.parse(JSON.stringify(config));
  broken.OverrideCurrencyIcon = 'https://example.com/coin.png';
  const result = validateArkShopUiConfig(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.includes('OverrideCurrencyIcon')));
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
