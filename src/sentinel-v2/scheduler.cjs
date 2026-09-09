'use strict';

const { randomUUID } = require('node:crypto');

class Scheduler {
  constructor({ logger, defaultTimeoutMs = 30000, jobStore, now = () => Date.now(), random = Math.random, sleep = delay } = {}) {
    this.logger = logger;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.jobStore = jobStore;
    this.now = now;
    this.random = random;
    this.sleep = sleep;
    this.jobs = new Map();
    this.running = new Map();
    this.nextDue = new Map();
    this.paused = new Set();
    this.started = false;
    this.timer = null;
  }

  register(definition) {
    const job = normalizeJob(definition, this.defaultTimeoutMs);
    if (this.jobs.has(job.name)) throw new Error(`Duplicate job: ${job.name}`);
    this.jobs.set(job.name, job);
    if (this.started) this.#seedDue(job);
    return job;
  }

  list() {
    return [...this.jobs.values()].map(({ run, ...job }) => ({
      ...job,
      paused: this.paused.has(job.name),
      nextDueAt: this.nextDue.get(job.name) || null,
    }));
  }

  start() {
    if (this.started) return false;
    this.started = true;
    for (const job of this.jobs.values()) this.#seedDue(job);
    this.#scheduleLoop();
    this.logger?.info?.('sentinel.scheduler.started', { jobs: this.jobs.size });
    return true;
  }

  stop() {
    if (!this.started) return false;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.logger?.info?.('sentinel.scheduler.stopped');
    return true;
  }

  pause(name) {
    if (!this.jobs.has(name)) throw new Error(`Unknown job: ${name}`);
    this.paused.add(name);
    this.nextDue.delete(name);
    return true;
  }

  resume(name) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    this.paused.delete(name);
    if (this.started) this.#seedDue(job);
    return true;
  }

  async runNow(name, context = {}) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    if (this.running.has(name) && job.concurrency === 1) {
      return { skipped: true, reason: 'already-running', runId: this.running.get(name) };
    }

    const runId = randomUUID();
    const startedAt = this.now();
    const correlationId = String(context.correlationId || runId);
    this.running.set(name, runId);
    const log = this.logger?.child?.({ job: name, runId, correlationId }) || this.logger;
    log?.info?.('sentinel.job.started');

    try {
      await this.jobStore?.ensureJob?.(job);
      const execute = async () => this.#executeWithRetry({ job, runId, correlationId, context, log });

      const result = this.jobStore?.runWithLock
        ? await this.jobStore.runWithLock({ job, runId, correlationId, execute })
        : await execute();

      if (result?.__sentinelLockSkipped) {
        const durationMs = this.now() - startedAt;
        log?.info?.('sentinel.job.skipped', { durationMs, reason: result.reason });
        return { skipped: true, reason: result.reason, runId, durationMs };
      }

      const durationMs = this.now() - startedAt;
      await this.jobStore?.finishRun?.({ runId, status: 'succeeded', durationMs, result: result.value });
      log?.info?.('sentinel.job.succeeded', { durationMs, attempts: result.attempts });
      return { skipped: false, ok: true, runId, durationMs, attempts: result.attempts, result: result.value };
    } catch (error) {
      const durationMs = this.now() - startedAt;
      await this.jobStore?.finishRun?.({ runId, status: 'failed', durationMs, error }).catch?.((persistError) => {
        log?.error?.('sentinel.job.persistence_failed', { error: persistError });
      });
      log?.error?.('sentinel.job.failed', { durationMs, attempts: error.sentinelAttempts || 1, error });
      return { skipped: false, ok: false, runId, durationMs, attempts: error.sentinelAttempts || 1, error };
    } finally {
      if (this.running.get(name) === runId) this.running.delete(name);
    }
  }

  async #executeWithRetry({ job, runId, correlationId, context, log }) {
    const totalAttempts = job.retry.attempts + 1;
    let lastError;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      if (attempt > 1) {
        await this.jobStore?.updateRunAttempt?.({ runId, attempt });
      }
      try {
        const value = await withTimeout(
          Promise.resolve(job.run({ ...context, runId, correlationId, attempt, job })),
          job.timeoutMs,
          `Job ${job.name} timed out after ${job.timeoutMs}ms`,
        );
        return { value, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (attempt >= totalAttempts) break;
        const backoffMs = retryDelay(job.retry, attempt, this.random);
        log?.warn?.('sentinel.job.retrying', { attempt, nextAttempt: attempt + 1, backoffMs, error });
        await this.sleep(backoffMs);
      }
    }

    try { lastError.sentinelAttempts = totalAttempts; } catch {}
    throw lastError;
  }

  #seedDue(job) {
    if (this.paused.has(job.name) || job.trigger.type !== 'interval') return;
    this.nextDue.set(job.name, this.now() + intervalDelay(job.trigger, this.random));
  }

  #scheduleLoop() {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);

    const now = this.now();
    let nearest = Infinity;
    for (const [name, dueAt] of this.nextDue.entries()) {
      if (this.paused.has(name)) continue;
      nearest = Math.min(nearest, dueAt);
    }

    const waitMs = Number.isFinite(nearest) ? Math.max(0, nearest - now) : 1000;
    this.timer = setTimeout(() => void this.#tick(), waitMs);
    this.timer.unref?.();
  }

  async #tick() {
    if (!this.started) return;
    const now = this.now();
    const due = [];

    for (const [name, dueAt] of this.nextDue.entries()) {
      if (dueAt <= now && !this.paused.has(name)) due.push(name);
    }

    for (const name of due) {
      const job = this.jobs.get(name);
      if (!job) continue;
      this.nextDue.set(name, now + intervalDelay(job.trigger, this.random));
      void this.runNow(name, { trigger: 'interval' }).catch((error) => {
        this.logger?.error?.('sentinel.scheduler.dispatch_failed', { job: name, error });
      });
    }

    this.#scheduleLoop();
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
    trigger: normalizeTrigger(definition.trigger),
    timeoutMs,
    concurrency,
    retry: normalizeRetry(definition.retry),
    run: definition.run,
  });
}

