'use strict';

const { readJson, writeJson } = require('../../panel-message.cjs');

const SYSTEMS = Object.freeze([
  'Destiny2',
  'D2Profiles',
  'D2Vendors',
  'D2Milestones',
  'D2PublicMilestones',
  'D2Manifest'
]);

function systemsFromSettings(json) {
  const source = json?.Response?.systems || json?.systems || {};
  const systems = {};
  for (const [name, value] of Object.entries(source)) {
    if (!/^[A-Za-z0-9]+$/.test(name)) continue;
    if (value && typeof value === 'object') systems[name] = Boolean(value.enabled);
    else systems[name] = Boolean(value);
  }
  return systems;
}

function featureOpen(systems, feature) {
  if (!systems || typeof systems !== 'object') return false;
  if (feature === 'reset') return Boolean(systems.D2PublicMilestones || systems.D2Milestones);
  if (feature === 'xur') return Boolean(systems.D2Vendors);
  if (feature === 'lookup' || feature === 'clan') return Boolean(systems.Destiny2 && systems.D2Profiles);
  if (feature === 'manifest') return Boolean(systems.D2Manifest);
  return false;
}

function createHealth({ file, now = () => new Date() } = {}) {
  let memory = null;

  function read() {
    if (memory) return memory;
    if (!file) return null;
    const stored = readJson(file, null);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    memory = stored;
    return memory;
  }

  function write(next) {
    memory = next;
    if (file) writeJson(file, next);
    return memory;
  }

  async function poll(client) {
    const result = await client.get('/Settings/');
    const checkedAt = now().toISOString();
    const previous = read() || {};
    if (!result.ok) {
      const next = {
        ...previous,
        checkedAt,
        status: result.status || 0,
        contentType: result.contentType || '',
        degraded: true,
        reason: result.reason || result.kind || 'unavailable',
        systems: previous.systems || {},
        lastOkAt: previous.lastOkAt || {}
      };
      return write(next);
    }
    const systems = systemsFromSettings(result.json);
    const lastOkAt = { ...(previous.lastOkAt || {}) };
    for (const name of Object.keys(systems)) {
      if (systems[name]) lastOkAt[name] = checkedAt;
    }
    return write({
      checkedAt,
      status: result.status || 200,
      contentType: result.contentType || '',
      degraded: false,
      reason: '',
      systems,
      lastOkAt
    });
  }

  function allows(feature) {
    const current = read();
    if (!current || current.degraded) return false;
    return featureOpen(current.systems, feature);
  }

  return { poll, allows, read, featureOpen, systemsFromSettings };
}

module.exports = {
  SYSTEMS,
  systemsFromSettings,
  featureOpen,
  createHealth
};
