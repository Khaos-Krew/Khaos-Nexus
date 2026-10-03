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

// A hold is disabled, the quarantined literal, the quarantine denylist, a missing row,
// or any non-empty hold marker (staff, denylist quarantine, o9-demote, legacy-review).
// An unmarked restricted row is a Shadow Recruit pending verification: it is not shown
// the hold message.
function memberIdentityHold({ status, holdReason, economicIdentityId, missingRow = false, env = process.env } = {}) {
  const normalized = String(status || '').trim().toLowerCase();
  const marker = String(holdReason || '').trim();
  const denylisted = quarantineDenylist(env).has(String(economicIdentityId || '').trim());
  const markedRestricted = normalized === 'restricted' && Boolean(marker);
  const blockedStatus = normalized === 'disabled' || normalized === 'quarantined' || markedRestricted;
  if (!blockedStatus && !denylisted && !missingRow && !marker) return null;
  return {
    ok: false,
    reason: denylisted && !blockedStatus && !marker ? 'quarantined' : 'account-hold',
    message: MEMBER_HOLD_MESSAGE,
    credited: 0
  };
}

// Linking may elevate an unmarked restricted row. A marker, disabled, quarantined,
// denylist, or missing row stays held and is not elevated.
function linkElevationHold({ status, holdReason, economicIdentityId, missingRow = false, env = process.env } = {}) {
  const normalized = String(status || '').trim().toLowerCase();
  const marker = String(holdReason || '').trim();
  const denylisted = quarantineDenylist(env).has(String(economicIdentityId || '').trim());
  const durable = Boolean(missingRow)
    || normalized === 'disabled'
    || normalized === 'quarantined'
    || Boolean(marker)
    || denylisted;
  if (!durable) return null;
  return memberIdentityHold({ status: normalized, holdReason: marker, economicIdentityId, missingRow, env })
    || { ok: false, reason: 'account-hold', message: MEMBER_HOLD_MESSAGE, credited: 0 };
}

function memberHoldFromError(error) {
  const message = String(error?.message || error || '').trim();
  if (message === 'Economic identity is disabled.' || message === MEMBER_HOLD_MESSAGE) {
    return { ok: false, reason: 'account-hold', message: MEMBER_HOLD_MESSAGE, credited: 0 };
  }
  return null;
}

module.exports = {
  SCHEMA_IDENTITY_STATUSES,
  BLOCKED_MEMBER_STATUSES,
  MEMBER_HOLD_MESSAGE,
  quarantineDenylist,
  memberIdentityHold,
  linkElevationHold,
  memberHoldFromError
};
