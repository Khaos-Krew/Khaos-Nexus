'use strict';

const PROTOCOL_STATES = Object.freeze({
  SIGNAL_DETECTED: 'signal_detected',
  FORGING: 'forging',
  CALIBRATING: 'calibrating',
  PARTIAL_ACTIVATION: 'partial_activation',
  ACTIVE: 'active',
  CONTAINED: 'contained',
  OFFLINE: 'offline'
});

const PROTOCOL_DEFINITIONS = Object.freeze({
  alpha_purge: Object.freeze({
    id: 'alpha_purge',
    name: 'Alpha Purge',
    activation: 'scheduled_or_automatic',
    scope: 'cluster',
    summary: 'High-threat creature elimination protocol.'
  }),
  ascension: Object.freeze({
    id: 'ascension',
    name: 'Ascension',
    activation: 'scheduled_or_admin',
    scope: 'map_or_cluster',
    summary: 'World-boss and major encounter protocol.'
  }),
  dark_zone: Object.freeze({
    id: 'dark_zone',
    name: 'Dark Zone',
    activation: 'persistent_opt_in_and_scheduled',
    scope: 'cluster',
    summary: 'Voluntary PvP protocol with protected PvE defaults.'
  }),
  anomaly: Object.freeze({
    id: 'anomaly',
    name: 'Anomaly',
    activation: 'reactive',
    scope: 'map_or_cluster',
    summary: 'ARN / Shiny-linked anomaly response protocol.'
  }),
  extraction: Object.freeze({
    id: 'extraction',
    name: 'Extraction',
    activation: 'scheduled_or_rotating',
    scope: 'map_or_cluster',
    summary: 'Resource and objective extraction protocol.'
  }),
  community: Object.freeze({
    id: 'community',
    name: 'Community',
    activation: 'admin_only',
    scope: 'map_or_cluster',
    summary: 'Reserved for owner/admin planned community events.'
  })
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [PROTOCOL_STATES.SIGNAL_DETECTED]: new Set([PROTOCOL_STATES.FORGING, PROTOCOL_STATES.OFFLINE]),
  [PROTOCOL_STATES.FORGING]: new Set([PROTOCOL_STATES.CALIBRATING, PROTOCOL_STATES.CONTAINED, PROTOCOL_STATES.OFFLINE]),
  [PROTOCOL_STATES.CALIBRATING]: new Set([PROTOCOL_STATES.PARTIAL_ACTIVATION, PROTOCOL_STATES.CONTAINED, PROTOCOL_STATES.OFFLINE]),
  [PROTOCOL_STATES.PARTIAL_ACTIVATION]: new Set([PROTOCOL_STATES.ACTIVE, PROTOCOL_STATES.CALIBRATING, PROTOCOL_STATES.CONTAINED]),
  [PROTOCOL_STATES.ACTIVE]: new Set([PROTOCOL_STATES.CONTAINED, PROTOCOL_STATES.CALIBRATING]),
  [PROTOCOL_STATES.CONTAINED]: new Set([PROTOCOL_STATES.CALIBRATING, PROTOCOL_STATES.OFFLINE]),
  [PROTOCOL_STATES.OFFLINE]: new Set([PROTOCOL_STATES.SIGNAL_DETECTED, PROTOCOL_STATES.FORGING])
});

const DARK_ZONE_STATES = Object.freeze({
  SAFE: 'safe',
  ENLISTING: 'enlisting',
  ENLISTED: 'enlisted',
  COOLDOWN: 'cooldown',
  SUSPENDED: 'suspended'
});

