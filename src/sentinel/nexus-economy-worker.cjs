'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { rankById } = require('../shared/ranks.cjs');

const STORE_VERSION = 1;
const ONLINE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_ONLINE_POINTS = Object.freeze({
  'shadow-recruit': 2,
  'cipher-runner': 4,
  'nexus-raider': 4,
  'khaos-warden': 4,
  'blackout-legend': 4,
  'origin-founder': 4
});
const DEFAULT_OFFLINE_POINTS_PER_HOUR = Object.freeze({
  'shadow-recruit': 0,
  'cipher-runner': 4,
  'nexus-raider': 6,
  'khaos-warden': 8,
  'blackout-legend': 10,
  'origin-founder': 10
});
const DEFAULT_OFFLINE_CAP_HOURS = 48;
const MAX_LEDGER = 50_000;

function cleanId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
}

function whole(value, fallback = 0) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function loadRates(envName, defaults) {
  const raw = String(process.env[envName] || '').trim();
  if (!raw) return { ...defaults };
  try {
    const parsed = JSON.parse(raw);
    return Object.fromEntries(Object.keys(defaults).map((key) => [key, Math.max(0, whole(parsed?.[key], defaults[key]))]));
  } catch {
    throw new Error(`${envName} must be valid JSON.`);
  }
}

class NexusEconomyStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'nexus-economy.json');
  }

  empty() {
    return { version: STORE_VERSION, accounts: {}, eosToDiscord: {}, ledger: [], processed: {} };
  }

  read() {
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state?.version !== STORE_VERSION || !state.accounts || !state.eosToDiscord || !Array.isArray(state.ledger) || !state.processed) {
        throw new Error('Nexus economy state is invalid.');
      }
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return this.empty();
      throw error;
    }
  }

  write(state) {
    state.version = STORE_VERSION;
    state.updatedAt = new Date().toISOString();
    state.ledger = state.ledger.slice(-MAX_LEDGER);
    const processedEntries = Object.entries(state.processed).slice(-MAX_LEDGER * 2);
    state.processed = Object.fromEntries(processedEntries);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return state;
  }
}

class NexusEconomyWorker {
  constructor(options = {}) {
    this.store = options.store || new NexusEconomyStore();
    this.now = options.now || Date.now;
    this.onlineRates = options.onlineRates || loadRates('NEXUS_ECONOMY_ONLINE_RATES_JSON', DEFAULT_ONLINE_POINTS);
    this.offlineRates = options.offlineRates || loadRates('NEXUS_ECONOMY_OFFLINE_RATES_JSON', DEFAULT_OFFLINE_POINTS_PER_HOUR);
    this.offlineCapHours = Math.max(1, whole(process.env.NEXUS_ECONOMY_OFFLINE_CAP_HOURS, DEFAULT_OFFLINE_CAP_HOURS));
    this.locks = new Map();
  }

  withLock(discordUserId, fn) {
    const key = cleanId(discordUserId);
    if (!key) throw new Error('Discord user ID is required.');
    const prior = this.locks.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(fn);
    this.locks.set(key, next);
    return next.finally(() => { if (this.locks.get(key) === next) this.locks.delete(key); });
  }

  ensureAccount(state, discordUserId, rankId = 'shadow-recruit') {
    const id = cleanId(discordUserId);
    if (!id) throw new Error('Discord user ID is required.');
    const rank = rankById(rankId) || rankById('shadow-recruit');
    state.accounts[id] ||= {
      discordUserId: id,
      balance: 0,
      rankId: rank.id,
      eosIds: [],
      online: false,
      onlineSince: null,
      onlineUncreditedMs: 0,
      lastPresenceAt: null,
      offlineSince: new Date(this.now()).toISOString(),
      lastPassiveAt: new Date(this.now()).toISOString(),
      createdAt: new Date(this.now()).toISOString(),
      updatedAt: new Date(this.now()).toISOString()
    };
    state.accounts[id].rankId = rank.id;
    return state.accounts[id];
  }

