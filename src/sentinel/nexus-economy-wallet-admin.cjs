'use strict';

const { normalizeCurrency } = require('./nexus-economy-postgres-repository.cjs');

const BASELINE_WALLET_UNAVAILABLE_REASON = 'baseline-wallet-unavailable';
const SHADOW_RECRUIT_RANK_ID = 'shadow-recruit';
const MISSING_ADMIN_IDENTITY_MESSAGE = /^(?:Economic identity is required\.|Verified economic identity is required\.)$/;

function isMissingAdminIdentityError(error) {
  return MISSING_ADMIN_IDENTITY_MESSAGE.test(String(error?.message || '').trim());
}

function baselineWalletUnavailable(rejected) {
  const code = String(rejected || 'ensure-failed').replace(/[^\w.-]+/g, '-').slice(0, 64) || 'ensure-failed';
  return {
    ok: false,
    reason: BASELINE_WALLET_UNAVAILABLE_REASON,
    rejected: code
  };
}

function shadowRecruitEnsureSucceeded(ensured) {
  if (!ensured || ensured.ok !== true || ensured.rejected || ensured.skipped) return false;
  return Boolean(ensured.economicIdentityId || ensured.economic_identity_id);
}

// ensureShadowRecruitWallet rewrites accrual rank. Call it only when no Discord
// economic identity exists so verified, restricted, disabled, and quarantine-override
// adjusts keep their current identity path.
async function ensureMissingShadowRecruitWallet(repository, discordUserId, env) {
  if (typeof repository?.ensureShadowRecruitWallet !== 'function') {
    return baselineWalletUnavailable('ensure-unsupported');
  }
  let ensured;
  try {
    ensured = await repository.ensureShadowRecruitWallet(discordUserId, SHADOW_RECRUIT_RANK_ID, { env });
  } catch (error) {
    console.warn(`[Nexus Economy] admin adjust baseline wallet ensure failed: ${String(error?.message || error).slice(0, 240)}`);
    return baselineWalletUnavailable('ensure-failed');
  }
  if (!shadowRecruitEnsureSucceeded(ensured)) {
    return baselineWalletUnavailable(ensured?.rejected || ensured?.skipped || 'ensure-failed');
  }
  return { ok: true };
}

async function resolveForAdminAdjust(wallet, discordUserId, { allowOverride = false, env = process.env, allowEnsure = true } = {}) {
  try {
    const identity = await wallet.resolveAdminDiscordIdentity(discordUserId, { allowOverride, env });
    return { ok: true, identity };
  } catch (error) {
    if (!isMissingAdminIdentityError(error)) throw error;
    if (!allowEnsure) return baselineWalletUnavailable('identity-still-missing');
    const ensured = await ensureMissingShadowRecruitWallet(wallet.repository, discordUserId, env);
    if (ensured.ok === false) return ensured;
    return resolveForAdminAdjust(wallet, discordUserId, { allowOverride, env, allowEnsure: false });
  }
}

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
    const value = positiveWhole(amount);
    const key = cleanId(idempotencyKey, 'Idempotency key');
    const resolved = await resolveForAdminAdjust(this, discordUserId, { allowOverride, env });
    if (resolved.ok === false) return resolved;
    const identity = resolved.identity;
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
    const value = positiveWhole(amount);
    const key = cleanId(idempotencyKey, 'Idempotency key');
    const resolved = await resolveForAdminAdjust(this, discordUserId, { allowOverride, env });
    if (resolved.ok === false) return resolved;
    const identity = resolved.identity;
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

module.exports = {
  attachAdminWalletMutations,
  BASELINE_WALLET_UNAVAILABLE_REASON,
  isMissingAdminIdentityError
};
