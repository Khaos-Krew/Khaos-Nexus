'use strict';

/**
 * O9 eligibility floor for verified economic-identity mint.
 * EOS half is enforced; Discord membership half is a named stub until Director/owner
 * defines the custom Sentinal member-verification predicate (no role/badge invention).
 */

/** Stable reason string for the Discord membership stub (E1 unresolved). */
const O9_DISCORD_MEMBERSHIP_VERIFIED_STUB = 'o9-discord-membership-predicate-unresolved';

/**
 * Named Discord membership stub — always fail-closed until a real predicate lands.
 * Do NOT invent role/badge/self-serve checks here.
 * @returns {{ ok: false, reason: 'o9-discord-membership-predicate-unresolved' }}
 */
function assertDiscordMembershipVerified(/* discordUserId, context = {} */) {
  return { ok: false, reason: O9_DISCORD_MEMBERSHIP_VERIFIED_STUB };
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
 * O9 verified-mint eligibility: EOS floor first, then Discord membership stub.
 * @returns {{ ok: true } | { ok: false, reason: string, floor?: string, discordMembership?: string }}
 */
function assertO9EligibilityForVerifiedMint({ discordUserId, eosId, verifiedAt } = {}) {
  const eos = assertArkEosLinkForVerifiedMint({ eosId, verifiedAt });
  if (!eos.ok) return eos;
  const discordMembership = assertDiscordMembershipVerified(discordUserId);
  if (!discordMembership.ok) {
    return {
      ok: false,
      reason: discordMembership.reason,
      floor: 'eos-present',
      discordMembership: 'stub-blocked'
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
