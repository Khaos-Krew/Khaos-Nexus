'use strict';

class JobStore {
  constructor({ database, logger } = {}) {
    this.database = database;
    this.logger = logger;
  }

  get enabled() {
    return Boolean(this.database?.enabled);
  }

  async ensureJob(job) {
    if (!this.enabled) return { persisted: false, reason: 'database-disabled' };
    await this.database.query(
      `INSERT INTO sentinel_jobs (name, owner, enabled, trigger, timeout_ms, concurrency, retry, updated_at)
       VALUES ($1, $2, true, $3::jsonb, $4, $5, $6::jsonb, now())
       ON CONFLICT (name) DO UPDATE SET
         owner = EXCLUDED.owner,
         trigger = EXCLUDED.trigger,
         timeout_ms = EXCLUDED.timeout_ms,
         concurrency = EXCLUDED.concurrency,
         retry = EXCLUDED.retry,
         updated_at = now()`,
      [job.name, job.owner, JSON.stringify(job.trigger || {}), job.timeoutMs, job.concurrency, JSON.stringify(job.retry || {})],
    );
    return { persisted: true };
  }

  async runWithLock({ job, runId, correlationId, execute }) {
    if (typeof execute !== 'function') throw new TypeError('runWithLock requires execute()');
    if (!this.enabled || job.concurrency !== 1) {
      await this.startRun({ job, runId, correlationId });
      return execute();
    }

    return this.database.withClient(async (client) => {
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [`sentinel-job:${job.name}`]);
      const acquired = Boolean(lock.rows?.[0]?.acquired);
      if (!acquired) return { __sentinelLockSkipped: true, reason: 'distributed-lock-held' };

      try {
        await this.startRun({ job, runId, correlationId, client });
        return await execute();
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`sentinel-job:${job.name}`]);
        } catch (error) {
          this.logger?.warn?.('sentinel.job.lock_release_failed', { job: job.name, runId, error });
        }
      }
    });
  }

  async startRun({ job, runId, correlationId, client, attempt = 1 } = {}) {
    if (!this.enabled) return;
    const db = client || this.database;
    await db.query(
      `INSERT INTO sentinel_job_runs (run_id, job_name, status, started_at, attempt, correlation_id)
       VALUES ($1::uuid, $2, 'running', now(), $4, $3)`,
      [runId, job.name, correlationId || null, attempt],
    );
  }

  async updateRunAttempt({ runId, attempt } = {}) {
    if (!this.enabled) return;
    await this.database.query(
      `UPDATE sentinel_job_runs
       SET attempt = $2
       WHERE run_id = $1::uuid`,
      [runId, attempt],
    );
  }

  async finishRun({ runId, status, durationMs, result, error } = {}) {
    if (!this.enabled) return;
    await this.database.query(
      `UPDATE sentinel_job_runs
       SET status = $2,
           finished_at = now(),
           duration_ms = $3,
           result = $4::jsonb,
           error = $5::jsonb
       WHERE run_id = $1::uuid`,
      [runId, status, durationMs ?? null, jsonOrNull(result), jsonOrNull(serializeError(error))],
    );
  }
}

function jsonOrNull(value) {
  return value == null ? null : JSON.stringify(value);
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: String(error.name || 'Error'),
    message: String(error.message || error),
    code: error.code == null ? undefined : String(error.code),
  };
}

module.exports = { JobStore, serializeError };
