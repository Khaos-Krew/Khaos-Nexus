'use strict';

/**
 * O9 eligibility floor for verified economic-identity mint.
 * Dual bar: challenge-verified EOS + Sentinal Discord membership verify (store or signed proof claim).
 * Economy-worker must NOT read NEXUS_DATA_DIR; it consumes discordMembershipVerified from HMAC proof.
 */

const { MemberVerificationStore } = require('./member-verification-store.cjs');

/** @deprecated Stub reason retained for audit/compat; assert path no longer returns this. */
const O9_DISCORD_MEMBERSHIP_VERIFIED_STUB = 'o9-discord-membership-predicate-unresolved';

/**
 * Discord membership half of O9.
 * - Worker/proof path: pass { discordMembershipVerified } from verifyIdentityProof (signed claim).
 * - Sentinal/store path: pass { store } or rely on default MemberVerificationStore under NEXUS_DATA_DIR.
 * Never auto-verifies. Missing/pending → discord-verify-required; rejected → discord-verify-rejected.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function assertDiscordMembershipVerified(discordUserId, context = {}) {
  if (Object.prototype.hasOwnProperty.call(context || {}, 'discordMembershipVerified')) {
    if (context.discordMembershipVerified === true) return { ok: true };
    return { ok: false, reason: 'discord-verify-required' };
  }

  const store = context.store || new MemberVerificationStore();
  const row = typeof store.get === 'function' ? store.get(discordUserId) : null;
  if (!row || row.state === 'pending') {
    return { ok: false, reason: 'discord-verify-required' };
  }
  if (row.state === 'rejected') {
    return { ok: false, reason: 'discord-verify-rejected' };
  }
  if (row.state === 'verified') return { ok: true };
  return { ok: false, reason: 'discord-verify-required' };
}

/**
 * Floor: challenge-verified EOS link required (proof must carry eosId + verifiedAt).
 * @returns {{ ok: true } | { ok: false, reason: 'ark-link-required' }}
 */
function assertArkEosLinkForVerifiedMint({ eosId, verifiedAt } = {}) {
  if (!eosId || !verifiedAt) {
    return { ok: false, reason: 'ark-link-required' };
  }
  return { ok: true };
}

/**
 * O9 verified-mint eligibility: EOS floor first, then Discord membership (store or proof claim).
 * @returns {{ ok: true } | { ok: false, reason: string, floor?: string, discordMembership?: string }}
 */
function assertO9EligibilityForVerifiedMint(input = {}) {
  const { discordUserId, eosId, verifiedAt, store } = input;
  const eos = assertArkEosLinkForVerifiedMint({ eosId, verifiedAt });
  if (!eos.ok) return eos;

  const hasClaim = Object.prototype.hasOwnProperty.call(input, 'discordMembershipVerified');
  let discordCtx;
  if (hasClaim) {
    discordCtx = { discordMembershipVerified: input.discordMembershipVerified };
  } else if (store) {
    discordCtx = { store };
  } else {
    // Fail closed when neither signed claim nor store is supplied (worker-safe default).
    discordCtx = { discordMembershipVerified: false };
  }

  const discordMembership = assertDiscordMembershipVerified(discordUserId, discordCtx);
  if (!discordMembership.ok) {
    return {
      ok: false,
      reason: discordMembership.reason,
      floor: 'eos-present',
      discordMembership: 'store-blocked'
    };
  }
  return { ok: true };
}

module.exports = {
  O9_DISCORD_MEMBERSHIP_VERIFIED_STUB,
  assertDiscordMembershipVerified,
  assertArkEosLinkForVerifiedMint,
  assertO9EligibilityForVerifiedMint
};
