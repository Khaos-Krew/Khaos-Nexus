'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { mergeProviderModules, providerSecretNames, sanitizeProviderModules } = require('../shared/provider-sync.cjs');

let activeStore = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function atomicWrite(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}
function keyFromToken(token) {
  const value = String(token || '');
  if (value.length < 32 || /\s/.test(value)) return null;
  return crypto.createHash('sha256').update('khaos-nexus-hosted-provider-v1\0').update(value).digest();
}
function encryptSecret(secret, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
}
function decryptSecret(record, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8');
}

class HostedProviderStore {
  constructor({ root = process.cwd(), token = '', templateConfig }) {
    this.root = root;
    this.token = String(token || '');
    this.key = keyFromToken(this.token);
    this.templateConfig = clone(templateConfig || {});
    this.file = path.join(root, 'data', 'hosted-provider-config.json');
    this.runtimeFile = path.join(root, 'data', 'hosted-runtime-config.json');
  }

  empty() { return { version: 1, modules: {}, secrets: {}, updatedAt: null }; }
  read() {
    if (!fs.existsSync(this.file)) return this.empty();
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        version: 1,
        modules: value?.modules && typeof value.modules === 'object' ? value.modules : {},
        secrets: value?.secrets && typeof value.secrets === 'object' ? value.secrets : {},
        updatedAt: value?.updatedAt || null
      };
    } catch { return this.empty(); }
  }

  effectiveConfig() {
    const state = this.read();
    const modules = sanitizeProviderModules(state.modules || {}, this.templateConfig);
    return mergeProviderModules(this.templateConfig, modules);
  }

  materializeRuntimeConfig() {
    const config = this.effectiveConfig();
    atomicWrite(this.runtimeFile, config);
    return this.runtimeFile;
  }

  applySecrets() {
    const state = this.read();
    const allowed = new Set(providerSecretNames(this.effectiveConfig()));
    const applied = [];
    const failed = [];
    if (!this.key) return { applied, failed: Object.keys(state.secrets || {}).filter((name) => allowed.has(name)), encryptionReady: false };
    for (const [name, record] of Object.entries(state.secrets || {})) {
      if (!allowed.has(name)) continue;
      try {
        const value = decryptSecret(record, this.key);
        if (value) { process.env[name] = value; applied.push(name); }
      } catch { failed.push(name); }
    }
    return { applied, failed, encryptionReady: true };
  }

  status() {
    const state = this.read();
    const config = this.effectiveConfig();
    const allowed = new Set(providerSecretNames(config));
    const secretNames = Object.keys(state.secrets || {}).filter((name) => allowed.has(name)).sort();
    return {
      ok: true,
      configured: Object.keys(state.modules || {}).length > 0,
      updatedAt: state.updatedAt,
      secretEncryptionReady: Boolean(this.key),
      configuredSecrets: secretNames.map((name) => ({ name, configured: true })),
      modules: sanitizeProviderModules(state.modules || {}, this.templateConfig)
    };
  }

  configure(input = {}) {
    const current = this.read();
    const modules = sanitizeProviderModules(input.modules || {}, this.templateConfig);
    const config = mergeProviderModules(this.templateConfig, modules);
    const allowed = new Set(providerSecretNames(config));
    const secrets = { ...(current.secrets || {}) };
    if (input.secrets && typeof input.secrets === 'object' && !Array.isArray(input.secrets)) {
      if (!this.key) throw new Error('Hosted provider secret encryption is unavailable.');
      for (const [rawName, rawValue] of Object.entries(input.secrets)) {
        const name = String(rawName || '').trim().toUpperCase();
        if (!allowed.has(name)) throw new Error(`Provider secret ${name || '(blank)'} is not allowed by the hosted module configuration.`);
        const value = String(rawValue || '');
        if (!value || value.length > 8192) throw new Error(`${name}: provider secret is empty or too large.`);
        secrets[name] = encryptSecret(value, this.key);
      }
    }
    for (const rawName of Array.isArray(input.clearSecrets) ? input.clearSecrets : []) {
      const name = String(rawName || '').trim().toUpperCase();
      if (allowed.has(name)) { delete secrets[name]; delete process.env[name]; }
    }
    const state = { version: 1, modules, secrets, updatedAt: new Date().toISOString() };
    atomicWrite(this.file, state);
    this.materializeRuntimeConfig();
    const applied = this.applySecrets();
    return { ...this.status(), secretApply: applied };
  }
}

function bootstrapHostedProviderStore(options = {}) {
  const root = options.root || process.cwd();
  const templatePath = options.templatePath || path.join(root, 'config.example.json');
  const templateConfig = options.templateConfig || JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const store = new HostedProviderStore({ root, token: options.token || process.env.NEXUS_SENTINAL_ADMIN_TOKEN || '', templateConfig });
  const runtimeFile = store.materializeRuntimeConfig();
  const secretState = store.applySecrets();
  process.env.NEXUS_CONFIG = runtimeFile;
  activeStore = store;
  return { store, runtimeFile, secretState };
}

function currentHostedProviderStore() { return activeStore; }

module.exports = {
  HostedProviderStore,
  bootstrapHostedProviderStore,
  currentHostedProviderStore,
  decryptSecret,
  encryptSecret,
  keyFromToken
};
