'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { redactObject, redactText } = require('../shared/redaction.cjs');

const STATE_FORMAT = 1;
const UNHEALTHY_REPEAT_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_TEXT = 6000;
const PUBLIC_DETAIL_KEYS = new Set([
  'exists', 'size', 'freeMb', 'totalMb', 'count', 'visibleCount', 'focusedCount',
  'unresponsiveCount', 'packaged', 'installMode', 'status', 'reason'
]);

function safeJsonRead(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function atomicJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(temporary, filePath); }
  catch { fs.rmSync(filePath, { force: true }); fs.renameSync(temporary, filePath); }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function strictRedactText(value) {
  return redactText(String(value ?? ''))
    .replace(/(authorization\s*:\s*)(?:bearer\s+)?[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+\/-]{8,}/gi, '$1 [REDACTED]')
    .replace(/\b(password|passwd|token|secret|api[_ -]?key|client[_ -]?secret)\s*[:=]\s*[^\s\r\n]+/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, 'https://[REDACTED]@');
}

function publicCheckDetail(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const redacted = redactObject(detail);
  return Object.fromEntries(Object.entries(redacted).filter(([key, value]) => {
    if (!PUBLIC_DETAIL_KEYS.has(key)) return false;
    return ['string', 'number', 'boolean'].includes(typeof value) || value === null;
  }));
}

function runtimeIdentity(report = {}) {
  return String(report.trigger?.detail?.diagnosticsRuntime || report.application?.diagnosticsRuntime || 'embedded').slice(0, 80);
}

function healthSignature(report = {}) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const payload = checks.map((check) => ({
    id: String(check.id || ''),
    status: String(check.status || ''),
    summary: strictRedactText(check.summary || '').slice(0, 300)
  }));
  return sha256(JSON.stringify(payload)).slice(0, 16);
}

function reportIdentity(report = {}) {
  return `${String(report.application?.version || 'unknown')}:${runtimeIdentity(report)}:${healthSignature(report)}`;
}

function severity(report = {}) {
  const failed = Math.max(0, Number(report.summary?.failed || 0));
  const warnings = Math.max(0, Number(report.summary?.warnings || 0));
  if (failed > 0) return 'failed';
  if (warnings > 0) return 'warning';
  return 'healthy';
}

function deliveryPolicy(report, state = {}, now = Date.now()) {
  const status = severity(report);
  const identity = reportIdentity(report);
  const versionIdentity = `${String(report.application?.version || 'unknown')}:${runtimeIdentity(report)}`;

  if (status === 'healthy') {
    if (state.lastHealthyVersionIdentity === versionIdentity) {
      return { send: false, reason: 'healthy-version-already-reported', status, identity, versionIdentity };
    }
    return { send: true, reason: 'first-healthy-report-for-version', status, identity, versionIdentity };
  }

  const lastAt = Date.parse(state.lastUnhealthyAt || '') || 0;
  if (state.lastUnhealthyIdentity === identity && now - lastAt < UNHEALTHY_REPEAT_MS) {
    return { send: false, reason: 'unchanged-unhealthy-report-throttled', status, identity, versionIdentity };
  }
  return { send: true, reason: 'unhealthy-or-changed-health', status, identity, versionIdentity };
}

function checkLines(report = {}) {
  return (Array.isArray(report.checks) ? report.checks : []).map((check) => {
    const detail = publicCheckDetail(check.detail);
    const suffix = Object.keys(detail).length
      ? ` — \`${strictRedactText(JSON.stringify(detail)).slice(0, 800)}\``
      : '';
    return `- **${String(check.status || 'info').toUpperCase()} — ${strictRedactText(check.id || 'check')}**: ${strictRedactText(check.summary || '')}${suffix}`;
  });
}

