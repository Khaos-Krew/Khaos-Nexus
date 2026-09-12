'use strict';

const crypto = require('node:crypto');
const { ClusterShopService, loadCatalog } = require('./cluster-shop-service.cjs');
const { createNexusEconomyPurchaseOutboxRecord } = require('./nexus-economy-purchase-outbox-record.cjs');

const SHOP_CURRENCY = 'Nexus Points';
const MAX_ACTION_BUNDLES = 25;

function cleanId(value, label = 'ID') {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function cleanIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 256) throw new Error('A purchase idempotency key is required.');
  return key;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function sameQuote(a, b) {
  return Boolean(a && b &&
    a.itemId === b.itemId &&
    a.action === b.action &&
    a.bundles === b.bundles &&
    a.baseQuantity === b.baseQuantity &&
    a.totalQuantity === b.totalQuantity &&
    a.unitPrice === b.unitPrice &&
    a.totalPrice === b.totalPrice &&
    a.blueprint === b.blueprint);
}

class NexusEconomyPostgresShopService {
  constructor({ wallet, repository, catalog } = {}) {
    if (!wallet || typeof wallet.commitPurchase !== 'function' || typeof wallet.balance !== 'function') {
      throw new Error('Postgres shop requires the Nexus economy wallet core.');
    }
    if (!repository) throw new Error('Postgres shop requires the Nexus economy repository.');
    this.wallet = wallet;
    this.repository = repository;
    this.catalogView = new ClusterShopService({ economy: Object.freeze({}), catalog: catalog || loadCatalog() });
  }

  listCatalog() { return this.catalogView.listCatalog(); }
  quote(input) { return this.catalogView.quote(input); }

  async order(orderId) {
    return this.repository.getOrder(cleanId(orderId, 'Order ID'));
  }

  async pendingBuyOrders() {
    return this.repository.listOrdersByStatus(['PAID_QUEUED', 'PLAYER_OFFLINE', 'DELIVERY_FAILED'], 100);
  }

  async createBuyOrder({ discordUserId, eosId, itemId, bundles = 1, server = 'where-playing', idempotencyKey } = {}) {
    const discord = cleanId(discordUserId, 'Discord user ID');
    const eos = cleanId(eosId, 'EOS ID');
    const idem = cleanIdempotencyKey(idempotencyKey);
    const quote = this.quote({ itemId, bundles, action: 'buy' });
    if (quote.bundles > MAX_ACTION_BUNDLES) throw new Error(`A single purchase is limited to ${MAX_ACTION_BUNDLES} bundles.`);

    const identityDigest = digest(`${discord}\u0000${idem}`);
    const requestId = `req_${identityDigest.slice(0, 40)}`;
    const orderId = `shop_${identityDigest.slice(0, 40)}`;
    const balance = await this.wallet.balance(discord, 'NEXUS_POINTS');
    if (balance < quote.totalPrice) return { ok: false, reason: 'insufficient-funds', currency: 'NEXUS_POINTS', balance };
    const projectedBalance = balance - quote.totalPrice;
    const planDigest = digest(JSON.stringify({
      requestId,
      orderId,
      discordUserId: discord,
      eosId: eos,
      itemId: quote.itemId,
      bundles: quote.bundles,
      totalQuantity: quote.totalQuantity,
      totalPrice: quote.totalPrice,
      blueprint: quote.blueprint,
      server: String(server || 'where-playing')
    }));
    const planId = `plan_${planDigest.slice(0, 32)}`;
    const record = createNexusEconomyPurchaseOutboxRecord().prepare({
      ok: true,
      actionReady: true,
      queueWritePermitted: false,
      executionPermitted: false,
      schemaVersion: 2,
      actionId: `action_${planDigest.slice(0, 32)}`,
      type: 'nexus.economy.purchase',
      capability: 'economy.purchase.execute',
      subject: `discord-user:${discord}`,
      correlationId: requestId,
      requestId,
      idempotencyKey: orderId,
      orderId,
      planId,
      payload: {
        planId,
        planDigest,
        discordUserId: discord,
        itemId: quote.itemId,
        quantity: quote.bundles,
        currency: SHOP_CURRENCY,
        totalPrice: quote.totalPrice,
        projectedBalance,
        fulfillment: 'rewards-ascended-item'
      }
    });
    if (!record.ok) throw new Error(`Purchase outbox record rejected: ${record.reason}`);

    return this.wallet.commitPurchase({
      record,
      eosId: eos,
      quote: { ...quote, server: String(server || 'where-playing').slice(0, 64) },
      validateQuote: async (committedQuote, committedRecord) => {
        const current = this.quote({ itemId: committedRecord.payload.itemId, bundles: committedRecord.payload.quantity, action: 'buy' });
        if (!sameQuote(current, committedQuote) || current.totalPrice !== committedRecord.payload.totalPrice) {
          throw new Error('Purchase quote changed; prepare a fresh quote.');
        }
      }
    });
  }

  async createSellOrder() {
    throw new Error('Postgres sellback cutover is not enabled.');
  }

  async confirmSellRemoval() {
    throw new Error('Postgres sellback cutover is not enabled.');
  }

  async markBuyDelivery({ orderId, status, deliveryReceipt = '', error = '' } = {}) {
    const allowed = new Set(['DELIVERY_IN_PROGRESS', 'DELIVERED', 'DELIVERY_FAILED', 'SENT_UNCONFIRMED', 'PLAYER_OFFLINE']);
    if (!allowed.has(String(status))) throw new Error('Invalid delivery status.');
    return this.repository.updateOrderDelivery({
      orderId: cleanId(orderId, 'Order ID'),
      status: String(status),
      deliveryReceipt: String(deliveryReceipt || '').slice(0, 500),
      error: String(error || '').slice(0, 500)
    });
  }
}

module.exports = {
  SHOP_CURRENCY,
  MAX_ACTION_BUNDLES,
  NexusEconomyPostgresShopService,
  cleanIdempotencyKey,
  sameQuote
};