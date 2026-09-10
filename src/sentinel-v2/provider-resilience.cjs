'use strict';

function serializeProviderError(error) {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  return {
    name: error.name || 'Error',
    message: String(error.message || error),
    code: error.code == null ? undefined : String(error.code),
  };
}

class DeadLetterStore {
  constructor({ database, logger } = {}) {
    this.database = database;
    this.logger = logger;
    this.enabled = Boolean(database?.enabled);
  }

  async quarantine({ provider, operation, subject, attempts = 1, correlationId, payload = {}, error } = {}) {
    const normalizedProvider = String(provider || '').trim();
    const normalizedOperation = String(operation || '').trim();
    if (!normalizedProvider) throw new TypeError('dead-letter provider is required');
    if (!normalizedOperation) throw new TypeError('dead-letter operation is required');
    const record = {
      provider: normalizedProvider,
      operation: normalizedOperation,
      subject: subject == null ? null : String(subject),
      attempts: Math.max(1, Number(attempts) || 1),
      correlationId: correlationId == null ? null : String(correlationId),
      payload: payload && typeof payload === 'object' ? payload : {},
      error: serializeProviderError(error),
      status: 'quarantined',
    };
    if (!this.enabled) return { ...record, persisted: false };

    const { rows } = await this.database.query(`
      INSERT INTO sentinel_dead_letters (
        provider, operation, subject, status, attempts, correlation_id, payload, error
      ) VALUES ($1,$2,$3,'quarantined',$4,$5,$6::jsonb,$7::jsonb)
      RETURNING dead_letter_id, provider, operation, subject, status, attempts,
                correlation_id, payload, error, first_failed_at, last_failed_at,
                resolved_at, resolved_by, resolution_note
    `, [
      record.provider,
      record.operation,
      record.subject,
      record.attempts,
      record.correlationId,
      JSON.stringify(record.payload),
      record.error ? JSON.stringify(record.error) : null,
    ]);
    return fromDeadLetterRow(rows[0]);
  }

  async list({ provider, status = 'quarantined', limit = 100 } = {}) {
    if (!this.enabled) return [];
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const { rows } = await this.database.query(`
      SELECT dead_letter_id, provider, operation, subject, status, attempts,
             correlation_id, payload, error, first_failed_at, last_failed_at,
             resolved_at, resolved_by, resolution_note
      FROM sentinel_dead_letters
      WHERE ($1::text IS NULL OR provider = $1)
        AND ($2::text IS NULL OR status = $2)
      ORDER BY last_failed_at DESC
      LIMIT $3
    `, [provider ? String(provider) : null, status == null ? null : String(status), safeLimit]);
    return rows.map(fromDeadLetterRow);
  }

  async get(deadLetterId) {
    if (!this.enabled) return null;
    const id = normalizeDeadLetterId(deadLetterId);
    const { rows } = await this.database.query(`
      SELECT dead_letter_id, provider, operation, subject, status, attempts,
             correlation_id, payload, error, first_failed_at, last_failed_at,
             resolved_at, resolved_by, resolution_note
      FROM sentinel_dead_letters
      WHERE dead_letter_id = $1
      LIMIT 1
    `, [id]);
    return rows[0] ? fromDeadLetterRow(rows[0]) : null;
  }

  async acknowledge(deadLetterId, { actor, reason } = {}) {
    if (!this.enabled) {
      const error = Object.assign(new Error('dead-letter persistence is unavailable'), { code: 'SENTINEL_DEAD_LETTER_STORE_UNAVAILABLE' });
      throw error;
    }
    const id = normalizeDeadLetterId(deadLetterId);
    const normalizedActor = String(actor || '').trim();
    const normalizedReason = String(reason || '').trim();
    if (!normalizedActor) throw new TypeError('dead-letter acknowledgement actor is required');
    if (!normalizedReason) throw new TypeError('dead-letter acknowledgement reason is required');

    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const { rows } = await client.query(`
          UPDATE sentinel_dead_letters
          SET status = 'acknowledged', resolved_at = now(), resolved_by = $2, resolution_note = $3
          WHERE dead_letter_id = $1 AND status = 'quarantined'
          RETURNING dead_letter_id, provider, operation, subject, status, attempts,
                    correlation_id, payload, error, first_failed_at, last_failed_at,
                    resolved_at, resolved_by, resolution_note
        `, [id, normalizedActor, normalizedReason]);
        if (!rows[0]) {
          const existing = await client.query('SELECT status FROM sentinel_dead_letters WHERE dead_letter_id = $1', [id]);
          const error = existing.rows[0]
            ? Object.assign(new Error(`Dead letter ${id} is not quarantined`), { code: 'SENTINEL_DEAD_LETTER_NOT_QUARANTINED' })
            : Object.assign(new Error(`Dead letter ${id} not found`), { code: 'SENTINEL_DEAD_LETTER_NOT_FOUND' });
          throw error;
        }
        const stored = fromDeadLetterRow(rows[0]);
        await client.query(`
          INSERT INTO sentinel_audit_log (actor, action, subject, correlation_id, details)
          VALUES ($1,'sentinel.dead_letter.acknowledged',$2,$3,$4::jsonb)
        `, [
          normalizedActor,
          `dead-letter:${id}`,
          stored.correlationId || null,
          JSON.stringify({ deadLetterId: id, provider: stored.provider, operation: stored.operation, reason: normalizedReason }),
        ]);
        await client.query('COMMIT');
        return stored;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
}

class ProviderCircuitBreaker {
  constructor({ failureThreshold = 3, cooldownMs = 60000, clock = () => Date.now(), logger } = {}) {
    this.failureThreshold = Math.max(1, Number(failureThreshold) || 3);
    this.cooldownMs = Math.max(0, Number(cooldownMs) || 0);
    this.clock = clock;
    this.logger = logger;
    this.providers = new Map();
  }