function diagnosticMarkdown(report = {}) {
  const system = redactObject(report.system || {});
  const processState = redactObject(report.process || {});
  const logs = strictRedactText(report.evidence?.recentLogs || '').slice(0, MAX_LOG_TEXT);
  const snapshot = strictRedactText(JSON.stringify({ system, process: processState }, null, 2)).slice(0, 8000);
  const lines = [
    '# Khaos Nexus automatic startup diagnostics',
    '',
    `- **Report ID:** ${strictRedactText(report.reportId || 'unknown')}`,
    `- **Created:** ${strictRedactText(report.createdAt || 'unknown')}`,
    `- **Application:** ${strictRedactText(report.application?.version || 'unknown')}`,
    `- **Diagnostics runtime:** ${strictRedactText(runtimeIdentity(report))}`,
    `- **Install mode:** ${strictRedactText(report.application?.installMode || 'unknown')}`,
    `- **Health:** ${severity(report)}`,
    `- **Summary:** ${Number(report.summary?.passed || 0)} passed, ${Number(report.summary?.warnings || 0)} warning(s), ${Number(report.summary?.failed || 0)} failed`,
    '',
    '## Checks',
    '',
    ...checkLines(report),
    '',
    '## Redacted runtime snapshot',
    '',
    '```json',
    snapshot,
    '```'
  ];
  if (logs) {
    lines.push('', '## Recent redacted application logs', '', '```text', logs, '```');
  }
  lines.push(
    '',
    '> Generated automatically by the in-app Diagnostics runtime. Known credential formats are redacted locally and `secrets.bin` is never copied.',
    '',
    `**Health signature:** \`${healthSignature(report)}\``
  );
  return lines.join('\n').slice(0, 54000);
}

function preparedItem(report = {}) {
  const status = severity(report);
  const id = `startup-diagnostics-${sha256(reportIdentity(report)).slice(0, 16)}`;
  const summary = `${Number(report.summary?.failed || 0)} failed, ${Number(report.summary?.warnings || 0)} warning(s)`;
  return {
    id,
    source: 'startup-diagnostics',
    title: `[Startup Diagnostics ${String(report.application?.version || 'unknown')}] ${status} — ${summary}`.slice(0, 180),
    body: diagnosticMarkdown(report),
    createdAt: String(report.createdAt || new Date().toISOString()),
    occurrences: 1
  };
}

class DiagnosticGithubBridge {
  constructor({ applicationMonitor, dataDirectory, logger = console, now = () => Date.now() }) {
    this.applicationMonitor = applicationMonitor;
    this.logger = logger;
    this.now = now;
    this.statePath = path.join(dataDirectory, 'diagnostics', 'github-startup-state.json');
  }

  state() {
    return { formatVersion: STATE_FORMAT, ...(safeJsonRead(this.statePath, {}) || {}) };
  }

  saveDelivery(report, policy, result) {
    const current = this.state();
    const next = {
      ...current,
      formatVersion: STATE_FORMAT,
      lastAttemptAt: new Date(this.now()).toISOString(),
      lastResult: redactObject(result)
    };
    if (policy.status === 'healthy') {
      next.lastHealthyVersionIdentity = policy.versionIdentity;
      next.lastHealthyIdentity = policy.identity;
      next.lastHealthyAt = next.lastAttemptAt;
    } else {
      next.lastUnhealthyIdentity = policy.identity;
      next.lastUnhealthyAt = next.lastAttemptAt;
    }
    atomicJsonWrite(this.statePath, next);
  }

  async submit(report) {
    if (!report || report.skipped) return { skipped: true, reason: 'no-report' };
    if (!this.applicationMonitor || typeof this.applicationMonitor.capturePrepared !== 'function') {
      return { skipped: true, reason: 'application-monitor-unavailable' };
    }
    const monitorState = this.applicationMonitor.getState?.() || {};
    if (!monitorState.enabled) return { skipped: true, reason: 'application-monitor-disabled' };

    const policy = deliveryPolicy(report, this.state(), this.now());
    if (!policy.send) return { skipped: true, reason: policy.reason, policy };

    const result = await this.applicationMonitor.capturePrepared(preparedItem(report), {
      immediate: true,
      trigger: 'automatic-startup-diagnostics'
    });
    if (result?.delivered) this.saveDelivery(report, policy, result);
    else this.logger?.warn?.('Startup diagnostics were retained for later GitHub delivery.', {
      reason: result?.reason || result?.error || 'queued',
      reportId: report.reportId
    });
    return { ...result, policy };
  }
}

module.exports = {
  DiagnosticGithubBridge,
  STATE_FORMAT,
  UNHEALTHY_REPEAT_MS,
  strictRedactText,
  publicCheckDetail,
  healthSignature,
  reportIdentity,
  severity,
  deliveryPolicy,
  diagnosticMarkdown,
  preparedItem,
  safeJsonRead,
  atomicJsonWrite
};
