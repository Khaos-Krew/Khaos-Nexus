'use strict';

const DEFAULT_TIMEOUT_MS = 16 * 60 * 1000;
const DEFAULT_REPO = 'Khaos-Krew/Khaos-Nexus';
const DEFAULT_BASE_REF = 'rebuild/nexus-0.1';

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

function safeTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(5_000, Math.min(parsed, 20 * 60 * 1000));
}

function boundedText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function mapUsage(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    requests: Math.max(0, Number(value.requests) || 0),
    inputTokens: Math.max(0, Number(value.input_tokens ?? value.inputTokens) || 0),
    outputTokens: Math.max(0, Number(value.output_tokens ?? value.outputTokens) || 0),
    totalTokens: Math.max(0, Number(value.total_tokens ?? value.totalTokens) || 0)
  };
}

function mapQueuedTask(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: boundedText(value.id, 128),
    state: boundedText(value.state, 40) || 'unknown',
    repo: boundedText(value.repo, 240),
    goal: boundedText(value.goal, 12_000),
    mode: boundedText(value.mode, 40),
    baseRef: boundedText(value.base_ref ?? value.baseRef, 240),
    branch: value.branch ? boundedText(value.branch, 240) : null,
    priority: Math.max(0, Number(value.priority) || 0),
    attempt: Math.max(0, Number(value.attempt) || 0),
    maxAttempts: Math.max(0, Number(value.max_attempts ?? value.maxAttempts) || 0),
    correlationId: value.correlation_id ? boundedText(value.correlation_id, 200) : null,
    requestedBy: value.requested_by ? boundedText(value.requested_by, 200) : null,
    idempotencyKey: value.idempotency_key ? boundedText(value.idempotency_key, 200) : null,
    modelRoute: value.model_route ? boundedText(value.model_route, 120) : null,
    usage: mapUsage(value.usage),
    output: value.output ? String(value.output).slice(0, 12_000) : '',
    errorType: value.error_type ? boundedText(value.error_type, 120) : null,
    createdAt: value.created_at ? boundedText(value.created_at, 80) : null,
    updatedAt: value.updated_at ? boundedText(value.updated_at, 80) : null,
    finishedAt: value.finished_at ? boundedText(value.finished_at, 80) : null
  };
}

class ForgeClient {
  constructor(options = {}) {
    this.enabled = options.enabled ?? truthy(process.env.FORGE_ENABLED);
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.FORGE_BASE_URL);
    this.token = String(options.token ?? process.env.FORGE_SERVICE_TOKEN ?? '').trim();
    this.defaultRepo = String(options.defaultRepo ?? process.env.FORGE_DEFAULT_REPO ?? DEFAULT_REPO).trim() || DEFAULT_REPO;
    this.defaultBaseRef = String(options.defaultBaseRef ?? process.env.FORGE_DEFAULT_BASE_REF ?? DEFAULT_BASE_REF).trim() || DEFAULT_BASE_REF;
    this.timeoutMs = safeTimeoutMs(options.timeoutMs ?? (Number(process.env.FORGE_REQUEST_TIMEOUT_SECONDS || 0) * 1000));
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  configuration() {
    return {
      enabled: Boolean(this.enabled),
      baseUrlConfigured: Boolean(this.baseUrl),
      tokenConfigured: Boolean(this.token),
      defaultRepo: this.defaultRepo,
      defaultBaseRef: this.defaultBaseRef
    };
  }

  assertReady({ requireToken = true } = {}) {
    if (!this.enabled) throw Object.assign(new Error('Khaos Nexus Forge integration is disabled'), { code: 'FORGE_DISABLED' });
    if (!this.baseUrl) throw Object.assign(new Error('FORGE_BASE_URL is not configured'), { code: 'FORGE_NOT_CONFIGURED' });
    if (requireToken && !this.token) throw Object.assign(new Error('FORGE_SERVICE_TOKEN is not configured'), { code: 'FORGE_NOT_CONFIGURED' });
    if (typeof this.fetchImpl !== 'function') throw Object.assign(new Error('Fetch is unavailable in this runtime'), { code: 'FORGE_HTTP_UNAVAILABLE' });
  }

