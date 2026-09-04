'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');

const STATE_FILE = 'arkshop-profile-health-monitor.json';
const HEALTHY_CODE = 'OK';
const UNHEALTHY_CODE = 'ARKSHOP_PROFILE_STATE_UNHEALTHY';

function safeSnapshot(health = {}) {
  if (health?.ok === true) {
    return Object.freeze({
      ok: true,
      code: HEALTHY_CODE,
      profileCount: Math.max(0, Math.floor(Number(health.profileCount) || 0)),
      version: Math.max(0, Math.floor(Number(health.version) || 0))
    });
  }
  return Object.freeze({ ok: false, code: UNHEALTHY_CODE, profileCount: 0, version: 0 });
}

function readPrevious(root) {
  const file = path.join(root, STATE_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return safeSnapshot(parsed);
  } catch {
    return null;
  }
}

function writePrevious(root, snapshot) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, STATE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = { ...safeSnapshot(snapshot), checkedAt: new Date().toISOString() };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return payload;
}

function healthChanged(previous, current) {
  if (!previous) return current.ok !== true;
  return previous.ok !== current.ok || previous.code !== current.code;
}

function alertPayload(snapshot) {
  const current = safeSnapshot(snapshot);
  if (current.ok) {
    return Object.freeze({
      state: 'healthy',
      title: '🟢 ARK Shop Profile Storage Recovered',
      description: 'Sentinal can safely read and validate ArkShop profile storage again. Automatic repair or reconstruction was not performed.',
      counts: Object.freeze({ profileCount: current.profileCount, version: current.version })
    });
  }
  return Object.freeze({
    state: 'unhealthy',
    title: '🔴 ARK Shop Profile Storage Unhealthy',
    description: 'Sentinal has failed closed for ArkShop profile operations. Existing profile data was not overwritten, repaired, or automatically reconstructed. Staff review is required.',
    code: current.code
  });
}

function inspectArkShopProfileHealth(options = {}) {
  const root = path.resolve(options.root || process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data'));
  const store = options.store || new ArkShopProfileStore(root);
  const current = safeSnapshot(store.health());
  const previous = readPrevious(root);
  const changed = healthChanged(previous, current);
  writePrevious(root, current);
  return Object.freeze({ current, previous, changed, alert: changed ? alertPayload(current) : null });
}

module.exports = {
  STATE_FILE,
  HEALTHY_CODE,
  UNHEALTHY_CODE,
  safeSnapshot,
  readPrevious,
  writePrevious,
  healthChanged,
  alertPayload,
  inspectArkShopProfileHealth
};
