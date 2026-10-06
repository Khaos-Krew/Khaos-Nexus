'use strict';

const crypto = require('node:crypto');
const { COMMUNITY_LEVEL_UP_SOURCE } = require('./nexus-economy-community-level-coins.cjs');
const { BIRTHDAY_GIFT_SOURCE } = require('./nexus-economy-birthday-gift.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { rankById } = require('../shared/ranks.cjs');
const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { normalizeUuid } = require('../craft/mc-rcon-text.cjs');
const { otherPresenceOnline, planMinecraftContribution, minecraftServerName, countsForSharedOnline, PRESENCE_TTL_MS } = require('../economy-worker/mc-playtime-accounting.cjs');
const { MemoryMcPoints, mcPlaytimeEligible, bumpMcMetric } = require('../economy-worker/mc-points-service.cjs');
const { economyPerkForRank } = require('../shared/nexus-economy-rank-perks.cjs');
const { memberIdentityHold, linkElevationHold } = require('./nexus-economy-identity-hold.cjs');
const { quarantineDenylist } = require('./nexus-economy-wallet-core.cjs');

const STORE_VERSION = 1;
const ONLINE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_ONLINE_POINTS = Object.freeze({
  'shadow-recruit': 2,
  'cipher-runner': 4,
  'nexus-raider': 4,
  'khaos-warden': 4,
  'blackout-legend': 4,
  'origin-founder': 10
});
const DEFAULT_OFFLINE_POINTS_PER_HOUR = Object.freeze({
  'shadow-recruit': 0,
  'cipher-runner': 4,
  'nexus-raider': 6,
  'khaos-warden': 8,
  'blackout-legend': 10,
  'origin-founder': 4
});
const DEFAULT_OFFLINE_CAP_HOURS = 48;
const MAX_LEDGER = 50_000;

function cleanId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
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
    state.processed = Object.fromEntries(Object.entries(state.processed).slice(-MAX_LEDGER * 2));
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
    this.env = options.env || process.env;
    const worker = this;
    this.minecraft = new MemoryMcPoints({
      now: () => worker.now(),
      env: options.env || process.env,
      wallet: {
        async resolve(discordUserId) {
          const account = worker.store.read().accounts?.[String(discordUserId || '').trim()];
          if (!account) return null;
          const rawStatus = String(account.status || '').trim().toLowerCase();
          return {
            economicIdentityId: account.discordUserId,
            status: rawStatus,
            holdReason: String(account.holdReason || '').trim(),
            verifiedAt: rawStatus === 'verified' ? (account.verifiedAt || account.createdAt || new Date(worker.now()).toISOString()) : (account.verifiedAt || null)
          };
        },
        balance: (discordUserId) => worker.balance(discordUserId),
        spend: (input) => worker.spend(input),
        credit: (input, creditOptions) => worker.credit(input, creditOptions),
        async lifetimeMs(discordUserId) {
          return Number(worker.store.read().accounts?.[discordUserId]?.mcLifetimeMs || 0);
        },
        async quarantined(economicIdentityId) {
          return quarantineDenylist(worker.env).has(String(economicIdentityId || ''));
        },
        ensureMinecraftMember: (discordUserId, options) => worker.ensureMinecraftMember(discordUserId, options)
      }
    });
  }

  // The in-game link code verifies a Minecraft member on this Discord wallet.
  // Unmarked restricted rows elevate on confirm. Held, disabled, and denylisted rows stay held.
  // An EOS id is never written here.
  ensureMinecraftMember(discordUserId, { elevate = false } = {}) {
    const id = cleanId(discordUserId);
    if (!id) return { ok: false, reason: 'discord-user-required' };
    return this.withLock(id, async () => {
      const state = this.store.read();
      let account = state.accounts[id] || null;
      const created = !account;
      if (!account) account = this.ensureAccount(state, id);
      if (created) {
        account.status = elevate ? 'verified' : 'restricted';
        account.holdReason = '';
        account.verifiedAt = elevate ? new Date(this.now()).toISOString() : null;
        account.eosIds = [];
      }
      if (quarantineDenylist(this.env).has(id) && !String(account.holdReason || '').trim()) {
        account.holdReason = 'quarantine';
        if (created) account.status = 'restricted';
      }
      const held = linkElevationHold({
        status: account.status,
        holdReason: account.holdReason,
        economicIdentityId: id,
        env: this.env
      });
      if (held) {
        this.store.write(state);
        return { ...held, commitStamp: quarantineDenylist(this.env).has(id), economicIdentityId: id };
      }
      if (elevate && String(account.status || '').trim().toLowerCase() === 'restricted') {
        account.status = 'verified';
        account.holdReason = '';
        account.verifiedAt = account.verifiedAt || new Date(this.now()).toISOString();
      } else if (elevate && String(account.status || '').trim().toLowerCase() === 'verified' && !account.verifiedAt) {
        account.verifiedAt = account.createdAt || new Date(this.now()).toISOString();
      }
      account.eosIds = Array.isArray(account.eosIds) ? account.eosIds : [];
      this.store.write(state);
      const rawStatus = String(account.status || '').trim().toLowerCase();
      return {
        ok: true,
        identity: {
          economicIdentityId: account.discordUserId,
          status: rawStatus,
          holdReason: String(account.holdReason || '').trim(),
          verifiedAt: rawStatus === 'verified' ? (account.verifiedAt || account.createdAt) : (account.verifiedAt || null)
        }
      };
    });
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
      status: 'verified',
      holdReason: '',
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
    if (key) state.processed[key] = entry.id;
    return { duplicate: false, entry };
  }

  accountHold(account, discordUserId) {
    const economicIdentityId = account?.discordUserId || cleanId(discordUserId);
    if (!account) return null;
    const status = String(account.status || '').trim().toLowerCase();
    if (!status) {
      return memberIdentityHold({ missingRow: true, economicIdentityId, env: this.env });
    }
    const hold = memberIdentityHold({
      status,
      holdReason: account.holdReason,
      economicIdentityId,
      env: this.env
    });
    if (hold) return hold;
    if (status === 'restricted') {
      return { ok: false, reason: 'verified-identity-required', message: 'Verified economic identity is required.', credited: 0 };
    }
    return null;
  }

  // Same in-process identity lock as spend and credit. A status written while the lock is held is visible here.
  memberHold(discordUserId) {
    return this.withLock(discordUserId, async () => {
      const state = this.store.read();
      const existing = state.accounts[cleanId(discordUserId)] || null;
      return this.accountHold(existing, discordUserId);
    });
  }

  credit({ discordUserId, amount, type = 'credit', source = 'nexus', idempotencyKey = '', metadata = {} } = {}, options = {}) {
    if (String(source || '').trim() === COMMUNITY_LEVEL_UP_SOURCE || String(source || '').trim() === BIRTHDAY_GIFT_SOURCE) {
      return { ok: false, skipped: 'coins-wallet-unavailable', currency: 'NEXUS_COINS' };
    }
    const staffRefund = options?.allowHeldStaffRefund === true && source === 'mc-shop' && type === 'reversal';
    return this.withLock(discordUserId, async () => {
      const value = whole(amount);
      if (value <= 0) throw new Error('Credit amount must be a positive whole number.');
      const state = this.store.read();
      const existing = state.accounts[cleanId(discordUserId)] || null;
      if (existing && idempotencyKey && state.processed[idempotencyKey]) return { ok: true, duplicate: true, balance: existing.balance, accountHold: false };
      const hold = this.accountHold(existing, discordUserId);
      if (hold && !staffRefund) return { ...hold, balance: existing?.balance || 0 };
      const account = this.ensureAccount(state, discordUserId, existing?.rankId);
      account.balance += value;
      account.updatedAt = new Date(this.now()).toISOString();
      const result = this.appendLedger(state, account, { amount: value, type, source, idempotencyKey, metadata });
      this.store.write(state);
      return { ok: true, duplicate: result.duplicate, balance: account.balance, transactionId: result.entry?.id || null, accountHold: Boolean(hold) };
    });
  }

  spend({ discordUserId, amount, orderId, source = 'cluster-shop', metadata = {}, idempotencyKey = '' } = {}) {
    return this.withLock(discordUserId, async () => {
      const value = whole(amount);
      if (value <= 0) throw new Error('Spend amount must be a positive whole number.');
      const explicit = String(idempotencyKey || '').trim();
      const key = explicit || `purchase:${String(orderId || '').trim()}`;
      if (!key || key === 'purchase:' || key.length > 200 || !/^[A-Za-z0-9:_-]+$/.test(key)) throw new Error('Order ID is required.');
      const state = this.store.read();
      const existing = state.accounts[cleanId(discordUserId)] || null;
      if (existing && state.processed[key]) return { ok: true, duplicate: true, balance: existing.balance };
      const hold = this.accountHold(existing, discordUserId);
      if (hold) return { ...hold, balance: existing?.balance || 0 };
      const account = this.ensureAccount(state, discordUserId, existing?.rankId);
      if (account.balance < value) return { ok: false, reason: 'insufficient-funds', balance: account.balance };
      account.balance -= value;
      account.updatedAt = new Date(this.now()).toISOString();
      const result = this.appendLedger(state, account, { amount: -value, type: 'purchase', source, idempotencyKey: key, metadata: { orderId, ...metadata } });
      this.store.write(state);
      return { ok: true, duplicate: result.duplicate, balance: account.balance, transactionId: result.entry?.id || null };
    });
  }

  accountOnline(account) {
    return Object.values(account.presenceByServer || {}).some((entry) => entry?.online === true);
  }

  accrueOnlineInterval(state, account, now, sourceServer, planned = null) {
    const previous = account.lastAccountingAt ? Date.parse(account.lastAccountingAt) : now;
    let gap = account.online ? Math.max(0, Math.min(now - previous, ONLINE_INTERVAL_MS * 2)) : 0;
    let source = sourceServer;
    if (planned) {
      gap = planned.gap;
      source = planned.creditSource || source;
      account.mcCountedDay = planned.mcCountedDay;
      account.mcCountedMs = planned.mcCountedMs;
      account.mcLifetimeMs = planned.mcLifetimeMs;
      account.mcOnline = planned.mcOnline;
      account.lastMcOnlineAt = planned.lastMcOnlineAt;
    }
    account.onlineUncreditedMs += gap;
    if (planned?.afkClawbackMs) account.onlineUncreditedMs = Math.max(0, account.onlineUncreditedMs - Number(planned.afkClawbackMs));
    account.lastAccountingAt = new Date(now).toISOString();

    while (account.onlineUncreditedMs >= ONLINE_INTERVAL_MS) {
      const endBucket = Math.floor(now / ONLINE_INTERVAL_MS);
      const outstandingBuckets = Math.floor(account.onlineUncreditedMs / ONLINE_INTERVAL_MS);
      const bucket = endBucket - outstandingBuckets + 1;
      const points = this.onlineRates[account.rankId] || 0;
      if (points > 0) {
        const key = `playtime:${account.discordUserId}:${bucket}`;
        if (!state.processed[key]) {
          account.balance += points;
          this.appendLedger(state, account, {
            amount: points,
            type: 'playtime',
            source,
            idempotencyKey: key,
            metadata: {
              rankId: account.rankId,
              intervalMinutes: ONLINE_INTERVAL_MS / 60_000,
              ...(planned?.mcUuid ? { mcUuid: planned.mcUuid } : {})
            }
          });
        }
      }
      account.onlineUncreditedMs -= ONLINE_INTERVAL_MS;
    }
  }

  #dryRunMinecraft(state, discordUserId, link, { online, server, mcUuid, afk = false }) {
    const account = state.accounts[discordUserId];
    const now = this.now();
    const wasOnline = Boolean(account?.online);
    const previous = account?.lastAccountingAt ? Date.parse(account.lastAccountingAt) : now;
    const accountingGap = wasOnline ? Math.max(0, Math.min(now - previous, ONLINE_INTERVAL_MS * 2)) : 0;
    const otherSource = otherPresenceOnline(account?.presenceByServer, now, PRESENCE_TTL_MS);
    const planned = planMinecraftContribution({
      mcCountedDay: account?.mcCountedDay || '',
      mcCountedMs: Number(account?.mcCountedMs || 0),
      mcLifetimeMs: Number(account?.mcLifetimeMs || 0),
      mcOnline: account?.mcOnline === true,
      lastMcOnlineAt: account?.lastMcOnlineAt,
      online: Boolean(online),
      nowMs: now,
      accountingGap,
      otherOnline: Boolean(otherSource),
      otherSource: otherSource || 'ark',
      maxGapMs: ONLINE_INTERVAL_MS * 2,
      afk: afk === true
    });
    const perk = economyPerkForRank(account?.rankId || 'shadow-recruit');
    const projectedUncredited = Math.max(0, Number(account?.onlineUncreditedMs || 0) + planned.gap - Number(planned.afkClawbackMs || 0));
    const projectedCredit = Math.floor(projectedUncredited / ONLINE_INTERVAL_MS) * Number(perk.onlinePointsPerFiveMinutes || 0);
    bumpMcMetric('dryRun');
    console.log(`[Nexus Economy] mc_playtime_dry_run identity=${link.economicIdentityId} server=${server} gap=${planned.gap} countedMs=${planned.mcCountedMs} capHit=${planned.capHit} projectedCredit=${projectedCredit} day=${planned.mcCountedDay} overflowDroppedMs=${planned.overflowDroppedMs} mcUuid=${mcUuid}`);
    if (account) {
      const previousLifetime = Number(account.mcLifetimeMs || 0);
      const delta = Number(planned.mcLifetimeMs || 0) - previousLifetime;
      account.mcCountedDay = planned.mcCountedDay;
      account.mcCountedMs = planned.mcCountedMs;
      account.mcLifetimeMs = planned.mcLifetimeMs;
      account.mcOnline = planned.mcOnline;
      account.lastMcOnlineAt = planned.lastMcOnlineAt;
      if (link) link.playtimeMs = Math.max(0, Number(link.playtimeMs || 0) + delta);
      this.store.write(state);
    }
    return { ok: true, dryRun: true, credited: 0, projectedCredit, capHit: planned.capHit, countedMs: planned.mcCountedMs, playtimeMs: Number(link?.playtimeMs || 0) };
  }

  async recordPresence({ eosId, mcUuid, online, rankId, server, provider, afk = false } = {}) {
    const minecraft = provider === 'minecraft' || (mcUuid && !eosId);
    const state = this.store.read();
    let discordUserId = '';
    let subjectId = '';
    let serverKey = minecraft ? (server == null || server === '' ? 'minecraft' : server) : cleanServer(server || 'ark');
    if (minecraft) {
      const gate = mcPointsFlags(this.env);
      if (!gate.pointsEnabled) return { ok: false, reason: 'mc-points-disabled', credited: 0 };
      if (!gate.playtimeEnabled && !gate.kitPlaytimeObservation) return { ok: false, reason: 'mc-playtime-disabled', credited: 0 };
      serverKey = minecraftServerName(serverKey);
      if (!serverKey) return { ok: false, reason: 'invalid-mc-server', credited: 0 };
      const uuid = normalizeUuid(mcUuid);
      const link = this.minecraft?.linkByUuid(uuid);
      const identity = link ? await this.minecraft.wallet.resolve(link.discordUserId) : null;
      if (identity) {
        const hold = memberIdentityHold({
          status: identity.status,
          holdReason: identity.holdReason,
          missingRow: !String(identity.status || '').trim(),
          economicIdentityId: identity.economicIdentityId,
          env: this.env
        });
        if (hold) return { ...hold, credited: 0 };
      }
      if (!mcPlaytimeEligible(identity, link)) return { ok: false, reason: 'unlinked-player' };
      discordUserId = link.discordUserId;
      subjectId = uuid;
      if (gate.dryRun) return this.#dryRunMinecraft(state, discordUserId, link, { online, server: serverKey, mcUuid: uuid, afk });
    } else {
      const eos = cleanId(eosId);
      discordUserId = state.eosToDiscord[eos];
      subjectId = eos;
      if (!discordUserId) return { ok: false, reason: 'unlinked-player' };
    }
    return this.withLock(discordUserId, async () => {
      const fresh = this.store.read();
      const syncedRank = fresh.accounts[discordUserId]?.rankId || 'shadow-recruit';
      const account = minecraft
        ? this.ensureAccount(fresh, discordUserId, syncedRank)
        : this.ensureAccount(fresh, discordUserId, rankId || syncedRank);
      const now = this.now();
      const hold = this.accountHold(account, discordUserId);
      if (hold) {
        account.lastAccountingAt = new Date(now).toISOString();
        account.onlineUncreditedMs = 0;
        account.updatedAt = account.lastAccountingAt;
        this.store.write(fresh);
        return { ...hold, online: account.online, server: serverKey, balance: account.balance, rankId: account.rankId };
      }
      const wasOnline = Boolean(account.online);
      const previous = account.lastAccountingAt ? Date.parse(account.lastAccountingAt) : now;
      const accountingGap = wasOnline ? Math.max(0, Math.min(now - previous, ONLINE_INTERVAL_MS * 2)) : 0;
      let planned = null;
      if (minecraft) {
        const otherSource = otherPresenceOnline(account.presenceByServer, now, PRESENCE_TTL_MS);
        planned = planMinecraftContribution({
          mcCountedDay: account.mcCountedDay || '',
          mcCountedMs: Number(account.mcCountedMs || 0),
          mcLifetimeMs: Number(account.mcLifetimeMs || 0),
          mcOnline: account.mcOnline === true,
          lastMcOnlineAt: account.lastMcOnlineAt,
          online: Boolean(online),
          nowMs: now,
          accountingGap,
          otherOnline: Boolean(otherSource),
          otherSource: otherSource || 'ark',
          maxGapMs: ONLINE_INTERVAL_MS * 2,
          afk: afk === true
        });
        planned.mcUuid = subjectId;
        const link = this.minecraft.linkByUuid(subjectId);
        const previousLifetime = Number(account.mcLifetimeMs || 0);
        const lifetimeDelta = Number(planned.mcLifetimeMs || 0) - previousLifetime;
        if (link) link.playtimeMs = Math.max(0, Number(link.playtimeMs || 0) + lifetimeDelta);
      }
      this.accrueOnlineInterval(fresh, account, now, serverKey, planned);
      const sharedOnline = countsForSharedOnline(Boolean(online), { minecraft, capHit: planned?.capHit === true });
      account.presenceByServer[serverKey] = minecraft
        ? { online: sharedOnline, mcUuid: subjectId, at: new Date(now).toISOString() }
        : { online: sharedOnline, eosId: subjectId, at: new Date(now).toISOString() };
      account.online = this.accountOnline(account);
      account.lastPresenceAt = new Date(now).toISOString();

      if (!wasOnline && account.online) {
        await this.accrueOfflineInternal(fresh, account, now);
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
      const existing = state.accounts[cleanId(discordUserId)] || null;
      const hold = this.accountHold(existing, discordUserId);
      if (hold) {
        if (existing) {
          existing.lastPassiveAt = new Date(this.now()).toISOString();
          existing.updatedAt = existing.lastPassiveAt;
          this.store.write(state);
        }
        return { ...hold, balance: existing?.balance || 0 };
      }
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
