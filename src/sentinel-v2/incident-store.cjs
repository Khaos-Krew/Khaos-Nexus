'use strict';

class IncidentStore {
  constructor({ database, logger } = {}) {
    this.database = database;
    this.logger = logger;
    this.enabled = Boolean(database?.enabled);
  }

  async listOpen() {
    if (!this.enabled) return [];
    const { rows } = await this.database.query(`
      SELECT fingerprint, source, code, subject, message, severity, status,
             first_seen_at, last_seen_at, recovered_at, acknowledged_at,
             acknowledged_by, occurrences, metadata
      FROM sentinel_incidents
      WHERE status = 'open'
      ORDER BY last_seen_at DESC
    `);
    return rows.map(fromRow);
  }

  async observe(incident) {
    if (!this.enabled) return incident;
    const { rows } = await this.database.query(`
      INSERT INTO sentinel_incidents (
        fingerprint, source, code, subject, message, severity, status,
        first_seen_at, last_seen_at, occurrences, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,1,$9::jsonb)
      ON CONFLICT (fingerprint) DO UPDATE SET
        source = EXCLUDED.source,
        code = EXCLUDED.code,
        subject = EXCLUDED.subject,
        message = EXCLUDED.message,
        severity = EXCLUDED.severity,
        status = 'open',
        last_seen_at = EXCLUDED.last_seen_at,
        recovered_at = NULL,
        occurrences = sentinel_incidents.occurrences + 1,
        metadata = EXCLUDED.metadata
      RETURNING fingerprint, source, code, subject, message, severity, status,
                first_seen_at, last_seen_at, recovered_at, acknowledged_at,
                acknowledged_by, occurrences, metadata
    `, [
      incident.fingerprint,
      incident.source,
      incident.code,
      incident.subject || null,
      incident.message,
      incident.severity,
      incident.firstSeenAt,
      incident.lastSeenAt,
      JSON.stringify(incident.metadata || {}),
    ]);
    return fromRow(rows[0]);
  }

  async recover(fingerprint, recoveredAt = new Date().toISOString()) {
    if (!this.enabled) return null;
    const { rows } = await this.database.query(`
      UPDATE sentinel_incidents
      SET status = 'recovered', recovered_at = $2, last_seen_at = GREATEST(last_seen_at, $2::timestamptz)
      WHERE fingerprint = $1 AND status = 'open'
      RETURNING fingerprint, source, code, subject, message, severity, status,
                first_seen_at, last_seen_at, recovered_at, acknowledged_at,
                acknowledged_by, occurrences, metadata
    `, [fingerprint, recoveredAt]);
    return rows[0] ? fromRow(rows[0]) : null;
  }
}

function fromRow(row) {
  return {
    fingerprint: row.fingerprint,
    source: row.source,
    code: row.code,
    subject: row.subject || '',
    message: row.message,
    severity: row.severity,
    status: row.status,
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
    recoveredAt: row.recovered_at ? toIso(row.recovered_at) : undefined,
    acknowledgedAt: row.acknowledged_at ? toIso(row.acknowledged_at) : undefined,
    acknowledgedBy: row.acknowledged_by || undefined,
    occurrences: Number(row.occurrences || 0),
    metadata: row.metadata || {},
  };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

module.exports = { IncidentStore, fromRow };
