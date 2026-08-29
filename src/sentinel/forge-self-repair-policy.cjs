'use strict';

const POLICY_VERSION = 1;

const INCIDENT_SEVERITY = Object.freeze({
  'nexus-backend-unhealthy': 'critical',
  'sentinel-admin-degraded': 'critical',
  'forge-runtime-unavailable': 'high',
  'forge-auth-failure': 'high',
  'forge-ci-probe-failure': 'high',
  'ci-failure': 'high',
  'sentinel-runtime-memory-pressure': 'medium',
  'self-repair-state-store-degraded': 'high',
  'ark-rcon-unavailable': 'critical',
  'arkshop-database-unavailable': 'high',
  'ark-sftp-degraded': 'medium'
});

const ACTION_RISK = Object.freeze({
  hold: 'none',
  build: 'medium',
  repair: 'medium'
});

function envBoolean(value, fallback = false) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function safeIncidentId(value) {
  const id = String(value || '').trim().toUpperCase();
  return /^SRI-[A-F0-9]{16}$/.test(id) ? id : '';
}

function severityForIncident(type) {
  return INCIDENT_SEVERITY[String(type || '')] || 'medium';
}

function riskForCandidate(candidate = {}) {
  return ACTION_RISK[String(candidate.action || 'hold')] || 'high';
}

function normalizeSelfRepairPolicy(env = process.env) {
  return Object.freeze({
    version: POLICY_VERSION,
    executionMode: 'manual-confirmation-only',
    automaticPlanningAllowed: false,
    automaticExecutionAllowed: false,
    automaticMergeAllowed: false,
    automaticDeployAllowed: false,
    automaticRestartAllowed: false,
    requireStaffConfirmation: true,
    maxSnoozeMinutes: boundedInteger(env.NEXUS_FORGE_SELF_REPAIR_MAX_SNOOZE_MINUTES, 1440, 5, 10080),
    verificationPassesRequired: boundedInteger(env.NEXUS_FORGE_SELF_REPAIR_VERIFY_PASSES, 1, 1, 5),
    rssWarnMb: boundedInteger(env.NEXUS_FORGE_SELF_REPAIR_RSS_WARN_MB, 0, 0, 32768),
    alertsEnabled: envBoolean(env.NEXUS_FORGE_SELF_REPAIR_ALERTS_ENABLED, false),
    alertChannelConfigured: Boolean(String(env.NEXUS_FORGE_SELF_REPAIR_ALERT_CHANNEL_ID || '').trim())
  });
}

function incidentIsSnoozed(incident = {}, now = new Date()) {
  if (!incident.snoozedUntil) return false;
  const until = Date.parse(String(incident.snoozedUntil));
  return Number.isFinite(until) && until > now.getTime();
}

function evaluateIncidentPolicy(incident = {}, options = {}) {
  const policy = options.policy || normalizeSelfRepairPolicy(options.env || process.env);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const candidate = incident.repairCandidate || {};
  const severity = severityForIncident(incident.type);
  const risk = riskForCandidate(candidate);
  const blockers = [];

  if (String(incident.status || 'open') !== 'open') blockers.push('incident-resolved');
  if (incidentIsSnoozed(incident, now)) blockers.push('incident-snoozed');
  if (!candidate.prepared) blockers.push('candidate-not-prepared');
  if (!['build', 'repair'].includes(String(candidate.action || ''))) blockers.push('candidate-hold-only');
  if (candidate.requiresForgeRecovery) blockers.push('forge-recovery-required');

  return {
    policyVersion: policy.version,
    severity,
    risk,
    executionMode: policy.executionMode,
    mayPrepareManualHandoff: blockers.length === 0,
    mayRunZeroAiVerification: true,
    automaticPlanningAllowed: false,
    automaticExecutionAllowed: false,
    automaticMergeAllowed: false,
    automaticDeployAllowed: false,
    automaticRestartAllowed: false,
    requiresStaffConfirmation: true,
    blockers
  };
}

function clampSnoozeMinutes(value, policy = normalizeSelfRepairPolicy()) {
  return boundedInteger(value, 60, 5, policy.maxSnoozeMinutes);
}

function publicPolicyView(policy = normalizeSelfRepairPolicy()) {
  return {
    version: policy.version,
    executionMode: policy.executionMode,
    automaticPlanningAllowed: false,
    automaticExecutionAllowed: false,
    automaticMergeAllowed: false,
    automaticDeployAllowed: false,
    automaticRestartAllowed: false,
    requireStaffConfirmation: true,
    maxSnoozeMinutes: policy.maxSnoozeMinutes,
    verificationPassesRequired: policy.verificationPassesRequired,
    rssWarnMb: policy.rssWarnMb,
    alertsEnabled: policy.alertsEnabled,
    alertChannelConfigured: policy.alertChannelConfigured
  };
}

module.exports = {
  POLICY_VERSION,
  INCIDENT_SEVERITY,
  ACTION_RISK,
  envBoolean,
  boundedInteger,
  safeIncidentId,
  severityForIncident,
  riskForCandidate,
  normalizeSelfRepairPolicy,
  incidentIsSnoozed,
  evaluateIncidentPolicy,
  clampSnoozeMinutes,
  publicPolicyView
};
