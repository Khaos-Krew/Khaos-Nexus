'use strict';

const fs = require('node:fs');
const path = require('node:path');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function validName(value) {
  const name = String(value || '').trim().toUpperCase();
  if (!/^NEXUS_[A-Z0-9_]+$/.test(name)) throw new Error('Secret name is not an approved Nexus environment key.');
  return name;
}

class SecretVault {
  constructor({ userDataPath, safeStorage }) {
    this.safeStorage = safeStorage;
    this.filePath = path.join(userDataPath, 'secrets.json');
    ensureDirectory(userDataPath);
  }

  encryptionAvailable() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  load() {
    if (!fs.existsSync(this.filePath)) return { version: 1, secrets: {} };
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!value || typeof value !== 'object' || typeof value.secrets !== 'object') return { version: 1, secrets: {} };
      return { version: 1, secrets: { ...value.secrets } };
    } catch {
      return { version: 1, secrets: {} };
    }
  }

  save(value) {
    ensureDirectory(path.dirname(this.filePath));
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
  }

  set(name, secret) {
    const key = validName(name);
    const value = String(secret || '');
    if (!value) throw new Error('Secret value cannot be empty.');
    if (!this.encryptionAvailable()) throw new Error('OS protected storage is not available on this system.');
    const data = this.load();
    data.secrets[key] = this.safeStorage.encryptString(value).toString('base64');
    this.save(data);
    process.env[key] = value;
    return { name: key, configured: true };
  }

  remove(name) {
    const key = validName(name);
    const data = this.load();
    delete data.secrets[key];
    this.save(data);
    delete process.env[key];
    return { name: key, configured: false };
  }

  decrypt(name) {
    const key = validName(name);
    const encoded = this.load().secrets[key];
    if (!encoded || !this.encryptionAvailable()) return '';
    try {
      return this.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      return '';
    }
  }

  apply(names = []) {
    const applied = [];
    for (const rawName of names) {
      const name = validName(rawName);
      if (process.env[name]) {
        applied.push(name);
        continue;
      }
      const value = this.decrypt(name);
      if (value) {
        process.env[name] = value;
        applied.push(name);
      }
    }
    return applied;
  }

  statuses(names = []) {
    const data = this.load();
    return names.map((rawName) => {
      const name = validName(rawName);
      return {
        name,
        configured: Boolean(process.env[name] || data.secrets[name]),
        source: process.env[name] ? 'environment' : data.secrets[name] ? 'protected-storage' : 'missing'
      };
    });
  }
}

module.exports = { SecretVault, validName };
