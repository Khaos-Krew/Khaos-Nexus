'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeServerId, captureConfigDriftStatus } = require('./ark-config-drift-status.cjs');

const DEFAULT_STATE_FILE = '/app/data/ark-config-drift-state.json';
const STATE_VERSION = 1;

function boundedKey(value) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120);
}

function publicSnapshot(status) {
  const serverId = normalizeServerId(status?.serverId);
  const entries = Array.isArray(status?.entries) ? status.entries : [];
  const keys = [...new Set(entries.map((entry) => boundedKey(entry?.key)).filter(Boolean))].sort().slice(0, 50);
  return Object.freeze({
    serverId,
    state: status?.inSync === true ? 'in-sync' : 'drifted',
    driftCount: Math.max(0, Number(status?.driftCount) || 0),
    keys: Object.freeze(keys),
    truncated: Boolean(status?.truncated),
    checkedAt: String(status?.checkedAt || new Date().toISOString())
  });
}

function unavailableSnapshot(serverId, now = new Date()) {
  return Object.freeze({
    serverId: normalizeServerId(serverId),
    state: 'unavailable',
    driftCount: 0,
    keys: Object.freeze([]),
    truncated: false,
    checkedAt: now.toISOString()
  });
}

function fingerprint(snapshot) {
  const payload = JSON.stringify({
    state: snapshot.state,
    driftCount: snapshot.driftCount,
    keys: snapshot.keys,
    truncated: snapshot.truncated
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function classifyTransition(previous, current) {
  if (!previous) {
    return current.state === 'in-sync' ? 'initial-healthy' : `initial-${current.state}`;
  }
  if (previous.state !== current.state) return `${previous.state}-to-${current.state}`;
  if (fingerprint(previous) !== fingerprint(current)) return `${current.state}-changed`;
  return 'unchanged';
}

function shouldAlert(transition) {
  return transition !== 'unchanged' && transition !== 'initial-healthy';
}

function alertText(snapshot, transition) {
  const target = snapshot.serverId === 'gen1' ? 'Genesis 1' : 'Astraeos';
  if (snapshot.state === 'in-sync') return `🟢 ${target} ARK config returned to Git parity.`;
  if (snapshot.state === 'unavailable') return `🟡 ${target} ARK config parity check is unavailable. No configuration was changed.`;
  const keyText = snapshot.keys.length ? ` Drifted keys: ${snapshot.keys.join(', ')}${snapshot.truncated ? ', …' : ''}.` : '';
  return `🟡 ${target} ARK config drift detected (${snapshot.driftCount} setting${snapshot.driftCount === 1 ? '' : 's'}).${keyText}`;
}

function emptyState() {
  return { version: STATE_VERSION, servers: {} };
}

function loadState(stateFile = DEFAULT_STATE_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (parsed?.version !== STATE_VERSION || !parsed.servers || typeof parsed.servers !== 'object') return emptyState();
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState();
    return emptyState();
  }
}

function saveState(state, stateFile = DEFAULT_STATE_FILE) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, stateFile);
}

async function checkServerConfigDrift({ serverId, capture = captureConfigDriftStatus, stateFile = DEFAULT_STATE_FILE, now = new Date() } = {}) {
  const normalized = normalizeServerId(serverId);
  const state = loadState(stateFile);
  const previous = state.servers[normalized] || null;
  let current;
  try {
    current = publicSnapshot(await capture({ serverId: normalized }));
  } catch {
    current = unavailableSnapshot(normalized, now);
  }
  const transition = classifyTransition(previous, current);
  state.servers[normalized] = current;
  saveState(state, stateFile);
  return Object.freeze({
    serverId: normalized,
    transition,
    alert: shouldAlert(transition),
    message: shouldAlert(transition) ? alertText(current, transition) : null,
    current,
    previous: previous ? Object.freeze(previous) : null
  });
}

module.exports = {
  DEFAULT_STATE_FILE,
  STATE_VERSION,
  publicSnapshot,
  unavailableSnapshot,
  fingerprint,
  classifyTransition,
  shouldAlert,
  alertText,
  loadState,
  saveState,
  checkServerConfigDrift
};
