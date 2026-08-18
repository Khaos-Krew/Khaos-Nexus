'use strict';

const fs = require('node:fs');
const { safeStorage } = require('electron');
const { attachBackupIntegrity, validateBackupIntegrity } = require('../shared/sentinel-backup-integrity.cjs');

let installed = false;

function validateBackupPayload(payload = {}) {
  const supported = payload && (
    (payload.format === 'khaos-nexus-backup' && payload.formatVersion === 2) ||
    (payload.format === 'khaos-nexus-bot-manager-backup' && payload.formatVersion === 1)
  );
  if (!supported) throw new Error('This is not a supported Khaos Nexus backup.');
  if (!payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
    throw new Error('The backup configuration is missing or invalid.');
  }
  if (payload.config.servers !== undefined && !Array.isArray(payload.config.servers)) {
    throw new Error('The backup server configuration is invalid.');
  }
  const integrity = validateBackupIntegrity(payload);
  if (!integrity.valid) throw new Error(integrity.reason || 'Backup integrity validation failed.');

  if (payload.encryptedSecrets) {
    let encrypted;
    try { encrypted = Buffer.from(String(payload.encryptedSecrets), 'base64'); }
    catch { throw new Error('The encrypted credential payload is not valid base64.'); }
    if (!encrypted.length) throw new Error('The encrypted credential payload is empty.');
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const decrypted = safeStorage.decryptString(encrypted);
        const parsed = JSON.parse(decrypted);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Credential payload is not an object.');
      } catch (error) {
        throw new Error(`The encrypted credentials cannot be decrypted by this Windows profile: ${error.message || error}`);
      }
    }
  }
  return { valid: true, integrity };
}

function snapshotFile(filePath) {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null; }
  catch { return null; }
}

function restoreFile(filePath, snapshot) {
  if (snapshot === null) fs.rmSync(filePath, { force: true });
  else {
    fs.mkdirSync(require('node:path').dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, snapshot);
  }
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__nexusSentinelBackupSafetyPatched) return;

  class SentinelBackupConfigStore extends Original {
    createBackupPayload(appVersion) {
      return attachBackupIntegrity(super.createBackupPayload(appVersion));
    }

    validateBackupPayload(payload) {
      return validateBackupPayload(payload);
    }

    restoreBackupPayload(payload) {
      this.validateBackupPayload(payload);
      const configSnapshot = snapshotFile(this.configPath);
      const secretsSnapshot = snapshotFile(this.secretsPath);
      const memoryConfig = this.config;
      const memorySecrets = this.secrets;
      try {
        const result = super.restoreBackupPayload(payload);
        const written = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        if (!written || typeof written !== 'object' || !Array.isArray(written.servers)) {
          throw new Error('Restored configuration did not pass post-write validation.');
        }
        this.getPublicConfig();
        return result;
      } catch (error) {
        try {
          restoreFile(this.configPath, configSnapshot);
          restoreFile(this.secretsPath, secretsSnapshot);
          this.config = configSnapshot ? this.loadConfig() : memoryConfig;
          this.secrets = secretsSnapshot ? this.loadSecrets() : memorySecrets;
        } catch (rollbackError) {
          const wrapped = new Error(`Backup restore failed and rollback also failed: ${rollbackError.message || rollbackError}`);
          wrapped.cause = error;
          throw wrapped;
        }
        throw new Error(`Backup restore was rolled back safely: ${error.message || error}`);
      }
    }
  }

  Object.defineProperty(SentinelBackupConfigStore, '__nexusSentinelBackupSafetyPatched', { value: true });
  target.ConfigStore = SentinelBackupConfigStore;
}

function patchAutonomyService() {
  const target = require('./services/autonomy-service.cjs');
  const Original = target.AutonomyService;
  if (!Original || Original.__nexusSentinelBackupSafetyPatched) return;

  class SentinelBackupAutonomyService extends Original {
    verifyBackup(filePath) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (this.configStore?.validateBackupPayload) this.configStore.validateBackupPayload(parsed);
      else validateBackupPayload(parsed);
      return true;
    }
  }

  Object.defineProperty(SentinelBackupAutonomyService, '__nexusSentinelBackupSafetyPatched', { value: true });
  target.AutonomyService = SentinelBackupAutonomyService;
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchAutonomyService();
}

module.exports = { install, patchConfigStore, patchAutonomyService, validateBackupPayload };