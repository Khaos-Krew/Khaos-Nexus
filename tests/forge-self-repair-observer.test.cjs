'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ForgeSelfRepairObserver,
  repairCandidateForIncident,
  stableIncidentId
} = require('../src/sentinel/forge-self-repair-observer.cjs');

function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-self-repair-'));
  return path.join(dir, 'state.json');
}

function response(payload, ok = true, status = ok ? 200 : 503) {
  return { ok, status, async json() { return payload; } };
}

function healthyFetch(url) {
  if (String(url).includes(':3210/health')) return Promise.resolve(response({ ok: true, version: '0.1.0' }));
  return Promise.resolve(response({ ok: true, state: 'ready', discordReady: true, backendReady: true }));
}

function forgeStub(overrides = {}) {
  const calls = { health: 0, ci: 0, plan: 0, execute: 0 };
  return {
    calls,
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
      return {
        ref,
        sha: 'abc123def456',
        state: 'success',
        combinedStatus: 'success',
        checkRuns: [{ name: 'tests', status: 'completed', conclusion: 'success' }]
      };
    },
    async plan() {
      calls.plan += 1;
      throw new Error('observer must never call plan');
    },
    async execute() {
      calls.execute += 1;
      throw new Error('observer must never call execute');
    },
    ...overrides
  };
}

function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 29, 0, 0, tick++));
}

test('Self-Repair observer healthy pass uses health and CI only, never AI task methods', async () => {
  const forge = forgeStub();
  const observer = new ForgeSelfRepairObserver({
    forge,
    fetchImpl: healthyFetch,
    stateFile: tempStateFile(),
    now: fixedClock(),
    enabled: true,
    logger: { log() {}, warn() {} }
  });

  const result = await observer.runOnce('test');
  assert.equal(result.ok, true);
  assert.equal(result.aiInvoked, false);
  assert.equal(result.openIncidents.length, 0);
  assert.equal(forge.calls.health, 1);
  assert.equal(forge.calls.ci, 1);
  assert.equal(forge.calls.plan, 0);
  assert.equal(forge.calls.execute, 0);
  assert.equal(observer.configuration().automaticExecutionAllowed, false);
  assert.equal(observer.configuration().aiInvocationPathPresent, false);
});

test('Self-Repair observer deduplicates the same failing CI incident', async () => {
  const forge = forgeStub();
  forge.ciStatus = async function ciStatus(ref) {
    this.calls.ci += 1;
    return {
      ref,
      sha: 'deadbeef00112233',
      state: 'failure',
      combinedStatus: 'failure',
      checkRuns: [
        { name: 'test', status: 'completed', conclusion: 'failure' },
        { name: 'lint', status: 'completed', conclusion: 'success' }
      ]
    };
  };
  const observer = new ForgeSelfRepairObserver({
    forge,
    fetchImpl: healthyFetch,
    stateFile: tempStateFile(),
    now: fixedClock(),
    enabled: true,
    logger: { log() {}, warn() {} }
  });

  const first = await observer.runOnce('test-1');
  const second = await observer.runOnce('test-2');
  assert.equal(first.opened.length, 1);
  assert.equal(second.opened.length, 0);
  assert.equal(observer.status().openIncidents.length, 1);
  assert.equal(observer.status().openIncidents[0].seenCount, 2);
  assert.equal(observer.status().openIncidents[0].type, 'ci-failure');
  assert.equal(observer.status().openIncidents[0].repairCandidate.action, 'build');
  assert.equal(observer.status().openIncidents[0].repairCandidate.aiInvoked, false);
  assert.equal(forge.calls.plan, 0);
  assert.equal(forge.calls.execute, 0);
});

test('Self-Repair observer resolves an incident after CI recovers', async () => {
  let failing = true;
  const forge = forgeStub();
  forge.ciStatus = async function ciStatus(ref) {
    this.calls.ci += 1;
    return failing
      ? {
          ref,
          sha: 'cafebabe9988',
          state: 'failure',
          combinedStatus: 'failure',
          checkRuns: [{ name: 'build', status: 'completed', conclusion: 'failure' }]
        }
      : {
          ref,
          sha: 'cafebabe9988',
          state: 'success',
          combinedStatus: 'success',
          checkRuns: [{ name: 'build', status: 'completed', conclusion: 'success' }]
        };
  };
  const observer = new ForgeSelfRepairObserver({
    forge,
    fetchImpl: healthyFetch,
    stateFile: tempStateFile(),
    now: fixedClock(),
    enabled: true,
    logger: { log() {}, warn() {} }
  });

  await observer.runOnce('failure');
  failing = false;
  const recovered = await observer.runOnce('recovered');
  assert.equal(recovered.resolved.length, 1);
  assert.equal(observer.status().openIncidents.length, 0);
  assert.equal(observer.status().recentIncidents[0].status, 'resolved');
  assert.ok(observer.status().lastHealthyAt);
});

test('Self-Repair observer classifies Forge authentication failure as hold-only', async () => {
  const forge = forgeStub();
  forge.ciStatus = async function ciStatus() {
    this.calls.ci += 1;
    const error = new Error('Forge request failed: invalid service token');
    error.code = 'FORGE_UNAUTHORIZED';
    throw error;
  };
  const observer = new ForgeSelfRepairObserver({
    forge,
    fetchImpl: healthyFetch,
    stateFile: tempStateFile(),
    now: fixedClock(),
    enabled: true,
    logger: { log() {}, warn() {} }
  });

  await observer.runOnce('auth-failure');
  const [incident] = observer.status().openIncidents;
  assert.equal(incident.type, 'forge-auth-failure');
  assert.equal(incident.repairCandidate.action, 'hold');
  assert.equal(incident.repairCandidate.requiresForgeRecovery, true);
  assert.equal(incident.repairCandidate.automaticExecutionAllowed, false);
  assert.equal(forge.calls.plan, 0);
  assert.equal(forge.calls.execute, 0);
});

test('Self-Repair observer records Nexus backend health failures independently of Forge', async () => {
  const forge = forgeStub();
  const fetchImpl = async (url) => {
    if (String(url).includes(':3210/health')) return response({ ok: false }, false, 503);
    return response({ ok: true, state: 'ready', discordReady: true, backendReady: true });
  };
  const observer = new ForgeSelfRepairObserver({
    forge,
    fetchImpl,
    stateFile: tempStateFile(),
    now: fixedClock(),
    enabled: true,
    logger: { log() {}, warn() {} }
  });

  await observer.runOnce('backend-down');
  const backend = observer.status().openIncidents.find((item) => item.type === 'nexus-backend-unhealthy');
  assert.ok(backend);
  assert.equal(backend.repairCandidate.action, 'build');
  assert.equal(backend.repairCandidate.aiInvoked, false);
});

test('repair candidate uses existing forge branch for branch repair and stable incident IDs', () => {
  const incident = {
    type: 'ci-failure',
    evidence: {
      ref: 'forge/example-fix',
      sha: '1234567890abcdef',
      failedChecks: [{ name: 'tests', status: 'completed', conclusion: 'failure' }]
    }
  };
  const candidate = repairCandidateForIncident(incident);
  assert.equal(candidate.action, 'repair');
  assert.equal(candidate.branch, 'forge/example-fix');
  assert.equal(candidate.aiInvoked, false);
  assert.equal(candidate.requiresStaffConfirmation, true);
  assert.equal(
    stableIncidentId('ci-failure', { ref: 'x', sha: 'y' }),
    stableIncidentId('ci-failure', { ref: 'x', sha: 'y' })
  );
});
