'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { patchIniSection } = require('./ark-sftp-config.cjs');
const { readConfig, setIniValue, restoreBackup } = require('./ark-config-manager.cjs');
const { normalizeFiles, countSettings } = require('./ark-config-profiles.cjs');

const APPLY_STORE_VERSION = 1;
const MAX_TRANSACTIONS = 100;
const PROTECTED_PLAYER_STAT_KEY = /^PerLevelStatsMultiplier_Player\[\d+\]$/i;

function cleanText(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function applySectionsToText(input, sections = {}) {
  let next = String(input || '');
  for (const [section, settings] of Object.entries(sections || {})) {
    next = patchIniSection(next, section, settings);
  }
  return next;
}

function profileRefs(files) {
  const normalized = normalizeFiles(files);
  const refs = [];
  for (const fileKey of ['gus', 'game']) {
    for (const [section, settings] of Object.entries(normalized[fileKey].sections)) {
      for (const key of Object.keys(settings)) refs.push({ fileKey, section, key });
    }
  }
  return refs;
}

function isProtectedProfileRef(ref = {}) {
  return String(ref.fileKey || '').toLowerCase() === 'game' && PROTECTED_PLAYER_STAT_KEY.test(String(ref.key || ''));
}

function protectedProfileRefs(files) {
  return profileRefs(files).filter(isProtectedProfileRef);
}

class ArkConfigApplyStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'ark-config-applies.json');
  }

  read() {
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state && typeof state === 'object' && Array.isArray(state.transactions)) {
        return { version: APPLY_STORE_VERSION, transactions: state.transactions.slice(-MAX_TRANSACTIONS) };
      }
    } catch {}
    return { version: APPLY_STORE_VERSION, transactions: [] };
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    state.version = APPLY_STORE_VERSION;
    state.transactions = (state.transactions || []).slice(-MAX_TRANSACTIONS);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
    return state;
  }

  add(transaction) {
    const state = this.read();
    state.transactions.push(JSON.parse(JSON.stringify(transaction)));
    this.write(state);
    return transaction;
  }

  get(id) {
    return this.read().transactions.find((item) => item.id === String(id || '')) || null;
  }

  markRolledBack(id, details = {}) {
    const state = this.read();
    const item = state.transactions.find((entry) => entry.id === String(id || ''));
    if (!item) throw new Error('Unknown ARK config apply transaction.');
    item.rolledBackAt = new Date().toISOString();
    item.rollback = {
      restored: Math.max(0, Number(details.restored) || 0),
      failures: Math.max(0, Number(details.failures) || 0)
    };
    this.write(state);
    return item;
  }

  listForServer(serverId, limit = 10) {
    return this.read().transactions.filter((item) => item.serverId === String(serverId || '')).slice(-Math.max(1, Math.min(25, Number(limit) || 10))).reverse();
  }
}

async function previewProfile({ server, profile, reader = readConfig } = {}) {
  if (!server?.envPrefix) throw new Error('ARK cluster server has no environment prefix.');
  if (!profile?.id) throw new Error('ARK config profile is required.');
  const files = normalizeFiles(profile.files);
  const counts = countSettings(files);
  const protectedRefs = protectedProfileRefs(files);
  const results = {};
  let changedFiles = 0;

  for (const fileKey of ['gus', 'game']) {
    const sections = files[fileKey].sections;
    const configured = Object.values(sections).reduce((sum, settings) => sum + Object.keys(settings).length, 0);
    if (!configured) {
      results[fileKey] = { configured: 0, changed: false, remoteFile: '' };
      continue;
    }
    const current = await reader(server.envPrefix, fileKey);
    const next = applySectionsToText(current.text, sections);
    const changed = next !== current.text;
    if (changed) changedFiles += 1;
    results[fileKey] = { configured, changed, remoteFile: current.remoteFile };
  }

  return {
    profileId: profile.id,
    revision: profile.revision,
    serverId: server.id,
    envPrefix: server.envPrefix,
    settings: counts.total,
    protectedSettings: protectedRefs.length,
    protectedRefs,
    changedFiles,
    files: results,
    restartRequired: changedFiles > 0
  };
}

