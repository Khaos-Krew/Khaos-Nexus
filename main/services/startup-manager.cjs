'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const VALID_STATUSES = new Set(['starting', 'ready', 'degraded', 'failed']);

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function safeText(value, maxLength = 6000) {
  return String(value ?? '')
    .replace(/(token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, maxLength);
}

function timestampForFile(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

class StartupManager extends EventEmitter {
  constructor({ version = 'unknown', logDirectory = null, clock = () => new Date() } = {}) {
    super();
    this.clock = clock;
    this.logDirectory = logDirectory;
    this.logPath = null;
    this.state = {
      status: 'starting',
      stage: 'not-started',
      progress: 0,
      message: 'Preparing Khaos Nexus…',
      detail: '',
      version: String(version || 'unknown'),
      warnings: [],
      startedAt: this.clock().toISOString(),
      updatedAt: this.clock().toISOString(),
      logPath: null
    };
    this.initializeLog();
  }

  initializeLog() {
    if (!this.logDirectory) return;
    try {
      fs.mkdirSync(this.logDirectory, { recursive: true });
      this.logPath = path.join(this.logDirectory, `startup-${timestampForFile(this.clock())}.log`);
      this.state.logPath = this.logPath;
      this.writeLog('startup', 'Khaos Nexus startup began.');
    } catch {
      this.logPath = null;
      this.state.logPath = null;
    }
  }

  writeLog(stage, message, detail = '') {
    if (!this.logPath) return;
    const line = `[${this.clock().toISOString()}] [${safeText(stage, 80)}] ${safeText(message, 1000)}${detail ? ` | ${safeText(detail, 4000)}` : ''}\n`;
    try { fs.appendFileSync(this.logPath, line, 'utf8'); } catch {}
  }

  snapshot() {
    return {
      ...this.state,
      warnings: [...this.state.warnings]
    };
  }

  transition({ status, stage, progress, message, detail } = {}) {
    if (status && VALID_STATUSES.has(status)) this.state.status = status;
    if (stage) this.state.stage = safeText(stage, 80);
    if (progress !== undefined) this.state.progress = Math.max(this.state.progress, clampProgress(progress));
    if (message !== undefined) this.state.message = safeText(message, 1000);
    if (detail !== undefined) this.state.detail = safeText(detail, 6000);
    this.state.updatedAt = this.clock().toISOString();
    this.writeLog(this.state.stage, this.state.message, this.state.detail);
    this.emit('state', this.snapshot());
    return this.snapshot();
  }

  warn(message, detail = '') {
    const warning = {
      message: safeText(message, 1000),
      detail: safeText(detail, 3000),
      time: this.clock().toISOString()
    };
    this.state.warnings.push(warning);
    this.writeLog('warning', warning.message, warning.detail);
    this.emit('state', this.snapshot());
    return warning;
  }

  complete({ degraded = false, message, detail = '' } = {}) {
    return this.transition({
      status: degraded || this.state.warnings.length ? 'degraded' : 'ready',
      stage: degraded || this.state.warnings.length ? 'degraded' : 'ready',
      progress: 100,
      message: message || (degraded || this.state.warnings.length ? 'Khaos Nexus started with limited functionality.' : 'Khaos Nexus is ready.'),
      detail
    });
  }

  fail(error, stage = 'failed') {
    const normalized = error instanceof Error ? error : new Error(String(error || 'Unknown startup failure'));
    return this.transition({
      status: 'failed',
      stage,
      message: normalized.message || 'Khaos Nexus could not fully start.',
      detail: normalized.stack || normalized.message
    });
  }
}

module.exports = {
  StartupManager,
  clampProgress,
  safeText
};
