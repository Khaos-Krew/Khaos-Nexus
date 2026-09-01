'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CACHE_POOLS, rollCache } = require('./ark-dino-cache-engine.cjs');
const {
  ArkDinoCachePurchaseService,
  assertDeliverableRoll,
  buildDinoDepotCommand,
  cleanEosId
} = require('./ark-dino-cache-purchase.cjs');

const STORE_VERSION = 2;
const ACTIVE_STATES = new Set(['pending_charge', 'sealed', 'revealed', 'delivery_pending', 'delivering', 'delivered']);
const TERMINAL_STATES = new Set(['delivered', 'refunded', 'charge_failed', 'cancelled']);

function nowIso() { return new Date().toISOString(); }
function clean(value, max = 160) { return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max); }
function safeDiscordId(value) {
  const id = String(value || '').trim();
  if (!/^\d{15,24}$/.test(id)) throw new Error('A valid Discord user id is required for Dino Cache ownership.');
  return id;
}
function newId() { return `dc_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`; }

class SealedDinoCacheStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-dino-cache-sealed-v2.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        version: STORE_VERSION,
        records: Array.isArray(parsed?.records) ? parsed.records.slice(-10000) : []
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return { version: STORE_VERSION, records: [] };
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const next = {
      version: STORE_VERSION,
      updatedAt: nowIso(),
      records: Array.isArray(state?.records) ? state.records.slice(-10000) : []
    };
    const temp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.file);
    return next;
  }

  create({ discordUserId, eosId, cacheId, price, roll, purchaseSource = 'discord' } = {}) {
    const state = this.read();
    const timestamp = nowIso();
    const record = {
      id: newId(),
      discordUserId: safeDiscordId(discordUserId),
      eosId: cleanEosId(eosId),
      cacheId: String(cacheId || '').toLowerCase(),
      price: Number(price),
      purchaseSource: clean(purchaseSource, 40) || 'discord',
      state: 'pending_charge',
      revealStatus: 'sealed',
      deliveryStatus: 'not_queued',
      announcementStatus: 'pending',
      announcementMessageId: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      revealedAt: '',
      deliveredAt: '',
      lastDeliveryAttemptAt: '',
      deliveryAttempts: 0,
      lastError: '',
      roll: JSON.parse(JSON.stringify(roll || {}))
    };
    state.records.push(record);
    this.write(state);
    return JSON.parse(JSON.stringify(record));
  }

  get(id) {
    const key = String(id || '');
    return this.read().records.find((record) => record.id === key) || null;
  }

  listForDiscord(discordUserId, { limit = 30 } = {}) {
    const userId = safeDiscordId(discordUserId);
    return this.read().records
      .filter((record) => record.discordUserId === userId)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 30)));
  }

  listDeliveryPending({ limit = 20 } = {}) {
    return this.read().records
      .filter((record) => ['revealed', 'delivery_pending'].includes(record.state) && record.deliveryStatus !== 'delivered')
      .sort((a, b) => Date.parse(a.updatedAt || 0) - Date.parse(b.updatedAt || 0))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
  }

  mutate(id, updater) {
    const state = this.read();
    const index = state.records.findIndex((record) => record.id === String(id || ''));
    if (index < 0) throw new Error('Dino Cache reward record was not found.');
    const current = state.records[index];
    const next = updater({ ...current, roll: JSON.parse(JSON.stringify(current.roll || {})) }) || current;
    next.updatedAt = nowIso();
    state.records[index] = next;
    this.write(state);
    return JSON.parse(JSON.stringify(next));
  }

  transition(id, stateName, patch = {}) {
    return this.mutate(id, (record) => ({ ...record, ...patch, state: String(stateName || record.state) }));
  }
}

function cacheCooldownFromSealed(store, eosId, cacheId, now = Date.now()) {
  const id = String(cacheId || '').toLowerCase();
  const pool = CACHE_POOLS[id];
  const cooldownHours = Number(pool?.cooldownHours || 0);
  if (!(cooldownHours > 0)) return { active: false, cooldownHours: 0, remainingSeconds: 0 };
  const player = cleanEosId(eosId);
  const last = store.read().records
    .filter((record) => record.eosId === player && record.cacheId === id && ACTIVE_STATES.has(record.state) && record.state !== 'charge_failed')
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
  if (!last) return { active: false, cooldownHours, remainingSeconds: 0 };
  const startedAt = Date.parse(last.createdAt || '');
  if (!Number.isFinite(startedAt)) return { active: false, cooldownHours, remainingSeconds: 0 };
  const expiresAt = startedAt + cooldownHours * 60 * 60 * 1000;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return { active: remainingSeconds > 0, cooldownHours, remainingSeconds, expiresAt: new Date(expiresAt).toISOString() };
}

