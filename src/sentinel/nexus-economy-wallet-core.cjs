'use strict';

const { createNexusEconomyPurchaseActionRequest } = require('./nexus-economy-purchase-action-request.cjs');
const { normalizeCurrency } = require('./nexus-economy-postgres-repository.cjs');
const { memberIdentityHold, MEMBER_HOLD_MESSAGE, quarantineDenylist } = require('./nexus-economy-identity-hold.cjs');

// Reads status while the caller already holds the identity/currency transaction lock.
// A locked row wins over the pre-transaction snapshot so a concurrent status change is respected.
async function guardMemberMutation(tx, loaded, env = process.env) {
  let status = loaded.status;
  let economicIdentityId = loaded.economicIdentityId;
  let verifiedAt = loaded.verified_at;
  let missingRow = false;
  if (tx && typeof tx.lockIdentity === 'function') {
    const row = await tx.lockIdentity(economicIdentityId);
    if (row) {
      status = row.status;
      economicIdentityId = row.economic_identity_id || row.economicIdentityId || economicIdentityId;
      if (Object.prototype.hasOwnProperty.call(row, 'verified_at') || Object.prototype.hasOwnProperty.call(row, 'verifiedAt')) {
        verifiedAt = row.verified_at ?? row.verifiedAt ?? null;
      }
    } else {
      missingRow = true;
    }
  }
  const hold = memberIdentityHold({ status, economicIdentityId, missingRow, env });
  if (hold) return { hold, economicIdentityId, status };
  if (String(status || '') !== 'verified' || !verifiedAt) {
    throw new Error('Verified economic identity is required.');
  }
  return { hold: null, economicIdentityId, status };
}