  async request(path, options = {}) {
    this.assertReady({ requireToken: options.requireToken !== false });
    const headers = {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(this.token ? { 'x-forge-token': this.token } : {}),
      ...(options.headers || {})
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    timer.unref?.();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok) {
        const detail = String(payload?.detail || payload?.message || `HTTP ${response.status}`).slice(0, 500);
        const error = new Error(`Forge request failed: ${detail}`);
        error.code = response.status === 401 ? 'FORGE_UNAUTHORIZED' : 'FORGE_REQUEST_FAILED';
        error.status = response.status;
        throw error;
      }
      return payload || {};
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('Forge request timed out'), { code: 'FORGE_TIMEOUT' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    const payload = await this.request('/health', { requireToken: false, timeoutMs: Math.min(this.timeoutMs, 15_000) });
    return {
      ok: Boolean(payload?.ok),
      name: String(payload?.name || 'Khaos Nexus Forge'),
      version: String(payload?.version || 'unknown'),
      openaiConfigured: Boolean(payload?.openaiConfigured),
      githubConfigured: Boolean(payload?.githubConfigured),
      fallbackRouting: String(payload?.fallbackRouting || 'unknown'),
      writePolicy: String(payload?.writePolicy || 'unknown')
    };
  }

  async ready() {
    return this.request('/ready', { timeoutMs: Math.min(this.timeoutMs, 15_000) });
  }

  async infrastructureStatus() {
    return this.request('/api/v1/status', { timeoutMs: Math.min(this.timeoutMs, 15_000) });
  }

  async usage() {
    const payload = await this.request('/api/v1/usage', { timeoutMs: Math.min(this.timeoutMs, 15_000) });
    const totals = payload?.totals || {};
    const byRoute = payload?.by_route || payload?.byRoute || {};
    return {
      ok: payload?.ok !== false,
      totals: {
        tasks: Math.max(0, Number(totals.tasks) || 0),
        requests: Math.max(0, Number(totals.requests) || 0),
        inputTokens: Math.max(0, Number(totals.input_tokens ?? totals.inputTokens) || 0),
        outputTokens: Math.max(0, Number(totals.output_tokens ?? totals.outputTokens) || 0),
        totalTokens: Math.max(0, Number(totals.total_tokens ?? totals.totalTokens) || 0)
      },
      byRoute,
      modelTokensConsumed: Math.max(0, Number(payload?.modelTokensConsumed) || 0)
    };
  }

  async ciStatus(ref, options = {}) {
    const targetRef = String(ref || '').trim();
    if (!targetRef) throw Object.assign(new Error('Forge CI ref is required'), { code: 'FORGE_INVALID_REF' });
    if (targetRef.length > 240) throw Object.assign(new Error('Forge CI ref is too large'), { code: 'FORGE_INVALID_REF' });
    const repo = String(options.repo || this.defaultRepo).trim();
    const params = new URLSearchParams({ repo, ref: targetRef });
    const payload = await this.request(`/api/v1/ci?${params.toString()}`, { timeoutMs: Math.min(this.timeoutMs, 30_000) });
    return {
      repo: String(payload?.repo || repo),
      ref: String(payload?.ref || targetRef),
      sha: String(payload?.sha || ''),
      state: String(payload?.state || 'unknown'),
      combinedStatus: String(payload?.combined_status || 'unknown'),
      checkRuns: Array.isArray(payload?.check_runs) ? payload.check_runs.slice(0, 50) : [],
      statuses: Array.isArray(payload?.statuses) ? payload.statuses.slice(0, 50) : []
    };
  }

  taskBody(options = {}) {
    const goal = String(options.goal || '').trim();
    if (!goal) throw Object.assign(new Error('Forge task goal is required'), { code: 'FORGE_INVALID_TASK' });
    if (goal.length > 12_000) throw Object.assign(new Error('Forge task goal is too large'), { code: 'FORGE_INVALID_TASK' });
    const mode = options.mode === 'execute' ? 'execute' : 'plan';
    const body = {
      repo: String(options.repo || this.defaultRepo).trim(),
      goal,
      mode,
      base_ref: String(options.baseRef || options.base_ref || this.defaultBaseRef).trim(),
      constraints: Array.isArray(options.constraints)
        ? options.constraints.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
        : []
    };
    if (options.branch) body.branch = String(options.branch).trim();
    return body;
  }

  async runTask(options = {}) {
    const body = this.taskBody(options);
    const payload = await this.request('/api/v1/tasks', { method: 'POST', body });
    return {
      status: String(payload?.status || 'unknown'),
      mode: String(payload?.mode || body.mode),
      repo: String(payload?.repo || body.repo),
      baseRef: String(payload?.base_ref || body.base_ref),
      branch: payload?.branch ? String(payload.branch) : null,
      output: String(payload?.output || ''),
      modelRoute: payload?.model_route ? String(payload.model_route) : null,
      usage: mapUsage(payload?.usage)
    };
  }

  async queueTask(options = {}) {
    const body = this.taskBody(options);
    const headers = {};
    if (options.actor) headers['x-forge-actor'] = boundedText(options.actor, 200);
    if (options.correlationId) headers['x-forge-correlation-id'] = boundedText(options.correlationId, 200);
    if (options.idempotencyKey) headers['idempotency-key'] = boundedText(options.idempotencyKey, 200);
    const payload = await this.request('/api/v1/task-queue', { method: 'POST', body, headers });
    return {
      ok: payload?.ok !== false,
      task: mapQueuedTask(payload?.task),
      duplicate: Boolean(payload?.duplicate),
      approvalRequired: payload?.approvalRequired !== false,
      modelTokensConsumed: Math.max(0, Number(payload?.modelTokensConsumed) || 0)
    };
  }

  async listQueue(options = {}) {
    const params = new URLSearchParams();
    if (options.state) params.set('state', boundedText(options.state, 40));
    params.set('limit', String(Math.max(1, Math.min(Number(options.limit) || 50, 200))));
    const payload = await this.request(`/api/v1/task-queue?${params.toString()}`);
    return {
      ok: payload?.ok !== false,
      tasks: Array.isArray(payload?.tasks) ? payload.tasks.map(mapQueuedTask).filter(Boolean) : [],
      count: Math.max(0, Number(payload?.count) || 0)
    };
  }

  async queuedTask(taskId) {
    const id = boundedText(taskId, 128);
    if (!id) throw Object.assign(new Error('Forge task ID is required'), { code: 'FORGE_INVALID_TASK_ID' });
    const payload = await this.request(`/api/v1/task-queue/${encodeURIComponent(id)}`);
    return {
      ok: payload?.ok !== false,
      task: mapQueuedTask(payload?.task),
      approval: payload?.approval || null,
      events: Array.isArray(payload?.events) ? payload.events.slice(0, 500) : []
    };
  }

  async taskAction(taskId, action, options = {}) {
    const id = boundedText(taskId, 128);
    if (!id) throw Object.assign(new Error('Forge task ID is required'), { code: 'FORGE_INVALID_TASK_ID' });
    const allowed = new Set(['approve', 'revoke', 'cancel', 'retry']);
    if (!allowed.has(action)) throw Object.assign(new Error('Invalid Forge task action'), { code: 'FORGE_INVALID_TASK_ACTION' });
    const headers = options.actor ? { 'x-forge-actor': boundedText(options.actor, 200) } : {};
    const payload = await this.request(`/api/v1/task-queue/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers });
    return { ok: payload?.ok !== false, task: mapQueuedTask(payload?.task), approval: payload?.approval || null, modelTokensConsumed: Math.max(0, Number(payload?.modelTokensConsumed) || 0) };
  }

  approveTask(taskId, options = {}) { return this.taskAction(taskId, 'approve', options); }
  revokeTask(taskId, options = {}) { return this.taskAction(taskId, 'revoke', options); }
  cancelQueuedTask(taskId, options = {}) { return this.taskAction(taskId, 'cancel', options); }
  retryQueuedTask(taskId, options = {}) { return this.taskAction(taskId, 'retry', options); }

  async queueRepairCandidate(options = {}) {
    const incidentId = boundedText(options.incidentId, 200);
    if (!incidentId) throw Object.assign(new Error('Forge repair incident ID is required'), { code: 'FORGE_INVALID_INCIDENT' });
    const body = {
      incident_id: incidentId,
      repo: String(options.repo || this.defaultRepo).trim(),
      base_ref: String(options.baseRef || this.defaultBaseRef).trim(),
      severity: boundedText(options.severity || 'medium', 40),
      summary: boundedText(options.summary, 2000),
      evidence: Array.isArray(options.evidence) ? options.evidence.map((item) => boundedText(item, 1000)).filter(Boolean).slice(0, 30) : []
    };
    const headers = options.actor ? { 'x-forge-actor': boundedText(options.actor, 200) } : {};
    const payload = await this.request('/api/v1/repair-candidates', { method: 'POST', body, headers });
    return { ok: payload?.ok !== false, task: mapQueuedTask(payload?.task), approvalRequired: payload?.approvalRequired !== false, modelTokensConsumed: Math.max(0, Number(payload?.modelTokensConsumed) || 0), execution: boundedText(payload?.execution, 80) };
  }

  async recoverStale(options = {}) {
    const headers = options.actor ? { 'x-forge-actor': boundedText(options.actor, 200) } : {};
    const payload = await this.request('/api/v1/maintenance/recover-stale', { method: 'POST', headers });
    return { ok: payload?.ok !== false, recovered: Array.isArray(payload?.recovered) ? payload.recovered.map((item) => boundedText(item, 128)) : [], count: Math.max(0, Number(payload?.count) || 0), modelTokensConsumed: Math.max(0, Number(payload?.modelTokensConsumed) || 0) };
  }

  async audit(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
    const payload = await this.request(`/api/v1/audit?limit=${limit}`);
    return { ok: payload?.ok !== false, events: Array.isArray(payload?.events) ? payload.events.slice(0, limit) : [] };
  }

  verifyAudit() { return this.request('/api/v1/audit/verify'); }

  plan(goal, options = {}) { return this.runTask({ ...options, goal, mode: 'plan' }); }
  execute(goal, options = {}) { return this.runTask({ ...options, goal, mode: 'execute' }); }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_REPO,
  DEFAULT_BASE_REF,
  truthy,
  normalizeBaseUrl,
  mapUsage,
  mapQueuedTask,
  ForgeClient
};
