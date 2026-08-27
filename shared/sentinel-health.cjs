'use strict';

const HEALTH_STATES = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  MAINTENANCE: 'maintenance'
});

const HEALTH_PRESENTATION = Object.freeze({
  online: Object.freeze({ label: 'Online', emoji: '🟢' }),
  offline: Object.freeze({ label: 'Offline', emoji: '🔴' }),
  maintenance: Object.freeze({ label: 'Maintenance', emoji: '🟡' })
});

const ONLINE_SIGNALS = new Set(['online', 'up', 'healthy', 'ready', 'connected', 'recovered']);
const MAINTENANCE_SIGNALS = new Set(['maintenance', 'starting', 'restarting', 'repairing', 'reconnecting', 'recovering']);

function normalizeHealthState(value) {
  const signal = String(value || '').trim().toLowerCase();
  if (ONLINE_SIGNALS.has(signal)) return HEALTH_STATES.ONLINE;
  if (MAINTENANCE_SIGNALS.has(signal)) return HEALTH_STATES.MAINTENANCE;
  // Unknown, stale, degraded, partial, error and failed signals all fail closed
  // to Offline. Public Sentinel health intentionally exposes only three states.
  return HEALTH_STATES.OFFLINE;
}

function deriveHealthState({ reachable = false, maintenance = false, recovering = false, retryCount = 0, retryLimit = 3 } = {}) {
  if (reachable) return HEALTH_STATES.ONLINE;
  const attempts = Math.max(0, Number(retryCount) || 0);
  const limit = Math.max(1, Number(retryLimit) || 3);
  if ((maintenance || recovering) && attempts < limit) return HEALTH_STATES.MAINTENANCE;
  return HEALTH_STATES.OFFLINE;
}

function healthTransition(previousState, nextState, time = new Date().toISOString()) {
  const previous = normalizeHealthState(previousState);
  const next = normalizeHealthState(nextState);
  return Object.freeze({
    previous,
    next,
    changed: previous !== next,
    time: String(time)
  });
}

function healthPresentation(state) {
  return HEALTH_PRESENTATION[normalizeHealthState(state)];
}

function healthLabel(state, { uppercase = false, includeEmoji = true } = {}) {
  const presentation = healthPresentation(state);
  const label = uppercase ? presentation.label.toUpperCase() : presentation.label;
  return includeEmoji ? `${presentation.emoji} ${label}` : label;
}

module.exports = {
  HEALTH_STATES,
  HEALTH_PRESENTATION,
  normalizeHealthState,
  deriveHealthState,
  healthTransition,
  healthPresentation,
  healthLabel
};
