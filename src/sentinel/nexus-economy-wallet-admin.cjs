'use strict';

const { normalizeCurrency } = require('./nexus-economy-postgres-repository.cjs');

function attachAdminWalletMutations(WalletCoreClass, {
  cleanId,
  positiveWhole,
  priorResult,
  walletBalance,
  quarantineDenylist
}) {
  WalletCoreClass.prototype.resolveAdminDiscordIdentity = async function resolveAdminDiscordIdentity(
    discordUserId,
    { allowOverride = false, env = process.env } = {}
  ) {
    const discord = cleanId(discordUserId, 'Discord user ID');
    if (typeof this.repository.getIdentityByLink !== 'function') {
      throw new Error('Economy repository identity resolution is required.');
    }
    const identity = await this.repository.getIdentityByLink('discord', discord);
    if (!identity) throw new Error('Economic identity is required.');
    const status = String(identity.status || '');
    if (status === 'disabled') throw new Error('Economic identity is disabled.');
    if (status !== 'verified' && status !== 'restricted') {
      throw new Error('Economic identity status does not allow admin adjustment.');
    }
    const economicIdentityId = cleanId(
      identity.economic_identity_id ?? identity.economicIdentityId,
      'Economic identity ID'
    );
    if (quarantineDenylist(env).has(economicIdentityId) && !allowOverride) {
      throw new Error('Economic identity is quarantine-denylisted.');
    }
    return { discordUserId: discord, economicIdentityId, status };
  };

  WalletCoreClass.prototype.adminCredit = async function adminCredit(input = {}) {
    const {
      discordUserId,
      amount,
      idempotencyKey,
      source = 'discord-guild-owner-adjust',
      type = 'admin-credit',
      currency = 'NEXUS_POINTS',
      metadata = {},
      allowOverride = false,
      env = process.env
    } = input;
    const normalizedCurrency = normalizeCurrency(currency);
    const identity = await this.resolveAdminDiscordIdentity(discordUserId, { allowOverride, env });
    const value = positiveWhole(amount);
    const key = cleanId(idempotencyKey, 'Idempotency key');
    return this.repository.transact(identity.economicIdentityId, normalizedCurrency, async (tx) => {
      const prior = await tx.findLedgerByKey(key);
      if (prior) {
        return priorResult(prior, {
          economicIdentityId: identity.economicIdentityId,
          currency: normalizedCurrency,
          amount: value,
          type,
          source
        });
      }
      const wallet = await tx.getOrCreateWallet(identity.economicIdentityId, normalizedCurrency);
      const balance = walletBalance(wallet) + value;
      if (!Number.isSafeInteger(balance)) throw new Error('Wallet balance exceeds the supported range.');
      const entry = await tx.appendLedger({
        economicIdentityId: identity.economicIdentityId,
        currency: normalizedCurrency,
        amount: value,
        balanceAfter: balance,
        type,
        source,
        idempotencyKey: key,
        metadata: {
          ...metadata,
          currency: normalizedCurrency,
          adminAdjust: true,
          identityStatus: identity.status
        },
        at: this.now().toISOString()
      });
      await tx.setBalance(identity.economicIdentityId, normalizedCurrency, balance);
      return { ok: true, duplicate: false, currency: normalizedCurrency, balance, transactionId: entry?.id || null };
    });
  };

  WalletCoreClass.prototype.adminSpend = async function adminSpend(input = {}) {
    const {
      discordUserId,
      amount,
      idempotencyKey,
      source = 'discord-guild-owner-adjust',
      type = 'admin-debit',
      currency = 'NEXUS_POINTS',
      metadata = {},
      allowOverride = false,
      env = process.env
    } = input;
    const normalizedCurrency = normalizeCurrency(currency);
    const identity = await this.resolveAdminDiscordIdentity(discordUserId, { allowOverride, env });
    const value = positiveWhole(amount);
    const key = cleanId(idempotencyKey, 'Idempotency key');
    return this.repository.transact(identity.economicIdentityId, normalizedCurrency, async (tx) => {
      const prior = await tx.findLedgerByKey(key);
      if (prior) {
        return priorResult(prior, {
          economicIdentityId: identity.economicIdentityId,
          currency: normalizedCurrency,
          amount: -value,
          type,
          source
        });
      }
      const wallet = await tx.getOrCreateWallet(identity.economicIdentityId, normalizedCurrency);
      const current = walletBalance(wallet);
      if (current < value) return { ok: false, reason: 'insufficient-funds', currency: normalizedCurrency, balance: current };
      const balance = current - value;
      const entry = await tx.appendLedger({
        economicIdentityId: identity.economicIdentityId,
        currency: normalizedCurrency,
        amount: -value,
        balanceAfter: balance,
        type,
        source,
        idempotencyKey: key,
        metadata: {
          ...metadata,
          currency: normalizedCurrency,
          adminAdjust: true,
          identityStatus: identity.status
        },
        at: this.now().toISOString()
      });
      await tx.setBalance(identity.economicIdentityId, normalizedCurrency, balance);
      return { ok: true, duplicate: false, currency: normalizedCurrency, balance, transactionId: entry?.id || null };
    });
  };
}

module.exports = { attachAdminWalletMutations };
