'use strict';

const { checkServerConfigDrift } = require('./ark-config-drift-monitor.cjs');

const DEFAULT_SERVERS = Object.freeze(['gen1', 'astraeos']);

function safeAlertPayload(result) {
  if (!result?.alert || !result?.message) return null;
  const current = result.current || {};
  const keys = Array.isArray(current.keys)
    ? current.keys.map((key) => String(key || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 50)
    : [];
  return Object.freeze({
    kind: 'ark-config-drift',
    serverId: String(result.serverId || '').slice(0, 32),
    transition: String(result.transition || '').slice(0, 64),
    state: String(current.state || '').slice(0, 32),
    driftCount: Math.max(0, Number(current.driftCount) || 0),
    keys: Object.freeze([...new Set(keys)]),
    truncated: Boolean(current.truncated),
    checkedAt: String(current.checkedAt || '').slice(0, 64),
    message: String(result.message).replace(/[\r\n\t]/g, ' ').trim().slice(0, 1900)
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
  safeAlertPayload,
  deliverDriftAlert,
  runArkConfigDriftAlerts
};