  linkArkIdentity({ discordUserId, eosId, rankId = 'shadow-recruit' } = {}) {
    const state = this.store.read();
    const account = this.ensureAccount(state, discordUserId, rankId);
    const eos = cleanId(eosId);
    if (!eos) throw new Error('EOS ID is required.');
    const prior = state.eosToDiscord[eos];
    if (prior && prior !== account.discordUserId) throw new Error('EOS ID is already linked to another Nexus wallet.');
    if (!account.eosIds.includes(eos)) account.eosIds.push(eos);
    state.eosToDiscord[eos] = account.discordUserId;
    account.updatedAt = new Date(this.now()).toISOString();
    this.store.write(state);
    return { discordUserId: account.discordUserId, eosId: eos, rankId: account.rankId, balance: account.balance };
  }

  accountByEos(eosId) {
    const state = this.store.read();
    const discordUserId = state.eosToDiscord[cleanId(eosId)];
    return discordUserId ? state.accounts[discordUserId] || null : null;
  }

  balance(discordUserId) {
    return this.store.read().accounts[cleanId(discordUserId)]?.balance || 0;
  }

  appendLedger(state, account, { amount, type, source, idempotencyKey, metadata = {} }) {
    const key = String(idempotencyKey || '').trim();
    if (key && state.processed[key]) return { duplicate: true, entry: state.processed[key] };
    const entry = {
      id: crypto.randomUUID(),
      discordUserId: account.discordUserId,
      amount,
      balanceAfter: account.balance,
      type,
      source,
      metadata,
      at: new Date(this.now()).toISOString()
    };
    state.ledger.push(entry);
    if (key) state.processed[key] = entry.id;
    return { duplicate: false, entry };
  }

  credit({ discordUserId, amount, type = 'credit', source = 'nexus', idempotencyKey = '', metadata = {} } = {}) {
    return this.withLock(discordUserId, async () => {
      const value = whole(amount);
      if (value <= 0) throw new Error('Credit amount must be a positive whole number.');
      const state = this.store.read();
      const account = this.ensureAccount(state, discordUserId);
      if (idempotencyKey && state.processed[idempotencyKey]) return { ok: true, duplicate: true, balance: account.balance };
      account.balance += value;
      account.updatedAt = new Date(this.now()).toISOString();
      const result = this.appendLedger(state, account, { amount: value, type, source, idempotencyKey, metadata });
      this.store.write(state);
      return { ok: true, duplicate: result.duplicate, balance: account.balance, transactionId: result.entry?.id || null };
    });
  }

  spend({ discordUserId, amount, orderId, source = 'cluster-shop', metadata = {} } = {}) {
    return this.withLock(discordUserId, async () => {
      const value = whole(amount);
      if (value <= 0) throw new Error('Spend amount must be a positive whole number.');
      const key = `purchase:${String(orderId || '').trim()}`;
      if (key === 'purchase:') throw new Error('Order ID is required.');
      const state = this.store.read();
      const account = this.ensureAccount(state, discordUserId);
      if (state.processed[key]) return { ok: true, duplicate: true, balance: account.balance };
      if (account.balance < value) return { ok: false, reason: 'insufficient-funds', balance: account.balance };
      account.balance -= value;
      account.updatedAt = new Date(this.now()).toISOString();
      const result = this.appendLedger(state, account, { amount: -value, type: 'purchase', source, idempotencyKey: key, metadata: { orderId, ...metadata } });
      this.store.write(state);
      return { ok: true, duplicate: result.duplicate, balance: account.balance, transactionId: result.entry?.id || null };
    });
  }

