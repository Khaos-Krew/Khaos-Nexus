'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readDesiredConfig, VERSION } = require('../src/sentinel/arkshop-ui-live-deploy.cjs');
const runtime = require('../src/sentinel/arkshop-ui-live-deploy-runtime.cjs');

test('Nexus ArkShopUI live deploy keeps Sell locked and trade available', () => {
  const config = readDesiredConfig();
  assert.equal(config.ShopName, 'KHAOS NEXUS // EXCHANGE');
  assert.equal(config.UiKey, 'F3');
  assert.equal(config.DisableSellButton, true);
  assert.equal(config.DisableTradeButton, false);
  assert.equal(VERSION, 'nexus-arkshopui-test-v2-iconfix');
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'OverrideCurrencyIcon'), false);
});

test('ArkShopUI live deploy runtime is opt-in only', () => {
  const previous = process.env[runtime.ENV_KEY];
  try {
    delete process.env[runtime.ENV_KEY];
    assert.equal(runtime.requested(), false);
    process.env[runtime.ENV_KEY] = 'true';
    assert.equal(runtime.requested(), true);
    process.env[runtime.ENV_KEY] = 'false';
    assert.equal(runtime.requested(), false);
  } finally {
    if (previous === undefined) delete process.env[runtime.ENV_KEY];
    else process.env[runtime.ENV_KEY] = previous;
  }
});
