'use strict';

const {
  DARK_ZONE_STATES,
  enlistDarkZone,
  advanceDarkZone,
  withdrawDarkZone
} = require('./nexus-protocol-core.cjs');
const {
  protocolSummary,
  leaderboardView,
  darkZoneView
} = require('./nexus-protocol-presentation.cjs');

const ACTIONS = Object.freeze({
  REFRESH: 'nexus_protocol_refresh',
  LEADERBOARD: 'nexus_protocol_leaderboard',
  DARK_ZONE: 'nexus_protocol_dark_zone',
  ENLIST_SOLO: 'nexus_darkzone_enlist_solo',
  ENLIST_TRIBE: 'nexus_darkzone_enlist_tribe',
  WITHDRAW: 'nexus_darkzone_withdraw'
});

function cleanId(value, label = 'id') {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function snapshotRevision(snapshot = {}) {
  const revision = Number(snapshot.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid Nexus Protocol snapshot revision');
  return revision;
}

function activeSeason(snapshot = {}, now = Date.now()) {
  const at = Number(now);
  return Object.values(snapshot.seasons || {})
    .filter((season) => season.status === 'active'
      && Number(season.startsAt || 0) <= at
      && (!Number(season.endsAt || 0) || Number(season.endsAt) > at))
    .sort((a, b) => Number(b.startsAt || 0) - Number(a.startsAt || 0))[0] || null;
}

function accountDarkZone(snapshot = {}, accountId, now = Date.now()) {
  const id = cleanId(accountId, 'account id');
  const raw = snapshot.darkZone?.[id] || {
    accountId: id,
    state: DARK_ZONE_STATES.SAFE,
    enrollmentMode: 'solo',
    effectiveAt: 0,
    safeAt: 0,
    changedAt: 0,
    lastPvpDamageAt: 0,
    lastPvpKillAt: 0,
    lastStructureDamageAt: 0,
    registeredTameIds: []
  };
  return advanceDarkZone(raw, now);
}

function readProtocolAction(action, context = {}) {
  const snapshot = context.snapshot || {};
  const now = Number(context.now ?? Date.now());
  if (action === ACTIONS.REFRESH) {
    return { kind: 'view', ephemeral: false, payload: protocolSummary(snapshot, { now }) };
  }
  if (action === ACTIONS.LEADERBOARD) {
    const season = context.seasonId ? snapshot.seasons?.[context.seasonId] : activeSeason(snapshot, now);
    const seasonId = season?.id || context.seasonId || 'current';
    const rows = Array.isArray(context.leaderboardRows) ? context.leaderboardRows : [];
    return { kind: 'view', ephemeral: true, payload: leaderboardView(snapshot, seasonId, rows) };
  }
  if (action === ACTIONS.DARK_ZONE) {
    const record = accountDarkZone(snapshot, context.accountId, now);
    return { kind: 'view', ephemeral: true, payload: darkZoneView(record, { now }) };
  }
  throw new Error(`Unknown Nexus Protocol read action: ${action}`);
}

function planDarkZoneAction(action, context = {}) {
  const snapshot = context.snapshot || {};
  const now = Number(context.now ?? Date.now());
  const accountId = cleanId(context.accountId, 'account id');
  const expectedRevision = snapshotRevision(snapshot);
  const current = accountDarkZone(snapshot, accountId, now);

  if (action === ACTIONS.ENLIST_SOLO || action === ACTIONS.ENLIST_TRIBE) {
    const enrollmentMode = action === ACTIONS.ENLIST_TRIBE ? 'tribe' : 'solo';
    const next = enlistDarkZone(current, {
      now,
      enrollmentMode,
      delayMs: Number(context.enlistDelayMs ?? 5 * 60 * 1000)
    });
    return {
      kind: 'mutation-plan',
      action,
      accountId,
      expectedRevision,
      requiresConfirmation: true,
      confirmationText: `Confirm Dark Zone ${enrollmentMode} enlistment. PvP protections change when enlistment becomes active.`,
      current,
      next
    };
  }

  if (action === ACTIONS.WITHDRAW) {
    const next = withdrawDarkZone(current, {
      now,
      combatLockMs: Number(context.combatLockMs ?? 15 * 60 * 1000),
      withdrawalCooldownMs: Number(context.withdrawalCooldownMs ?? 45 * 60 * 1000)
    });
    return {
      kind: 'mutation-plan',
      action,
      accountId,
      expectedRevision,
      requiresConfirmation: !next.withdrawalBlocked,
      blocked: Boolean(next.withdrawalBlocked),
      confirmationText: next.withdrawalBlocked
        ? 'Dark Zone withdrawal is combat-locked.'
        : 'Confirm Dark Zone withdrawal. PvE protection returns after the withdrawal cooldown.',
      current,
      next
    };
  }

  throw new Error(`Unknown Dark Zone action: ${action}`);
}

function applyDarkZonePlan(store, plan, context = {}) {
  if (!store || typeof store.upsertDarkZone !== 'function' || typeof store.audit !== 'function'
    || typeof store.snapshot !== 'function') {
    throw new Error('Nexus Protocol store is required');
  }
  if (!plan || plan.kind !== 'mutation-plan') throw new Error('Invalid Dark Zone mutation plan');
  if (plan.blocked) return { applied: false, reason: 'combat_locked', record: plan.current };
  if (plan.requiresConfirmation && context.confirmed !== true) {
    return { applied: false, reason: 'confirmation_required', record: plan.current };
  }
  const currentRevision = snapshotRevision(store.snapshot());
  if (!Number.isSafeInteger(plan.expectedRevision) || plan.expectedRevision < 0) {
    throw new Error('Dark Zone mutation plan is missing a valid store revision');
  }
  if (currentRevision !== plan.expectedRevision) {
    return { applied: false, reason: 'stale_plan', expectedRevision: plan.expectedRevision, currentRevision };
  }
  const record = store.upsertDarkZone(plan.next);
  store.audit(
    'dark_zone_state_change',
    plan.accountId,
    `${plan.current.state}->${record.state}:${record.enrollmentMode}`,
    context.actor || plan.accountId,
    Number(context.now ?? Date.now())
  );
  return { applied: true, record };
}

module.exports = {
  ACTIONS,
  snapshotRevision,
  activeSeason,
  accountDarkZone,
  readProtocolAction,
  planDarkZoneAction,
  applyDarkZonePlan
};
