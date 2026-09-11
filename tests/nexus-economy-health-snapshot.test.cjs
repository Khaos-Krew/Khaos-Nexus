'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HEALTH_STATES,
  deriveState,
  getNexusEconomyHealthSnapshot
} = require('../src/sentinel/nexus-economy-health-snapshot.cjs');

test('deriveState maps off to disabled', () => {
  assert.equal(deriveState({ mode: 'off' }), HEALTH_STATES.DISABLED);
});

test('deriveState maps mutation-enabled runtime to active', () => {
  assert.equal(deriveState({ mode: 'active', ready: true, mutationAllowed: true }), HEALTH_STATES.ACTIVE);
});

test('deriveState maps ready non-mutating runtime to ready', () => {
  assert.equal(deriveState({ mode: 'shadow', ready: true, mutationAllowed: false }), HEALTH_STATES.READY);
});

test('deriveState maps non-ready enabled runtime to degraded', () => {
  assert.equal(deriveState({ mode: 'shadow', ready: false, mutationAllowed: false }), HEALTH_STATES.DEGRADED);
});

test('off snapshot is inert and excludes database internals', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; throw new Error('must not query'); } };
  const snapshot = await getNexusEconomyHealthSnapshot({
    pool,
    schema: 'secret_schema_name',
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off' }
  });

  assert.equal(queries, 0);
  assert.deepEqual(snapshot, {
    component: 'nexus-economy',
    state: 'disabled',
    mode: 'off',
    databaseChecked: false,
    ready: false,
    mutationAllowed: false,
    reason: 'runtime-mode-off'
  });
  assert.equal(JSON.stringify(snapshot).includes('secret_schema_name'), false);
});

test('database failures remain sanitized in health output', async () => {
  const pool = { query: async () => { throw new Error('postgres://user:password@private-host/db'); } };
  const snapshot = await getNexusEconomyHealthSnapshot({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  assert.equal(snapshot.state, 'degraded');
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.mutationAllowed, false);
  assert.equal(snapshot.reason, 'economy-not-ready');
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('private-host'), false);
});

test('shadow-ready snapshot never reports mutations allowed', async () => {
  const pool = {
    query: async () => ({
      rows: [
        { relation_name: 'nexus_economy_accounts' },
        { relation_name: 'nexus_economy_ledger' },
        { relation_name: 'nexus_economy_audit' }
      ]
    })
  };

  const snapshot = await getNexusEconomyHealthSnapshot({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.mutationAllowed, false);
  assert.equal(snapshot.reason, 'shadow-ready');
});
