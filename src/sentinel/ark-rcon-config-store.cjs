'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;

function normalizePrefix(value) {
  const prefix = String(value || '').trim().toUpperCase();
  if (!/^ARK_[A-Z0-9_]{2,60}$/.test(prefix)) throw new Error('Invalid ARK RCON server prefix.');
  return prefix;
}

function normalizeHost(value) {
  const host = String(value || '').trim();
  if (!host || host.length > 255 || /[\s\r\n\u0000]/.test(host)) throw new Error('RCON host is invalid.');
  return host;
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RCON port is invalid.');
  return port;
}

function normalizeTimeout(value, fallback = 8000) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) return fallback;
  return Math.max(1000, Math.min(30000, Math.round(timeout)));
}

class ArkRconConfigStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-rcon-overrides.json');
    this.secretFile = path.join(this.dir, 'ark-rcon-config-secret');
  }

  empty() {
    return { version: VERSION, servers: {}, updatedAt: '' };
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return this.empty();
      return {
        version: VERSION,
        servers: parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : {},
        updatedAt: String(parsed.updatedAt || '')
      };
    } catch {
      return this.empty();
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = {
      version: VERSION,
      servers: state.servers || {},
      updatedAt: new Date().toISOString()
    };
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return safe;
  }

  secret() {
    const explicit = String(process.env.NEXUS_RCON_CONFIG_SECRET || '').trim();
    if (explicit) {
      if (Buffer.byteLength(explicit) < 32) throw new Error('NEXUS_RCON_CONFIG_SECRET must contain at least 32 characters.');
      return explicit;
    }

    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const existing = String(fs.readFileSync(this.secretFile, 'utf8')).trim();
      if (existing) return existing;
    } catch {}

    const generated = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(this.secretFile, `${generated}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const stored = String(fs.readFileSync(this.secretFile, 'utf8')).trim();
    if (!stored) throw new Error('Unable to initialize protected RCON config secret.');
    return stored;
  }

  encryptionKey() {
    return crypto.createHash('sha256').update(this.secret()).digest();
  }

  encrypt(value) {
    const text = String(value || '');
    if (!text) throw new Error('RCON password cannot be empty.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    };
  }

  decrypt(payload) {
    if (!payload || payload.v !== 1 || payload.alg !== 'aes-256-gcm') return '';
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return '';
    }
  }

  get(prefix) {
    const key = normalizePrefix(prefix);
    const record = this.read().servers[key] || null;
    if (!record) return null;
    return {
      prefix: key,
      host: String(record.host || ''),
      port: Number(record.port || 0),
      enabled: typeof record.enabled === 'boolean' ? record.enabled : null,
      timeoutMs: normalizeTimeout(record.timeoutMs, 8000),
      password: this.decrypt(record.password),
      passwordConfigured: Boolean(record.password),
      updatedAt: String(record.updatedAt || ''),
      updatedBy: String(record.updatedBy || '')
    };
  }

  setEndpoint(prefix, { host, port, enabled = true, timeoutMs = 8000, actorId = '' } = {}) {
    const key = normalizePrefix(prefix);
    const state = this.read();
    const previous = state.servers[key] || {};
    state.servers[key] = {
      ...previous,
      host: normalizeHost(host),
      port: normalizePort(port),
      enabled: enabled !== false,
      timeoutMs: normalizeTimeout(timeoutMs, 8000),
      updatedAt: new Date().toISOString(),
      updatedBy: String(actorId || '').slice(0, 32)
    };
    this.write(state);
    return this.get(key);
  }

  setPassword(prefix, password, actorId = '') {
    const key = normalizePrefix(prefix);
    const state = this.read();
    const previous = state.servers[key] || {};
    state.servers[key] = {
      ...previous,
      password: this.encrypt(password),
      updatedAt: new Date().toISOString(),
      updatedBy: String(actorId || '').slice(0, 32)
    };
    this.write(state);
    return this.status(key);
  }

  clear(prefix) {
    const key = normalizePrefix(prefix);
    const state = this.read();
    const existed = Boolean(state.servers[key]);
    delete state.servers[key];
    this.write(state);
    return existed;
  }

  status(prefix, env = process.env) {
    const key = normalizePrefix(prefix);
    const override = this.get(key);
    const envPassword = String(env[`${key}_RCON_PASSWORD`] || '');
    return {
      prefix: key,
      overrideConfigured: Boolean(override),
      hostSource: override?.host ? 'discord-override' : env[`${key}_HOST`] ? 'environment' : 'missing',
      portSource: override?.port ? 'discord-override' : env[`${key}_RCON_PORT`] ? 'environment' : 'missing',
      passwordSource: override?.password ? 'discord-protected' : envPassword ? 'environment' : 'missing',
      passwordConfigured: Boolean(override?.password || envPassword),
      updatedAt: override?.updatedAt || ''
    };
  }

  resolve(prefix, env = process.env) {
    const key = normalizePrefix(prefix);
    const override = this.get(key);
    const envEnabled = String(env[`${key}_ENABLED`] || 'false').toLowerCase() === 'true';
    return {
      id: key.toLowerCase(),
      prefix: key,
      name: String(env[`${key}_NAME`] || (key === 'ARK_MAP2' ? 'Astraeos' : key)),
      host: String(override?.host || env[`${key}_HOST`] || '').trim(),
      port: Number(override?.port || env[`${key}_RCON_PORT`] || 0),
      password: String(override?.password || env[`${key}_RCON_PASSWORD`] || ''),
      enabled: override && typeof override.enabled === 'boolean' ? override.enabled : envEnabled,
      timeoutMs: normalizeTimeout(override?.timeoutMs || env[`${key}_RCON_TIMEOUT_MS`] || 8000, 8000),
      source: override ? 'discord-override' : 'environment'
    };
  }
}

function resolveRconServer(prefix = 'ARK_GEN1', env = process.env) {
  return new ArkRconConfigStore().resolve(prefix, env);
}

module.exports = {
  VERSION,
  normalizePrefix,
  normalizeHost,
  normalizePort,
  normalizeTimeout,
  ArkRconConfigStore,
  resolveRconServer
};
