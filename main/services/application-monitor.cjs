'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { reportAsMarkdown } = require('./diagnostics.cjs');
const { errorFingerprint, redactText } = require('../../shared/redaction.cjs');

const DEFAULT_STATE = Object.freeze({
  queue: [],
  reports: {},
  daily: { date: '', count: 0 },
  lastDeliveryAt: null,
  lastDeliveryAction: null,
  lastIssueUrl: null,
  lastError: null,
  status: 'idle'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRepository(value) {
  const repository = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GitHub repository must use the owner/name format.');
  }
  return repository;
}

function todayUtc(now) {
  return new Date(now).toISOString().slice(0, 10);
}

class ApplicationMonitor extends EventEmitter {
  constructor({ configStore, logger, createReport, dataDirectory, fetchImpl = global.fetch, now = () => Date.now() }) {
    super();
    this.configStore = configStore;
    this.logger = logger;
    this.createReport = createReport;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.statePath = path.join(dataDirectory, 'application-monitor.json');
    this.state = this.loadState();
    this.processing = false;
    this.retryTimer = setInterval(() => this.processQueue().catch(() => {}), 15 * 60 * 1000);
    this.retryTimer.unref?.();
  }

  loadState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return {
        ...clone(DEFAULT_STATE),
        ...parsed,
        queue: Array.isArray(parsed.queue) ? parsed.queue.slice(-20) : [],
        reports: parsed.reports && typeof parsed.reports === 'object' ? parsed.reports : {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(this.statePath, `${this.statePath}.corrupt-${Date.now()}`); } catch {}
      }
      return clone(DEFAULT_STATE);
    }
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporary, this.statePath);
  }

  resetDailyCounter() {
    const date = todayUtc(this.now());
    if (this.state.daily?.date !== date) this.state.daily = { date, count: 0 };
  }

  publicState() {
    this.resetDailyCounter();
    const config = this.configStore.getConfig().monitor || {};
    const publicConfig = this.configStore.getPublicConfig();
    return {
      enabled: Boolean(config.autoReportEnabled),
      configured: Boolean(publicConfig.hasGithubToken),
      repository: config.reportRepository,
      queueDepth: this.state.queue.length,
      sentToday: Number(this.state.daily?.count || 0),
      maxReportsPerDay: Number(config.maxReportsPerDay || 10),
      lastDeliveryAt: this.state.lastDeliveryAt,
      lastDeliveryAction: this.state.lastDeliveryAction,
      lastIssueUrl: this.state.lastIssueUrl,
      lastError: this.state.lastError,
      status: this.state.status
    };
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.saveState();
    this.emit('state', this.publicState());
  }

  getState() {
    return clone(this.publicState());
  }

  getConfig() {
    const config = this.configStore.getConfig().monitor || {};
    return {
      autoReportEnabled: Boolean(config.autoReportEnabled),
      reportRepository: normalizeRepository(config.reportRepository),
      reportLabels: Array.isArray(config.reportLabels) ? config.reportLabels.filter(Boolean).slice(0, 10) : [],
      duplicateWindowHours: Math.max(1, Number(config.duplicateWindowHours || 72)),
      maxReportsPerDay: Math.max(1, Number(config.maxReportsPerDay || 10))
    };
  }

  authHeaders() {
    const token = this.configStore.getGithubToken();
    if (!token) throw new Error('Add a GitHub monitor token before sending reports.');
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Khaos-Nexus-Application-Monitor',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async request(url, options = {}) {
    if (typeof this.fetchImpl !== 'function') throw new Error('Network requests are unavailable in this build.');
    const response = await this.fetchImpl(url, { ...options, headers: { ...this.authHeaders(), ...(options.headers || {}) } });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.message || `GitHub request failed with status ${response.status}.`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async verifyConnection() {
    const { reportRepository } = this.getConfig();
    this.updateState({ status: 'checking', lastError: null });
    try {
      const repository = await this.request(`https://api.github.com/repos/${reportRepository}`);
      this.updateState({ status: 'ready', lastError: null });
      return { ok: true, repository: repository.full_name || reportRepository, private: Boolean(repository.private) };
    } catch (error) {
      this.updateState({ status: 'error', lastError: redactText(error.message) });
      throw error;
    }
  }

  canSendToday(config) {
    this.resetDailyCounter();
    return this.state.daily.count < config.maxReportsPerDay;
  }

  incrementDailyCounter() {
    this.resetDailyCounter();
    this.state.daily.count += 1;
  }

  createItem(errorLike, source) {
    const report = this.createReport();
    const error = report.runtime?.lastError || {};
    const message = error.message || errorLike?.message || String(errorLike || 'Unknown application error');
    const stack = error.stack || errorLike?.stack || message;
    const id = error.id || errorFingerprint(stack);
    const markdown = reportAsMarkdown(report, 9000);
    return {
      id,
      source: String(source || 'application'),
      title: `[Auto ${id}] ${message}`.slice(0, 180),
      body: `${markdown}\n\n**Monitor source:** ${String(source || 'application')}\n**Captured automatically:** ${new Date(this.now()).toISOString()}`,
      createdAt: new Date(this.now()).toISOString(),
      occurrences: 1
    };
  }

  enqueue(item, reason) {
    const queue = [...this.state.queue];
    const existing = queue.find((queued) => queued.id === item.id);
    if (existing) {
      existing.occurrences = Number(existing.occurrences || 1) + Number(item.occurrences || 1);
      existing.createdAt = item.createdAt;
      existing.body = item.body;
      existing.reason = reason;
    } else {
      queue.push({ ...item, reason });
    }
    this.updateState({ queue: queue.slice(-20), status: reason === 'missing-token' ? 'waiting-for-token' : 'queued', lastError: reason });
    this.logger.warn('Application Monitor queued an error report.', { errorId: item.id, reason });
    return { queued: true, errorId: item.id, reason };
  }

  async capture(errorLike, { source = 'application', force = false } = {}) {
    const config = this.getConfig();
    if (!force && !config.autoReportEnabled) return { skipped: true, reason: 'disabled' };
    const item = this.createItem(errorLike, source);
    if (!this.configStore.getGithubToken()) return this.enqueue(item, 'missing-token');
    if (!this.canSendToday(config)) return this.enqueue(item, 'daily-limit');
    try {
      return await this.deliver(item, config);
    } catch (error) {
      this.logger.error('Application Monitor could not deliver a GitHub report.', { errorId: item.id, message: error.message });
      return this.enqueue(item, redactText(error.message));
    }
  }

  async deliver(item, config = this.getConfig()) {
    const now = this.now();
    const existing = this.state.reports[item.id];
    const duplicateWindowMs = config.duplicateWindowHours * 60 * 60 * 1000;
    let payload;
    let action;

    this.updateState({ status: 'sending', lastError: null });
    if (existing?.issueNumber && now - Number(existing.lastSeenAt || 0) <= duplicateWindowMs) {
      payload = await this.request(`https://api.github.com/repos/${config.reportRepository}/issues/${existing.issueNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: `## Additional occurrence\n\nThis error occurred again at ${item.createdAt}.\n\n${item.body}` })
      });
      action = 'commented';
    } else {
      const issuePayload = { title: item.title, body: item.body, labels: config.reportLabels };
      try {
        payload = await this.request(`https://api.github.com/repos/${config.reportRepository}/issues`, {
          method: 'POST',
          body: JSON.stringify(issuePayload)
        });
      } catch (error) {
        if (error.status !== 422 || !config.reportLabels.length) throw error;
        delete issuePayload.labels;
        payload = await this.request(`https://api.github.com/repos/${config.reportRepository}/issues`, {
          method: 'POST',
          body: JSON.stringify(issuePayload)
        });
      }
      action = 'created';
    }

    this.incrementDailyCounter();
    const issueNumber = payload.issue_url ? Number(payload.issue_url.split('/').pop()) : (payload.number || existing?.issueNumber);
    const issueUrl = action === 'commented' ? (existing?.issueUrl || null) : (payload.html_url || null);
    this.state.reports[item.id] = {
      issueNumber,
      issueUrl,
      createdAt: existing?.createdAt || now,
      lastSeenAt: now,
      occurrences: Number(existing?.occurrences || 0) + Number(item.occurrences || 1)
    };
    this.updateState({
      reports: this.state.reports,
      daily: this.state.daily,
      status: 'ready',
      lastDeliveryAt: new Date(now).toISOString(),
      lastDeliveryAction: action,
      lastIssueUrl: issueUrl,
      lastError: null
    });
    this.logger.info(`Application Monitor ${action} a GitHub issue report.`, { errorId: item.id, issueNumber, issueUrl });
    return { delivered: true, action, errorId: item.id, issueNumber, issueUrl };
  }

  async processQueue() {
    if (this.processing) return { skipped: true, reason: 'already-processing' };
    const config = this.getConfig();
    if (!config.autoReportEnabled || !this.configStore.getGithubToken() || !this.state.queue.length) return { skipped: true };
    this.processing = true;
    try {
      const pending = [...this.state.queue];
      const remaining = [];
      let delivered = 0;
      for (let index = 0; index < pending.length; index += 1) {
        const item = pending[index];
        if (!this.canSendToday(config)) {
          remaining.push(item);
          continue;
        }
        try {
          await this.deliver(item, config);
          delivered += 1;
        } catch (error) {
          remaining.push({ ...item, reason: redactText(error.message) }, ...pending.slice(index + 1));
          break;
        }
      }
      this.updateState({ queue: remaining.slice(-20), status: remaining.length ? 'queued' : 'ready' });
      return { delivered, remaining: remaining.length };
    } finally {
      this.processing = false;
    }
  }

  clearQueue() {
    this.updateState({ queue: [], status: 'ready', lastError: null });
    return this.getState();
  }

  destroy() {
    clearInterval(this.retryTimer);
  }
}

module.exports = { ApplicationMonitor, normalizeRepository, DEFAULT_STATE };
