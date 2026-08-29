'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ForgeSelfRepairObserver,
  loadState
} = require('../src/sentinel/forge-self-repair-observer.cjs');
const { normalizeSelfRepairPolicy } = require('../src/sentinel/forge-self-repair-policy.cjs');

function tempFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-self-repair-controls-'));
  return {
    dir,
    stateFile: path.join(dir, 'state.json'),
    auditFile: path.join(dir, 'audit.ndjson')
  };
}

function response(payload, ok = true, status = ok ? 200 : 503) {
  return { ok, status, async json() { return payload; } };
}

function healthyFetch(url) {
  if (String(url).includes(':3210/health')) return Promise.resolve(response({ ok: true }));
  return Promise.resolve(response({ ok: true, state: 'ready', discordReady: true, backendReady: true }));
}

async function disabledArkDiagnostics() {
  return {
    enabled: false,
    ok: true,
    state: 'disabled'
  };
}

function controlledForge() {
  const calls = { health: 0, ci: 0, plan: 0, execute: 0 };
  let failing = true;
  return {
    calls,
    setFailing(value) { failing = Boolean(value); },
    configuration() {
      return {
        enabled: true,
        baseUrlConfigured: true,
        tokenConfigured: true,
        defaultRepo: 'Khaos-Krew/Khaos-Nexus',
        defaultBaseRef: 'rebuild/nexus-0.1'
      };
    },
    async health() {
      calls.health += 1;
      return { ok: true, version: '1.0.0' };
    },
    async ciStatus(ref) {
      calls.ci += 1;
      return failing
        ? {
            ref,
            sha: 'deadbeef00112233',
            state: 'failure',
            combinedStatus: 'failure',
            checkRuns: [{ name: 'tests', status: 'completed', conclusion: 'failure' }]
          }
        : {
            ref,
            sha: 'deadbeef00112233',
            state: 'success',
            combinedStatus: 'success',
            checkRuns: [{ name: 'tests', status: 'completed', conclusion: 'success' }]
          };
    },
    async plan() {
      calls.plan += 1;
      throw new Error('Self-Repair controls must never call plan');
    },
    async execute() {
      calls.execute += 1;
      throw new Error('Self-Repair controls must never call execute');
    }
  };
}

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 29, 0, 0, tick++));
}

function observerOptions(files, forge, extras = {}) {
  return {
    forge,
    fetchImpl: healthyFetch,
    stateFile: files.stateFile,
    auditFile: files.auditFile,
    now: clock(),
    enabled: true,
    env: {},
    arkDiagnostics: disabledArkDiagnostics,
    backendUrl: 'http://127.0.0.1:3210',
    adminHealthUrl: 'http://127.0.0.1:8080/health',
    logger: { log() {}, warn() {} },
    ...extras
  };
}

test('Self-Repair migrates V1 state without losing incident history', () => {
  const files = tempFiles();
  fs.writeFileSync(files.stateFile, JSON.stringify({
    version: 1,
    mode: 'observe',
    lastRunAt: '2026-08-29T00:00:00.000Z',
    openIncidentIds: ['SRI-0123456789ABCDEF'],
    incidents: [{
      id: 'SRI-0123456789ABCDEF',
      type: 'ci-failure',
      status: 'open',
      firstSeenAt: '2026-08-29T00:00:00.000Z',
      lastSeenAt: '2026-08-29T00:00:00.000Z',
      seenCount: 3,
      evidence: { ref: 'rebuild/nexus-0.1', sha: 'abc' },
      repairCandidate: { prepared: true, action: 'build', goal: 'repair CI', automaticExecutionAllowed: false }
    }]
  }));

  const state = loadState(files.stateFile);
  assert.equal(state.version, 2);
  assert.equal(state.incidents.length, 1);
  assert.equal(state.incidents[0].seenCount, 3);
  assert.equal(state.incidents[0].occurrenceCount, 1);
  assert.equal(state.incidents[0].severity, 'high');
  assert.equal(state.incidents[0].acknowledgedAt, null);
});