function cleanId(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function getProtocolDefinition(value) {
  return PROTOCOL_DEFINITIONS[cleanId(value)] || null;
}

function createProtocolState(protocolId, now = Date.now()) {
  const definition = getProtocolDefinition(protocolId);
  if (!definition) throw new Error(`Unknown Nexus Protocol: ${protocolId}`);
  return {
    protocolId: definition.id,
    state: PROTOCOL_STATES.SIGNAL_DETECTED,
    changedAt: Number(now),
    reason: 'protocol_registered'
  };
}

function transitionProtocol(current, nextState, options = {}) {
  if (!current || !getProtocolDefinition(current.protocolId)) throw new Error('Invalid protocol state record');
  if (!Object.values(PROTOCOL_STATES).includes(nextState)) throw new Error(`Unknown protocol state: ${nextState}`);
  if (current.state === nextState) return { ...current };
  const allowed = ALLOWED_TRANSITIONS[current.state];
  if (!allowed?.has(nextState)) throw new Error(`Illegal Nexus Protocol transition: ${current.state} -> ${nextState}`);
  return {
    ...current,
    state: nextState,
    changedAt: Number(options.now ?? Date.now()),
    reason: String(options.reason || 'state_transition').slice(0, 240)
  };
}

function qualifyParticipation(input = {}) {
  const activeMinutes = Math.max(0, Number(input.activeMinutes || 0));
  const objectiveContribution = Math.max(0, Number(input.objectiveContribution || 0));
  const killContribution = Math.max(0, Number(input.killContribution || 0));
  const presentAtCompletion = Boolean(input.presentAtCompletion);
  const afk = Boolean(input.afk);
  const disqualified = Boolean(input.disqualified);
  const minActiveMinutes = Math.max(0, Number(input.minActiveMinutes ?? 5));
  const requiresCompletionPresence = input.requiresCompletionPresence !== false;
  const hasContribution = objectiveContribution > 0 || killContribution > 0 || Boolean(input.manualContribution);

  const reasons = [];
  if (disqualified) reasons.push('disqualified');
  if (afk) reasons.push('afk');
  if (activeMinutes < minActiveMinutes) reasons.push('insufficient_active_time');
  if (!hasContribution) reasons.push('no_meaningful_contribution');
  if (requiresCompletionPresence && !presentAtCompletion) reasons.push('not_present_at_completion');

  return { eligible: reasons.length === 0, reasons };
}

function computeProtocolScore(input = {}) {
  const objective = Math.max(0, Number(input.objectiveContribution || 0));
  const kills = Math.max(0, Number(input.killContribution || 0));
  const activeMinutes = Math.max(0, Number(input.activeMinutes || 0));
  const completionBonus = input.completed ? 100 : 0;
  const mvpBonus = input.mvp ? 50 : 0;
  const deathPenalty = Math.min(100, Math.max(0, Number(input.deathPenalty || 0)));
  return Math.max(0, Math.floor(objective * 10 + kills * 5 + Math.min(activeMinutes, 120) + completionBonus + mvpBonus - deathPenalty));
}

function canDamage(attacker, target, targetKind = 'player') {
  const attackerEnlisted = attacker?.state === DARK_ZONE_STATES.ENLISTED;
  const targetEnlisted = target?.state === DARK_ZONE_STATES.ENLISTED;
  if (targetKind === 'player') return attackerEnlisted && targetEnlisted;
  if (targetKind === 'personal_tame') return attackerEnlisted && targetEnlisted && Boolean(target?.registeredForPvp);
  if (targetKind === 'tribe_tame' || targetKind === 'tribe_structure') {
    return attackerEnlisted && targetEnlisted && attacker?.enrollmentMode === 'tribe' && target?.enrollmentMode === 'tribe';
  }
  return false;
}

function enlistDarkZone(current = {}, options = {}) {
  if (current.state === DARK_ZONE_STATES.SUSPENDED) throw new Error('Dark Zone enrollment is suspended');
  if (current.state && ![DARK_ZONE_STATES.SAFE, DARK_ZONE_STATES.COOLDOWN].includes(current.state)) {
    throw new Error(`Dark Zone cannot enlist from ${current.state}`);
  }
  const now = Number(options.now ?? Date.now());
  const delayMs = Math.max(0, Number(options.delayMs ?? 5 * 60 * 1000));
  return {
    ...current,
    state: delayMs ? DARK_ZONE_STATES.ENLISTING : DARK_ZONE_STATES.ENLISTED,
    enrollmentMode: options.enrollmentMode === 'tribe' ? 'tribe' : 'solo',
    effectiveAt: now + delayMs,
    changedAt: now
  };
}

function advanceDarkZone(current = {}, now = Date.now()) {
  const at = Number(now);
  if (current.state === DARK_ZONE_STATES.ENLISTING && at >= Number(current.effectiveAt || 0)) {
    return { ...current, state: DARK_ZONE_STATES.ENLISTED, changedAt: at };
  }
  if (current.state === DARK_ZONE_STATES.COOLDOWN && at >= Number(current.safeAt || 0)) {
    return { ...current, state: DARK_ZONE_STATES.SAFE, changedAt: at, effectiveAt: null, safeAt: null };
  }
  return { ...current };
}

function withdrawDarkZone(current = {}, options = {}) {
  if (current.state !== DARK_ZONE_STATES.ENLISTED) throw new Error('Dark Zone withdrawal requires active enlistment');
  const now = Number(options.now ?? Date.now());
  const combatLockMs = Math.max(0, Number(options.combatLockMs ?? 15 * 60 * 1000));
  const withdrawalCooldownMs = Math.max(0, Number(options.withdrawalCooldownMs ?? 45 * 60 * 1000));
  const lastCombatAt = Math.max(
    Number(current.lastPvpDamageAt || 0),
    Number(current.lastPvpKillAt || 0),
    Number(current.lastStructureDamageAt || 0)
  );
  if (lastCombatAt && now - lastCombatAt < combatLockMs) {
    return { ...current, withdrawalBlocked: true, withdrawalBlockedUntil: lastCombatAt + combatLockMs };
  }
  return {
    ...current,
    state: DARK_ZONE_STATES.COOLDOWN,
    safeAt: now + withdrawalCooldownMs,
    changedAt: now,
    withdrawalBlocked: false,
    withdrawalBlockedUntil: null
  };
}

module.exports = {
  PROTOCOL_STATES,
  PROTOCOL_DEFINITIONS,
  DARK_ZONE_STATES,
  getProtocolDefinition,
  createProtocolState,
  transitionProtocol,
  qualifyParticipation,
  computeProtocolScore,
  canDamage,
  enlistDarkZone,
  advanceDarkZone,
  withdrawDarkZone
};
