'use strict';

class AuditStore {
  constructor({ database, logger } = {}) {
    this.database = database;
    this.logger = logger;
    this.enabled = Boolean(database?.enabled);
  }

  async append({ actor, action, subject, correlationId, details } = {}) {
    const auditAction = String(action || '').trim();
    if (!auditAction) throw new TypeError('audit action is required');

    const entry = {
      actor: actor ? String(actor) : null,
      action: auditAction,
      subject: subject ? String(subject) : null,
      correlationId: correlationId ? String(correlationId) : null,
      details: details && typeof details === 'object' ? details : {},
    };

    if (!this.enabled) return { ...entry, persisted: false };

    const { rows } = await this.database.query(`
      INSERT INTO sentinel_audit_log (actor, action, subject, correlation_id, details)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      RETURNING audit_id, occurred_at, actor, action, subject, correlation_id, details
    `, [
      entry.actor,
      entry.action,
      entry.subject,
      entry.correlationId,
      JSON.stringify(entry.details),
    ]);

    return fromAuditRow(rows[0]);
  }
}

function fromAuditRow(row) {
  return {
    auditId: Number(row.audit_id),
    occurredAt: toIso(row.occurred_at),
    actor: row.actor || undefined,
    action: row.action,
    subject: row.subject || undefined,
    correlationId: row.correlation_id || undefined,
    details: row.details || {},
    persisted: true,
  };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

module.exports = { AuditStore, fromAuditRow };
