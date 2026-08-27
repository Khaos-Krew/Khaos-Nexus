'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { updateArkShopConfig, readConfig, restoreBackup } = require('./ark-config-manager.cjs');
const { ArkRconClient } = require('./ark-rcon.cjs');
const { serverConnectionFromRecord } = require('./ark-cluster-monitor.cjs');
const { normalizeData, counts } = require('./arkshop-profiles.cjs');

const STORE_VERSION = 1;
const MAX_TRANSACTIONS = 100;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return deepClone(patch);
  const out = base && typeof base === 'object' && !Array.isArray(base) ? deepClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = deepMerge(out[key], value);
    else out[key] = deepClone(value);
  }
  return out;
}

function buildArkShopConfig(currentConfig, profileData) {
  const current = deepClone(currentConfig || {});
  const data = normalizeData(profileData);
  current.General = deepMerge(current.General || {}, data.General || {});
  for (const section of data.managedSections) current[section] = deepClone(data[section] || {});
  return current;
}

function parseArkShopText(text) {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root is not an object');
    return parsed;
  } catch (error) {
    throw new Error(`ArkShop config.json is not valid JSON: ${error.message}`);
  }
}

function configsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class ArkShopApplyStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'arkshop-applies.json');
  }

  read() {
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state && Array.isArray(state.transactions)) return { version: STORE_VERSION, transactions: state.transactions.slice(-MAX_TRANSACTIONS) };
    } catch {}
    return { version: STORE_VERSION, transactions: [] };
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    state.version = STORE_VERSION;
    state.transactions = (state.transactions || []).slice(-MAX_TRANSACTIONS);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
    return state;
  }

  add(transaction) {
    const state = this.read();
    state.transactions.push(deepClone(transaction));
    this.write(state);
    return transaction;
  }

  get(id) { return this.read().transactions.find((item) => item.id === String(id || '')) || null; }

  listForServer(serverId, limit = 12) {
    return this.read().transactions.filter((item) => item.serverId === String(serverId || '')).slice(-Math.max(1, Math.min(25, Number(limit) || 12))).reverse();
  }

  markRolledBack(id) {
    const state = this.read();
    const item = state.transactions.find((entry) => entry.id === String(id || ''));
    if (!item) throw new Error('Unknown ArkShop apply transaction.');
    item.rolledBackAt = new Date().toISOString();
    this.write(state);
    return item;
  }
}

async function previewArkShopProfile({ server, profile, reader = readConfig } = {}) {
  if (!server?.envPrefix) throw new Error('ARK server has no environment prefix.');
  if (!profile?.id) throw new Error('ArkShop profile is required.');
  const currentResult = await reader(server.envPrefix, 'arkshop');
  const current = parseArkShopText(currentResult.text);
  const next = buildArkShopConfig(current, profile.data);
  return {
    serverId: server.id,
    profileId: profile.id,
    revision: profile.revision,
    changed: !configsEqual(current, next),
    remoteFile: currentResult.remoteFile,
    counts: counts(profile.data),
    managedSections: normalizeData(profile.data).managedSections,
    restartRequired: false
  };
}

async function reloadArkShop(server, { RconClient = ArkRconClient } = {}) {
  const connection = serverConnectionFromRecord(server);
  if (!connection.host || !connection.port || !connection.password) throw new Error('ARK RCON is not configured for ArkShop reload.');
  const client = new RconClient(connection);
  const response = await client.execute('ArkShop.Reload');
  return { command: 'ArkShop.Reload', response: String(response || '').slice(0, 500) };
}

async function applyArkShopProfile({
  server,
  profile,
  actorId = '',
  applyStore = new ArkShopApplyStore(),
  reader = readConfig,
  writer = updateArkShopConfig,
  restorer = restoreBackup,
  reloader = reloadArkShop,
  dryRun = false
} = {}) {
  const preview = await previewArkShopProfile({ server, profile, reader });
  if (dryRun || !preview.changed) return { ...preview, dryRun: true, transaction: null, reload: null };

  let writeResult;
  try {
    writeResult = await writer({
      prefix: server.envPrefix,
      dryRun: false,
      transform: (current) => buildArkShopConfig(current, profile.data)
    });
    const reload = await reloader(server);
    const transaction = {
      id: crypto.randomUUID(),
      serverId: String(server.id || ''),
      envPrefix: String(server.envPrefix || ''),
      profileId: String(profile.id || ''),
      profileRevision: Number(profile.revision) || 1,
      actorId: String(actorId || '').slice(0, 40),
      appliedAt: new Date().toISOString(),
      backup: writeResult.backup || '',
      remoteFile: writeResult.remoteFile || preview.remoteFile,
      reloadCommand: 'ArkShop.Reload',
      rolledBackAt: ''
    };
    applyStore.add(transaction);
    return { ...preview, dryRun: false, transaction, reload, restartRequired: false };
  } catch (error) {
    if (writeResult?.changed && writeResult?.backup) {
      let rollbackError = null;
      try {
        await restorer({ prefix: server.envPrefix, fileKey: 'arkshop', backup: writeResult.backup });
        try { await reloader(server); } catch (reloadOldError) { rollbackError = reloadOldError; }
      } catch (restoreError) {
        rollbackError = restoreError;
      }
      const suffix = rollbackError
        ? ` The new config write could not be fully rolled back/reloaded: ${String(rollbackError?.message || rollbackError).slice(0, 240)}`
        : ' The pre-write ArkShop config was restored and reloaded.';
      throw new Error(`ArkShop profile apply failed: ${String(error?.message || error).slice(0, 300)}.${suffix}`);
    }
    throw error;
  }
}

async function rollbackArkShopTransaction({
  server,
  transactionId,
  applyStore = new ArkShopApplyStore(),
  restorer = restoreBackup,
  reloader = reloadArkShop
} = {}) {
  const transaction = applyStore.get(transactionId);
  if (!transaction) throw new Error('Unknown ArkShop apply transaction.');
  if (transaction.serverId !== server.id || transaction.envPrefix !== server.envPrefix) throw new Error('That ArkShop transaction belongs to a different server.');
  if (transaction.rolledBackAt) throw new Error('That ArkShop transaction has already been rolled back.');
  if (!transaction.backup) throw new Error('That ArkShop transaction has no backup to restore.');

  await restorer({ prefix: server.envPrefix, fileKey: 'arkshop', backup: transaction.backup });
  try {
    await reloader(server);
  } catch (error) {
    throw new Error(`ArkShop backup was restored, but ArkShop.Reload failed: ${String(error?.message || error).slice(0, 300)}. The restored file will be used on the next plugin/server load.`);
  }
  applyStore.markRolledBack(transaction.id);
  return { transactionId: transaction.id, restoredFrom: transaction.backup, reloadCommand: 'ArkShop.Reload', restartRequired: false };
}

module.exports = {
  STORE_VERSION,
  MAX_TRANSACTIONS,
  deepClone,
  deepMerge,
  buildArkShopConfig,
  parseArkShopText,
  configsEqual,
  ArkShopApplyStore,
  previewArkShopProfile,
  reloadArkShop,
  applyArkShopProfile,
  rollbackArkShopTransaction
};
