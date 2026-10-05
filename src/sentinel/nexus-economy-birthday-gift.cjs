'use strict';

const crypto = require('node:crypto');
const { normalizeCurrency } = require('./nexus-economy-postgres-repository.cjs');
const { memberIdentityHold } = require('./nexus-economy-identity-hold.cjs');
const { systemGrantsEnabled } = require('./economy-system-grants.cjs');
const { readBirthdayCoins, HARD_BIRTHDAY_GIFT_CEILING, BIRTHDAY_POLICY } = require('./card/birthday-config.cjs');
const { nextCapMidnight, startOfCapDay } = require('./card/birthday-calendar.cjs');

const BIRTHDAY_GIFT_SOURCE = 'birthday-gift';
const BIRTHDAY_GIFT_TYPE = 'credit';
const SHADOW_RECRUIT_RANK_ID = 'shadow-recruit';
const REQUEST_KEY = /^birthday-gift:(\d{15,24}):((?:19|20|21)\d{2})$/;

function birthdayGiftSkipKey(economicIdentityId, giftYear) {
  return `birthday-gift-skip:${economicIdentityId}:${giftYear}`;
}
const ROLL_SPAN = 0x100000000;

function isBirthdayGiftGrant(input = {}) {
  return String(input?.source || '').trim() === BIRTHDAY_GIFT_SOURCE;
}

function assertBirthdayRequest(input = {}) {
  const discordUserId = String(input.discordUserId || '').trim();
  const key = String(input.idempotencyKey || '').trim();
  const match = REQUEST_KEY.exec(key);
  if (!match) return { ok: false, skipped: 'request-key' };
  if (match[1] !== discordUserId) return { ok: false, skipped: 'subject-mismatch' };
  const giftYear = Number(match[2]);
  if (input.giftYear != null && input.giftYear !== '' && Number(input.giftYear) !== giftYear) {
    return { ok: false, skipped: 'subject-mismatch' };
  }
  return { ok: true, discordUserId, giftYear, requestKey: key };
}

function rollBirthdayCoins({ economicIdentityId, giftYear, min, max }) {
  const span = max - min + 1;
  if (!Number.isSafeInteger(span) || span < 1) {
    const error = new Error('Birthday Coin range is invalid.');
    error.reason = 'coins-range';
    throw error;
  }
  const limit = Math.floor(ROLL_SPAN / span) * span;
  let digest = crypto.createHash('sha256')
    .update(`birthday-gift:${economicIdentityId}:${giftYear}:${min}:${max}`)
    .digest();
  for (let offset = 0; offset + 4 <= digest.length; offset += 4) {
    const value = digest.readUInt32BE(offset);
    if (value < limit) return min + (value % span);
  }
  digest = crypto.createHash('sha256').update(digest).digest();
  return min + (digest.readUInt32BE(0) % span);
}

function shadowRecruitEnsureSucceeded(ensured) {
  if (!ensured || ensured.ok !== true || ensured.rejected || ensured.skipped) return false;
  return Boolean(ensured.economicIdentityId || ensured.economic_identity_id);
}

function holdSkip(hold) {
  return {
    ok: false,
    skipped: 'account-hold',
    reason: hold?.reason || 'account-hold',
    credited: 0
  };
}

