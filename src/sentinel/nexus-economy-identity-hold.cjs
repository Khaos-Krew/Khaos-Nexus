'use strict';

// Column values from nexus_economic_identities.status CHECK constraint.
const SCHEMA_IDENTITY_STATUSES = Object.freeze(['verified', 'restricted', 'disabled']);

// 'quarantined' is not a CHECK value. A row that still carries that literal is refused.
// The live quarantined hold is NEXUS_ECONOMY_QUARANTINE_DENYLIST (economic identity ids).
const BLOCKED_MEMBER_STATUSES = Object.freeze(['quarantined', 'restricted', 'disabled']);

const MEMBER_HOLD_MESSAGE = 'Your account is on hold. Ask an Admin for help.';

function quarantineDenylist(env = process.env) {
  return new Set(
    String(env?.NEXUS_ECONOMY_QUARANTINE_DENYLIST || '')
      .split(',')
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
}

function memberIdentityHold({ status, economicIdentityId, env = process.env } = {}) {
  const normalized = String(status || '').trim().toLowerCase();
  const denylisted = quarantineDenylist(env).has(String(economicIdentityId || '').trim());
  const statusBlocked = BLOCKED_MEMBER_STATUSES.includes(normalized);
  if (!statusBlocked && !denylisted) return null;
  return {
    ok: false,
    reason: denylisted && !statusBlocked ? 'quarantined' : 'account-hold',
    message: MEMBER_HOLD_MESSAGE,
    credited: 0
  };
}

module.exports = {
  SCHEMA_IDENTITY_STATUSES,
  BLOCKED_MEMBER_STATUSES,
  MEMBER_HOLD_MESSAGE,
  quarantineDenylist,
  memberIdentityHold
};
