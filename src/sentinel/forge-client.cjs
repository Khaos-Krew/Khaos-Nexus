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
      try {
        payload = await response.json();
      } catch {}
      if (!response.ok) {
        const detail = String(payload?.detail || payload?.message || `HTTP ${response.status}`).slice(0, 500);
        const error = new Error(`Forge request failed: ${detail}`);
        error.code = response.status === 401 ? 'FORGE_UNAUTHORIZED' : 'FORGE_REQUEST_FAILED';
        error.status = response.status;
        throw error;
      }
      return payload || {};
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error('Forge request timed out'), { code: 'FORGE_TIMEOUT' });
      }
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
      writePolicy: String(payload?.writePolicy || 'unknown')
    };
  }

  async runTask(options = {}) {
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
        ? options.constraints.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
        : []
    };
    if (options.branch) body.branch = String(options.branch).trim();

    const payload = await this.request('/api/v1/tasks', { method: 'POST', body });
    return {
      status: String(payload?.status || 'unknown'),
      mode: String(payload?.mode || mode),
      repo: String(payload?.repo || body.repo),
      baseRef: String(payload?.base_ref || body.base_ref),
      branch: payload?.branch ? String(payload.branch) : null,
      output: String(payload?.output || '')
    };
  }

  plan(goal, options = {}) {
    return this.runTask({ ...options, goal, mode: 'plan' });
  }

  execute(goal, options = {}) {
    return this.runTask({ ...options, goal, mode: 'execute' });
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_REPO,
  DEFAULT_BASE_REF,
  truthy,
  normalizeBaseUrl,
  ForgeClient
};
