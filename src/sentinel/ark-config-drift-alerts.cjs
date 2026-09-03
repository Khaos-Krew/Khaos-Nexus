'use strict';

const { checkServerConfigDrift } = require('./ark-config-drift-monitor.cjs');
const { PROTECTED_KEYS } = require('./ark-source-of-truth.cjs');

const DEFAULT_SERVERS = Object.freeze(['gen1', 'astraeos']);

function safeKey(value) {
  const key = String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120);
  if (!key || PROTECTED_KEYS.test(key)) return null;
  if (/(?:password|passwd|secret|token|credential|api[_-]?key)/i.test(key)) return null;
  return key;
}

function safeMessage({ serverId, state, driftCount, keys, truncated }) {
  const target = serverId === 'gen1' ? 'Genesis 1' : serverId === 'astraeos' ? 'Astraeos' : 'ARK server';
  if (state === 'in-sync') return `🟢 ${target} ARK config returned to Git parity.`;
  if (state === 'unavailable') return `🟡 ${target} ARK config parity check is unavailable. No configuration was changed.`;
  const keyText = keys.length ? ` Drifted keys: ${keys.join(', ')}${truncated ? ', …' : ''}.` : '';
  return `🟡 ${target} ARK config drift detected (${driftCount} setting${driftCount === 1 ? '' : 's'}).${keyText}`;
}

function safeAlertPayload(result) {
  if (!result?.alert) return null;
  const current = result.current || {};
  const keys = Array.isArray(current.keys)
    ? [...new Set(current.keys.map(safeKey).filter(Boolean))].slice(0, 50)
    : [];
  const serverId = String(result.serverId || '').slice(0, 32);
  const state = String(current.state || '').slice(0, 32);
  const driftCount = Math.max(0, Number(current.driftCount) || 0);
  const truncated = Boolean(current.truncated) || (Array.isArray(current.keys) && keys.length < current.keys.length);
  return Object.freeze({
    kind: 'ark-config-drift',
    serverId,
    transition: String(result.transition || '').slice(0, 64),
    state,
    driftCount,
    keys: Object.freeze(keys),
    truncated,
    checkedAt: String(current.checkedAt || '').slice(0, 64),
    message: safeMessage({ serverId, state, driftCount, keys, truncated })
  });
}

async function deliverDriftAlert({ result, notify } = {}) {
  const payload = safeAlertPayload(result);
  if (!payload) return Object.freeze({ sent: false, reason: 'no-transition-alert' });
  if (typeof notify !== 'function') return Object.freeze({ sent: false, reason: 'no-notifier', payload });
  try {
    await notify(payload);
    return Object.freeze({ sent: true, payload });
  } catch {
    return Object.freeze({ sent: false, reason: 'notify-failed', payload });
  }
}

async function runArkConfigDriftAlerts({
  servers = DEFAULT_SERVERS,
  check = checkServerConfigDrift,
  notify,
  stateFile,
  now = new Date()
} = {}) {
  const results = [];
  for (const serverId of servers) {
    const result = await check({ serverId, stateFile, now });
    const delivery = await deliverDriftAlert({ result, notify });
    results.push(Object.freeze({
      serverId: result.serverId,
      transition: result.transition,
      alert: Boolean(result.alert),
      sent: delivery.sent,
      reason: delivery.reason || null
    }));
  }
  return Object.freeze(results);
}

module.exports = {
  DEFAULT_SERVERS,
  safeKey,
  safeMessage,
  safeAlertPayload,
  deliverDriftAlert,
  runArkConfigDriftAlerts
};
