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

function runtimeSeverity(report = {}) {
  const checkStatus = severity(report);
  const triggerSeverity = String(report.trigger?.severity || 'info').toLowerCase();
  if (checkStatus === 'failed') return 'failed';
  if (triggerSeverity === 'fatal') return 'fatal';
  if (triggerSeverity === 'error') return 'error';
  if (checkStatus === 'warning' || triggerSeverity === 'warning') return 'warning';
  return 'healthy';
}

function inferStabilizationGate(report = {}) {
  const trigger = report.trigger || {};
  const detail = trigger.detail && typeof trigger.detail === 'object' ? trigger.detail : {};
  const text = [
    trigger.type,
    trigger.reason,
    trigger.error?.message,
    trigger.error?.code,
    detail.source,
    detail.channel,
    detail.view,
    detail.operation
  ].filter(Boolean).join(' ').toLowerCase();

  const gate = (number, label) => ({ number, label });
  if (/sidebar|navigation|\bnav\b|nexus-v8|desktop shell/.test(text)) return gate(2, 'Sidebar/navigation');
  if (/startup|loading|renderer-load-failed|render-process-gone|renderer-process-gone|window-unresponsive|renderer-unresponsive/.test(text)) return gate(1, 'Startup/loading');
  if (/(settings?|config(?:uration)?)\b/.test(text) && /persist|save|restore|reload|restart/.test(text)) return gate(3, 'Settings persistence');
  if (/discord/.test(text) && /(login|auth|oauth|bot|supervis|runtime|connect)/.test(text)) return gate(4, 'Discord login/bot supervision');
  if (/discord/.test(text) && /(status|control|panel)/.test(text)) return gate(5, 'Discord status/control panel');
  if (/palworld/.test(text) && /(config|setting|persist)/.test(text)) return gate(6, 'Palworld server configuration');
  if (/palworld/.test(text) && /(status|player|read|rest)/.test(text)) return gate(7, 'Palworld status/player reads');
  if (/palworld/.test(text) && /(command|action|save|broadcast|kick|ban|shutdown|restart|execute)/.test(text)) return gate(8, 'Palworld command/action execution');
  if (/scheduler|scheduled|schedule/.test(text)) return gate(9, 'Shared scheduler');
  if (/module/.test(text) && /(enable|disable|toggle|runtime)/.test(text)) return gate(10, 'Module enable/disable');
  if (/updater|update|release detection|download path|latest\.yml/.test(text)) return gate(11, 'Updater/manual release detection');
  if (/backup|restore/.test(text)) return gate(12, 'Backup/restore');
  return null;
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

function runtimeDiagnosticMarkdown(report = {}) {
  const gate = inferStabilizationGate(report);
  const trigger = report.trigger || {};
  const error = trigger.error || {};
  const logs = strictRedactText(report.evidence?.recentLogs || '').slice(0, MAX_LOG_TEXT);
  const lines = [
    '# Khaos Nexus owner-test live diagnostic',
    '',
    `- **Report ID:** ${strictRedactText(report.reportId || 'unknown')}`,
    `- **Session:** ${strictRedactText(report.session?.id || 'unknown')}`,
    `- **Created:** ${strictRedactText(report.createdAt || 'unknown')}`,
    `- **Application:** ${strictRedactText(report.application?.version || 'unknown')}`,
    `- **Type:** ${strictRedactText(trigger.type || 'runtime-diagnostic')}`,
    `- **Severity:** ${runtimeSeverity(report)}`,
    `- **Stabilization gate:** ${gate ? `Gate ${gate.number} — ${gate.label}` : 'Unclassified / cross-cutting'}`,
    `- **Reason:** ${strictRedactText(trigger.reason || 'No reason supplied.')}`,
    ''
  ];
  if (error.message || error.stack) {
    lines.push(
      '## Captured error',
      '',
      `**${strictRedactText(error.name || 'Error')}**: ${strictRedactText(error.message || trigger.reason || 'Unknown error')}`,
      '',
      '```text',
      strictRedactText(error.stack || '').slice(0, 16000),
      '```',
      ''
    );
  }
  lines.push('## System checks', '', ...checkLines(report));
  if (logs) lines.push('', '## Recent redacted application logs', '', '```text', logs, '```');
  lines.push(
    '',
    '> Captured during owner testing by the local Diagnostics runtime and delivered through the opt-in Application Monitor. Known credential formats are redacted locally and `secrets.bin` is never copied.'
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

function runtimePreparedItem(report = {}) {
  const gate = inferStabilizationGate(report);
  const trigger = report.trigger || {};
  const fingerprint = String(trigger.fingerprint || sha256(`${trigger.type || ''}:${trigger.reason || ''}`)).slice(0, 80);
  const gatePrefix = gate ? `Gate ${gate.number} ` : '';
  return {
    id: `owner-test-${fingerprint}`.slice(0, 120),
    source: 'owner-test-diagnostics',
    title: `[Owner Test ${gatePrefix}${String(report.application?.version || 'unknown')}] ${runtimeSeverity(report)} — ${strictRedactText(trigger.reason || trigger.type || 'runtime diagnostic')}`.slice(0, 180),
    body: runtimeDiagnosticMarkdown(report),
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

  monitorReady() {
    if (!this.applicationMonitor || typeof this.applicationMonitor.capturePrepared !== 'function') {
      return { ready: false, reason: 'application-monitor-unavailable' };
    }
    const monitorState = this.applicationMonitor.getState?.() || {};
    if (!monitorState.enabled) return { ready: false, reason: 'application-monitor-disabled' };
    return { ready: true, monitorState };
  }

  async submit(report) {
    if (!report || report.skipped) return { skipped: true, reason: 'no-report' };
    const availability = this.monitorReady();
    if (!availability.ready) return { skipped: true, reason: availability.reason };

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

  async submitRuntime(report, { trigger = 'owner-test-live-diagnostic' } = {}) {
    if (!report || report.skipped) return { skipped: true, reason: 'no-report' };
    if (runtimeSeverity(report) === 'healthy') return { skipped: true, reason: 'healthy-runtime-check' };
    const availability = this.monitorReady();
    if (!availability.ready) return { skipped: true, reason: availability.reason };

    const result = await this.applicationMonitor.capturePrepared(runtimePreparedItem(report), {
      immediate: true,
      trigger
    });
    if (!result?.delivered) {
      this.logger?.warn?.('Owner-test diagnostics were retained for later GitHub delivery.', {
        reason: result?.reason || result?.error || 'queued',
        reportId: report.reportId,
        stabilizationGate: inferStabilizationGate(report)?.number || null
      });
    }
    return result;
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
  runtimeSeverity,
  inferStabilizationGate,
  deliveryPolicy,
  diagnosticMarkdown,
  runtimeDiagnosticMarkdown,
  preparedItem,
  runtimePreparedItem,
  safeJsonRead,
  atomicJsonWrite
};
