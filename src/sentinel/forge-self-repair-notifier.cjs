'use strict';

const { envBoolean, severityForIncident } = require('./forge-self-repair-policy.cjs');

function notifierConfiguration(env = process.env) {
  return {
    enabled: envBoolean(env.NEXUS_FORGE_SELF_REPAIR_ALERTS_ENABLED, false),
    channelId: String(env.NEXUS_FORGE_SELF_REPAIR_ALERT_CHANNEL_ID || '').trim(),
    notifyResolved: envBoolean(env.NEXUS_FORGE_SELF_REPAIR_ALERT_RESOLVED, true)
  };
}

function safeText(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function incidentAlertText(event, incident = {}) {
  const resolved = event === 'resolved';
  const icon = resolved ? '✅' : '🚨';
  const severity = severityForIncident(incident.type).toUpperCase();
  const candidate = incident.repairCandidate || {};
  const lines = [
    `${icon} **Nexus Self-Repair ${resolved ? 'Resolved' : 'Incident'}**`,
    `Severity: **${severity}**`,
    `Type: **${safeText(incident.type || 'unknown', 80)}**`,
    `Incident: \`${safeText(incident.id || 'unknown', 40)}\``
  ];
  if (!resolved) {
    lines.push(`Prepared action: **${safeText(candidate.action || 'hold', 20)}**`);
    if (incident.evidence?.ref) lines.push(`Ref: \`${safeText(incident.evidence.ref, 180)}\``);
    lines.push('_Observation only — no AI task, merge, deployment, or restart was triggered._');
  }
  return lines.join('\n').slice(0, 1800);
}

class ForgeSelfRepairNotifier {
  constructor(options = {}) {
    this.config = options.config || notifierConfiguration(options.env || process.env);
    this.logger = options.logger || console;
  }

  configuration() {
    return {
      enabled: Boolean(this.config.enabled),
      channelConfigured: Boolean(this.config.channelId),
      notifyResolved: Boolean(this.config.notifyResolved)
    };
  }

  async notify(client, event, incident) {
    if (!this.config.enabled || !this.config.channelId) return { ok: true, skipped: true, reason: 'disabled-or-unconfigured' };
    if (event === 'resolved' && !this.config.notifyResolved) return { ok: true, skipped: true, reason: 'resolved-disabled' };
    try {
      const channel = await client.channels.fetch(this.config.channelId);
      if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
        return { ok: false, skipped: true, reason: 'channel-not-text-based' };
      }
      await channel.send({ content: incidentAlertText(event, incident), allowedMentions: { parse: [] } });
      return { ok: true, skipped: false };
    } catch (error) {
      this.logger.warn?.(`[Nexus Sentinal] Self-Repair alert failed: ${safeText(error?.message || error, 300)}`);
      return { ok: false, skipped: false, error: safeText(error?.message || error, 300) };
    }
  }
}

module.exports = {
  notifierConfiguration,
  safeText,
  incidentAlertText,
  ForgeSelfRepairNotifier
};
