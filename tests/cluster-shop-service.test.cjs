'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const { loadCatalog, ShopOrderStore, ClusterShopService } = require('../src/sentinel/cluster-shop-service.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cluster-shop-'));
  const economy = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    onlineRates: {},
    offlineRates: {}
  });
  economy.linkArkIdentity({ discordUserId: '111', eosId: 'EOS_abc12345', rankId: 'shadow-recruit' });
  const catalog = loadCatalog(JSON.stringify([
    {
      id: 'metal',
      name: 'Metal',
      kind: 'resource',
      baseQuantity: 100,
      buyPrice: 50,
      sellPrice: 17,
      minBundles: 1,
      maxBundles: 50,
      buyable: true,
      sellable: true,
      blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Metal.PrimalItemResource_Metal'
    },
    {
      id: 'rex-cache',
      name: 'Rex Cache',
      kind: 'dino-cache',
      baseQuantity: 1,
      buyPrice: 500,
      sellPrice: 250,
      buyable: true,
      sellable: true
    }
  ]));
  const shop = new ClusterShopService({ economy, store: new ShopOrderStore(root), catalog });
  return { root, economy, shop };
}

test('quantity quote scales delivered amount and price from the base bundle', () => {
  const { shop } = fixture();
  const quote = shop.quote({ itemId: 'metal', bundles: 5, action: 'buy' });
  assert.equal(quote.baseQuantity, 100);
  assert.equal(quote.totalQuantity, 500);
  assert.equal(quote.unitPrice, 50);
  assert.equal(quote.totalPrice, 250);
});

test('quantity quote enforces configured min and max bundles', () => {
  const { shop } = fixture();
  assert.throws(() => shop.quote({ itemId: 'metal', bundles: 0, action: 'buy' }), /between 1 and 50/);
  assert.throws(() => shop.quote({ itemId: 'metal', bundles: 51, action: 'buy' }), /between 1 and 50/);
});

test('dino and dino-cache categories can never be sold to the shop', () => {
  const { shop } = fixture();
  const dino = shop.item('rex-cache');
  assert.equal(dino.sellable, false);
  assert.throws(() => shop.quote({ itemId: 'rex-cache', bundles: 1, action: 'sell' }), /cannot be sold/);
});

test('buy order snapshots quote and debits the wallet only once', async () => {
  const { economy, shop } = fixture();
  await economy.credit({ discordUserId: '111', amount: 1000, idempotencyKey: 'seed' });
  const first = await shop.createBuyOrder({
    discordUserId: '111',
    eosId: 'EOS_abc12345',
    itemId: 'metal',
    bundles: 5,
    idempotencyKey: 'discord-interaction-1'
  });
  const second = await shop.createBuyOrder({
    discordUserId: '111',
    eosId: 'EOS_abc12345',
    itemId: 'metal',
    bundles: 5,
    idempotencyKey: 'discord-interaction-1'
  });
  assert.equal(first.ok, true);
  assert.equal(first.order.status, 'PAID_QUEUED');
  assert.equal(first.order.quote.totalQuantity, 500);
  assert.equal(first.order.quote.totalPrice, 250);
  assert.equal(economy.balance('111'), 750);
  assert.equal(second.duplicate, true);
  assert.equal(second.order.orderId, first.order.orderId);
  assert.equal(economy.balance('111'), 750);
});

test('sell order does not credit wallet until ARK item removal is confirmed', async () => {
  const { economy, shop } = fixture();
  const created = shop.createSellOrder({
    discordUserId: '111',
    eosId: 'EOS_abc12345',
    itemId: 'metal',
    bundles: 2,
    idempotencyKey: 'sell-interaction-1'
  });
  assert.equal(created.order.status, 'AWAITING_ITEM_REMOVAL');
  assert.equal(created.order.quote.totalQuantity, 200);
  assert.equal(created.order.quote.totalPrice, 34);
  assert.equal(economy.balance('111'), 0);

  const completed = await shop.confirmSellRemoval({
    orderId: created.order.orderId,
    removalReceipt: 'ark-removal:receipt-123'
  });
  assert.equal(completed.order.status, 'COMPLETE');
  assert.equal(economy.balance('111'), 34);

  const duplicate = await shop.confirmSellRemoval({
    orderId: created.order.orderId,
    removalReceipt: 'ark-removal:receipt-123'
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(economy.balance('111'), 34);
});
