'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ORDER_VERSION = 1;
const DEFAULT_MAX_BUNDLES = 100;
const FORBIDDEN_SELL_KINDS = new Set(['dino', 'dinos', 'creature', 'creatures', 'dino-cache']);

function cleanId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
}

function whole(value, fallback = 0) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function money(value) {
  const n = whole(value, -1);
  return n >= 0 ? n : -1;
}

function loadCatalog(raw = process.env.NEXUS_CLUSTER_SHOP_CATALOG_JSON || '[]') {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || '[]'));
  } catch {
    throw new Error('NEXUS_CLUSTER_SHOP_CATALOG_JSON must be valid JSON.');
  }
  if (!Array.isArray(parsed)) throw new Error('Cluster shop catalog must be an array.');

  const out = new Map();
  for (const input of parsed) {
    const id = cleanId(input?.id);
    if (!id) throw new Error('Every cluster shop item requires an id.');
    if (out.has(id)) throw new Error(`Duplicate cluster shop item id: ${id}`);

    const kind = String(input?.kind || 'item').trim().toLowerCase();
    const baseQuantity = Math.max(1, whole(input?.baseQuantity ?? input?.base_quantity, 1));
    const buyPrice = money(input?.buyPrice ?? input?.buy_price);
    const explicitSellPrice = money(input?.sellPrice ?? input?.sell_price);
    const sellRateRaw = Number(input?.sellRate ?? input?.sell_rate ?? 0);
    const sellRate = Number.isFinite(sellRateRaw) ? Math.max(0, Math.min(1, sellRateRaw)) : 0;
    const minBundles = Math.max(1, whole(input?.minBundles ?? input?.min_bundles, 1));
    const maxBundles = Math.max(minBundles, Math.min(10_000, whole(input?.maxBundles ?? input?.max_bundles, DEFAULT_MAX_BUNDLES)));
    const forbiddenSell = FORBIDDEN_SELL_KINDS.has(kind);
    const sellPrice = explicitSellPrice >= 0 ? explicitSellPrice : (buyPrice >= 0 ? Math.floor(buyPrice * sellRate) : -1);

    out.set(id, Object.freeze({
      id,
      name: String(input?.name || id).trim().slice(0, 100),
      description: String(input?.description || '').trim().slice(0, 300),
      category: String(input?.category || 'General').trim().slice(0, 64),
      kind,
      blueprint: String(input?.blueprint || '').trim(),
      baseQuantity,
      buyPrice,
      sellPrice,
      minBundles,
      maxBundles,
      buyable: input?.buyable !== false && buyPrice > 0,
      sellable: !forbiddenSell && input?.sellable === true && sellPrice > 0,
      metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    }));
  }
  return out;
}

class ShopOrderStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'nexus-cluster-shop-orders.json');
  }

  empty() {
    return { version: ORDER_VERSION, orders: {}, idempotency: {} };
  }

  read() {
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state?.version !== ORDER_VERSION || !state.orders || !state.idempotency) throw new Error('Cluster shop order state is invalid.');
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return this.empty();
      throw error;
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    state.version = ORDER_VERSION;
    state.updatedAt = new Date().toISOString();
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return state;
  }
}

class ClusterShopService {
  constructor({ economy, store, catalog } = {}) {
    if (!economy) throw new Error('ClusterShopService requires an economy worker.');
    this.economy = economy;
    this.store = store || new ShopOrderStore();
    this.catalog = catalog || loadCatalog();
  }

  listCatalog() {
    return [...this.catalog.values()].map((item) => ({ ...item }));
  }

  item(itemId) {
    return this.catalog.get(cleanId(itemId)) || null;
  }

  quote({ itemId, bundles = 1, action = 'buy' } = {}) {
    const item = this.item(itemId);
    if (!item) throw new Error('Unknown cluster shop item.');
    const count = whole(bundles, 0);
    if (count < item.minBundles || count > item.maxBundles) {
      throw new Error(`Bundle quantity must be between ${item.minBundles} and ${item.maxBundles}.`);
    }
    const mode = String(action || 'buy').toLowerCase();
    if (mode !== 'buy' && mode !== 'sell') throw new Error('Shop action must be buy or sell.');
    if (mode === 'buy' && !item.buyable) throw new Error('This item is not available to buy.');
    if (mode === 'sell' && (!item.sellable || FORBIDDEN_SELL_KINDS.has(item.kind))) {
      throw new Error('This item cannot be sold to the cluster shop.');
    }
    const unitPrice = mode === 'buy' ? item.buyPrice : item.sellPrice;
    return {
      itemId: item.id,
      name: item.name,
      kind: item.kind,
      action: mode,
      bundles: count,
      baseQuantity: item.baseQuantity,
      totalQuantity: item.baseQuantity * count,
      unitPrice,
      totalPrice: unitPrice * count,
      blueprint: item.blueprint,
      category: item.category
    };
  }

  order(orderId) {
    return this.store.read().orders[cleanId(orderId)] || null;
  }

