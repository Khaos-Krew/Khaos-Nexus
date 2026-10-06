'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EXPECTED_PRICES, loadArkNpCatalog } = require('../src/shared/ark-np-catalog.cjs');
const {
  NEXUS_POINTS,
  CACHE_TOKENS,
  ARN_TOKENS,
  resolveCachePayment,
  shopCurrencyCopy
} = require('../src/shared/dino-cache-currency.cjs');
const { arkMemberText } = require('../src/shared/ark-np-member-text.cjs');
const {
  cacheIds,
  cachePanelPayload,
  cacheDetailPayload,
  hubHomePayload
} = require('../src/sentinel/ark-dino-box-shop-extension.cjs');

const CURRENCIES = [NEXUS_POINTS, CACHE_TOKENS, ARN_TOKENS];

test('each cache accepts only its currencies and keeps the existing point prices', () => {
  for (const [sku, points] of Object.entries(EXPECTED_PRICES)) {
    for (const currency of CURRENCIES) {
      const result = resolveCachePayment(sku, currency);
      if (currency === ARN_TOKENS) {
        assert.equal(result.ok, false, sku);
        assert.equal(result.reason, 'currency-not-accepted');
        assert.equal(result.debited, false);
        assert.deepEqual(result.accepted, [NEXUS_POINTS]);
      } else if (currency === NEXUS_POINTS) {
        assert.equal(result.ok, true, sku);
        assert.equal(result.currency, NEXUS_POINTS);
        assert.equal(result.price, points);
      } else {
        assert.equal(result.ok, false, sku);
        assert.equal(result.reason, 'currency-not-accepted');
        assert.equal(result.debited, false);
        assert.deepEqual(result.accepted, [NEXUS_POINTS]);
      }
    }
    assert.equal(resolveCachePayment(sku).currency, NEXUS_POINTS);
    assert.equal(resolveCachePayment(sku).price, points);
  }

  for (const currency of CURRENCIES) {
    const result = resolveCachePayment('arn', currency);
    if (currency === ARN_TOKENS) {
      assert.equal(result.ok, true);
      assert.equal(result.price, 1);
      assert.deepEqual(result.accepted, [ARN_TOKENS]);
    } else {
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'currency-not-accepted');
      assert.equal(result.debited, false);
    }
  }
  assert.equal(resolveCachePayment('arn').currency, ARN_TOKENS);
  assert.equal(resolveCachePayment('not-a-cache', NEXUS_POINTS).reason, 'unknown-item');
  assert.equal(resolveCachePayment('weekly', NEXUS_POINTS).reason, 'unknown-item');
  assert.equal(resolveCachePayment('weekly', ARN_TOKENS).reason, 'currency-not-accepted');
});

test('catalog stamps currencies without moving point prices or reviving the weekly cache', () => {
  const catalog = loadArkNpCatalog();
  assert.deepEqual(catalog.items.map((item) => [item.sku, item.price]), Object.entries(EXPECTED_PRICES));
  assert.equal(catalog.items.some((item) => item.sku === 'weekly' || item.sku === 'arn'), false);
  for (const item of catalog.items) {
    assert.deepEqual([...item.currencies], [NEXUS_POINTS]);
    assert.equal(item.prices.NEXUS_POINTS, item.price);
    assert.equal(item.prices.DINO_CACHE_TOKENS, 1);
  }
  assert.deepEqual([...catalog.arn.currencies], [ARN_TOKENS]);
  assert.equal(catalog.arn.prices.ARN_TOKENS, 1);
  assert.equal(catalog.arn.price, 1);
});

test('shop copy names the accepted currency on every cache', () => {
  const menu = hubHomePayload().components[0].toJSON().components[0];
  const home = JSON.stringify(hubHomePayload().embeds[0]);
  assert.match(home, /Nexus Points/);
  assert.doesNotMatch(home, /Cache token/i);
  assert.match(home, /ARN tokens only/);
  for (const cacheId of cacheIds()) {
    const panel = JSON.stringify(cachePanelPayload(cacheId).embeds[0]);
    const detail = JSON.stringify(cacheDetailPayload(cacheId).embeds[0]);
    const option = menu.options.find((entry) => entry.value === cacheId);
    const button = cachePanelPayload(cacheId).components[0].toJSON().components[0].label;
    assert.ok(button.length <= 80, button);
    if (cacheId === 'arn') {
      assert.match(panel, /ARN tokens only/);
      assert.match(detail, /ARN tokens only/);
      assert.match(option.description, /ARN tokens only/);
      assert.doesNotMatch(panel, /Nexus Points|\bPoints\b/);
      assert.doesNotMatch(detail, /Nexus Points/);
      assert.equal(button, shopCurrencyCopy('arn').button);
    } else {
      const points = EXPECTED_PRICES[cacheId];
      assert.equal(typeof points, 'number');
      assert.match(panel, new RegExp(`${points.toLocaleString('en-US')} Nexus Points`));
      assert.doesNotMatch(panel, /Cache token/i);
      assert.match(detail, new RegExp(`${points.toLocaleString('en-US')} Nexus Points`));
      assert.match(detail, /Accepted currency: Nexus Points/);
      assert.match(option.description, /Nexus Points/);
      assert.doesNotMatch(option.description, /Cache token/i);
      assert.doesNotMatch(`${panel}\n${detail}\n${option.description}`, /ARN token/);
      assert.equal(button, shopCurrencyCopy(cacheId, points).button);
    }
  }
  const ui = fs.readFileSync(path.join(__dirname, '../src/sentinel/ark-np-shop-ui.cjs'), 'utf8');
  assert.doesNotMatch(ui, /Cache token/i);
  assert.match(ui, /shopCurrencyCopy/);
  assert.match(ui, /Confirm to spend the Nexus Points/);
  assert.match(arkMemberText('currency-not-accepted'), /ARN Tokens, earned from shiny dinos/);
  assert.match(arkMemberText('currency-not-accepted'), /Open the shop again/);
  assert.match(arkMemberText('currency-not-accepted'), /does not accept that currency/);
  assert.match(arkMemberText('currency-not-accepted'), /Nothing was spent/);
  const shop = fs.readFileSync(path.join(__dirname, '../src/sentinel/ark-dino-box-shop-extension.cjs'), 'utf8');
  assert.doesNotMatch(shop, /\/arn\/preview|\/arn\/balance|arnSpend|ledger\.spend/);
});
