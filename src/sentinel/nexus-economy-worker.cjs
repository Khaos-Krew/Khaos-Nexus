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
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid account identity.');
  return id;
}

function cleanServer(value) {
  return String(value || 'ark').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'ark';
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
    // Dedupe receipts must outlive the display ledger; pruning permits replayed credits.
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
    const nowIso = new Date(this.now()).toISOString();
    state.accounts[id] ||= {
      discordUserId: id,
      balance: 0,
      rankId: rank.id,
      eosIds: [],
      online: false,
      onlineSince: null,
      onlineUncreditedMs: 0,
      lastAccountingAt: null,
      lastPresenceAt: null,
      presenceByServer: {},
      offlineSince: nowIso,
      lastPassiveAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    const account = state.accounts[id];
    account.rankId = rank.id;
    account.presenceByServer ||= {};
    account.onlineUncreditedMs = Math.max(0, Number(account.onlineUncreditedMs) || 0);
    return account;
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

  syncIdentitySnapshot({ profiles, observedAt } = {}) {
    const observed = Date.parse(observedAt);
    if (!Array.isArray(profiles) || profiles.length > 10000 || !Number.isFinite(observed) || Math.abs(this.now() - observed) > 180_000) throw new Error('A fresh verified identity snapshot is required.');
    const state = this.store.read();
    if (Date.parse(state.identitySnapshotAt || 0) >= observed) return { ok: true, duplicate: true };
    const index = {};
    const seen = new Set();
    for (const profile of profiles) {
      const discord = cleanId(profile.discordUserId);
      if (seen.has(discord) || !Array.isArray(profile.eosIds) || profile.eosIds.length > 20) throw new Error('Invalid identity snapshot.');
      seen.add(discord);
      for (const raw of profile.eosIds) {
        const eos = cleanId(raw);
        if (Object.hasOwn(index, eos)) throw new Error('Duplicate EOS identity in snapshot.');
        index[eos] = discord;
      }
    }
    const now = this.now();
    for (const profile of profiles) {
      const id = cleanId(profile.discordUserId);
      const old = state.accounts[id];
      if (old) { this.expirePresence(old, now); this.accrueOfflineInternal(state, old, now); this.accrueOnlineInterval(state, old, now, 'identity-sync'); }
      const account = this.ensureAccount(state, id, profile.rankId);
      account.eosIds = profile.eosIds.map(cleanId);
    }
    for (const account of Object.values(state.accounts)) {
      if (!seen.has(account.discordUserId)) account.eosIds = [];
      let revoked = false;
      for (const [server, entry] of Object.entries(account.presenceByServer || {})) {
        if (index[entry.eosId] !== account.discordUserId) { delete account.presenceByServer[server]; revoked = true; }
      }
      if (revoked && account.online && !this.accountOnline(account)) {
        account.online = false; account.onlineSince = null;
        account.offlineSince = new Date(now).toISOString(); account.lastPassiveAt = account.offlineSince;
      }
    }
    state.eosToDiscord = index;
    state.identitySnapshotAt = new Date(observed).toISOString();
    this.store.write(state);
    return { ok: true, linked: Object.keys(index).length, failed: 0 };
  }

  accountByEos(eosId) {
    const state = this.store.read();
    const discordUserId = state.eosToDiscord[cleanId(eosId)];
    return discordUserId ? state.accounts[discordUserId] || null : null;
  }

  wallet(discordUserId) {
    const account = this.store.read().accounts[cleanId(discordUserId)];
    if (!account) return null;
    return JSON.parse(JSON.stringify(account));
  }

  balance(discordUserId) {
    return this.store.read().accounts[cleanId(discordUserId)]?.balance || 0;
  }

  appendLedger(state, account, { amount, type, source, idempotencyKey, metadata = {} }) {
    const key = String(idempotencyKey || '').trim();
    if (key && state.processed[key]) return { duplicate: true, entry: null };
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
    if (key) state.processed[key] = { id: entry.id, discordUserId: entry.discordUserId, amount, type, source };
    return { duplicate: false, entry };
  }

  duplicateReceipt(state, key, { discordUserId, amount, type, source }) {
    const saved = state.processed[key];
    if (!saved) return null;
    const receipt = typeof saved === 'string' ? state.ledger.find((entry) => entry.id === saved) : saved;
    if (!receipt || receipt.discordUserId !== cleanId(discordUserId) || receipt.amount !== amount || receipt.type !== type || receipt.source !== source) {
      throw new Error('Idempotency key conflicts with an existing or unverifiable transaction.');
    }
    return { ok: true, duplicate: true, balance: state.accounts[cleanId(discordUserId)]?.balance || 0, transactionId: receipt.id };
  }

  addBalance(account, amount) {
    const next = account.balance + amount;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('Wallet balance is outside the safe integer range.');
    account.balance = next;
  }

  credit({ discordUserId, amount, type = 'credit', source = 'nexus', idempotencyKey = '', metadata = {} } = {}) {
    return this.withLock(discordUserId, async () => {
      const value = whole(amount);
      if (value <= 0) throw new Error('Credit amount must be a positive whole number.');
      idempotencyKey = String(idempotencyKey || '').trim();
      if (!idempotencyKey || idempotencyKey.length > 200) throw new Error('A stable idempotency key of at most 200 characters is required.');
      const state = this.store.read();
      const duplicate = this.duplicateReceipt(state, idempotencyKey, { discordUserId, amount: value, type, source });
      if (duplicate) return duplicate;
      const account = this.ensureAccount(state, discordUserId, state.accounts[cleanId(discordUserId)]?.rankId);
      this.addBalance(account, value);
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
      const account = this.ensureAccount(state, discordUserId, state.accounts[cleanId(discordUserId)]?.rankId);
      const duplicate = this.duplicateReceipt(state, key, { discordUserId, amount: -value, type: 'purchase', source });
      if (duplicate) return duplicate;
      if (account.balance < value) return { ok: false, reason: 'insufficient-funds', balance: account.balance };
      this.addBalance(account, -value);
      account.updatedAt = new Date(this.now()).toISOString();
      const result = this.appendLedger(state, account, { amount: -value, type: 'purchase', source, idempotencyKey: key, metadata: { orderId, ...metadata } });
      this.store.write(state);
      return { ok: true, duplicate: result.duplicate, balance: account.balance, transactionId: result.entry?.id || null };
    });
  }

  expirePresence(account, now = this.now()) {
    const expired = Object.values(account.presenceByServer || {}).some(entry => entry?.online && now - Date.parse(entry.at) > ONLINE_INTERVAL_MS * 2);
    if (!expired) return;
    for (const entry of Object.values(account.presenceByServer || {})) {
      if (entry?.online && now - Date.parse(entry.at) > ONLINE_INTERVAL_MS * 2) entry.online = false;
    }
    if (account.online && !this.accountOnline(account)) {
      account.online = false;
      account.onlineSince = null;
      account.offlineSince = new Date(now).toISOString();
      account.lastPassiveAt = account.offlineSince;
      account.lastAccountingAt = account.offlineSince;
    }
  }

  async recordPresenceSnapshot({ server, eosIds, observedAt } = {}) {
    const observed = Date.parse(observedAt);
    if (!server || !Array.isArray(eosIds) || eosIds.length > 200 || !Number.isFinite(observed) || observed > this.now() + 30_000 || observed < this.now() - 180_000) throw new Error('A fresh, complete server presence snapshot is required.');
    const serverKey = cleanServer(server);
    const current = new Set(eosIds.map(cleanId));
    const state = this.store.read();
    const previousAt = Date.parse(state.presenceSnapshots?.[serverKey] || 0);
    if (previousAt >= observed) return { ok: true, duplicate: true };
    const all = new Set(current);
    for (const account of Object.values(state.accounts)) {
      const entry = account.presenceByServer?.[serverKey];
      if (entry?.online && entry.eosId) all.add(entry.eosId);
    }
    for (const eosId of all) await this.recordPresence({ eosId, online: current.has(eosId), server: serverKey });
    const fresh = this.store.read();
    fresh.presenceSnapshots ||= {};
    fresh.presenceSnapshots[serverKey] = new Date(observed).toISOString();
    this.store.write(fresh);
    return { ok: true, online: current.size, offline: all.size - current.size };
  }

  accountOnline(account) {
    return Object.values(account.presenceByServer || {}).some((entry) => entry?.online === true);
  }

  accrueOnlineInterval(state, account, now, sourceServer) {
    const previous = account.lastAccountingAt ? Date.parse(account.lastAccountingAt) : now;
    if (account.online) account.onlineUncreditedMs += Math.max(0, Math.min(now - previous, ONLINE_INTERVAL_MS * 2));
    account.lastAccountingAt = new Date(now).toISOString();

    while (account.onlineUncreditedMs >= ONLINE_INTERVAL_MS) {
      const endBucket = Math.floor(now / ONLINE_INTERVAL_MS);
      const outstandingBuckets = Math.floor(account.onlineUncreditedMs / ONLINE_INTERVAL_MS);
      const bucket = endBucket - outstandingBuckets + 1;
      const points = this.onlineRates[account.rankId] || 0;
      if (points > 0) {
        const key = `playtime:${account.discordUserId}:${bucket}`;
        if (!state.processed[key]) {
          this.addBalance(account, points);
          this.appendLedger(state, account, {
            amount: points,
            type: 'playtime',
            source: sourceServer,
            idempotencyKey: key,
            metadata: { rankId: account.rankId, intervalMinutes: ONLINE_INTERVAL_MS / 60_000 }
          });
        }
      }
      account.onlineUncreditedMs -= ONLINE_INTERVAL_MS;
    }
  }

  async recordPresence({ eosId, online, rankId, server = 'ark' } = {}) {
    const state = this.store.read();
    const eos = cleanId(eosId);
    const discordUserId = state.eosToDiscord[eos];
    if (!discordUserId) return { ok: false, reason: 'unlinked-player' };
    return this.withLock(discordUserId, async () => {
      const fresh = this.store.read();
      const account = this.ensureAccount(fresh, discordUserId, rankId || fresh.accounts[discordUserId]?.rankId);
      const now = this.now();
      const serverKey = cleanServer(server);
      this.expirePresence(account, now);
      const wasOnline = Boolean(account.online);

      this.accrueOnlineInterval(fresh, account, now, serverKey);
      if (!wasOnline && online) this.accrueOfflineInternal(fresh, account, now);
      account.presenceByServer[serverKey] = { online: Boolean(online), eosId: eos, at: new Date(now).toISOString() };
      account.online = this.accountOnline(account);
      account.lastPresenceAt = new Date(now).toISOString();

      if (!wasOnline && account.online) {
        account.onlineSince = new Date(now).toISOString();
        account.offlineSince = null;
        account.lastAccountingAt = new Date(now).toISOString();
      } else if (wasOnline && !account.online) {
        account.offlineSince = new Date(now).toISOString();
        account.lastPassiveAt = new Date(now).toISOString();
        account.onlineSince = null;
        account.lastAccountingAt = new Date(now).toISOString();
      }

      account.updatedAt = new Date(now).toISOString();
      this.store.write(fresh);
      return { ok: true, online: account.online, server: serverKey, balance: account.balance, rankId: account.rankId };
    });
  }

  accrueOfflineInternal(state, account, now = this.now()) {
    if (account.online) return 0;
    const rate = this.offlineRates[account.rankId] || 0;
    if (rate <= 0) return 0;
    const start = account.lastPassiveAt ? Date.parse(account.lastPassiveAt) : (account.offlineSince ? Date.parse(account.offlineSince) : now);
    const cappedMs = Math.min(Math.max(0, now - start), this.offlineCapHours * 60 * 60_000);
    const wholeHours = Math.floor(cappedMs / 3_600_000);
    if (wholeHours <= 0) return 0;
    const points = wholeHours * rate;
    // Discard time beyond the cap so repeated reads cannot drain an old backlog.
    const end = now - (cappedMs % 3_600_000);
    const key = `passive:${account.discordUserId}:${start}:${end}:${account.rankId}`;
    if (!state.processed[key]) {
      this.addBalance(account, points);
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
      this.expirePresence(account);
      const points = this.accrueOfflineInternal(state, account, this.now());
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
