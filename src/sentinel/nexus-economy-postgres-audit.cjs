'use strict';

const { sqlIdent } = require('./nexus-economy-postgres-repository.cjs');

const DEFAULT_SCHEMA = 'public';
const MAX_TEXT = 160;
const MAX_REASON = 500;
const MAX_METADATA_BYTES = 16 * 1024;

function boundedText(value, { required = false, max = MAX_TEXT, field = 'value' } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > max) throw new Error(`${field} exceeds ${max} characters.`);
  return text;
}

function nullableInteger(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${field} must be a safe integer.`);
  return number;
}

function serializeMetadata(value) {
  const metadata = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  let json;
  try {
    json = JSON.stringify(metadata);
  } catch {
    throw new Error('Audit metadata must be JSON serializable.');
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) {
    throw new Error(`Audit metadata exceeds ${MAX_METADATA_BYTES} bytes.`);
  }
  return json;
}

function normalizeEvent(event = {}) {
  const at = event.at instanceof Date ? event.at : new Date(event.at || Date.now());
  if (Number.isNaN(at.getTime())) throw new Error('Audit timestamp is invalid.');
  return {
    eventType: boundedText(event.type, { required: true, field: 'Audit event type' }),
    operation: boundedText(event.operation, { required: true, field: 'Audit operation' }),
    actor: boundedText(event.actor, { required: true, field: 'Audit actor' }),
    target: boundedText(event.target, { max: 200, field: 'Audit target' }),
    idempotencyKey: boundedText(event.idempotencyKey, { max: 240, field: 'Audit idempotency key' }),
    authority: boundedText(event.authority, { max: 80, field: 'Audit authority' }),
    walletAuthority: boundedText(event.walletAuthority, { max: 80, field: 'Audit wallet authority' }),
    ok: typeof event.ok === 'boolean' ? event.ok : null,
    duplicate: typeof event.duplicate === 'boolean' ? event.duplicate : null,
    reason: boundedText(event.reason, { max: MAX_REASON, field: 'Audit reason' }),
    transactionId: boundedText(event.transactionId, { max: 200, field: 'Audit transaction id' }),
    balance: nullableInteger(event.balance, 'Audit balance'),
    metadataJson: serializeMetadata(event.metadata),
    at: at.toISOString()
  };
}

class NexusEconomyPostgresAudit {
  constructor({ pool, schema = DEFAULT_SCHEMA } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('Postgres pool with query() is required.');
    this.pool = pool;
    this.schema = sqlIdent(schema);
  }

  async record(event) {
    const row = normalizeEvent(event);
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.nexus_economy_audit\n` +
      `(event_type, operation, actor, target, idempotency_key, authority, wallet_authority, ok, duplicate, reason, transaction_id, balance, metadata, created_at)\n` +
      `VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)\n` +
      `RETURNING id, created_at`,
      [
        row.eventType,
        row.operation,
        row.actor,
        row.target || null,
        row.idempotencyKey || null,
        row.authority || null,
        row.walletAuthority || null,
        row.ok,
        row.duplicate,
        row.reason || null,
        row.transactionId || null,
        row.balance,
        row.metadataJson,
        row.at
      ]
    );
    const inserted = result.rows?.[0] || {};
    return {
      id: inserted.id || null,
      at: inserted.created_at instanceof Date ? inserted.created_at.toISOString() : (inserted.created_at || row.at)
    };
  }

  static schemaSql({ schema = DEFAULT_SCHEMA } = {}) {
    const s = sqlIdent(schema);
    return [
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_audit (`,
      '  id BIGSERIAL PRIMARY KEY,',
      '  event_type TEXT NOT NULL,',
      '  operation TEXT NOT NULL,',
      '  actor TEXT NOT NULL,',
      '  target TEXT,',
      '  idempotency_key TEXT,',
      '  authority TEXT,',
      '  wallet_authority TEXT,',
      '  ok BOOLEAN,',
      '  duplicate BOOLEAN,',
      '  reason TEXT,',
      '  transaction_id TEXT,',
      '  balance BIGINT,',
      "  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,",
      '  created_at TIMESTAMPTZ NOT NULL',
      ');',
      `CREATE INDEX IF NOT EXISTS nexus_economy_audit_target_created_idx ON ${s}.nexus_economy_audit (target, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS nexus_economy_audit_idempotency_idx ON ${s}.nexus_economy_audit (idempotency_key, created_at DESC);`
    ].join('\n');
  }
}

module.exports = {
  NexusEconomyPostgresAudit,
  normalizeEvent,
  MAX_METADATA_BYTES
};
