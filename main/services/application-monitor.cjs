'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { reportAsMarkdown } = require('./diagnostics.cjs');
const { errorFingerprint, redactText } = require('../../shared/redaction.cjs');
const { isExpectedAccessDenial } = require('../../shared/renderer-action-errors.cjs');

const STARTUP_BATCH_DELAY_MS = 5 * 60 * 1000;
const ERROR_BATCH_INTERVAL_MS = 30 * 60 * 1000;
const MAX_QUEUED_ERRORS = 200;
const MAX_BATCH_BODY_LENGTH = 54000;

const DEFAULT_STATE = Object.freeze({
  queue: [],
  reports: {},
  sourceOccurrences: {},
  daily: { date: '', count: 0 },
  lastDeliveryAt: null,
  lastDeliveryAction: null,
  lastIssueUrl: null,
  lastError: null,
  status: 'idle',
  lastBatchAt: null,
  nextBatchAt: null,
  lastBatchCount: 0,
  batchRuns: 0
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

function queueKey(item = {}) {
  return `${item.id || ''}:${item.createdAt || ''}`;
}

class ApplicationMonitor extends EventEmitter {
  constructor({
    configStore,
    logger,
    createReport,
    dataDirectory,
    fetchImpl = global.fetch,
    now = () => Date.now(),
    setTimeoutFactory = setTimeout,
    clearTimeoutFactory = clearTimeout,
    setIntervalFactory = setInterval,
    clearIntervalFactory = clearInterval
  }) {
    super();
    this.configStore = configStore;
    this.logger = logger;
    this.createReport = createReport;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.setTimeoutFactory = setTimeoutFactory;
    this.clearTimeoutFactory = clearTimeoutFactory;
    this.setIntervalFactory = setIntervalFactory;
    this.clearIntervalFactory = clearIntervalFactory;
    this.statePath = path.join(dataDirectory, 'application-monitor.json');
    this.state = this.loadState();
    this.processing = false;
    this.batchProcessing = false;
    this.startupBatchTimer = null;
    this.batchTimer = null;
    this.scheduleAutomaticBatches();
  }

  loadState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return {
        ...clone(DEFAULT_STATE),
        ...parsed,
        queue: Array.isArray(parsed.queue) ? parsed.queue.slice(-MAX_QUEUED_ERRORS) : [],
        reports: parsed.reports && typeof parsed.reports === 'object' ? parsed.reports : {},
        sourceOccurrences: parsed.sourceOccurrences && typeof parsed.sourceOccurrences === 'object' ? parsed.sourceOccurrences : {}
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
      status: this.state.status,
      lastBatchAt: this.state.lastBatchAt,
      nextBatchAt: this.state.nextBatchAt,
      lastBatchCount: Number(this.state.lastBatchCount || 0),
      batchRuns: Number(this.state.batchRuns || 0),
      startupBatchDelayMinutes: STARTUP_BATCH_DELAY_MS / 60000,
      batchIntervalMinutes: ERROR_BATCH_INTERVAL_MS / 60000
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
    const runtimeError = report.runtime?.lastError || {};
    const supplied = errorLike instanceof Error || (errorLike && typeof errorLike === 'object') ? errorLike : {};
    const message = supplied.message || runtimeError.message || String(errorLike || 'Unknown application error');
    const stack = supplied.stack || runtimeError.stack || message;
    const id = supplied.id || runtimeError.id || errorFingerprint(stack);
    const markdown = reportAsMarkdown(report, 9000);
    return {
      id,
      source: String(source || 'application'),
      title: `[Auto ${id}] ${message}`.slice(0, 180),
      body: `${markdown}\n\n**Monitor source:** ${String(source || 'application')}\n**Captured automatically:** ${new Date(this.now()).toISOString()}`,
      createdAt: new Date(this.now()).toISOString(),
      occurrences: Math.max(1, Number(supplied.occurrences) || 1)
    };
  }

  enqueue(item, reason = 'awaiting-batch') {
    const queue = [...this.state.queue];
    const existing = queue.find((queued) => queued.id === item.id);
    if (existing) {
      existing.occurrences = Math.min(9999, Number(existing.occurrences || 1) + Number(item.occurrences || 1));
      existing.createdAt = item.createdAt;
      existing.body = item.body;
      existing.title = item.title;
      existing.source = item.source;
      existing.reason = reason;
    } else {
      queue.push({ ...item, reason });
    }
    this.updateState({
      queue: queue.slice(-MAX_QUEUED_ERRORS),
      status: reason === 'missing-token' ? 'waiting-for-token' : 'queued',
      lastError: reason === 'awaiting-batch' ? null : reason
    });
    const log = reason === 'awaiting-batch' ? this.logger.info?.bind(this.logger) : this.logger.warn?.bind(this.logger);
    log?.('Application Monitor retained an error for the next batch.', { errorId: item.id, reason });
    return { queued: true, errorId: item.id, reason };
  }

  captureRetainedErrors(entries = [], { source = 'renderer-action' } = {}) {
    const config = this.getConfig();
    if (!config.autoReportEnabled) return { skipped: true, reason: 'disabled' };
    const queue = [...this.state.queue];
    const sourceOccurrences = { ...(this.state.sourceOccurrences || {}) };
    let captured = 0;

    for (const entry of Array.isArray(entries) ? entries : []) {
      if (isExpectedAccessDenial(entry)) continue;
      const key = `${source}:${entry.id || ''}:${entry.channel || ''}:${entry.view || ''}`;
      const total = Math.max(1, Number(entry.occurrences) || 1);
      const previous = Math.max(0, Number(sourceOccurrences[key]) || 0);
      const delta = total - previous;
      if (delta <= 0) continue;
      const message = `${entry.operation || entry.channel || 'UI action'} failed on ${entry.view || 'unknown'}: ${entry.message || 'Unknown error'}`;
      const item = {
        id: entry.id || errorFingerprint(`${key}:${message}`),
        source,
        title: `[UI ${entry.id || 'error'}] ${message}`.slice(0, 180),
        body: [
          `## Retained UI action error ${entry.id || ''}`,
          '',
          `- **View:** ${entry.view || 'unknown'}`,
          `- **IPC channel:** ${entry.channel || 'unknown'}`,
          `- **Action:** ${entry.operation || 'unknown'}`,
          `- **Element:** ${entry.elementTag || 'unknown'}#${entry.elementId || 'none'} ${entry.elementText || ''}`.trim(),
          `- **First seen:** ${entry.time || 'unknown'}`,
          `- **Last seen:** ${entry.lastSeenAt || entry.time || 'unknown'}`,
          `- **New occurrences in this batch:** ${delta}`,
          '',
          String(entry.message || 'Unknown UI error'),
          '',
          '```text',
          String(entry.stack || 'No renderer stack was supplied.').slice(0, 12000),
          '```'
        ].join('\n'),
        createdAt: entry.lastSeenAt || entry.time || new Date(this.now()).toISOString(),
        occurrences: delta,
        reason: 'awaiting-batch'
      };
      const existing = queue.find((queued) => queued.id === item.id);
      if (existing) {
        existing.occurrences = Math.min(9999, Number(existing.occurrences || 1) + delta);
        existing.createdAt = item.createdAt;
        existing.body = item.body;
        existing.title = item.title;
      } else queue.push(item);
      sourceOccurrences[key] = total;
      captured += delta;
    }

    const occurrenceEntries = Object.entries(sourceOccurrences).slice(-500);
    this.updateState({
      queue: queue.slice(-MAX_QUEUED_ERRORS),
      sourceOccurrences: Object.fromEntries(occurrenceEntries),
      status: queue.length ? 'queued' : this.state.status
    });
    return { captured, queueDepth: Math.min(queue.length, MAX_QUEUED_ERRORS) };
  }

  async capture(errorLike, { source = 'application', force = false } = {}) {
    if (isExpectedAccessDenial(errorLike)) return { skipped: true, reason: 'expected-access-denial' };
    const config = this.getConfig();
    if (!force && !config.autoReportEnabled) return { skipped: true, reason: 'disabled' };
    const item = this.createItem(errorLike, source);
    if (!force) return this.enqueue(item, 'awaiting-batch');
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
        body: JSON.stringify({ body: `## Additional error batch\n\n${item.body}` })
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

  buildBatchChunks(pending, trigger) {
    const batchTime = new Date(this.now()).toISOString();
    const sections = pending.map((item, index) => {
      const heading = `## ${index + 1}. ${item.title}\n\n- **Source:** ${item.source || 'application'}\n- **Captured:** ${item.createdAt}\n- **Occurrences:** ${item.occurrences || 1}\n\n`;
      return { item, text: `${heading}${String(item.body || '').slice(0, 12000)}\n` };
    });
    const chunks = [];
    let current = [];
    let currentLength = 0;
    for (const section of sections) {
      if (current.length && currentLength + section.text.length > MAX_BATCH_BODY_LENGTH) {
        chunks.push(current);
        current = [];
        currentLength = 0;
      }
      current.push(section);
      currentLength += section.text.length;
    }
    if (current.length) chunks.push(current);

    return chunks.map((chunk, index) => {
      const totalOccurrences = chunk.reduce((sum, section) => sum + Math.max(1, Number(section.item.occurrences) || 1), 0);
      const body = [
        '# Khaos Nexus automatic error batch',
        '',
        `- **Batch time:** ${batchTime}`,
        `- **Trigger:** ${trigger}`,
        `- **Chunk:** ${index + 1} of ${chunks.length}`,
        `- **Unique errors:** ${chunk.length}`,
        `- **Total occurrences:** ${totalOccurrences}`,
        `- **Schedule:** first scan five minutes after startup, then every thirty minutes while Khaos Nexus remains open`,
        '',
        ...chunk.map((section) => section.text)
      ].join('\n').slice(0, 65000);
      return {
        items: chunk.map((section) => section.item),
        report: {
          id: errorFingerprint(`automatic-error-batch:${todayUtc(this.now())}`),
          source: 'automatic-error-batch',
          title: `[Auto Error Batch ${todayUtc(this.now())}] Khaos Nexus retained errors`,
          body,
          createdAt: batchTime,
          occurrences: totalOccurrences
        }
      };
    });
  }

  removeDeliveredItems(items) {
    const delivered = new Set(items.map(queueKey));
    this.state.queue = this.state.queue.filter((item) => !delivered.has(queueKey(item)));
  }

  async processAutomaticBatch({ trigger = 'scheduled', force = false } = {}) {
    if (this.batchProcessing || this.processing) return { skipped: true, reason: 'already-processing' };
    const config = this.getConfig();
    if (!force && !config.autoReportEnabled) return { skipped: true, reason: 'disabled' };
    if (!this.state.queue.length) {
      this.updateState({ status: 'ready', lastError: null, lastBatchCount: 0 });
      return { delivered: 0, remaining: 0, errors: 0 };
    }
    if (!this.configStore.getGithubToken()) {
      this.updateState({ status: 'waiting-for-token', lastError: 'missing-token' });
      return { delivered: 0, remaining: this.state.queue.length, reason: 'missing-token' };
    }

    this.batchProcessing = true;
    let delivered = 0;
    let errorCount = 0;
    try {
      const pending = [...this.state.queue];
      const chunks = this.buildBatchChunks(pending, trigger);
      for (const chunk of chunks) {
        try {
          await this.deliver(chunk.report, config);
          delivered += 1;
          errorCount += chunk.items.length;
          this.removeDeliveredItems(chunk.items);
          this.updateState({ queue: [...this.state.queue], status: this.state.queue.length ? 'queued' : 'ready', lastError: null });
        } catch (error) {
          const message = redactText(error.message);
          this.logger.error('Application Monitor could not upload an automatic error batch.', { trigger, message });
          this.updateState({ status: 'queued', lastError: message });
          break;
        }
      }
      return { delivered, remaining: this.state.queue.length, errors: errorCount };
    } finally {
      this.batchProcessing = false;
    }
  }

  async processQueue() {
    return this.processAutomaticBatch({ trigger: 'manual-queue-processing', force: true });
  }

  scheduleAutomaticBatches() {
    const firstAt = this.now() + STARTUP_BATCH_DELAY_MS;
    this.state.nextBatchAt = new Date(firstAt).toISOString();
    this.saveState();
    this.startupBatchTimer = this.setTimeoutFactory(async () => {
      this.startupBatchTimer = null;
      await this.runBatchCycle('five-minute-startup-batch');
      this.startRecurringBatchTimer();
    }, STARTUP_BATCH_DELAY_MS);
    this.startupBatchTimer?.unref?.();
  }

  startRecurringBatchTimer() {
    if (this.batchTimer) return;
    this.state.nextBatchAt = new Date(this.now() + ERROR_BATCH_INTERVAL_MS).toISOString();
    this.saveState();
    this.emit('state', this.publicState());
    this.batchTimer = this.setIntervalFactory(() => {
      this.runBatchCycle('thirty-minute-maintenance-scan').catch((error) => {
        this.logger.error('Application Monitor scheduled error batch failed.', { message: redactText(error.message) });
      });
    }, ERROR_BATCH_INTERVAL_MS);
    this.batchTimer?.unref?.();
  }

  async runBatchCycle(trigger) {
    const result = await this.processAutomaticBatch({ trigger });
    const completedAt = new Date(this.now()).toISOString();
    this.updateState({
      lastBatchAt: completedAt,
      nextBatchAt: new Date(this.now() + ERROR_BATCH_INTERVAL_MS).toISOString(),
      lastBatchCount: Number(result?.errors || 0),
      batchRuns: Number(this.state.batchRuns || 0) + 1
    });
    return result;
  }

  clearQueue() {
    this.updateState({ queue: [], status: 'ready', lastError: null });
    return this.getState();
  }

  destroy() {
    if (this.startupBatchTimer) this.clearTimeoutFactory(this.startupBatchTimer);
    if (this.batchTimer) this.clearIntervalFactory(this.batchTimer);
    this.startupBatchTimer = null;
    this.batchTimer = null;
  }
}

module.exports = {
  ApplicationMonitor,
  normalizeRepository,
  DEFAULT_STATE,
  STARTUP_BATCH_DELAY_MS,
  ERROR_BATCH_INTERVAL_MS,
  MAX_QUEUED_ERRORS
};
