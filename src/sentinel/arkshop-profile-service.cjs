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

function validateApplyState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('ArkShop apply history root must be an object.');
  if (state.version != null && state.version !== STORE_VERSION) throw new Error('ArkShop apply history uses an unsupported store version.');
  if (!Array.isArray(state.transactions)) throw new Error('ArkShop apply history transactions must be an array.');

  const seen = new Set();
  for (const transaction of state.transactions) {
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) throw new Error('ArkShop apply history contains an invalid transaction record.');
    const id = String(transaction.id || '').trim();
    if (!id) throw new Error('ArkShop apply history contains a transaction without an id.');
    if (seen.has(id)) throw new Error('ArkShop apply history contains duplicate transaction ids.');
    seen.add(id);
  }

  return {
    version: STORE_VERSION,
    transactions: state.transactions.slice(-MAX_TRANSACTIONS).map((item) => deepClone(item))
  };
}

class ArkShopApplyStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'arkshop-applies.json');
  }

  read() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: STORE_VERSION, transactions: [] };
      throw new Error('ArkShop apply history exists but could not be read.');
    }

    let state;
    try {
      state = JSON.parse(text);
    } catch {
      throw new Error('ArkShop apply history contains invalid JSON.');
    }
    return validateApplyState(state);
  }

  write(state) {
    const validated = validateApplyState({ ...state, version: state?.version ?? STORE_VERSION });
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(validated, null, 2));
    fs.renameSync(tmp, this.file);
    return validated;
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

  health() {
    try {
      const state = this.read();
      return { ok: true, transactionCount: state.transactions.length, version: STORE_VERSION };
    } catch {
      return { ok: false, transactionCount: 0, version: STORE_VERSION };
    }
  }
}

async function previewArkShopProfile({ server, profile, reader = readConfig, guardCurrent = null } = {}) {
  if (!server?.envPrefix) throw new Error('ARK server has no environment prefix.');
  if (!profile?.id) throw new Error('ArkShop profile is required.');
  const currentResult = await reader(server.envPrefix, 'arkshop');
  const current = parseArkShopText(currentResult.text);
  if (guardCurrent) await guardCurrent(current, { phase: 'preview' });
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
  guardCurrent = null,
  dryRun = false
} = {}) {
  const preview = await previewArkShopProfile({ server, profile, reader, guardCurrent });
  if (dryRun || !preview.changed) return { ...preview, dryRun: true, transaction: null, reload: null };

  let writeResult;
  try {
    writeResult = await writer({
      prefix: server.envPrefix,
      dryRun: false,
      transform: async (current) => {
        if (guardCurrent) await guardCurrent(current, { phase: 'write' });
        return buildArkShopConfig(current, profile.data);
      }
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
      status: 'applied',
      rolledBackAt: ''
    };
    applyStore.add(transaction);
    return { ...preview, dryRun: false, transaction, reload, restartRequired: false };
  } catch (error) {
    let restored = false;
    let rollbackError = null;
    if (writeResult?.changed && writeResult?.backup) {
      try {
        await restorer({ prefix: server.envPrefix, fileKey: 'arkshop', backup: writeResult.backup });
        try {
          await reloader(server);
          restored = true;
        } catch (reloadOldError) { rollbackError = reloadOldError; }
      } catch (restoreError) {
        rollbackError = restoreError;
      }
    }
    applyStore.add({
      id: crypto.randomUUID(),
      serverId: String(server?.id || ''),
      envPrefix: String(server?.envPrefix || ''),
      profileId: String(profile?.id || ''),
      profileRevision: Number(profile?.revision) || 1,
      actorId: String(actorId || '').slice(0, 40),
      failedAt: new Date().toISOString(),
      backup: writeResult?.backup || '',
      remoteFile: writeResult?.remoteFile || preview.remoteFile || '',
      reloadCommand: 'ArkShop.Reload',
      status: 'failed',
      restored,
      failure: 'ArkShop profile apply failed; inspect protected service logs for details.',
      rolledBackAt: ''
    });
    if (!writeResult?.changed || !writeResult?.backup) throw error;
    const suffix = rollbackError
      ? ` The new config write could not be fully rolled back/reloaded: ${String(rollbackError?.message || rollbackError).slice(0, 240)}`
      : ' The pre-write ArkShop config was restored and reloaded.';
    throw new Error(`ArkShop profile apply failed: ${String(error?.message || error).slice(0, 300)}.${suffix}`);
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
  validateApplyState,
  ArkShopApplyStore,
  previewArkShopProfile,
  reloadArkShop,
  applyArkShopProfile,
  rollbackArkShopTransaction
};
