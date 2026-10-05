'use strict';

const { cardRestrictedRoleIds } = require('./card-config.cjs');
const { BIRTHDAY_POLICY } = require('./birthday-config.cjs');

const DISCORD_EPOCH_MS = 1420070400000n;

function snowflakeTime(userId) {
  try {
    return Number((BigInt(userId) >> 22n) + DISCORD_EPOCH_MS);
  } catch {
    return NaN;
  }
}

function accountCreatedMs(user) {
  if (user?.createdAt instanceof Date) return user.createdAt.getTime();
  const stamp = Number(user?.createdTimestamp);
  if (Number.isFinite(stamp) && stamp > 0) return stamp;
  return snowflakeTime(user?.id);
}

function memberRoleIds(member) {
  const cache = member?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.keys === 'function' && !Array.isArray(cache)) return [...cache.keys()].map((id) => String(id));
  if (cache instanceof Map) return [...cache.keys()].map((id) => String(id));
  if (Array.isArray(cache)) {
    return cache.map((role) => (typeof role === 'string' ? role : String(role?.id || ''))).filter(Boolean);
  }
  return [];
}

function isTimedOut(member, nowMs) {
  const until = member?.communicationDisabledUntil;
  if (until instanceof Date && until.getTime() > nowMs) return true;
  const stamp = Number(member?.communicationDisabledUntilTimestamp);
  return Number.isFinite(stamp) && stamp > nowMs;
}

function assessBirthdayEligibility(member, nowMs, { policy = BIRTHDAY_POLICY, restrictedRoleIds = [] } = {}) {
  const user = member?.user || member;
  if (!member || !user) return { ok: false, reason: 'missing-member' };
  if (user.bot === true || member.bot === true) return { ok: false, reason: 'bot' };
  const created = accountCreatedMs(user);
  if (!Number.isFinite(created) || nowMs - created < policy.accountAgeMs) return { ok: false, reason: 'account-age' };
  const joined = member.joinedAt instanceof Date ? member.joinedAt.getTime() : Date.parse(member.joinedAt || '');
  if (!Number.isFinite(joined) || nowMs - joined < policy.tenureMs) return { ok: false, reason: 'tenure' };
  if (isTimedOut(member, nowMs)) return { ok: false, reason: 'timeout' };
  const restricted = new Set((restrictedRoleIds || []).map((id) => String(id)));
  if (memberRoleIds(member).some((id) => restricted.has(id))) return { ok: false, reason: 'restricted' };
  return { ok: true };
}

function restrictedRolesFor(deps = {}) {
  if (Array.isArray(deps.restrictedRoleIds)) return deps.restrictedRoleIds;
  return cardRestrictedRoleIds(deps.config || {}, deps.env || process.env);
}

module.exports = {
  snowflakeTime,
  assessBirthdayEligibility,
  restrictedRolesFor
};