  state(provider) {
    const key = normalizeProvider(provider);
    const current = this.providers.get(key) || initialState();
    return Object.freeze({ provider: key, ...current });
  }

  beforeCall(provider) {
    const key = normalizeProvider(provider);
    const current = this.providers.get(key) || initialState();
    const now = this.clock();
    if (current.status === 'open') {
      if (now - current.openedAt < this.cooldownMs) {
        return { allowed: false, reason: 'circuit-open', state: Object.freeze({ provider: key, ...current }) };
      }
      if (current.probeInFlight) {
        return { allowed: false, reason: 'half-open-probe-in-flight', state: Object.freeze({ provider: key, ...current }) };
      }
      const halfOpen = { ...current, status: 'half-open', probeInFlight: true };
      this.providers.set(key, halfOpen);
      return { allowed: true, reason: 'half-open-probe', state: Object.freeze({ provider: key, ...halfOpen }) };
    }
    if (current.status === 'half-open' && current.probeInFlight) {
      return { allowed: false, reason: 'half-open-probe-in-flight', state: Object.freeze({ provider: key, ...current }) };
    }
    return { allowed: true, reason: 'closed', state: Object.freeze({ provider: key, ...current }) };
  }

  success(provider) {
    const key = normalizeProvider(provider);
    const next = initialState();
    this.providers.set(key, next);
    this.logger?.info?.('sentinel.provider.circuit_closed', { provider: key });
    return Object.freeze({ provider: key, ...next });
  }

  failure(provider, error) {
    const key = normalizeProvider(provider);
    const previous = this.providers.get(key) || initialState();
    const failures = previous.failures + 1;
    const shouldOpen = previous.status === 'half-open' || failures >= this.failureThreshold;
    const next = {
      status: shouldOpen ? 'open' : 'closed',
      failures,
      openedAt: shouldOpen ? this.clock() : 0,
      probeInFlight: false,
      lastError: serializeProviderError(error),
    };
    this.providers.set(key, next);
    if (shouldOpen) this.logger?.warn?.('sentinel.provider.circuit_opened', { provider: key, failures, error: next.lastError });
    return Object.freeze({ provider: key, ...next });
  }
}

class ProviderResilience {
  constructor({ breaker, deadLetters, logger } = {}) {
    this.breaker = breaker || new ProviderCircuitBreaker({ logger });
    this.deadLetters = deadLetters;
    this.logger = logger;
  }

  async execute({ provider, operation, subject, correlationId, payload, run } = {}) {
    if (typeof run !== 'function') throw new TypeError('provider operation run function is required');
    const gate = this.breaker.beforeCall(provider);
    if (!gate.allowed) {
      const error = Object.assign(new Error(`Provider circuit blocked ${provider}: ${gate.reason}`), { code: 'SENTINEL_PROVIDER_CIRCUIT_OPEN' });
      return { ok: false, blocked: true, reason: gate.reason, error, circuit: gate.state };
    }

    try {
      const result = await run();
      const circuit = this.breaker.success(provider);
      return { ok: true, blocked: false, result, circuit };
    } catch (error) {
      const circuit = this.breaker.failure(provider, error);
      let deadLetter = null;
      if (circuit.status === 'open' && this.deadLetters?.quarantine) {
        deadLetter = await this.deadLetters.quarantine({
          provider,
          operation,
          subject,
          attempts: circuit.failures,
          correlationId,
          payload,
          error,
        });
      }
      return { ok: false, blocked: false, error, circuit, deadLetter };
    }
  }
}

function initialState() {
  return { status: 'closed', failures: 0, openedAt: 0, probeInFlight: false, lastError: null };
}

function normalizeProvider(provider) {
  const key = String(provider || '').trim();
  if (!key) throw new TypeError('provider is required');
  return key;
}

function normalizeDeadLetterId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError('dead-letter id must be a positive integer');
  return id;
}

function fromDeadLetterRow(row) {
  return {
    deadLetterId: Number(row.dead_letter_id),
    provider: row.provider,
    operation: row.operation,
    subject: row.subject || undefined,
    status: row.status,
    attempts: Number(row.attempts || 0),
    correlationId: row.correlation_id || undefined,
    payload: row.payload || {},
    error: row.error || undefined,
    firstFailedAt: toIso(row.first_failed_at),
    lastFailedAt: toIso(row.last_failed_at),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : undefined,
    resolvedBy: row.resolved_by || undefined,
    resolutionNote: row.resolution_note || undefined,
    persisted: true,
  };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

module.exports = {
  DeadLetterStore,
  ProviderCircuitBreaker,
  ProviderResilience,
  serializeProviderError,
  fromDeadLetterRow,
  normalizeDeadLetterId,
};
