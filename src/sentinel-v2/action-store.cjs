'use strict';

const { randomUUID } = require('node:crypto');

class ActionStore {
  constructor({ database, auditStore, logger } = {}) {
    this.database = database;
    this.auditStore = auditStore;
    this.logger = logger;
    this.enabled = Boolean(database?.enabled);
  }

  async request({ actionId, capability, source, actor, subject, destructive = false, idempotencyKey, correlationId, request = {} } = {}) {
    const normalizedCapability = String(capability || '').trim();
    const normalizedSource = String(source || '').trim();
    if (!normalizedCapability) throw new TypeError('action capability is required');
    if (!normalizedSource) throw new TypeError('action source is required');

    const record = {
      actionId: actionId || randomUUID(),
      capability: normalizedCapability,
      source: normalizedSource,
      actor: actor ? String(actor) : null,
      subject: subject ? String(subject) : null,
      destructive: Boolean(destructive),
      status: destructive ? 'approval-required' : 'requested',
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      correlationId: correlationId ? String(correlationId) : null,
      request: request && typeof request === 'object' ? request : {},
    };

    if (!this.enabled) {
      await this.#audit('sentinel.action.requested', record, { persisted: false });
      return { ...record, persisted: false };
    }

    const result = await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const { rows } = await client.query(`
          INSERT INTO sentinel_actions (
            action_id, capability, source, actor, subject, destructive, status,
            idempotency_key, correlation_id, request
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
          DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
          RETURNING action_id, capability, source, actor, subject, destructive, status,
                    requested_at, completed_at, idempotency_key, correlation_id, request, result
        `, [
          record.actionId,
          record.capability,
          record.source,
          record.actor,
          record.subject,
          record.destructive,
          record.status,
          record.idempotencyKey,
          record.correlationId,
          JSON.stringify(record.request),
        ]);

        const stored = fromActionRow(rows[0]);
        if (stored.destructive && stored.status === 'approval-required') {
          await client.query(`
            INSERT INTO sentinel_approvals (approval_id, action_id, status)
            SELECT $1, $2, 'pending'
            WHERE NOT EXISTS (
              SELECT 1 FROM sentinel_approvals WHERE action_id = $2 AND status = 'pending'
            )
          `, [randomUUID(), stored.actionId]);
        }

        await client.query(`
          INSERT INTO sentinel_audit_log (actor, action, subject, correlation_id, details)
          VALUES ($1,'sentinel.action.requested',$2,$3,$4::jsonb)
        `, [
          stored.actor || null,
          stored.subject || stored.actionId,
          stored.correlationId || null,
          JSON.stringify({
            actionId: stored.actionId,
            capability: stored.capability,
            destructive: stored.destructive,
            status: stored.status,
            source: stored.source,
          }),
        ]);

        await client.query('COMMIT');
        return stored;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return result;
  }

  async startAttempt(actionId, attempt = 1) {
    if (!this.enabled) return { actionId, attempt, status: 'running', persisted: false };
    const { rows } = await this.database.query(`
      INSERT INTO sentinel_action_attempts (action_id, attempt, status)
      VALUES ($1,$2,'running')
      ON CONFLICT (action_id, attempt) DO UPDATE SET status = 'running', started_at = now(), finished_at = NULL, error = NULL
      RETURNING attempt_id, action_id, attempt, started_at, finished_at, status, error
    `, [actionId, attempt]);
    await this.database.query(`UPDATE sentinel_actions SET status = 'running' WHERE action_id = $1`, [actionId]);
    return fromAttemptRow(rows[0]);
  }

  async complete(actionId, { status = 'succeeded', result = null, attempt = 1, error = null } = {}) {
    const normalizedStatus = String(status || '').trim();
    if (!normalizedStatus) throw new TypeError('action completion status is required');
    if (!this.enabled) return { actionId, status: normalizedStatus, result, error, persisted: false };

    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`
          UPDATE sentinel_action_attempts
          SET status = $3, finished_at = now(), error = $4::jsonb
          WHERE action_id = $1 AND attempt = $2
        `, [actionId, attempt, normalizedStatus, error ? JSON.stringify(serializeError(error)) : null]);

