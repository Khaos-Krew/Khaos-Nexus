'use strict';

const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 20_000;
const VALID_LANES = new Set(['forge', 'ark', 'general']);
const VALID_STAGES = new Set(['build', 'test', 'validation']);

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

function safeTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(2_000, Math.min(parsed, 120_000));
}

function makeJobId(stage = 'JOB') {
  const prefix = String(stage || 'JOB').toUpperCase().replace(/[^A-Z0-9_.-]/g, '').slice(0, 16) || 'JOB';
  return `NX-${prefix}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

class ForgeWorkerClient {
  constructor(options = {}) {
    this.urls = {
      forge: normalizeBaseUrl(options.forgeUrl ?? process.env.NEXUS_WORKER_FORGE_URL),
      ark: normalizeBaseUrl(options.arkUrl ?? process.env.NEXUS_WORKER_ARK_URL),
      general: normalizeBaseUrl(options.generalUrl ?? process.env.NEXUS_WORKER_GENERAL_URL)
    };
    this.token = String(options.token ?? process.env.NEXUS_WORKER_API_TOKEN ?? process.env.WORKER_API_TOKEN ?? '').trim();
    this.timeoutMs = safeTimeoutMs(options.timeoutMs ?? process.env.NEXUS_WORKER_REQUEST_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  configuration() {
    return {
      tokenConfigured: Boolean(this.token),
      lanes: Object.fromEntries(Object.entries(this.urls).map(([lane, url]) => [lane, Boolean(url)]))
    };
  }

  assertLane(lane) {
    const normalized = String(lane || 'general').toLowerCase();
    if (!VALID_LANES.has(normalized)) throw Object.assign(new Error(`Invalid worker lane: ${lane}`), { code: 'WORKER_INVALID_LANE' });
    if (!this.urls[normalized]) throw Object.assign(new Error(`Worker lane ${normalized} is not configured`), { code: 'WORKER_NOT_CONFIGURED' });
    if (typeof this.fetchImpl !== 'function') throw Object.assign(new Error('Fetch is unavailable in this runtime'), { code: 'WORKER_HTTP_UNAVAILABLE' });
    return normalized;
  }

  async request(lane, path, options = {}) {
    const targetLane = this.assertLane(lane);
    if (options.auth !== false && !this.token) throw Object.assign(new Error('NEXUS_WORKER_API_TOKEN is not configured'), { code: 'WORKER_NOT_CONFIGURED' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(`${this.urls[targetLane]}${path}`, {
        method: options.method || 'GET',
        headers: {
          accept: 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.auth === false ? {} : { authorization: `Bearer ${this.token}` })
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok) {
        const detail = String(payload?.error || payload?.message || `HTTP ${response.status}`).slice(0, 500);
        const error = new Error(`Worker ${targetLane} request failed: ${detail}`);
        error.code = response.status === 401 ? 'WORKER_UNAUTHORIZED' : 'WORKER_REQUEST_FAILED';
        error.status = response.status;
        throw error;
      }
      return payload || {};
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error(`Worker ${targetLane} request timed out`), { code: 'WORKER_TIMEOUT' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(lane) {
    return this.request(lane, '/health', { auth: false, timeoutMs: Math.min(this.timeoutMs, 10_000) });
  }

  async cluster(lane = 'forge') {
    return this.request(lane, '/cluster');
  }

  async enqueueJob(input = {}) {
    const lane = this.assertLane(input.lane || 'general');
    const stage = String(input.stage || '').toLowerCase();
    if (!VALID_STAGES.has(stage)) throw Object.assign(new Error(`Invalid worker stage: ${input.stage}`), { code: 'WORKER_INVALID_STAGE' });
    const repository = String(input.repository || 'Khaos-Krew/Khaos-Nexus').trim();
    const gitRef = String(input.gitRef || input.git_ref || '').trim();
    if (!gitRef || gitRef.length > 240) throw Object.assign(new Error('A valid git ref is required'), { code: 'WORKER_INVALID_REF' });
    const commands = Array.isArray(input.commands) ? input.commands : [];
    if (!commands.length) throw Object.assign(new Error('At least one validation command is required'), { code: 'WORKER_INVALID_COMMANDS' });

    const body = {
      jobId: String(input.jobId || makeJobId(stage)),
      releaseId: input.releaseId || null,
      stage,
      lane,
      repository,
      gitRef,
      commitSha: input.commitSha || null,
      artifactType: String(input.artifactType || (lane === 'ark' ? 'ARK_CONFIG' : 'GENERAL')),
      priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100,
      payload: {
        commands,
        source: 'sentinel-forge-control-plane',
        ...(input.metadata && typeof input.metadata === 'object' ? { metadata: input.metadata } : {})
      }
    };
    return this.request(lane, '/jobs', { method: 'POST', body });
  }

  async queueValidationPipeline(input = {}) {
    const lane = String(input.lane || 'forge').toLowerCase();
    const common = {
      lane,
      repository: input.repository || 'Khaos-Krew/Khaos-Nexus',
      gitRef: input.gitRef,
      commitSha: input.commitSha || null,
      artifactType: input.artifactType || (lane === 'ark' ? 'ARK_CONFIG' : 'GENERAL'),
      priority: input.priority,
      metadata: input.metadata
    };
    const validation = await this.enqueueJob({
      ...common,
      stage: 'validation',
      commands: [{ command: 'npm', args: ['run', 'check'] }]
    });
    const test = await this.enqueueJob({
      ...common,
      stage: 'test',
      priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) + 1 : 101,
      commands: [{ command: 'npm', args: ['test'] }]
    });
    return { validation, test };
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  VALID_LANES,
  VALID_STAGES,
  normalizeBaseUrl,
  makeJobId,
  ForgeWorkerClient
};
