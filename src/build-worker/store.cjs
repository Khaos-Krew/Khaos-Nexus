'use strict';

const { Pool } = require('pg');
const { SCHEMA_SQL } = require('./schema.cjs');

class WorkerStore {
  constructor(config, options = {}) {
    this.config = config;
    this.pool = options.pool || new Pool({ connectionString: config.databaseUrl, max: 5, ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } });
  }

  async initialize() {
    await this.pool.query(SCHEMA_SQL);
    await this.pool.query(
      `INSERT INTO nexus_worker_nodes (node_id, lane, capabilities, status, metadata)
       VALUES ($1, $2, $3, 'idle', $4)
       ON CONFLICT (node_id) DO UPDATE SET lane = EXCLUDED.lane, capabilities = EXCLUDED.capabilities,
         status = 'idle', active_job_id = NULL, started_at = now(), heartbeat_at = now(), metadata = EXCLUDED.metadata`,
      [this.config.nodeId, this.config.lane, this.config.capabilities, { version: process.env.RAILWAY_GIT_COMMIT_SHA || 'local' }]
    );
  }

  async ping() { await this.pool.query('SELECT 1'); }

  async heartbeat(jobId = null, status = 'idle') {
    await this.pool.query(
      `UPDATE nexus_worker_nodes SET heartbeat_at = now(), status = $2, active_job_id = $3 WHERE node_id = $1`,
      [this.config.nodeId, status, jobId]
    );
    if (jobId) {
      const result = await this.pool.query(
        `UPDATE nexus_build_jobs SET heartbeat_at = now(), lease_expires_at = now() + ($3 * interval '1 second'), updated_at = now()
         WHERE job_id = $1 AND leased_by = $2 AND status IN ('leased', 'running') RETURNING job_id`,
        [jobId, this.config.nodeId, this.config.leaseSeconds]
      );
      return result.rowCount === 1;
    }
    return true;
  }

  async leaseNextJob() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE nexus_build_jobs SET status = 'queued', leased_by = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE status IN ('leased', 'running') AND lease_expires_at < now()`
      );
      const result = await client.query(
        `SELECT * FROM nexus_build_jobs
         WHERE status = 'queued'
           AND stage = ANY($1::text[])
           AND (lane = $2 OR (lane = 'general' AND $2 <> 'general'))
         ORDER BY CASE WHEN lane = $2 THEN 0 ELSE 1 END, priority ASC, created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT 1`,
        [this.config.capabilities, this.config.lane]
      );
      if (!result.rowCount) { await client.query('COMMIT'); return null; }
      const job = result.rows[0];
      const leased = await client.query(
        `UPDATE nexus_build_jobs SET status = 'leased', leased_by = $2, lease_expires_at = now() + ($3 * interval '1 second'),
           heartbeat_at = now(), attempts = attempts + 1, updated_at = now()
         WHERE job_id = $1 RETURNING *`,
        [job.job_id, this.config.nodeId, this.config.leaseSeconds]
      );
      await client.query('COMMIT');
      return leased.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async markRunning(jobId) {
    await this.pool.query(
      `UPDATE nexus_build_jobs SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE job_id = $1 AND leased_by = $2`, [jobId, this.config.nodeId]
    );
  }

  async finishJob(job, status, result) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE nexus_build_jobs SET status = $3, result = $4, finished_at = now(), lease_expires_at = NULL, updated_at = now()
         WHERE job_id = $1 AND leased_by = $2`, [job.job_id, this.config.nodeId, status, result]
      );
      if (job.release_id && ['build', 'test', 'validation'].includes(job.stage)) {
        const column = `${job.stage}_status`;
        await client.query(`UPDATE nexus_releases SET ${column} = $2, updated_at = now() WHERE release_id = $1`, [job.release_id, status]);
      }
      await client.query(`UPDATE nexus_worker_nodes SET status = 'idle', active_job_id = NULL, heartbeat_at = now() WHERE node_id = $1`, [this.config.nodeId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async releaseForDeployment(releaseId) {
    const result = await this.pool.query('SELECT * FROM nexus_releases WHERE release_id = $1', [releaseId]);
    return result.rows[0] || null;
  }

  async acquireProductionLock(releaseId) {
    const client = await this.pool.connect();
    const key = this.config.releaseLockName;
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [key]);
      if (!lock.rows[0].acquired) { client.release(); return null; }
      await client.query(
        `INSERT INTO nexus_production_locks (lock_name, release_id, node_id) VALUES ($1, $2, $3)
         ON CONFLICT (lock_name) DO UPDATE SET release_id = EXCLUDED.release_id, node_id = EXCLUDED.node_id,
           acquired_at = now(), heartbeat_at = now()`, [key, releaseId, this.config.nodeId]
      );
      return async () => {
        await client.query('DELETE FROM nexus_production_locks WHERE lock_name = $1 AND node_id = $2', [key, this.config.nodeId]).catch(() => {});
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
        client.release();
      };
    } catch (error) { client.release(); throw error; }
  }

  async setDeploymentStatus(releaseId, status, metadata = {}) {
    await this.pool.query(
      `UPDATE nexus_releases SET deployment_status = $2, deployed_by = $3,
       deployed_at = CASE WHEN $2 = 'healthy' THEN now() ELSE deployed_at END,
       metadata = metadata || $4::jsonb, updated_at = now() WHERE release_id = $1`,
      [releaseId, status, this.config.nodeId, JSON.stringify(metadata)]
    );
  }

  async createRelease(input) {
    const result = await this.pool.query(
      `INSERT INTO nexus_releases (release_id, target, artifact_type, commit_sha, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (release_id) DO NOTHING RETURNING *`,
      [input.releaseId, input.target, input.artifactType, input.commitSha, input.metadata || {}]
    );
    if (!result.rowCount) throw Object.assign(new Error('release_already_exists'), { statusCode: 409 });
    return result.rows[0];
  }

  async enqueueJob(input) {
    const result = await this.pool.query(
      `INSERT INTO nexus_build_jobs (job_id, release_id, stage, lane, repository, git_ref, commit_sha, artifact_type, priority, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [input.jobId, input.releaseId || null, input.stage, input.lane || 'general', input.repository, input.gitRef,
        input.commitSha || null, input.artifactType || 'GENERAL', input.priority || 100, input.payload || {}]
    );
    return result.rows[0];
  }

  async approveRelease(releaseId) {
    const result = await this.pool.query(
      `UPDATE nexus_releases SET approval_status = 'approved', updated_at = now()
       WHERE release_id = $1 AND build_status = 'passed' AND test_status = 'passed' AND validation_status = 'passed'
       RETURNING *`, [releaseId]
    );
    if (!result.rowCount) throw Object.assign(new Error('release_not_ready_for_approval'), { statusCode: 409 });
    return result.rows[0];
  }

  async snapshot() {
    const [nodes, jobs, releases] = await Promise.all([
      this.pool.query(`SELECT node_id, lane, capabilities, status, active_job_id, heartbeat_at FROM nexus_worker_nodes ORDER BY node_id`),
      this.pool.query(`SELECT job_id, release_id, stage, lane, status, leased_by, heartbeat_at FROM nexus_build_jobs WHERE status IN ('queued','leased','running','blocked') ORDER BY priority, created_at LIMIT 50`),
      this.pool.query(`SELECT release_id, target, artifact_type, build_status, test_status, validation_status, approval_status, deployment_status FROM nexus_releases ORDER BY created_at DESC LIMIT 20`)
    ]);
    return { nodes: nodes.rows, jobs: jobs.rows, releases: releases.rows };
  }

  async close() { await this.pool.end(); }
}

module.exports = { WorkerStore };