  async recordPresence({ eosId, online, rankId, server = 'ark' } = {}) {
    const state = this.store.read();
    const discordUserId = state.eosToDiscord[cleanId(eosId)];
    if (!discordUserId) return { ok: false, reason: 'unlinked-player' };
    return this.withLock(discordUserId, async () => {
      const fresh = this.store.read();
      const account = this.ensureAccount(fresh, discordUserId, rankId || fresh.accounts[discordUserId]?.rankId);
      const now = this.now();
      const wasOnline = Boolean(account.online);
      const previous = account.lastPresenceAt ? Date.parse(account.lastPresenceAt) : now;
      if (wasOnline && online) account.onlineUncreditedMs += Math.max(0, Math.min(now - previous, ONLINE_INTERVAL_MS * 2));
      account.online = Boolean(online);
      account.lastPresenceAt = new Date(now).toISOString();
      if (!wasOnline && online) {
        await this.accrueOfflineInternal(fresh, account, now);
        account.onlineSince = new Date(now).toISOString();
        account.offlineSince = null;
      }
      while (account.online && account.onlineUncreditedMs >= ONLINE_INTERVAL_MS) {
        const bucket = Math.floor(now / ONLINE_INTERVAL_MS) - Math.floor(account.onlineUncreditedMs / ONLINE_INTERVAL_MS);
        const points = this.onlineRates[account.rankId] || 0;
        if (points > 0) {
          const key = `playtime:${account.discordUserId}:${bucket}`;
          if (!fresh.processed[key]) {
            account.balance += points;
            this.appendLedger(fresh, account, { amount: points, type: 'playtime', source: server, idempotencyKey: key, metadata: { eosId: cleanId(eosId), rankId: account.rankId } });
          }
        }
        account.onlineUncreditedMs -= ONLINE_INTERVAL_MS;
      }
      if (wasOnline && !online) {
        account.offlineSince = new Date(now).toISOString();
        account.lastPassiveAt = new Date(now).toISOString();
        account.onlineSince = null;
      }
      account.updatedAt = new Date(now).toISOString();
      this.store.write(fresh);
      return { ok: true, online: account.online, balance: account.balance, rankId: account.rankId };
    });
  }

  async accrueOfflineInternal(state, account, now = this.now()) {
    if (account.online) return 0;
    const rate = this.offlineRates[account.rankId] || 0;
    if (rate <= 0) return 0;
    const start = account.lastPassiveAt ? Date.parse(account.lastPassiveAt) : (account.offlineSince ? Date.parse(account.offlineSince) : now);
    const cappedMs = Math.min(Math.max(0, now - start), this.offlineCapHours * 60 * 60_000);
    const wholeHours = Math.floor(cappedMs / 3_600_000);
    if (wholeHours <= 0) return 0;
    const points = wholeHours * rate;
    const end = start + wholeHours * 3_600_000;
    const key = `passive:${account.discordUserId}:${start}:${end}:${account.rankId}`;
    if (!state.processed[key]) {
      account.balance += points;
      this.appendLedger(state, account, { amount: points, type: 'passive-income', source: 'paid-rank', idempotencyKey: key, metadata: { rankId: account.rankId, hours: wholeHours, ratePerHour: rate } });
    }
    account.lastPassiveAt = new Date(end).toISOString();
    return points;
  }

  accrueOffline(discordUserId) {
    return this.withLock(discordUserId, async () => {
      const state = this.store.read();
      const account = state.accounts[cleanId(discordUserId)];
      if (!account) return { ok: false, reason: 'wallet-not-found' };
      const points = await this.accrueOfflineInternal(state, account, this.now());
      account.updatedAt = new Date(this.now()).toISOString();
      this.store.write(state);
      return { ok: true, credited: points, balance: account.balance };
    });
  }

  health() {
    try {
      const state = this.store.read();
      return { ok: true, accounts: Object.keys(state.accounts).length, linkedArkIds: Object.keys(state.eosToDiscord).length, ledgerEntries: state.ledger.length };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }
}

module.exports = {
  STORE_VERSION,
  ONLINE_INTERVAL_MS,
  DEFAULT_ONLINE_POINTS,
  DEFAULT_OFFLINE_POINTS_PER_HOUR,
  DEFAULT_OFFLINE_CAP_HOURS,
  NexusEconomyStore,
  NexusEconomyWorker
};
