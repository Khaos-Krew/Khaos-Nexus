'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isHealthyEconomyState,
  getNexusEconomyHealthIndicator
} = require('../src/sentinel/nexus-economy-health-indicator.cjs');

test('only degraded economy state is unhealthy', () => {
  assert.equal(isHealthyEconomyState('disabled'), true);
  assert.equal(isHealthyEconomyState('ready'), true);
  assert.equal(isHealthyEconomyState('active'), true);
  assert.equal(isHealthyEconomyState('degraded'), false);
});

test('off indicator is healthy and performs zero database queries', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; throw new Error('must not query'); } };

  const indicator = await getNexusEconomyHealthIndicator({
    pool,
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'off' }
  });

  assert.equal(queries, 0);
  assert.deepEqual(indicator, {
    component: 'nexus-economy',
    healthy: true,
    state: 'disabled',
    mode: 'off',
    ready: false,
    mutationAllowed: false,
    reason: 'runtime-mode-off'
  });
});

test('database failure produces sanitized unhealthy indicator', async () => {
  const pool = { query: async () => { throw new Error('postgres://user:password@private-host/db'); } };

  const indicator = await getNexusEconomyHealthIndicator({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  assert.equal(indicator.healthy, false);
  assert.equal(indicator.state, 'degraded');
  assert.equal(indicator.mutationAllowed, false);
  assert.equal(indicator.reason, 'economy-not-ready');
  const serialized = JSON.stringify(indicator);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('private-host'), false);
});

test('shadow-ready indicator remains non-mutating', async () => {
  const pool = {
    query: async () => ({
      rows: [
        { relation_name: 'nexus_economy_accounts' },
        { relation_name: 'nexus_economy_ledger' },
        { relation_name: 'nexus_economy_audit' }
      ]
    })
  };

  const indicator = await getNexusEconomyHealthIndicator({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'shadow',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  assert.equal(indicator.healthy, true);
  assert.equal(indicator.state, 'ready');
  assert.equal(indicator.ready, true);
  assert.equal(indicator.mutationAllowed, false);
  assert.equal(indicator.reason, 'shadow-ready');
});