        const { rows } = await client.query(`
          UPDATE sentinel_actions
          SET status = $2, completed_at = now(), result = $3::jsonb
          WHERE action_id = $1
          RETURNING action_id, capability, source, actor, subject, destructive, status,
                    requested_at, completed_at, idempotency_key, correlation_id, request, result
        `, [actionId, normalizedStatus, result == null ? null : JSON.stringify(result)]);
        if (!rows[0]) throw new Error(`Sentinel action not found: ${actionId}`);

        const stored = fromActionRow(rows[0]);
        await client.query(`
          INSERT INTO sentinel_audit_log (actor, action, subject, correlation_id, details)
          VALUES ($1,'sentinel.action.completed',$2,$3,$4::jsonb)
        `, [
          stored.actor || null,
          stored.subject || stored.actionId,
          stored.correlationId || null,
          JSON.stringify({ actionId: stored.actionId, capability: stored.capability, status: stored.status, error: error ? serializeError(error) : undefined }),
        ]);
        await client.query('COMMIT');
        return stored;
      } catch (error_) {
        await client.query('ROLLBACK');
        throw error_;
      }
    });
  }

  async decideApproval(actionId, { approved, actor, reason } = {}) {
    if (!this.enabled) return { actionId, approved: Boolean(approved), persisted: false };
    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const approvalStatus = approved ? 'approved' : 'denied';
        const { rows } = await client.query(`
          UPDATE sentinel_approvals
          SET status = $2, decided_at = now(), decided_by = $3, decision_reason = $4
          WHERE approval_id = (
            SELECT approval_id FROM sentinel_approvals
            WHERE action_id = $1 AND status = 'pending'
            ORDER BY requested_at DESC LIMIT 1
          )
          RETURNING approval_id, action_id, status, requested_at, decided_at, decided_by, decision_reason
        `, [actionId, approvalStatus, actor ? String(actor) : null, reason ? String(reason) : null]);
        if (!rows[0]) throw new Error(`Pending Sentinel approval not found: ${actionId}`);

        const actionStatus = approved ? 'requested' : 'denied';
        await client.query(`
          UPDATE sentinel_actions
          SET status = $2, completed_at = CASE WHEN $2 = 'denied' THEN now() ELSE completed_at END
          WHERE action_id = $1
        `, [actionId, actionStatus]);

        await client.query(`
          INSERT INTO sentinel_audit_log (actor, action, subject, details)
          VALUES ($1,'sentinel.action.approval_decided',$2,$3::jsonb)
        `, [actor ? String(actor) : null, actionId, JSON.stringify({ actionId, approved: Boolean(approved), reason: reason || null })]);

        await client.query('COMMIT');
        return fromApprovalRow(rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async #audit(action, record, details) {
    if (!this.auditStore) return;
    await this.auditStore.append({
      actor: record.actor,
      action,
      subject: record.subject || record.actionId,
      correlationId: record.correlationId,
      details: { actionId: record.actionId, capability: record.capability, source: record.source, ...details },
    });
  }
}

function fromActionRow(row) {
  return {
    actionId: String(row.action_id),
    capability: row.capability,
    source: row.source,
    actor: row.actor || undefined,
    subject: row.subject || undefined,
    destructive: Boolean(row.destructive),
    status: row.status,
    requestedAt: toIso(row.requested_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : undefined,
    idempotencyKey: row.idempotency_key || undefined,
    correlationId: row.correlation_id || undefined,
    request: row.request || {},
    result: row.result ?? undefined,
    persisted: true,
  };
}

function fromAttemptRow(row) {
  return {
    attemptId: Number(row.attempt_id),
    actionId: String(row.action_id),
    attempt: Number(row.attempt),
    startedAt: toIso(row.started_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : undefined,
    status: row.status,
    error: row.error || undefined,
    persisted: true,
  };
}

function fromApprovalRow(row) {
  return {
    approvalId: String(row.approval_id),
    actionId: String(row.action_id),
    status: row.status,
    requestedAt: toIso(row.requested_at),
    decidedAt: row.decided_at ? toIso(row.decided_at) : undefined,
    decidedBy: row.decided_by || undefined,
    decisionReason: row.decision_reason || undefined,
    persisted: true,
  };
}

function serializeError(error) {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  return {
    name: error.name || 'Error',
    message: String(error.message || error),
    code: error.code == null ? undefined : String(error.code),
  };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

module.exports = { ActionStore, fromActionRow, fromAttemptRow, fromApprovalRow, serializeError };
