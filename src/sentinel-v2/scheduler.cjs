'use strict';

const { randomUUID } = require('node:crypto');

class Scheduler {
  constructor({ logger, defaultTimeoutMs = 30000, jobStore } = {}) {
    this.logger = logger;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.jobStore = jobStore;
    this.jobs = new Map();
    this.running = new Map();
  }

  register(definition) {
    const job = normalizeJob(definition, this.defaultTimeoutMs);
    if (this.jobs.has(job.name)) throw new Error(`Duplicate job: ${job.name}`);
    this.jobs.set(job.name, job);
    return job;
  }

  list() {
    return [...this.jobs.values()].map(({ run, ...job }) => ({ ...job }));
  }

  async runNow(name, context = {}) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    if (this.running.has(name) && job.concurrency === 1) {
      return { skipped: true, reason: 'already-running', runId: this.running.get(name) };
    }

    const runId = randomUUID();
    const startedAt = Date.now();
    const correlationId = String(context.correlationId || runId);
    this.running.set(name, runId);
    const log = this.logger?.child?.({ job: name, runId, correlationId }) || this.logger;
    log?.info?.('sentinel.job.started');

    try {
      await this.jobStore?.ensureJob?.(job);
      const execute = async () => withTimeout(
        Promise.resolve(job.run({ ...context, runId, correlationId, job })),
        job.timeoutMs,
        `Job ${name} timed out after ${job.timeoutMs}ms`,
      );

      const result = this.jobStore?.runWithLock
        ? await this.jobStore.runWithLock({ job, runId, correlationId, execute })
        : await execute();

      if (result?.__sentinelLockSkipped) {
        const durationMs = Date.now() - startedAt;
        log?.info?.('sentinel.job.skipped', { durationMs, reason: result.reason });
        return { skipped: true, reason: result.reason, runId, durationMs };
      }

      const durationMs = Date.now() - startedAt;
      await this.jobStore?.finishRun?.({ runId, status: 'succeeded', durationMs, result });
      log?.info?.('sentinel.job.succeeded', { durationMs });
      return { skipped: false, ok: true, runId, durationMs, result };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await this.jobStore?.finishRun?.({ runId, status: 'failed', durationMs, error }).catch?.((persistError) => {
        log?.error?.('sentinel.job.persistence_failed', { error: persistError });
      });
      log?.error?.('sentinel.job.failed', { durationMs, error });
      return { skipped: false, ok: false, runId, durationMs, error };
    } finally {
      if (this.running.get(name) === runId) this.running.delete(name);
    }
  }
}

function normalizeJob(definition, defaultTimeoutMs) {
  if (!definition || typeof definition !== 'object') throw new TypeError('Job definition is required');
  const name = String(definition.name || '').trim();
  if (!name) throw new Error('Job name is required');
  if (typeof definition.run !== 'function') throw new Error(`Job ${name} requires run()`);
  const timeoutMs = Number(definition.timeoutMs || defaultTimeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100) throw new Error(`Invalid timeout for ${name}`);
  const concurrency = Number(definition.concurrency || 1);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Invalid concurrency for ${name}`);
  return Object.freeze({
    name,
    owner: String(definition.owner || 'sentinel').trim(),
    trigger: definition.trigger || { type: 'manual' },
    timeoutMs,
    concurrency,
    retry: definition.retry || { attempts: 0 },
    run: definition.run,
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { Scheduler, normalizeJob, withTimeout };
