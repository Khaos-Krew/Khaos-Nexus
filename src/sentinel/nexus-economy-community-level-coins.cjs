'use strict';

const { normalizeCurrency } = require('./nexus-economy-postgres-repository.cjs');

const COMMUNITY_LEVEL_UP_SOURCE = 'community-level-up';
const COMMUNITY_LEVEL_UP_TYPE = 'credit';
const SHADOW_RECRUIT_RANK_ID = 'shadow-recruit';

function isCommunityLevelCoinGrant(input = {}) {
  return String(input?.source || '').trim() === COMMUNITY_LEVEL_UP_SOURCE;
}

function shadowRecruitEnsureSucceeded(ensured) {
  if (!ensured || ensured.ok !== true || ensured.rejected || ensured.skipped) return false;
  return Boolean(ensured.economicIdentityId || ensured.economic_identity_id);
}

function attachCommunityLevelCoinGrants(WalletCoreClass, {
  cleanId,
  positiveWhole,
  priorResult,
  walletBalance,
  quarantineDenylist
}) {
  async function resolveRewardIdentity(wallet, discordUserId, env) {
    const discord = cleanId(discordUserId, 'Discord user ID');
    if (typeof wallet.repository.getIdentityByLink !== 'function') {
      return { ok: false, skipped: 'wallet-identity-missing', reason: 'identity-resolution-unavailable' };
    }
    const identity = await wallet.repository.getIdentityByLink('discord', discord);
    if (!identity) return { ok: false, missing: true, discordUserId: discord };
    const status = String(identity.status || '');
    if (status === 'disabled') return { ok: false, skipped: 'wallet-identity-disabled', reason: 'disabled' };
    if (status !== 'verified' && status !== 'restricted') {
      return { ok: false, skipped: 'wallet-identity-missing', reason: status || 'unsupported-status' };
    }
    const economicIdentityId = cleanId(
      identity.economic_identity_id ?? identity.economicIdentityId,
      'Economic identity ID'
    );
    if (quarantineDenylist(env).has(economicIdentityId)) {
      return { ok: false, skipped: 'wallet-identity-missing', reason: 'quarantine-denylist' };
    }
    return { ok: true, discordUserId: discord, economicIdentityId, status };
  }

  async function ensureThenResolve(wallet, discordUserId, env) {
    const resolved = await resolveRewardIdentity(wallet, discordUserId, env);
    if (resolved.ok || !resolved.missing) return resolved;
    if (typeof wallet.repository.ensureShadowRecruitWallet !== 'function') {
      return { ok: false, skipped: 'wallet-identity-missing', reason: 'ensure-unsupported' };
    }
    let ensured;
    try {
      ensured = await wallet.repository.ensureShadowRecruitWallet(discordUserId, SHADOW_RECRUIT_RANK_ID, { env });
    } catch (error) {
      console.warn(`[Nexus Economy] community level-up wallet ensure failed: ${String(error?.message || error).slice(0, 240)}`);
      return { ok: false, skipped: 'wallet-identity-missing', reason: 'ensure-failed' };
    }
    if (!shadowRecruitEnsureSucceeded(ensured)) {
      return {
        ok: false,
        skipped: 'wallet-identity-missing',
        reason: ensured?.rejected || ensured?.skipped || 'ensure-failed'
      };
    }
    const retried = await resolveRewardIdentity(wallet, discordUserId, env);
    if (!retried.ok) {
      return { ok: false, skipped: retried.skipped || 'wallet-identity-missing', reason: retried.reason || 'identity-still-missing' };
    }
    return retried;
  }

  WalletCoreClass.prototype.grantCommunityLevelCoins = async function grantCommunityLevelCoins(input = {}) {
    const {
      discordUserId,
      amount,
      idempotencyKey,
      metadata = {},
      env = process.env
    } = input;
    if (input.currency != null && input.currency !== '') {
      const requested = normalizeCurrency(input.currency);
      if (requested !== 'NEXUS_COINS') return { ok: false, skipped: 'coins-only', currency: 'NEXUS_COINS' };
    }
    const value = positiveWhole(amount, 'Nexus Coins');
    const key = cleanId(idempotencyKey, 'Idempotency key');
    const resolved = await ensureThenResolve(this, discordUserId, env);
    if (resolved.ok === false) return { ...resolved, currency: 'NEXUS_COINS', missing: undefined };
    return this.repository.transact(resolved.economicIdentityId, 'NEXUS_COINS', async (tx) => {
      const prior = await tx.findLedgerByKey(key);
      if (prior) {
        return priorResult(prior, {
          economicIdentityId: resolved.economicIdentityId,
          currency: 'NEXUS_COINS',
          amount: value,
          type: COMMUNITY_LEVEL_UP_TYPE,
          source: COMMUNITY_LEVEL_UP_SOURCE
        });
      }
      const wallet = await tx.getOrCreateWallet(resolved.economicIdentityId, 'NEXUS_COINS');
      const balance = walletBalance(wallet) + value;
      if (!Number.isSafeInteger(balance)) throw new Error('Wallet balance exceeds the supported range.');
      const { adminAdjust: _adminAdjust, currency: _currency, reason: _reason, ...metadataRest } = metadata || {};
      const entry = await tx.appendLedger({
        economicIdentityId: resolved.economicIdentityId,
        currency: 'NEXUS_COINS',
        amount: value,
        balanceAfter: balance,
        type: COMMUNITY_LEVEL_UP_TYPE,
        source: COMMUNITY_LEVEL_UP_SOURCE,
        idempotencyKey: key,
        metadata: {
          ...metadataRest,
          reason: COMMUNITY_LEVEL_UP_SOURCE,
          currency: 'NEXUS_COINS'
        },
        at: this.now().toISOString()
      });
      await tx.setBalance(resolved.economicIdentityId, 'NEXUS_COINS', balance);
      return { ok: true, duplicate: false, currency: 'NEXUS_COINS', balance, transactionId: entry?.id || null };
    });
  };
}

function routeWalletCredit(walletCore, input = {}, env = process.env) {
  if (!walletCore || typeof walletCore.credit !== 'function' || typeof walletCore.grantCommunityLevelCoins !== 'function') {
    throw new Error('Economy wallet core is required.');
  }
  if (isCommunityLevelCoinGrant(input)) return walletCore.grantCommunityLevelCoins({ ...input, env });
  return walletCore.credit({ ...input, currency: input.currency || 'NEXUS_POINTS' });
}

module.exports = {
  COMMUNITY_LEVEL_UP_SOURCE,
  COMMUNITY_LEVEL_UP_TYPE,
  isCommunityLevelCoinGrant,
  attachCommunityLevelCoinGrants,
  routeWalletCredit
};