class SealedDinoCacheService {
  constructor({ prefix = 'ARK_GEN1', purchaseService, store, rng, logger = console } = {}) {
    this.prefix = prefix;
    this.logger = logger;
    this.store = store || new SealedDinoCacheStore();
    this.purchaseService = purchaseService || new ArkDinoCachePurchaseService({ prefix, rng });
    this.rng = rng;
  }

  async sealPurchase({ discordUserId, eosId, cacheId, purchaseSource = 'discord' } = {}) {
    const userId = safeDiscordId(discordUserId);
    const player = cleanEosId(eosId);
    const id = String(cacheId || '').toLowerCase();
    const pool = CACHE_POOLS[id];
    if (!pool) throw new Error(`Unknown Dino Cache: ${cacheId}.`);

    const cooldown = cacheCooldownFromSealed(this.store, player, id);
    if (cooldown.active) return { ok: false, reason: 'cooldown', cacheId: id, ...cooldown };

    const roll = rollCache(id, this.rng);
    assertDeliverableRoll(roll);
    const balance = await this.purchaseService.points(player);
    if (balance < roll.price) return { ok: false, reason: 'insufficient-points', cacheId: id, balance, price: roll.price };

    const record = this.store.create({ discordUserId: userId, eosId: player, cacheId: id, price: roll.price, roll, purchaseSource });
    try {
      await this.purchaseService.changePoints(player, -roll.price);
      const sealed = this.store.transition(record.id, 'sealed', { chargedAt: nowIso(), revealStatus: 'sealed' });
      return { ok: true, record: sealed, balanceBefore: balance, balanceAfter: balance - roll.price };
    } catch (error) {
      this.store.transition(record.id, 'charge_failed', { lastError: clean(error?.message || error, 300) });
      throw error;
    }
  }

  getOwned(recordId, discordUserId) {
    const record = this.store.get(recordId);
    if (!record) throw new Error('That Dino Cache reward no longer exists.');
    if (record.discordUserId !== safeDiscordId(discordUserId)) throw new Error('That Dino Cache belongs to another Discord account.');
    return record;
  }

  reveal(recordId, discordUserId) {
    const current = this.getOwned(recordId, discordUserId);
    if (['refunded', 'charge_failed', 'cancelled'].includes(current.state)) throw new Error('That Dino Cache cannot be revealed.');
    if (current.revealStatus === 'revealed') return current;
    if (current.state !== 'sealed') throw new Error(`Dino Cache is not revealable from state '${current.state}'.`);
    return this.store.transition(current.id, 'revealed', {
      revealStatus: 'revealed',
      revealedAt: nowIso(),
      deliveryStatus: 'queued'
    });
  }

  async deliver(recordId) {
    let record = this.store.get(recordId);
    if (!record) throw new Error('Dino Cache delivery record was not found.');
    if (record.deliveryStatus === 'delivered' || record.state === 'delivered') return { ok: true, alreadyDelivered: true, record };
    if (record.revealStatus !== 'revealed') throw new Error('Dino Cache must be revealed before delivery.');
    assertDeliverableRoll(record.roll);

    record = this.store.transition(record.id, 'delivery_pending', {
      deliveryStatus: 'pending',
      lastDeliveryAttemptAt: nowIso(),
      deliveryAttempts: Number(record.deliveryAttempts || 0) + 1
    });
    try {
      const command = buildDinoDepotCommand({ eosId: record.eosId, blueprint: record.roll.blueprint, level: record.roll.level });
      const response = await this.purchaseService.rcon.execute(command);
      const delivered = this.store.transition(record.id, 'delivered', {
        deliveryStatus: 'delivered',
        deliveredAt: nowIso(),
        lastError: ''
      });
      return { ok: true, record: delivered, response: clean(response, 300) };
    } catch (error) {
      const pending = this.store.transition(record.id, 'delivery_pending', {
        deliveryStatus: 'pending',
        lastError: clean(error?.message || error, 300)
      });
      return { ok: false, pending: true, record: pending, error };
    }
  }

  async processDeliveryQueue({ limit = 10 } = {}) {
    const pending = this.store.listDeliveryPending({ limit });
    const results = [];
    for (const record of pending) {
      try { results.push(await this.deliver(record.id)); }
      catch (error) { results.push({ ok: false, record, error }); }
    }
    return results;
  }
}

module.exports = {
  STORE_VERSION,
  ACTIVE_STATES,
  TERMINAL_STATES,
  SealedDinoCacheStore,
  SealedDinoCacheService,
  cacheCooldownFromSealed,
  safeDiscordId,
  clean
};