async function rollbackBackups({ prefix, applied = [], restorer = restoreBackup } = {}) {
  let restored = 0;
  let failures = 0;
  const errors = [];
  for (const item of [...applied].reverse()) {
    if (!item?.backup || !item?.fileKey) continue;
    try {
      await restorer({ prefix, fileKey: item.fileKey, backup: item.backup });
      restored += 1;
    } catch (error) {
      failures += 1;
      errors.push(cleanText(error?.message || error, 240));
    }
  }
  return { restored, failures, errors };
}

async function applyProfile({
  server,
  profile,
  actorId = '',
  applyStore = new ArkConfigApplyStore(),
  dryRun = false,
  allowProtected = false,
  reader = readConfig,
  setter = setIniValue,
  restorer = restoreBackup
} = {}) {
  const preview = await previewProfile({ server, profile, reader });
  if (!dryRun && preview.protectedSettings > 0 && allowProtected !== true) {
    throw new Error(`ARK config profile contains ${preview.protectedSettings} protected player-stat setting(s). Ordinary apply is blocked; use an explicit owner-approved protected-setting workflow.`);
  }
  if (dryRun || preview.changedFiles === 0) return { ...preview, dryRun: true, transaction: null, appliedSettings: 0 };

  const files = normalizeFiles(profile.files);
  const applied = [];
  let appliedSettings = 0;
  try {
    for (const fileKey of ['gus', 'game']) {
      for (const [section, settings] of Object.entries(files[fileKey].sections)) {
        for (const [key, value] of Object.entries(settings)) {
          const result = await setter({ prefix: server.envPrefix, fileKey, section, key, value, dryRun: false });
          if (result.changed) {
            applied.push({ fileKey, section, key, backup: result.backup, remoteFile: result.remoteFile });
            appliedSettings += 1;
          }
        }
      }
    }
  } catch (error) {
    const rollback = await rollbackBackups({ prefix: server.envPrefix, applied, restorer });
    const suffix = rollback.failures ? ` Automatic rollback had ${rollback.failures} failure(s).` : ` ${rollback.restored} applied setting(s) were rolled back.`;
    throw new Error(`ARK config profile apply failed: ${cleanText(error?.message || error, 300)}.${suffix}`);
  }

  const transaction = {
    id: crypto.randomUUID(),
    serverId: String(server.id || ''),
    envPrefix: String(server.envPrefix || ''),
    profileId: String(profile.id || ''),
    profileRevision: Number(profile.revision) || 1,
    actorId: cleanText(actorId, 40),
    appliedAt: new Date().toISOString(),
    restartRequired: appliedSettings > 0,
    protectedSettings: preview.protectedSettings,
    applied: applied.map((item) => ({
      fileKey: item.fileKey,
      section: cleanText(item.section, 120),
      key: cleanText(item.key, 120),
      backup: item.backup,
      remoteFile: item.remoteFile
    })),
    rolledBackAt: ''
  };
  applyStore.add(transaction);
  return { ...preview, dryRun: false, transaction, appliedSettings, restartRequired: appliedSettings > 0 };
}

async function rollbackTransaction({ server, transactionId, applyStore = new ArkConfigApplyStore(), restorer = restoreBackup } = {}) {
  if (!server?.id || !server?.envPrefix) throw new Error('ARK cluster server is required.');
  const transaction = applyStore.get(transactionId);
  if (!transaction) throw new Error('Unknown ARK config apply transaction.');
  if (transaction.serverId !== server.id || transaction.envPrefix !== server.envPrefix) throw new Error('That transaction belongs to a different ARK server.');
  if (transaction.rolledBackAt) throw new Error('That ARK config transaction has already been rolled back.');
  const result = await rollbackBackups({ prefix: server.envPrefix, applied: transaction.applied, restorer });
  if (result.failures) throw new Error(`Rollback restored ${result.restored} setting(s) but ${result.failures} restore operation(s) failed: ${result.errors.join('; ')}`);
  applyStore.markRolledBack(transaction.id, result);
  return { transactionId: transaction.id, restored: result.restored, restartRequired: result.restored > 0 };
}

module.exports = {
  APPLY_STORE_VERSION,
  MAX_TRANSACTIONS,
  PROTECTED_PLAYER_STAT_KEY,
  cleanText,
  applySectionsToText,
  profileRefs,
  isProtectedProfileRef,
  protectedProfileRefs,
  ArkConfigApplyStore,
  previewProfile,
  rollbackBackups,
  applyProfile,
  rollbackTransaction
};
