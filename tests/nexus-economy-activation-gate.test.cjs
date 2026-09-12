'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateNexusEconomyActivation
} = require('../src/sentinel/nexus-economy-activation-gate.cjs');

const ready = Object.freeze({ ready: true, mutationPerformed: false });

test('economy activation defaults to off and denies mutation', () => {
  const result = evaluateNexusEconomyActivation({ readiness: ready, env: {} });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'runtime-mode-off');
  assert.equal(result.mutationAllowed, false);
});

test('shadow mode requires durable readiness and Nexus authority but never permits mutation', () => {
  const env = {
    NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
    NEXUS_ECONOMY_AUTHORITY: 'nexus'
  };
  const blocked = evaluateNexusEconomyActivation({ readiness: { ready: false }, env });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'economy-not-ready');

  const result = evaluateNexusEconomyActivation({ readiness: ready, env });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'shadow-ready');
  assert.equal(result.mutationAllowed, false);
});

test('compatibility authority cannot activate rebuilt economy runtime', () => {
  const result = evaluateNexusEconomyActivation({
    readiness: ready,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'active',
      NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
      NEXUS_ECONOMY_AUTHORITY: 'compatibility',
      NEXUS_ARKSHOP_LEGACY_MAINTENANCE_ENABLED: 'true'
    }
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'nexus-authority-required');
  assert.equal(result.mutationAllowed, false);
});

test('active mode fails closed without a separate explicit enable flag', () => {
  const result = evaluateNexusEconomyActivation({
    readiness: ready,
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'active', NEXUS_ECONOMY_AUTHORITY: 'nexus' }
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'runtime-enable-flag-required');
  assert.equal(result.mutationAllowed, false);
});

test('active mode permits runtime mutation only when readiness, Nexus authority, and enable flag agree', () => {
  const result = evaluateNexusEconomyActivation({
    readiness: ready,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'active',
      NEXUS_ECONOMY_RUNTIME_ENABLED: 'true',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'active-ready');
  assert.equal(result.mutationAllowed, true);
});

test('unsupported runtime modes are rejected rather than coerced', () => {
  assert.throws(
    () => evaluateNexusEconomyActivation({ readiness: ready, env: { NEXUS_ECONOMY_RUNTIME_MODE: 'live-ish' } }),
    /unsupported nexus economy runtime mode/i
  );
});
