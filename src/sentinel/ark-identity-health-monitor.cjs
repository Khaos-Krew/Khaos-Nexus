'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');

const STATE_FILE = 'ark-identity-health-monitor.json';

function safeSnapshot(health = {}) {
  if (health?.ok === true) {
    return Object.freeze({
      ok: true,
      code: 'OK',
      profiles: Math.max(0, Number(health.profiles) || 0),
      linkedArkAccounts: Math.max(0, Number(health.linkedArkAccounts) || 0),
      pendingChallenges: Math.max(0, Number(health.pendingChallenges) || 0)
    });
  }
  const code = health?.code === 'ARK_IDENTITY_STATE_CORRUPT'
    ? 'ARK_IDENTITY_STATE_CORRUPT'
    : 'ARK_IDENTITY_STATE_UNAVAILABLE';
  return Object.freeze({ ok: false, code, profiles: 0, linkedArkAccounts: 0, pendingChallenges: 0 });
}

function readPrevious(root) {
  const file = path.join(root, STATE_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return safeSnapshot(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
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
      title: '🟢 ARK Account Linking Storage Recovered',
      description: 'Sentinal can safely read and validate the ARK identity store again. Automatic reconstruction was not performed.',
      counts: Object.freeze({
        profiles: current.profiles,
        linkedArkAccounts: current.linkedArkAccounts,
        pendingChallenges: current.pendingChallenges
      })
    });
  }
  return Object.freeze({
    state: current.code === 'ARK_IDENTITY_STATE_CORRUPT' ? 'corrupt' : 'unavailable',
    title: current.code === 'ARK_IDENTITY_STATE_CORRUPT'
      ? '🔴 ARK Account Linking Storage Corruption Detected'
      : '🔴 ARK Account Linking Storage Unavailable',
    description: 'Sentinal has failed closed for ARK identity operations. Existing identity data was not overwritten or automatically reconstructed. Staff review is required.',
    code: current.code
  });
}

function inspectIdentityHealth(options = {}) {
  const root = path.resolve(options.root || process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data'));
  const store = options.store || new ArkIdentityStore({ root });
  const current = safeSnapshot(store.health());
  const previous = readPrevious(root);
  const changed = healthChanged(previous, current);
  writePrevious(root, current);
  return Object.freeze({ current, previous, changed, alert: changed ? alertPayload(current) : null });
}

module.exports = { STATE_FILE, safeSnapshot, readPrevious, writePrevious, healthChanged, alertPayload, inspectIdentityHealth };