function attachBirthdayGiftGrants(WalletCoreClass, {
  cleanId,
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
    const hold = memberIdentityHold({
      status,
      holdReason: identity.hold_reason ?? identity.holdReason,
      economicIdentityId,
      env
    });
    if (hold) return { ...holdSkip(hold), economicIdentityId, discordUserId: discord };
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
      console.warn(`[Nexus Economy] birthday gift wallet ensure failed: ${String(error?.message || error).slice(0, 240)}`);
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

  WalletCoreClass.prototype.grantBirthdayGift = async function grantBirthdayGift(input = {}) {
    const env = input.env || this.env || process.env;
    if (!systemGrantsEnabled(env)) {
      return { ok: false, skipped: 'system-grants-disabled', currency: 'NEXUS_COINS', credited: 0 };
    }
    if (input.currency != null && input.currency !== '') {
      let requested = null;
      try { requested = normalizeCurrency(input.currency); } catch { requested = null; }
      if (requested !== 'NEXUS_COINS') return { ok: false, skipped: 'coins-only', currency: 'NEXUS_COINS', credited: 0 };
    }
    const request = assertBirthdayRequest(input);
    if (!request.ok) return { ...request, currency: 'NEXUS_COINS', credited: 0 };
    const coins = readBirthdayCoins(env);
    if (!coins.ok) return { ok: false, skipped: coins.reason, currency: 'NEXUS_COINS', credited: 0 };
    const resolved = await ensureThenResolve(this, request.discordUserId, env);
    const heldResolved = resolved.ok === false && resolved.skipped === 'account-hold' && resolved.economicIdentityId;
    if (resolved.ok === false && !heldResolved) return { ...resolved, currency: 'NEXUS_COINS', missing: undefined, credited: 0 };
    let amount;
    try {
      amount = rollBirthdayCoins({
        economicIdentityId: resolved.economicIdentityId,
        giftYear: request.giftYear,
        min: coins.min,
        max: coins.max
      });
    } catch (error) {
      return { ok: false, skipped: error.reason || 'coins-range', currency: 'NEXUS_COINS', credited: 0 };
    }
    if (input.amount != null && input.amount !== '' && Number(input.amount) !== amount) {
      return { ok: false, skipped: 'amount-mismatch', currency: 'NEXUS_COINS', credited: 0 };
    }
    if (amount > HARD_BIRTHDAY_GIFT_CEILING || amount > coins.ceiling) {
      return { ok: false, skipped: 'grant-ceiling', currency: 'NEXUS_COINS', credited: 0 };
    }
    const ledgerKey = cleanId(`birthday-gift:${resolved.economicIdentityId}:${request.giftYear}`, 'Idempotency key');
    const skipKey = cleanId(birthdayGiftSkipKey(resolved.economicIdentityId, request.giftYear), 'Idempotency key');
    const nowMs = this.now().getTime();
    return this.repository.transact(resolved.economicIdentityId, 'NEXUS_COINS', async (tx) => {
      if (typeof tx.findLedgerByKey !== 'function' || typeof tx.rememberSkip !== 'function' || typeof tx.latestCreditAt !== 'function') {
        return { ok: false, skipped: 'skip-unavailable', currency: 'NEXUS_COINS', credited: 0 };
      }
      let hold = null;
      if (typeof tx.lockIdentity === 'function') {
        const row = await tx.lockIdentity(resolved.economicIdentityId);
        hold = memberIdentityHold({
          status: row?.status,
          holdReason: row?.hold_reason ?? row?.holdReason,
          economicIdentityId: resolved.economicIdentityId,
          missingRow: !row,
          env
        });
      }
      const skippedYear = await tx.findLedgerByKey(skipKey);
      if (skippedYear) {
        return { ok: false, skipped: 'gift-year-skipped', reason: 'account-hold', currency: 'NEXUS_COINS', credited: 0 };
      }
      if (hold || heldResolved) {
        await tx.rememberSkip(skipKey);
        const written = await tx.findLedgerByKey(skipKey);
        if (!written) return { ok: false, skipped: 'skip-unavailable', currency: 'NEXUS_COINS', credited: 0 };
        return { ...holdSkip(hold || { reason: 'account-hold' }), currency: 'NEXUS_COINS' };
      }
      const prior = await tx.findLedgerByKey(ledgerKey);
      if (prior) {
        return priorResult(prior, {
          economicIdentityId: resolved.economicIdentityId,
          currency: 'NEXUS_COINS',
          amount,
          type: BIRTHDAY_GIFT_TYPE,
          source: BIRTHDAY_GIFT_SOURCE
        });
      }
      if (typeof tx.lockSource !== 'function' || typeof tx.sumCreditsSince !== 'function') {
        return { ok: false, skipped: 'cap-unavailable', currency: 'NEXUS_COINS', credited: 0 };
      }
      await tx.lockSource(BIRTHDAY_GIFT_SOURCE);
      const lastCreditAt = await tx.latestCreditAt(resolved.economicIdentityId, BIRTHDAY_GIFT_SOURCE, 'NEXUS_COINS');
      if (lastCreditAt) {
        const lastMs = Date.parse(lastCreditAt);
        const retryAtMs = lastMs + BIRTHDAY_POLICY.giftCooldownMs;
        if (!Number.isFinite(lastMs) || !Number.isFinite(retryAtMs)) {
          return { ok: false, skipped: 'cooldown-unavailable', currency: 'NEXUS_COINS', credited: 0 };
        }
        if (nowMs < retryAtMs) {
          return {
            ok: false,
            skipped: 'gift-cooldown',
            retryAt: new Date(retryAtMs).toISOString(),
            currency: 'NEXUS_COINS',
            credited: 0
          };
        }
      }
      const spent = await tx.sumCreditsSince(BIRTHDAY_GIFT_SOURCE, 'NEXUS_COINS', new Date(startOfCapDay(nowMs)).toISOString());
      if (!Number.isSafeInteger(spent) || spent < 0 || spent + amount > coins.dailyCap) {
        return {
          ok: false,
          deferred: true,
          skipped: 'daily-cap-deferred',
          retryAt: new Date(nextCapMidnight(nowMs)).toISOString(),
          currency: 'NEXUS_COINS',
          credited: 0
        };
      }
      const wallet = await tx.getOrCreateWallet(resolved.economicIdentityId, 'NEXUS_COINS');
      const balance = walletBalance(wallet) + amount;
      if (!Number.isSafeInteger(balance)) throw new Error('Wallet balance exceeds the supported range.');
      const entry = await tx.appendLedger({
        economicIdentityId: resolved.economicIdentityId,
        currency: 'NEXUS_COINS',
        amount,
        balanceAfter: balance,
        type: BIRTHDAY_GIFT_TYPE,
        source: BIRTHDAY_GIFT_SOURCE,
        idempotencyKey: ledgerKey,
        metadata: {
          reason: BIRTHDAY_GIFT_SOURCE,
          giftYear: request.giftYear,
          currency: 'NEXUS_COINS'
        },
        at: this.now().toISOString()
      });
      await tx.setBalance(resolved.economicIdentityId, 'NEXUS_COINS', balance);
      return {
        ok: true,
        duplicate: false,
        currency: 'NEXUS_COINS',
        balance,
        amount,
        transactionId: entry?.id || null
      };
    });
  };
}

module.exports = {
  BIRTHDAY_GIFT_SOURCE,
  BIRTHDAY_GIFT_TYPE,
  isBirthdayGiftGrant,
  assertBirthdayRequest,
  rollBirthdayCoins,
  birthdayGiftSkipKey,
  attachBirthdayGiftGrants,
  HARD_BIRTHDAY_GIFT_CEILING
};