  async createBuyOrder({ discordUserId, eosId, itemId, bundles = 1, server = 'where-playing', idempotencyKey = '' } = {}) {
    const discord = cleanId(discordUserId);
    const eos = cleanId(eosId);
    if (!discord || !eos) throw new Error('Discord user ID and EOS ID are required.');
    const quote = this.quote({ itemId, bundles, action: 'buy' });
    const state = this.store.read();
    const idem = String(idempotencyKey || '').trim().slice(0, 200);
    if (idem && state.idempotency[idem]) return { ok: true, duplicate: true, order: state.orders[state.idempotency[idem]] };

    const orderId = `NXARK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const order = {
      orderId,
      type: 'BUY',
      status: 'PENDING_PAYMENT',
      discordUserId: discord,
      eosId: eos,
      server: String(server || 'where-playing').slice(0, 64),
      quote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.orders[orderId] = order;
    if (idem) state.idempotency[idem] = orderId;
    this.store.write(state);

    const spent = await this.economy.spend({
      discordUserId: discord,
      amount: quote.totalPrice,
      orderId,
      source: 'cluster-shop',
      metadata: { itemId: quote.itemId, bundles: quote.bundles, totalQuantity: quote.totalQuantity, server: order.server }
    });

    const fresh = this.store.read();
    const current = fresh.orders[orderId];
    if (!spent.ok) {
      current.status = spent.reason === 'insufficient-funds' ? 'PAYMENT_REJECTED' : 'PAYMENT_FAILED';
      current.payment = spent;
    } else {
      current.status = 'PAID_QUEUED';
      current.payment = spent;
    }
    current.updatedAt = new Date().toISOString();
    this.store.write(fresh);
    return { ok: spent.ok, duplicate: false, order: current, balance: spent.balance };
  }

  createSellOrder({ discordUserId, eosId, itemId, bundles = 1, server = 'where-playing', idempotencyKey = '' } = {}) {
    const discord = cleanId(discordUserId);
    const eos = cleanId(eosId);
    if (!discord || !eos) throw new Error('Discord user ID and EOS ID are required.');
    const quote = this.quote({ itemId, bundles, action: 'sell' });
    const state = this.store.read();
    const idem = String(idempotencyKey || '').trim().slice(0, 200);
    if (idem && state.idempotency[idem]) return { ok: true, duplicate: true, order: state.orders[state.idempotency[idem]] };

    const orderId = `NXSELL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const order = {
      orderId,
      type: 'SELL',
      status: 'AWAITING_ITEM_REMOVAL',
      discordUserId: discord,
      eosId: eos,
      server: String(server || 'where-playing').slice(0, 64),
      quote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.orders[orderId] = order;
    if (idem) state.idempotency[idem] = orderId;
    this.store.write(state);
    return { ok: true, duplicate: false, order };
  }

  async confirmSellRemoval({ orderId, removalReceipt } = {}) {
    const id = cleanId(orderId);
    const receipt = String(removalReceipt || '').trim().slice(0, 300);
    if (!id || !receipt) throw new Error('Order ID and ARK removal receipt are required.');
    const state = this.store.read();
    const order = state.orders[id];
    if (!order || order.type !== 'SELL') throw new Error('Sell order not found.');
    if (order.status === 'COMPLETE') return { ok: true, duplicate: true, order };
    if (order.status !== 'AWAITING_ITEM_REMOVAL' && order.status !== 'ITEMS_REMOVED') throw new Error(`Sell order cannot be completed from ${order.status}.`);

    order.status = 'ITEMS_REMOVED';
    order.removalReceipt = receipt;
    order.updatedAt = new Date().toISOString();
    this.store.write(state);

    const credited = await this.economy.credit({
      discordUserId: order.discordUserId,
      amount: order.quote.totalPrice,
      type: 'shop-sellback',
      source: 'cluster-shop',
      idempotencyKey: `sell:${order.orderId}`,
      metadata: { orderId: order.orderId, itemId: order.quote.itemId, bundles: order.quote.bundles, totalQuantity: order.quote.totalQuantity, removalReceipt: receipt }
    });

    const fresh = this.store.read();
    const current = fresh.orders[id];
    current.status = 'COMPLETE';
    current.walletCredit = credited;
    current.completedAt = new Date().toISOString();
    current.updatedAt = current.completedAt;
    this.store.write(fresh);
    return { ok: true, duplicate: credited.duplicate, order: current, balance: credited.balance };
  }

  markBuyDelivery({ orderId, status, deliveryReceipt = '', error = '' } = {}) {
    const id = cleanId(orderId);
    const allowed = new Set(['DELIVERY_IN_PROGRESS', 'DELIVERED', 'DELIVERY_FAILED', 'SENT_UNCONFIRMED', 'PLAYER_OFFLINE']);
    if (!allowed.has(String(status))) throw new Error('Invalid delivery status.');
    const state = this.store.read();
    const order = state.orders[id];
    if (!order || order.type !== 'BUY') throw new Error('Buy order not found.');
    if (order.status === 'DELIVERED') return { ok: true, duplicate: true, order };
    if (!['PAID_QUEUED', 'PLAYER_OFFLINE', 'DELIVERY_IN_PROGRESS', 'SENT_UNCONFIRMED', 'DELIVERY_FAILED'].includes(order.status)) {
      throw new Error(`Buy order cannot transition from ${order.status}.`);
    }
    order.status = String(status);
    if (deliveryReceipt) order.deliveryReceipt = String(deliveryReceipt).slice(0, 500);
    if (error) order.deliveryError = String(error).slice(0, 500);
    if (order.status === 'DELIVERED') order.deliveredAt = new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    this.store.write(state);
    return { ok: true, duplicate: false, order };
  }

  pendingBuyOrders() {
    const orders = Object.values(this.store.read().orders);
    return orders.filter((order) => order.type === 'BUY' && ['PAID_QUEUED', 'PLAYER_OFFLINE', 'DELIVERY_FAILED'].includes(order.status));
  }
}

module.exports = {
  ORDER_VERSION,
  FORBIDDEN_SELL_KINDS,
  loadCatalog,
  ShopOrderStore,
  ClusterShopService
};