function normalizeTrigger(trigger = { type: 'manual' }) {
  const type = String(trigger?.type || 'manual').trim().toLowerCase();
  if (type === 'manual') return Object.freeze({ type: 'manual' });
  if (type !== 'interval') throw new Error(`Unsupported job trigger: ${type}`);
  const everyMs = Number(trigger.everyMs);
  if (!Number.isFinite(everyMs) || everyMs < 1000) throw new Error('Interval trigger requires everyMs >= 1000');
  const jitterMs = Number(trigger.jitterMs || 0);
  if (!Number.isFinite(jitterMs) || jitterMs < 0 || jitterMs > everyMs) throw new Error('Invalid interval jitterMs');
  return Object.freeze({ type, everyMs, jitterMs });
}

function normalizeRetry(retry = { attempts: 0 }) {
  const attempts = Number(retry?.attempts || 0);
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 10) throw new Error('Retry attempts must be an integer from 0 to 10');
  const baseDelayMs = Number(retry?.baseDelayMs || 1000);
  const maxDelayMs = Number(retry?.maxDelayMs || 30000);
  const factor = Number(retry?.factor || 2);
  const jitterRatio = Number(retry?.jitterRatio ?? 0.2);
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new Error('Invalid retry baseDelayMs');
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) throw new Error('Invalid retry maxDelayMs');
  if (!Number.isFinite(factor) || factor < 1) throw new Error('Invalid retry factor');
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error('Invalid retry jitterRatio');
  return Object.freeze({ attempts, baseDelayMs, maxDelayMs, factor, jitterRatio });
}

function retryDelay(retry, failedAttempt, random = Math.random) {
  const raw = Math.min(retry.maxDelayMs, retry.baseDelayMs * (retry.factor ** Math.max(0, failedAttempt - 1)));
  if (!retry.jitterRatio || raw === 0) return Math.round(raw);
  const spread = raw * retry.jitterRatio;
  const jitter = (Math.max(0, Math.min(1, Number(random()) || 0)) * 2 - 1) * spread;
  return Math.max(0, Math.round(raw + jitter));
}

function intervalDelay(trigger, random = Math.random) {
  if (!trigger.jitterMs) return trigger.everyMs;
  const jitter = Math.round(Math.max(0, Math.min(1, Number(random()) || 0)) * trigger.jitterMs);
  return trigger.everyMs + jitter;
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
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

module.exports = {
  Scheduler,
  normalizeJob,
  normalizeTrigger,
  normalizeRetry,
  retryDelay,
  intervalDelay,
  withTimeout,
};
