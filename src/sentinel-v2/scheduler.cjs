'use strict';

const { randomUUID } = require('node:crypto');

class Scheduler {
  constructor({ logger, defaultTimeoutMs = 30000 } = {}) {
    this.logger = logger;
    this.defaultTimeoutMs = defaultTimeoutMs;
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
    this.running.set(name, runId);
    const log = this.logger?.child?.({ job: name, runId }) || this.logger;
    log?.info?.('sentinel.job.started');

    try {
      const result = await withTimeout(
        Promise.resolve(job.run({ ...context, runId, job })),
        job.timeoutMs,
        `Job ${name} timed out after ${job.timeoutMs}ms`,
      );
      const durationMs = Date.now() - startedAt;
      log?.info?.('sentinel.job.succeeded', { durationMs });
      return { skipped: false, ok: true, runId, durationMs, result };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
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
  return Object.freeze({
    name,
    owner: String(definition.owner || 'sentinel').trim(),
    trigger: definition.trigger || { type: 'manual' },
    timeoutMs,
    concurrency: Number(definition.concurrency || 1),
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
