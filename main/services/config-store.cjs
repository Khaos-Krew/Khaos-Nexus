'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { safeStorage } = require('electron');

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  general: {
    autoStartBot: true,
    autoRestart: true,
    minimizeToTray: true,
    startWithWindows: false,
    checkUpdates: true
  },
  discord: {
    guildId: '',
    ownerUserId: ''
  },
  monitor: {
    maxRestarts: 5,
    restartWindowMinutes: 10,
    reportRepository: 'Khaos-Krew/Khaos-Nexus-Bot-Manager'
  },
  servers: []
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(current) {
  return {
    ...clone(DEFAULT_CONFIG),
    ...current,
    general: { ...DEFAULT_CONFIG.general, ...(current?.general || {}) },
    discord: { ...DEFAULT_CONFIG.discord, ...(current?.discord || {}) },
    monitor: { ...DEFAULT_CONFIG.monitor, ...(current?.monitor || {}) },
    servers: Array.isArray(current?.servers) ? current.servers : []
  };
}

class ConfigStore {
  constructor(userDataDirectory) {
    this.configPath = path.join(userDataDirectory, 'config.json');
    this.secretsPath = path.join(userDataDirectory, 'secrets.bin');
    this.config = this.loadConfig();
    this.secrets = this.loadSecrets();
  }

  loadConfig() {
    try {
      return mergeDefaults(JSON.parse(fs.readFileSync(this.configPath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') this.backupCorruptFile(this.configPath);
      const config = clone(DEFAULT_CONFIG);
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      return config;
    }
  }

  loadSecrets() {
    try {
      const encrypted = fs.readFileSync(this.secretsPath);
      if (!safeStorage.isEncryptionAvailable()) return {};
      return JSON.parse(safeStorage.decryptString(encrypted));
    } catch (error) {
      if (error.code !== 'ENOENT') this.backupCorruptFile(this.secretsPath);
      return {};
    }
  }

  backupCorruptFile(filePath) {
    try {
      if (fs.existsSync(filePath)) fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {}
  }

  saveConfig() {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.config, null, 2), 'utf8');
    fs.renameSync(temporary, this.configPath);
  }

  saveSecrets() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this system.');
    }
    fs.mkdirSync(path.dirname(this.secretsPath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(this.secrets));
    fs.writeFileSync(this.secretsPath, encrypted);
  }

  getConfig() { return clone(this.config); }

  getPublicConfig() {
    const config = clone(this.config);
    config.hasDiscordToken = Boolean(this.secrets.discordToken);
    config.servers = config.servers.map((server) => ({
      ...server,
      hasPassword: Boolean(this.secrets.serverPasswords?.[server.id])
    }));
    return config;
  }

  getSecretValues() {
    return [
      this.secrets.discordToken,
      ...Object.values(this.secrets.serverPasswords || {})
    ].filter(Boolean);
  }

  setGeneral(general) {
    this.config.general = { ...this.config.general, ...general };
    this.saveConfig();
  }

  setDiscord(discord) {
    this.config.discord = {
      guildId: String(discord.guildId || '').trim(),
      ownerUserId: String(discord.ownerUserId || '').trim()
    };
    this.saveConfig();
  }

  setDiscordToken(token) {
    const value = String(token || '').trim();
    if (value) this.secrets.discordToken = value;
    else delete this.secrets.discordToken;
    this.saveSecrets();
  }

  upsertServer(server, password) {
    const id = server.id || crypto.randomUUID();
    const normalized = {
      id,
      name: String(server.name || '').trim(),
      game: ['ark', 'palworld', 'generic'].includes(server.game) ? server.game : 'generic',
      host: String(server.host || '').trim(),
      port: Number(server.port),
      enabled: server.enabled !== false,
      statusCommand: String(server.statusCommand || '').trim(),
      playersCommand: String(server.playersCommand || '').trim(),
      saveCommand: String(server.saveCommand || '').trim(),
      broadcastCommand: String(server.broadcastCommand || '').trim(),
      kickCommand: String(server.kickCommand || '').trim(),
      banCommand: String(server.banCommand || '').trim()
    };
    if (!normalized.name || !normalized.host || !Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) {
      throw new Error('Server name, host, and a valid port are required.');
    }
    const index = this.config.servers.findIndex((item) => item.id === id);
    if (index >= 0) this.config.servers[index] = normalized;
    else this.config.servers.push(normalized);
    if (password) {
      this.secrets.serverPasswords ||= {};
      this.secrets.serverPasswords[id] = String(password);
      this.saveSecrets();
    }
    this.saveConfig();
    return id;
  }

  removeServer(id) {
    this.config.servers = this.config.servers.filter((server) => server.id !== id);
    if (this.secrets.serverPasswords) delete this.secrets.serverPasswords[id];
    this.saveConfig();
    if (safeStorage.isEncryptionAvailable()) this.saveSecrets();
  }

  getRuntimeBootstrap() {
    return {
      discordToken: this.secrets.discordToken || '',
      config: {
        ...clone(this.config),
        servers: this.config.servers.map((server) => ({
          ...clone(server),
          password: this.secrets.serverPasswords?.[server.id] || ''
        }))
      }
    };
  }

  createBackupPayload(appVersion) {
    let encryptedSecrets = null;
    try {
      if (fs.existsSync(this.secretsPath)) encryptedSecrets = fs.readFileSync(this.secretsPath).toString('base64');
    } catch {}
    return {
      format: 'khaos-nexus-bot-manager-backup',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      appVersion,
      note: 'Encrypted secrets can only be decrypted by the same operating-system user profile.',
      config: clone(this.config),
      encryptedSecrets
    };
  }

  restoreBackupPayload(payload) {
    if (!payload || payload.format !== 'khaos-nexus-bot-manager-backup' || payload.formatVersion !== 1) {
      throw new Error('This is not a supported Khaos Nexus Bot Manager backup.');
    }
    this.config = mergeDefaults(payload.config || {});
    this.saveConfig();
    if (payload.encryptedSecrets) {
      fs.writeFileSync(this.secretsPath, Buffer.from(payload.encryptedSecrets, 'base64'));
    }
    this.secrets = this.loadSecrets();
    return this.getPublicConfig();
  }

  exportSafeConfig() {
    return this.getPublicConfig();
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG, mergeDefaults };
