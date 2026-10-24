'use strict';

const {
  DARK_ZONE_STATES,
  canDamage
} = require('./nexus-protocol-core.cjs');

const TARGET_KINDS = Object.freeze(['player', 'personal_tame', 'tribe_tame', 'tribe_structure']);

function clean(value, max = 96) {
  return String(value ?? '').trim().slice(0, max);
}

function evaluateDarkZoneEncounterPolicy(attacker = {}, target = {}, targetKind = 'player', options = {}) {
  const kind = clean(targetKind, 32).toLowerCase();
  if (!TARGET_KINDS.includes(kind)) throw new Error(`Unknown Dark Zone target kind: ${targetKind}`);

  const attackerState = clean(attacker.state, 32).toLowerCase();
  const targetState = clean(target.state, 32).toLowerCase();
  const attackerId = clean(attacker.accountId || attacker.eosId, 160);
  const targetId = clean(target.accountId || target.eosId, 160);
  const attackerTribeId = clean(attacker.tribeId, 96);
  const targetTribeId = clean(target.tribeId, 96);
  const allowFriendlyFire = options.allowFriendlyFire === true;

  const reasons = [];
  if (attackerState !== DARK_ZONE_STATES.ENLISTED) reasons.push('attacker_not_enlisted');
  if (targetState !== DARK_ZONE_STATES.ENLISTED) reasons.push('target_not_enlisted');
  if (attackerId && targetId && attackerId === targetId) reasons.push('self_target');
  if (!allowFriendlyFire && attackerTribeId && targetTribeId && attackerTribeId === targetTribeId) {
    reasons.push('same_tribe_protected');
  }
  if (kind === 'personal_tame' && target.registeredForPvp !== true) {
    reasons.push('personal_tame_not_registered');
  }
  if ((kind === 'tribe_tame' || kind === 'tribe_structure')
    && (attacker.enrollmentMode !== 'tribe' || target.enrollmentMode !== 'tribe')) {
    reasons.push('tribe_enrollment_required');
  }

  const coreAllowsDamage = canDamage(attacker, target, kind);
  if (!coreAllowsDamage && reasons.length === 0) reasons.push('core_policy_denied');
  const allowed = coreAllowsDamage && reasons.length === 0;

  return Object.freeze({
    version: 1,
    targetKind: kind,
    allowed,
    decision: allowed ? 'allow' : 'deny',
    reasons: Object.freeze(reasons),
    attackerState: attackerState || null,
    targetState: targetState || null,
    attackerEnrollmentMode: clean(attacker.enrollmentMode, 16).toLowerCase() || null,
    targetEnrollmentMode: clean(target.enrollmentMode, 16).toLowerCase() || null,
    sameTribe: Boolean(attackerTribeId && targetTribeId && attackerTribeId === targetTribeId),
    requiresGameSideEnforcement: true,
    executesRcon: false,
    mutatesState: false
  });
}

module.exports = {
  TARGET_KINDS,
  evaluateDarkZoneEncounterPolicy
};
