'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyMutationRuntime } = require('../src/sentinel/nexus-economy-runtime-composition.cjs');
const { NexusEconomyPostgresRepository } = require('../src/sentinel/nexus-economy-postgres-repository.cjs');
const { NexusEconomyPostgresAudit } = require('../src/sentinel/nexus-economy-postgres-audit.cjs');
const { NexusEconomyMutationService } = require('../src/sentinel/nexus-economy-mutation-service.cjs');

test('guarded economy runtime construction is inert and wires expected components', () => {
  let connects = 0;
  let queries = 0;
  const pool = {
    async connect() { connects += 1; throw new Error('must not connect during construction'); },
    async query() { queries += 1; return { rows: [] }; }
  };
  const runtime = createNexusEconomyMutationRuntime({
    pool,
    schema: 'public',
    env: { NEXUS_ECONOMY_AUTHORITY: 'nexus' }
  });

  assert.equal(connects, 0);
  assert.equal(queries, 0);
  assert.ok(runtime.repository instanceof NexusEconomyPostgresRepository);
  assert.ok(runtime.audit instanceof NexusEconomyPostgresAudit);
  assert.ok(runtime.mutations instanceof NexusEconomyMutationService);
  assert.equal(Object.isFrozen(runtime), true);
});

test('composition fails before runtime use when Postgres pool is invalid', () => {
  assert.throws(
    () => createNexusEconomyMutationRuntime({ pool: null }),
    /Postgres pool/i
  );
});

test('composition does not weaken fail-closed authority policy', async () => {
  let connects = 0;
  let queries = 0;
  const pool = {
    async connect() { connects += 1; throw new Error('must not connect when authority denies mutation'); },
    async query() { queries += 1; return { rows: [] }; }
  };
  const runtime = createNexusEconomyMutationRuntime({
    pool,
    env: {
      NEXUS_ECONOMY_AUTHORITY: 'compatibility',
      NEXUS_ARKSHOP_LEGACY_MAINTENANCE_ENABLED: 'true'
    }
  });

  await assert.rejects(
    () => runtime.mutations.credit(
      { discordUserId: '123', amount: 1, idempotencyKey: 'credit-1' },
      { actor: 'test-suite' }
    ),
    (error) => error?.code === 'NEXUS_ECONOMY_MUTATION_DENIED' && error?.reason === 'nexus-authority-required'
  );
  assert.equal(connects, 0);
  assert.equal(queries, 0);
});
