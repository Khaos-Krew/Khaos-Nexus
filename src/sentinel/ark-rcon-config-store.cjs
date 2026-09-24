'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;

function resolveStoreRoot(root, env = process.env) {
  if (root) return path.resolve(String(root));
  const data = String(env.NEXUS_DATA_DIR || '').trim();
  if (data) return path.resolve(data);
  const volume = String(env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  if (volume) return path.resolve(volume);
  return path.resolve(__dirname, '../..', 'data');
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dirFd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {}
}

function writeExclusive(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

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
  constructor(root) {
    this.dir = resolveStoreRoot(root);
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
    const safe = {
      version: VERSION,
      servers: state.servers || {},
      updatedAt: new Date().toISOString()
    };
    atomicWrite(this.file, `${JSON.stringify(safe, null, 2)}\n`);
    return safe;
  }

  hasCiphertext() {
    return Object.values(this.read().servers || {}).some((record) => record && record.password);
  }

  secret() {
    const explicit = String(process.env.NEXUS_RCON_CONFIG_SECRET || '').trim();
    if (explicit) {
      if (Buffer.byteLength(explicit) < 32) throw new Error('NEXUS_RCON_CONFIG_SECRET must contain at least 32 characters.');
      return explicit;
    }

    try {
      const existing = String(fs.readFileSync(this.secretFile, 'utf8')).trim();
      if (existing) return existing;
    } catch {}

    if (this.hasCiphertext()) {
      const error = new Error('RCON vault key is missing. Refusing to mint a new key over saved ciphertext.');
      error.code = 'RCON_VAULT_KEY_MISSING';
      throw error;
    }

    const generated = crypto.randomBytes(32).toString('hex');
    try {
      writeExclusive(this.secretFile, `${generated}\n`);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    try {
      const stored = String(fs.readFileSync(this.secretFile, 'utf8')).trim();
      if (stored) return stored;
    } catch {}
    throw new Error('Unable to initialize protected RCON config secret.');
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
    let password = '';
    let passwordUnreadable = false;
    if (record.password) {
      try {
        password = this.decrypt(record.password);
        passwordUnreadable = !password;
      } catch (error) {
        if (error?.code !== 'RCON_VAULT_KEY_MISSING') throw error;
        passwordUnreadable = true;
      }
    }
    return {
      prefix: key,
      host: String(record.host || ''),
      port: Number(record.port || 0),
      enabled: typeof record.enabled === 'boolean' ? record.enabled : null,
      timeoutMs: normalizeTimeout(record.timeoutMs, 8000),
      password,
      passwordConfigured: Boolean(password),
      passwordUnreadable,
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
    const forbidEnv = rconRailwayEnvForbidden(env);
    const envPassword = forbidEnv ? '' : String(env[`${key}_RCON_PASSWORD`] || '');
    return {
      prefix: key,
      overrideConfigured: Boolean(override),
      hostSource: override?.host ? 'discord-override' : (!forbidEnv && env[`${key}_HOST`]) ? 'environment' : 'missing',
      portSource: override?.port ? 'discord-override' : (!forbidEnv && env[`${key}_RCON_PORT`]) ? 'environment' : 'missing',
      passwordSource: override?.password ? 'discord-protected' : override?.passwordUnreadable ? 'unreadable' : envPassword ? 'environment' : 'missing',
      passwordConfigured: Boolean(override?.password || envPassword),
      passwordUnreadable: Boolean(override?.passwordUnreadable),
      updatedAt: override?.updatedAt || '',
      railwayEnvForbidden: forbidEnv
    };
  }

  resolve(prefix, env = process.env) {
    const key = normalizePrefix(prefix);
    const override = this.get(key);
    const forbidEnv = rconRailwayEnvForbidden(env);
    const envEnabled = String(env[`${key}_ENABLED`] || 'false').toLowerCase() === 'true';
    const host = String(override?.host || (forbidEnv ? '' : env[`${key}_HOST`] || '')).trim();
    const port = Number(override?.port || (forbidEnv ? 0 : env[`${key}_RCON_PORT`] || 0));
    const password = String(override?.password || (forbidEnv ? '' : env[`${key}_RCON_PASSWORD`] || ''));
    return {
      id: key.toLowerCase(),
      prefix: key,
      name: String(env[`${key}_NAME`] || (key === 'ARK_MAP2' ? 'Astraeos' : key)),
      host,
      port,
      password,
      enabled: override && typeof override.enabled === 'boolean' ? override.enabled : (forbidEnv ? false : envEnabled),
      timeoutMs: normalizeTimeout(override?.timeoutMs || (forbidEnv ? 8000 : env[`${key}_RCON_TIMEOUT_MS`] || 8000), 8000),
      source: override ? 'discord-override' : (forbidEnv ? 'discord-override-required' : 'environment')
    };
  }
}

function rconRailwayEnvForbidden(env = process.env) {
  const flag = String(env.NEXUS_RCON_RAILWAY_ENV_FORBIDDEN || '').trim().toLowerCase();
  const source = String(env.NEXUS_RCON_SOURCE || '').trim().toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes' || source === 'discord_override_store';
}

function resolveRconServer(prefix = 'ARK_GEN1', env = process.env) {
  return new ArkRconConfigStore(resolveStoreRoot(undefined, env)).resolve(prefix, env);
}

function describeRconVault(env = process.env, root) {
  const store = new ArkRconConfigStore(resolveStoreRoot(root, env));
  const servers = store.read().servers || {};
  let sealed = 0;
  let readablePasswords = 0;
  let unreadable = 0;
  for (const record of Object.values(servers)) {
    if (!record?.password) continue;
    sealed += 1;
    try {
      if (store.decrypt(record.password)) readablePasswords += 1;
      else unreadable += 1;
    } catch (error) {
      if (error?.code !== 'RCON_VAULT_KEY_MISSING') throw error;
      unreadable += 1;
    }
  }
  return { servers: Object.keys(servers).length, sealed, readablePasswords, unreadable };
}

module.exports = {
  VERSION,
  resolveStoreRoot,
  normalizePrefix,
  normalizeHost,
  normalizePort,
  normalizeTimeout,
  ArkRconConfigStore,
  rconRailwayEnvForbidden,
  resolveRconServer,
  describeRconVault
};
