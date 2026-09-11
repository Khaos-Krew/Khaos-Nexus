'use strict';

const crypto = require('node:crypto');
const { normalizePrefix, normalizeHost, normalizePort, normalizeTimeout, ArkRconConfigStore } = require('./ark-rcon-config-store.cjs');

// Database mode never falls back to a stale file or environment password.
class ArkRconDatabase {
  constructor({ pool, secret, writesEnabled = false }) {
    if (!pool?.query) throw new Error('RCON database connection is required.');
    if (Buffer.byteLength(String(secret || '')) < 32) throw new Error('NEXUS_RCON_CONFIG_SECRET must contain at least 32 bytes.');
    this.pool = pool;
    this.key = crypto.createHash('sha256').update(secret).digest();
    this.writesEnabled = writesEnabled;
  }

  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS nexus_ark_rcon_servers (
      prefix TEXT PRIMARY KEY, host TEXT, port INTEGER CHECK (port BETWEEN 1 AND 65535),
      enabled BOOLEAN NOT NULL DEFAULT false, timeout_ms INTEGER NOT NULL DEFAULT 8000,
      password JSONB, revision BIGINT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL
    )`);
  }

  encrypt(prefix, password) {
    if (!password || Buffer.byteLength(password) > 1024) throw new Error('RCON password length is invalid.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(prefix));
    const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  decrypt(prefix, envelope) {
    try {
      if (envelope?.v !== 1) throw new Error();
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(prefix));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw new Error('RCON credential cannot be decrypted; verify the configured encryption key.'); }
  }

  assertWrite(actorId) {
    if (!this.writesEnabled) throw new Error('Database RCON configuration writes are disabled.');
    if (!String(actorId || '').trim()) throw new Error('RCON changes require an audit actor.');
  }

  async setEndpoint(prefix, { host, port, enabled = false, timeoutMs = 8000, actorId } = {}) {
    this.assertWrite(actorId);
    await this.pool.query(`INSERT INTO nexus_ark_rcon_servers(prefix,host,port,enabled,timeout_ms,updated_by)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(prefix) DO UPDATE SET
      host=EXCLUDED.host,port=EXCLUDED.port,enabled=EXCLUDED.enabled,timeout_ms=EXCLUDED.timeout_ms,
      updated_by=EXCLUDED.updated_by,updated_at=now(),revision=nexus_ark_rcon_servers.revision+1`,
    [normalizePrefix(prefix), normalizeHost(host), normalizePort(port), enabled === true, normalizeTimeout(timeoutMs), String(actorId)]);
    return this.status(prefix);
  }

  async setPassword(prefix, password, actorId) {
    this.assertWrite(actorId);
    const key = normalizePrefix(prefix);
    await this.pool.query(`INSERT INTO nexus_ark_rcon_servers(prefix,password,updated_by) VALUES($1,$2::jsonb,$3)
      ON CONFLICT(prefix) DO UPDATE SET password=EXCLUDED.password,updated_by=EXCLUDED.updated_by,
      updated_at=now(),revision=nexus_ark_rcon_servers.revision+1`, [key, JSON.stringify(this.encrypt(key, String(password || ''))), String(actorId)]);
    return this.status(key);
  }

  async clear(prefix, actorId) {
    this.assertWrite(actorId);
    // Retain a disabled tombstone; clearing must never resurrect environment access.
    const result = await this.pool.query(`UPDATE nexus_ark_rcon_servers SET enabled=false,password=NULL,
      updated_by=$2,updated_at=now(),revision=revision+1 WHERE prefix=$1 RETURNING prefix`, [normalizePrefix(prefix), String(actorId)]);
    return result.rows.length > 0;
  }

  async record(prefix) {
    const { rows } = await this.pool.query('SELECT * FROM nexus_ark_rcon_servers WHERE prefix=$1', [normalizePrefix(prefix)]);
    return rows[0] || null;
  }

  async status(prefix) {
    const key = normalizePrefix(prefix);
    const row = await this.record(key);
    return { prefix: key, name: key, host: row?.host || '', port: row?.port || 0, enabled: row?.enabled === true,
      timeoutMs: row?.timeout_ms || 8000, source: 'postgres', hostSource: row?.host ? 'postgres' : 'missing',
      portSource: row?.port ? 'postgres' : 'missing', passwordSource: row?.password ? 'postgres-encrypted' : 'missing',
      passwordConfigured: Boolean(row?.password), updatedAt: row?.updated_at || '', revision: Number(row?.revision || 0) };
  }

  async resolve(prefix) {
    const key = normalizePrefix(prefix);
    const row = await this.record(key);
    if (!row?.enabled) throw new Error(`${key} database RCON target is missing or disabled.`);
    if (!row.host || !row.port || !row.password) throw new Error(`${key} database RCON configuration is incomplete.`);
    return { prefix: key, id: key.toLowerCase(), name: key, host: row.host, port: row.port,
      password: this.decrypt(key, row.password), timeoutMs: row.timeout_ms, enabled: true, source: 'postgres' };
  }
}

let singleton;
function databaseMode(env = process.env) { return String(env.NEXUS_RCON_CONFIG_BACKEND || 'legacy').toLowerCase() === 'postgres'; }
function getRconConfigProvider(env = process.env) {
  if (!databaseMode(env)) return new ArkRconConfigStore();
  if (!singleton) {
    const connectionString = env.NEXUS_RCON_DATABASE_URL || env.NEXUS_ECONOMY_DATABASE_URL;
    if (!connectionString) throw new Error('NEXUS_RCON_DATABASE_URL is required for database RCON.');
    const { Pool } = require('pg');
    singleton = new ArkRconDatabase({ pool: new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, query_timeout: 10000 }),
      secret: env.NEXUS_RCON_CONFIG_SECRET, writesEnabled: String(env.NEXUS_RCON_CONFIG_WRITES_ENABLED) === 'true' });
  }
  return singleton;
}

module.exports = { ArkRconDatabase, databaseMode, getRconConfigProvider };
