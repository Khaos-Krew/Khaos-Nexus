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
const { PostgresArkShop } = require('../src/economy-worker/ark-np-postgres.cjs');
const { spendWithClient } = require('../src/economy-worker/arn-tokens-postgres.cjs');
const { arkMemberText } = require('../src/shared/ark-np-member-text.cjs');
const {
  cacheIds,
  cachePanelPayload,
  cacheDetailPayload,
  hubHomePayload
} = require('../src/sentinel/ark-dino-box-shop-extension.cjs');

const CURRENCIES = [NEXUS_POINTS, CACHE_TOKENS, ARN_TOKENS];

function gatePool() {
  return {
    queried: false,
    connected: false,
    async query() {
      this.queried = true;
      throw new Error('schema');
    },
    async connect() {
      this.connected = true;
      throw new Error('connect');
    }
  };
}

test('each cache accepts only its currencies and keeps the existing point prices', () => {
  for (const [sku, points] of Object.entries(EXPECTED_PRICES)) {
    for (const currency of CURRENCIES) {
      const result = resolveCachePayment(sku, currency);
      if (currency === ARN_TOKENS) {
        assert.equal(result.ok, false, sku);
        assert.equal(result.reason, 'currency-not-accepted');
        assert.equal(result.debited, false);
        assert.deepEqual(result.accepted, [NEXUS_POINTS, CACHE_TOKENS]);
      } else if (currency === NEXUS_POINTS) {
        assert.equal(result.ok, true, sku);
        assert.equal(result.currency, NEXUS_POINTS);
        assert.equal(result.price, points);
      } else {
        assert.equal(result.ok, true, sku);
        assert.equal(result.currency, CACHE_TOKENS);
        assert.equal(result.price, 1);
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
    assert.deepEqual([...item.currencies], [NEXUS_POINTS, CACHE_TOKENS]);
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
  assert.match(home, /Nexus Points or a Cache token/);
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
      assert.match(panel, new RegExp(`${points.toLocaleString('en-US')} Points`));
      assert.match(panel, /1 Cache token/);
      assert.match(detail, new RegExp(`${points.toLocaleString('en-US')} Points`));
      assert.match(detail, /Nexus Points or Cache tokens/);
      assert.match(option.description, /Points or 1 Cache token/);
      assert.doesNotMatch(`${panel}\n${detail}\n${option.description}`, /ARN token/);
      assert.equal(button, shopCurrencyCopy(cacheId, points).button);
    }
  }
  const ui = fs.readFileSync(path.join(__dirname, '../src/sentinel/ark-np-shop-ui.cjs'), 'utf8');
  assert.match(ui, /\$\{item\.price\} Points or 1 Cache token/);
});

test('the worker rejects the wrong currency before any shop gate or database call', async () => {
  const closed = new PostgresArkShop({ pool: gatePool(), env: {} });
  for (const currency of [NEXUS_POINTS, CACHE_TOKENS]) {
    const bought = await closed.buy({ sku: 'arn', currency, discordUserId: '1' });
    const quoted = await closed.quote({ sku: 'arn', currency, discordUserId: '1' });
    assert.equal(bought.reason, 'currency-not-accepted');
    assert.equal(quoted.reason, 'currency-not-accepted');
    assert.equal(bought.debited, false);
  }
  const coastalArn = await closed.buy({ sku: 'coastal', currency: ARN_TOKENS, discordUserId: '1' });
  assert.equal(coastalArn.reason, 'currency-not-accepted');
  assert.equal(coastalArn.debited, false);
  assert.equal(closed.pool.queried, false);
  assert.equal(closed.pool.connected, false);

  const npGate = await closed.buy({ sku: 'coastal', currency: NEXUS_POINTS, discordUserId: '1' });
  assert.equal(npGate.reason, 'ark-shop-disabled');
  assert.equal(closed.pool.queried, false);

  const open = new PostgresArkShop({ pool: gatePool(), env: { ARK_SHOP_ENABLED: 'true' } });
  const cacheToken = await open.buy({ sku: 'coastal', currency: CACHE_TOKENS, discordUserId: '1' });
  assert.equal(cacheToken.reason, 'ark-shop-dry-run');
  assert.equal(cacheToken.debited, false);
  assert.equal(cacheToken.price, 1);
  assert.equal(open.pool.queried, false);
  assert.equal(open.pool.connected, false);

  const deliveryHeld = new PostgresArkShop({
    pool: gatePool(),
    env: { ARK_SHOP_ENABLED: 'true', ARK_SHOP_DRY_RUN: 'false' }
  });
  const held = await deliveryHeld.buy({ sku: 'apex', currency: CACHE_TOKENS, discordUserId: '1' });
  assert.equal(held.reason, 'ark-shop-delivery-disabled');
  assert.equal(held.debited, false);
  assert.equal(deliveryHeld.pool.connected, false);

  const npEntered = await open.buy({ sku: 'coastal', currency: NEXUS_POINTS, discordUserId: '1', nonce: 'n' });
  assert.equal(npEntered.reason, 'mc-schema-unavailable');
  assert.equal(open.pool.queried, true);
  assert.equal(open.pool.connected, false);

  assert.match(arkMemberText('currency-not-accepted'), /does not accept that currency/);
  assert.match(arkMemberText('currency-not-accepted'), /Nothing was spent/);
});

test('ARN spend accepts only an ARN cache paid with ARN tokens', async () => {
  const client = { async query() { throw new Error('should-not-query'); } };
  for (const [sku, points] of Object.entries(EXPECTED_PRICES)) {
    for (const currency of CURRENCIES) {
      const result = await spendWithClient(client, { cacheId: sku, currency, orderId: `${sku}-${currency}` });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'currency-not-accepted');
      assert.equal(result.debited, false);
      assert.equal(result.cacheId, sku);
    }
    assert.equal(points > 0, true);
  }
  for (const currency of [NEXUS_POINTS, CACHE_TOKENS]) {
    const result = await spendWithClient(client, { cacheId: 'arn', currency, orderId: `arn-${currency}` });
    assert.equal(result.reason, 'currency-not-accepted');
    assert.equal(result.debited, false);
  }

  let began = false;
  const entering = {
    async query(sql) {
      began = true;
      assert.match(String(sql), /BEGIN/);
      throw new Error('entered');
    }
  };
  await assert.rejects(
    () => spendWithClient(entering, { cacheId: 'arn', currency: ARN_TOKENS, orderId: 'arn-order', env: {} }),
    /entered/
  );
  assert.equal(began, true);
});
