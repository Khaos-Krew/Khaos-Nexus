'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateManualForgeSubmission } = require('../src/sentinel/forge-self-repair-execution-gate.cjs');
const { forgeCommand, selfRepairTaskFromPrepared } = require('../src/sentinel/forge-extension.cjs');

function preparedIncident(overrides = {}) {
  return {
    incident: {
      id: 'SRI-0123456789ABCDEF',
      type: 'ci-failure',
      status: 'open'
    },
    decision: {
      mayPrepareManualHandoff: true
    },
    handoff: {
      command: 'forge build',
      goal: 'Repair the failing CI with the smallest safe change.'
    },
    ...overrides
  };
}

const forgeConfig = {
  enabled: true,
  baseUrlConfigured: true,
  tokenConfigured: true
};

test('manual Self-Repair Forge submission is allowed only as interactive staff-confirmed handoff', () => {
  const gate = evaluateManualForgeSubmission(preparedIncident(), { forgeConfig, actorId: 'staff-1' });
  assert.equal(gate.allowed, true);
  assert.equal(gate.action, 'build');
  assert.equal(gate.requiresInteractiveConfirmation, true);
  assert.equal(gate.automaticSubmissionAllowed, false);
  assert.equal(gate.automaticExecutionAllowed, false);
  assert.equal(gate.automaticMergeAllowed, false);
  assert.equal(gate.automaticDeployAllowed, false);
  assert.equal(gate.automaticRestartAllowed, false);
});

test('manual Self-Repair Forge submission refuses policy-blocked, unresolved configuration, and invalid branch requests', () => {
  const blocked = evaluateManualForgeSubmission(preparedIncident({
    decision: { mayPrepareManualHandoff: false }
  }), { forgeConfig, actorId: 'staff-1' });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.includes('policy-blocked'));

  const missingToken = evaluateManualForgeSubmission(preparedIncident(), {
    forgeConfig: { ...forgeConfig, tokenConfigured: false },
    actorId: 'staff-1'
  });
  assert.equal(missingToken.allowed, false);
  assert.ok(missingToken.blockers.includes('forge-token-missing'));

  const invalidRepair = evaluateManualForgeSubmission(preparedIncident({
    handoff: { command: 'forge repair', branch: 'main', goal: 'repair' }
  }), { forgeConfig, actorId: 'staff-1' });
  assert.equal(invalidRepair.allowed, false);
  assert.ok(invalidRepair.blockers.includes('invalid-repair-branch'));
});

test('Forge helper converts an eligible prepared incident to a pending task without executing it', () => {
  const result = selfRepairTaskFromPrepared(preparedIncident(), forgeConfig, 'staff-2');
  assert.equal(result.gate.allowed, true);
  assert.equal(result.task.incidentId, 'SRI-0123456789ABCDEF');
  assert.equal(result.task.userId, 'staff-2');
  assert.equal(result.task.branch, null);
  assert.match(result.task.goal, /Repair the failing CI/);
  assert.ok(result.task.expiresAt > Date.now());
});

test('/forge command schema includes the incident handoff subcommand', () => {
  const json = forgeCommand().toJSON();
  const names = (json.options || []).map((item) => item.name);
  assert.ok(names.includes('incident'));
});