function cleanId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function positiveWhole(value, label = 'Amount') {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[0-9]+$/.test(value))) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${label} must be a positive whole number.`);
  return amount;
}

function priorResult(prior, { economicIdentityId, currency, amount, type, source }) {
  if (
    prior.economicIdentityId !== economicIdentityId ||
    prior.currency !== currency ||
    prior.amount !== amount ||
    prior.type !== type ||
    prior.source !== source
  ) {
    throw new Error('Idempotency key is already bound to a different wallet mutation.');
  }
  return { ok: true, duplicate: true, currency, balance: Number(prior.balanceAfter), transactionId: prior.id };
}

function walletBalance(wallet) {
  const balance = Number(wallet?.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Wallet balance is invalid.');
  return balance;
}

class NexusEconomyWalletCore {
  constructor({ repository, now = () => new Date(), env = process.env } = {}) {
    if (!repository || typeof repository.transact !== 'function') throw new Error('Economy repository with transact() is required.');
    this.repository = repository;
    this.now = now;
    this.env = env || process.env;
  }

  async loadLinkedIdentity(discordUserId) {
    const discord = cleanId(discordUserId, 'Discord user ID');
    if (typeof this.repository.getIdentityByLink !== 'function') throw new Error('Economy repository identity resolution is required.');
    const identity = await this.repository.getIdentityByLink('discord', discord);
    if (!identity) throw new Error('Verified economic identity is required.');
    return {
      discordUserId: discord,
      economicIdentityId: cleanId(identity.economic_identity_id ?? identity.economicIdentityId, 'Economic identity ID'),
      status: identity.status,
      verified_at: identity.verified_at ?? identity.verifiedAt ?? null
    };
  }

  // Reads status while the caller already holds the identity/currency transaction lock.
  // A locked row wins over the pre-transaction snapshot so a concurrent status change is respected.
  async guardMemberMutation(tx, loaded) {
    return guardMemberMutation(tx, loaded, this.env);
  }

  async resolveDiscordIdentity(discordUserId) {
    const loaded = await this.loadLinkedIdentity(discordUserId);
    if (String(loaded.status || '') !== 'verified' || !loaded.verified_at) throw new Error('Verified economic identity is required.');
    return { discordUserId: loaded.discordUserId, economicIdentityId: loaded.economicIdentityId };
  }

  async balance(discordUserId, currency = 'NEXUS_POINTS') {
    const discord = cleanId(discordUserId, 'Discord user ID');
    const normalizedCurrency = normalizeCurrency(currency);
    if (typeof this.repository.getWalletByDiscord !== 'function') throw new Error('Economy repository wallet lookup is required.');
    const wallet = await this.repository.getWalletByDiscord(discord, normalizedCurrency);
    return wallet ? walletBalance(wallet) : 0;
  }

  async balances(discordUserId) {
    const result = {};
    for (const currency of ['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']) {
      result[currency] = await this.balance(discordUserId, currency);
    }
    return Object.freeze(result);
  }

  async credit({ discordUserId, amount, idempotencyKey, source = 'nexus', type = 'credit', currency = 'NEXUS_POINTS', metadata = {} } = {}) {
    const normalizedCurrency = normalizeCurrency(currency);
    const loaded = await this.loadLinkedIdentity(discordUserId);
    const value = positiveWhole(amount);
    const key = cleanId(idempotencyKey, 'Idempotency key');
    return this.repository.transact(loaded.economicIdentityId, normalizedCurrency, async (tx) => {
      const guard = await this.guardMemberMutation(tx, loaded);
      const prior = await tx.findLedgerByKey(key);
      if (prior) return priorResult(prior, {
        economicIdentityId: guard.economicIdentityId,
        currency: normalizedCurrency,
        amount: value,
        type,
        source
      });
      if (guard.hold) return { ...guard.hold, currency: normalizedCurrency };
      const wallet = await tx.getOrCreateWallet(guard.economicIdentityId, normalizedCurrency);
      const balance = walletBalance(wallet) + value;
      if (!Number.isSafeInteger(balance)) throw new Error('Wallet balance exceeds the supported range.');
      const entry = await tx.appendLedger({
        economicIdentityId: guard.economicIdentityId,
        currency: normalizedCurrency,
        amount: value,
        balanceAfter: balance,
        type,
        source,
        idempotencyKey: key,
        metadata: { ...metadata, currency: normalizedCurrency },
        at: this.now().toISOString()
      });
      await tx.setBalance(guard.economicIdentityId, normalizedCurrency, balance);
      return { ok: true, duplicate: false, currency: normalizedCurrency, balance, transactionId: entry?.id || null };
    });
  }

  async spend({ discordUserId, amount, orderId, source = 'cluster-shop', currency = 'NEXUS_POINTS', metadata = {}, idempotencyKey = '' } = {}) {
    const normalizedCurrency = normalizeCurrency(currency);
    const loaded = await this.loadLinkedIdentity(discordUserId);
    const value = positiveWhole(amount);
    const order = cleanId(orderId, 'Order ID');
    const key = idempotencyKey ? cleanId(idempotencyKey, 'Idempotency key') : `purchase_${order}`;
    return this.repository.transact(loaded.economicIdentityId, normalizedCurrency, async (tx) => {
      const guard = await this.guardMemberMutation(tx, loaded);
      const prior = await tx.findLedgerByKey(key);
      if (prior) return priorResult(prior, {
        economicIdentityId: guard.economicIdentityId,
        currency: normalizedCurrency,
        amount: -value,
        type: 'purchase',
        source
      });
      if (guard.hold) return { ...guard.hold, currency: normalizedCurrency };
      const wallet = await tx.getOrCreateWallet(guard.economicIdentityId, normalizedCurrency);
      const current = walletBalance(wallet);
      if (current < value) return { ok: false, reason: 'insufficient-funds', currency: normalizedCurrency, balance: current };
      const balance = current - value;
      const entry = await tx.appendLedger({
        economicIdentityId: guard.economicIdentityId,
        currency: normalizedCurrency,
        amount: -value,
        balanceAfter: balance,
        type: 'purchase',
        source,
        idempotencyKey: key,
        metadata: { ...metadata, orderId: order, currency: normalizedCurrency },
        at: this.now().toISOString()
      });
      await tx.setBalance(guard.economicIdentityId, normalizedCurrency, balance);
      return { ok: true, duplicate: false, currency: normalizedCurrency, balance, transactionId: entry?.id || null };
    });
  }


  async commitPurchase({ record, eosId, quote, validateQuote } = {}) {
    record = structuredClone(record);
    quote = structuredClone(quote);
    const projection = createNexusEconomyPurchaseActionRequest().prepare(record);
    if (!projection.ok) throw new Error(`Purchase record rejected: ${projection.reason}`);
    const eos = cleanId(eosId, 'EOS ID');
    if (typeof validateQuote !== 'function') throw new Error('Current quote validation is required.');
    const { discordUserId, totalPrice, projectedBalance } = record.payload;
    const normalizedCurrency = normalizeCurrency(record.payload.currency);
    let economicIdentityId = '';
    let statusHint = 'verified';
    if (typeof this.repository.getIdentityByLink === 'function') {
      const linked = await this.repository.getIdentityByLink('discord', discordUserId);
      if (!linked) throw new Error('Verified economic identity is required.');
      economicIdentityId = cleanId(linked.economic_identity_id ?? linked.economicIdentityId, 'Economic identity ID');
      statusHint = linked.status || 'verified';
    } else if (typeof this.repository.resolveVerifiedIdentity === 'function') {
      const resolved = await this.repository.resolveVerifiedIdentity({ discordUserId, eosId: eos });
      if (!resolved) throw new Error('Verified economic identity is required.');
      economicIdentityId = cleanId(resolved.economic_identity_id ?? resolved.economicIdentityId, 'Economic identity ID');
      statusHint = resolved.status || 'verified';
    } else {
      throw new Error('Economy repository identity resolution is required.');
    }

    return this.repository.transact(economicIdentityId, normalizedCurrency, async (tx) => {
      let lockedStatus = statusHint;
      let lockedIdentityId = economicIdentityId;
      let missingRow = false;
      if (typeof tx.lockIdentity === 'function') {
        const row = await tx.lockIdentity(economicIdentityId);
        if (row) {
          lockedStatus = row.status;
          lockedIdentityId = row.economic_identity_id || row.economicIdentityId || economicIdentityId;
        } else {
          missingRow = true;
        }
      }
      const prior = await tx.findOrder(record.orderId);
      if (prior) {
        if (
          prior.recordDigest !== record.recordDigest ||
          prior.discordUserId !== discordUserId ||
          prior.eosId !== eos ||
          prior.economicIdentityId !== economicIdentityId ||
          prior.currency !== normalizedCurrency
        ) {
          throw new Error('Order idempotency key is already bound to another purchase.');
        }
        return { ok: true, duplicate: true, order: prior, currency: normalizedCurrency, balance: prior.balance };
      }
      const hold = memberIdentityHold({ status: lockedStatus, economicIdentityId: lockedIdentityId, missingRow, env: this.env });
      if (hold) return { ...hold, currency: normalizedCurrency };
      const verified = await tx.findIdentity(discordUserId, eos);
      const verifiedIdentityId = verified?.economic_identity_id ?? verified?.economicIdentityId;
      if (!verifiedIdentityId || verifiedIdentityId !== economicIdentityId) throw new Error('Verified economic identity is required.');
      await validateQuote(quote, record);
      const wallet = await tx.getOrCreateWallet(economicIdentityId, normalizedCurrency);
      const current = walletBalance(wallet);
      if (current < totalPrice) return { ok: false, reason: 'insufficient-funds', currency: normalizedCurrency, balance: current };
      const balance = current - totalPrice;
      if (balance !== projectedBalance) throw new Error('Purchase balance changed; prepare a fresh quote.');
      const key = `purchase_${record.orderId}`;
      if (await tx.findLedgerByKey(key)) throw new Error('Purchase debit exists without its atomic order.');
      const at = this.now().toISOString();
      const entry = await tx.appendLedger({
        economicIdentityId,
        currency: normalizedCurrency,
        amount: -totalPrice,
        balanceAfter: balance,
        type: 'purchase',
        source: 'cluster-shop',
        idempotencyKey: key,
        metadata: { orderId: record.orderId, requestId: record.requestId, currency: normalizedCurrency },
        at
      });
      await tx.setBalance(economicIdentityId, normalizedCurrency, balance);
      const order = {
        orderId: record.orderId,
        requestId: record.requestId,
        economicIdentityId,
        discordUserId,
        eosId: eos,
        currency: normalizedCurrency,
        type: 'BUY',
        status: 'PAID_QUEUED',
        recordDigest: record.recordDigest,
        transactionId: entry.id,
        balance,
        quote,
        createdAt: at,
        updatedAt: at
      };
      await tx.appendOrder(order);
      await tx.appendOutbox(record);
      return { ok: true, duplicate: false, order, currency: normalizedCurrency, balance };
    });
  }
}


const { attachAdminWalletMutations } = require('./nexus-economy-wallet-admin.cjs');
const { attachCommunityLevelCoinGrants } = require('./nexus-economy-community-level-coins.cjs');
const walletMutationHelpers = {
  cleanId,
  positiveWhole,
  priorResult,
  walletBalance,
  quarantineDenylist
};
attachAdminWalletMutations(NexusEconomyWalletCore, walletMutationHelpers);
attachCommunityLevelCoinGrants(NexusEconomyWalletCore, walletMutationHelpers);

module.exports = {
  NexusEconomyWalletCore,
  positiveWhole,
  walletBalance,
  quarantineDenylist,
  memberIdentityHold,
  MEMBER_HOLD_MESSAGE,
  guardMemberMutation
};
