'use strict';

let installed = false;

function normalizePreparedItem(item = {}) {
  const id = String(item.id || '').trim().slice(0, 120);
  const title = String(item.title || '').trim().slice(0, 180);
  const body = String(item.body || '').trim().slice(0, 65000);
  if (!id) throw new Error('Prepared Application Monitor reports require an ID.');
  if (!title) throw new Error('Prepared Application Monitor reports require a title.');
  if (!body) throw new Error('Prepared Application Monitor reports require a body.');
  return {
    id,
    source: String(item.source || 'prepared-report').slice(0, 120),
    title,
    body,
    createdAt: String(item.createdAt || new Date().toISOString()).slice(0, 80),
    occurrences: Math.max(1, Math.min(9999, Number(item.occurrences) || 1))
  };
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/application-monitor.cjs');
  const Original = target.ApplicationMonitor;
  if (!Original || Original.__khaosDiagnosticGithubBridge) return;

  if (typeof Original.prototype.capturePrepared !== 'function') {
    Object.defineProperty(Original.prototype, 'capturePrepared', {
      configurable: true,
      value: async function capturePrepared(item, { immediate = false, trigger = 'prepared-report' } = {}) {
        const config = this.getConfig();
        if (!config.autoReportEnabled) return { skipped: true, reason: 'disabled' };
        const prepared = normalizePreparedItem(item);
        if (!immediate) return this.enqueue(prepared, 'awaiting-batch');
        if (!this.configStore.getGithubToken()) return this.enqueue(prepared, 'missing-token');
        if (!this.canSendToday(config)) return this.enqueue(prepared, 'daily-limit');
        try {
          const delivered = await this.deliver(prepared, config);
          return { ...delivered, trigger };
        } catch (error) {
          this.logger.error('Application Monitor could not deliver a prepared report.', {
            reportId: prepared.id,
            trigger,
            message: error.message
          });
          return this.enqueue(prepared, String(error.message || 'delivery-failed').slice(0, 500));
        }
      }
    });
  }

  class DiagnosticMonitorBridge extends Original {
    constructor(...args) {
      super(...args);
      try {
        require('./diagnostic-suite-extension.cjs').connectApplicationMonitor(this, args[0]?.logger);
      } catch (error) {
        args[0]?.logger?.warn?.('The startup diagnostics GitHub bridge could not connect.', { message: error.message });
      }
    }
  }
  Object.defineProperty(DiagnosticMonitorBridge, '__khaosDiagnosticGithubBridge', { value: true });
  target.ApplicationMonitor = DiagnosticMonitorBridge;
}

module.exports = { install, normalizePreparedItem };
