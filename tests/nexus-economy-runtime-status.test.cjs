'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inspectNexusEconomyRuntimeStatus
} = require('../src/sentinel/nexus-economy-runtime-status.cjs');

function readyRows() {
  return [
    { relname: 'nexus_economy_accounts', relkind: 'r' },
    { relname: 'nexus_economy_ledger', relkind: 'r' },
    { relname: 'nexus_economy_audit', relkind: 'r' }
  ];
}

test('off mode is fully inert and does not query Postgres', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; return { rows: readyRows() }; } };

  const status = await inspectNexusEconomyRuntimeStatus({ pool, env: {} });

  assert.equal(queries, 0);
  assert.equal(status.mode, 'off');
  assert.equal(status.databaseChecked, false);
  assert.equal(status.ready, false);
  assert.equal(status.mutationAllowed, false);
  assert.equal(status.activation.reason, 'runtime-mode-off');
});

test('shadow mode performs only the readiness query and never permits mutation', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; return { rows: readyRows() }; } };

  const status = await inspectNexusEconomyRuntimeStatus({
    pool,
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' }
  });

  assert.equal(queries, 1);
  assert.equal(status.databaseChecked, true);
  assert.equal(status.ready, true);
  assert.equal(status.mutationAllowed, false);
  assert.equal(status.activation.reason, 'shadow-ready');
  assert.equal(status.readiness.mutationPerformed, false);
});

test('active mode remains fail-closed unless explicit authority and enablement agree', async () => {
  const pool = { query: async () => ({ rows: readyRows() }) };

  const status = await inspectNexusEconomyRuntimeStatus({
    pool,
    env: {
      NEXUS_ECONOMY_RUNTIME_MODE: 'active',
      NEXUS_ECONOMY_AUTHORITY: 'nexus'
    }
  });

  assert.equal(status.ready, false);
  assert.equal(status.mutationAllowed, false);
  assert.equal(status.activation.reason, 'runtime-enable-flag-required');
});

test('database probe failure becomes a sanitized fail-closed status', async () => {
  const pool = { query: async () => { throw new Error('postgres://secret-host/internal'); } };

  const status = await inspectNexusEconomyRuntimeStatus({
    pool,
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' }
  });

  assert.equal(status.ready, false);
  assert.equal(status.mutationAllowed, false);
  assert.equal(status.readiness.databaseReady, false);
  assert.equal(status.readiness.probeFailed, true);
  assert.equal(status.activation.reason, 'economy-not-ready');
  assert.equal(JSON.stringify(status).includes('secret-host'), false);
});

test('invalid runtime mode fails before any database query', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; return { rows: readyRows() }; } };

  await assert.rejects(
    inspectNexusEconomyRuntimeStatus({
      pool,
      env: { NEXUS_ECONOMY_RUNTIME_MODE: 'live-ish' }
    }),
    /unsupported nexus economy runtime mode/i
  );

  assert.equal(queries, 0);
});

test('unsafe schema cannot cause database access or activation', async () => {
  let queries = 0;
  const pool = { query: async () => { queries += 1; return { rows: readyRows() }; } };

  const status = await inspectNexusEconomyRuntimeStatus({
    pool,
    schema: 'public; DROP TABLE sentinel_jobs;',
    env: { NEXUS_ECONOMY_RUNTIME_MODE: 'shadow' }
  });

  assert.equal(queries, 0);
  assert.equal(status.ready, false);
  assert.equal(status.mutationAllowed, false);
  assert.equal(status.readiness.probeFailed, true);
  assert.equal(status.activation.reason, 'economy-not-ready');
});
