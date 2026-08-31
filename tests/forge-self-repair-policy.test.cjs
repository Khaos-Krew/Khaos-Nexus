'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  clampSnoozeMinutes,
  evaluateIncidentPolicy,
  normalizeSelfRepairPolicy,
  safeIncidentId,
  severityForIncident
} = require('../src/sentinel/forge-self-repair-policy.cjs');
const {
  collectLocalRuntimeDiagnostics,
  collectProcessDiagnostics,
  collectStateStoreDiagnostics
} = require('../src/sentinel/forge-self-repair-runtime.cjs');
const {
  incidentAlertText,
  notifierConfiguration
} = require('../src/sentinel/forge-self-repair-notifier.cjs');

test('Self-Repair policy hard-disables automatic planning, execution, merge, deploy, and restart', () => {
  const policy = normalizeSelfRepairPolicy({
    NEXUS_FORGE_SELF_REPAIR_ALERTS_ENABLED: 'true',
    NEXUS_FORGE_SELF_REPAIR_ALERT_CHANNEL_ID: '123',
    NEXUS_FORGE_SELF_REPAIR_MAX_SNOOZE_MINUTES: '240',
    NEXUS_FORGE_SELF_REPAIR_VERIFY_PASSES: '2'
  });
  assert.equal(policy.executionMode, 'manual-confirmation-only');
  assert.equal(policy.automaticPlanningAllowed, false);
  assert.equal(policy.automaticExecutionAllowed, false);
  assert.equal(policy.automaticMergeAllowed, false);
  assert.equal(policy.automaticDeployAllowed, false);
  assert.equal(policy.automaticRestartAllowed, false);
  assert.equal(policy.requireStaffConfirmation, true);
  assert.equal(policy.maxSnoozeMinutes, 240);
  assert.equal(policy.verificationPassesRequired, 2);
  assert.equal(policy.alertsEnabled, true);
});

test('Self-Repair policy blocks a snoozed incident from manual handoff but still permits zero-AI verification', () => {
  const now = new Date('2026-08-29T00:00:00.000Z');
  const incident = {
    status: 'open',
    type: 'ci-failure',
    snoozedUntil: '2026-08-29T01:00:00.000Z',
    repairCandidate: {
      prepared: true,
      action: 'build',
      automaticExecutionAllowed: false,
      requiresStaffConfirmation: true
    }
  };
  const decision = evaluateIncidentPolicy(incident, { now, policy: normalizeSelfRepairPolicy({}) });
  assert.equal(decision.mayPrepareManualHandoff, false);
  assert.equal(decision.mayRunZeroAiVerification, true);
  assert.ok(decision.blockers.includes('incident-snoozed'));
  assert.equal(decision.automaticExecutionAllowed, false);
});

test('Self-Repair incident ID validation and snooze clamps are bounded', () => {
  assert.equal(safeIncidentId('sri-0123456789abcdef'), 'SRI-0123456789ABCDEF');
  assert.equal(safeIncidentId('bad-id'), '');
  const policy = normalizeSelfRepairPolicy({ NEXUS_FORGE_SELF_REPAIR_MAX_SNOOZE_MINUTES: '120' });
  assert.equal(clampSnoozeMinutes(1, policy), 5);
  assert.equal(clampSnoozeMinutes(999, policy), 120);
  assert.equal(severityForIncident('nexus-backend-unhealthy'), 'critical');
});

test('Self-Repair local runtime diagnostics expose bounded non-secret process and state-store health', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-self-repair-runtime-'));
  const stateFile = path.join(dir, 'state.json');
  const persistence = collectStateStoreDiagnostics(stateFile);
  assert.equal(persistence.ok, true);
  assert.equal(persistence.state, 'writable');

  const processState = collectProcessDiagnostics({ policy: normalizeSelfRepairPolicy({ NEXUS_FORGE_SELF_REPAIR_RSS_WARN_MB: '0' }) });
  assert.equal(processState.ok, true);
  assert.ok(processState.uptimeSeconds >= 0);
  assert.ok(processState.memory.rssMb > 0);
  assert.equal(processState.memory.rssWarnMb, 0);

  const combined = collectLocalRuntimeDiagnostics({ stateFile, policy: normalizeSelfRepairPolicy({}) });
  assert.equal(combined.ok, true);
  assert.equal(combined.persistence.ok, true);
});

test('Self-Repair optional Discord notifier is disabled by default and produces secret-free bounded text', () => {
  const config = notifierConfiguration({});
  assert.equal(config.enabled, false);
  assert.equal(config.channelId, '');

  const text = incidentAlertText('opened', {
    id: 'SRI-0123456789ABCDEF',
    type: 'ci-failure',
    repairCandidate: { action: 'build' },
    evidence: { ref: 'rebuild/nexus-0.1' }
  });
  assert.match(text, /Observation only/);
  assert.match(text, /SRI-0123456789ABCDEF/);
  assert.ok(text.length < 1801);
});