test('Self-Repair acknowledge, snooze, unsnooze, and manual handoff persist safely', async () => {
  const files = tempFiles();
  const forge = controlledForge();
  const observer = new ForgeSelfRepairObserver(observerOptions(files, forge, {
    policy: normalizeSelfRepairPolicy({ NEXUS_FORGE_SELF_REPAIR_MAX_SNOOZE_MINUTES: '120' })
  }));

  await observer.runOnce('failure');
  const incident = observer.status().openIncidents.find((item) => item.type === 'ci-failure');
  assert.ok(incident);

  const acknowledged = observer.acknowledgeIncident(incident.id, 'staff-1', 'Investigating CI failure');
  assert.equal(acknowledged.acknowledgedBy, 'staff-1');
  assert.equal(acknowledged.status, 'open');

  const snoozed = observer.snoozeIncident(incident.id, 999, 'staff-1');
  assert.equal(snoozed.minutes, 120);
  assert.ok(snoozed.until);
  const blocked = observer.prepareIncident(incident.id);
  assert.equal(blocked.handoff, null);
  assert.ok(blocked.decision.blockers.includes('incident-snoozed'));
  assert.equal(blocked.aiInvoked, false);

  observer.unsnoozeIncident(incident.id, 'staff-1');
  const prepared = observer.prepareIncident(incident.id);
  assert.equal(prepared.handoff.command, 'forge build');
  assert.match(prepared.handoff.goal, /smallest safe code or configuration repair/i);
  assert.equal(prepared.automaticExecutionAllowed, false);
  assert.equal(forge.calls.plan, 0);
  assert.equal(forge.calls.execute, 0);

  const reloaded = loadState(files.stateFile);
  const persisted = reloaded.incidents.find((item) => item.id === incident.id);
  assert.ok(persisted);
  assert.equal(persisted.acknowledgedBy, 'staff-1');
  assert.equal(persisted.snoozedUntil, null);

  const audit = fs.readFileSync(files.auditFile, 'utf8');
  assert.match(audit, /incident-acknowledged/);
  assert.match(audit, /incident-snoozed/);
  assert.match(audit, /incident-unsnoozed/);
});

test('Self-Repair verification resolves recovered condition without AI execution', async () => {
  const files = tempFiles();
  const forge = controlledForge();
  const observer = new ForgeSelfRepairObserver(observerOptions(files, forge, {
    policy: normalizeSelfRepairPolicy({ NEXUS_FORGE_SELF_REPAIR_VERIFY_PASSES: '1' })
  }));

  await observer.runOnce('failure');
  const incident = observer.status().openIncidents.find((item) => item.type === 'ci-failure');
  assert.ok(incident);
  const incidentId = incident.id;
  forge.setFailing(false);

  const verification = await observer.verifyIncident(incidentId, { actorId: 'staff-2' });
  assert.equal(verification.passed, true);
  assert.equal(verification.complete, true);
  assert.equal(verification.aiInvoked, false);
  assert.equal(verification.incident.status, 'resolved');
  assert.equal(verification.incident.verification.conditionCleared, true);
  assert.equal(forge.calls.plan, 0);
  assert.equal(forge.calls.execute, 0);
  assert.match(fs.readFileSync(files.auditFile, 'utf8'), /incident-verified/);
});

test('Self-Repair reopens a recurring incident and increments occurrence count', async () => {
  const files = tempFiles();
  const forge = controlledForge();
  const observer = new ForgeSelfRepairObserver(observerOptions(files, forge));

  await observer.runOnce('first-failure');
  forge.setFailing(false);
  await observer.runOnce('recovered');
  forge.setFailing(true);
  await observer.runOnce('second-failure');

  const incident = observer.status().openIncidents.find((item) => item.type === 'ci-failure');
  assert.ok(incident);
  assert.equal(incident.occurrenceCount, 2);
  assert.equal(incident.status, 'open');
  assert.ok(incident.reopenedAt);
});
