'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_RELATIONS,
  inspectNexusEconomyReadiness
} = require('../src/sentinel/nexus-economy-readiness.cjs');

test('Nexus economy readiness rejects an unsafe schema before querying Postgres', async () => {
  let calls = 0;
  const pool = { async query() { calls += 1; return { rows: [] }; } };

  await assert.rejects(
    inspectNexusEconomyReadiness({ pool, schema: 'public; DROP TABLE users' }),
    /schema name is invalid/i
  );
  assert.equal(calls, 0);
});

test('Nexus economy readiness uses one read-only catalog query', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: REQUIRED_RELATIONS.map((relname) => ({ relname, relkind: 'r' })) };
    }
  };

  const result = await inspectNexusEconomyReadiness({ pool, schema: 'nexus' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^SELECT /);
  assert.match(calls[0].sql, /pg_catalog\.pg_class/);
  assert.doesNotMatch(calls[0].sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  assert.deepEqual(calls[0].params, ['nexus', REQUIRED_RELATIONS]);
  assert.equal(result.ready, true);
  assert.equal(result.databaseReady, true);
  assert.equal(result.mutationPerformed, false);
  assert.deepEqual(result.missing, []);
});

test('Nexus economy readiness reports missing durable relations without mutation', async () => {
  const pool = {
    async query() {
      return {
        rows: [
          { relname: 'nexus_economy_accounts', relkind: 'r' },
          { relname: 'nexus_economy_ledger', relkind: 'r' }
        ]
      };
    }
  };

  const result = await inspectNexusEconomyReadiness({ pool });
  assert.equal(result.ready, false);
  assert.equal(result.databaseReady, true);
  assert.deepEqual(result.missing, ['nexus_economy_audit']);
  assert.equal(result.relations.nexus_economy_audit.present, false);
  assert.equal(result.mutationPerformed, false);
});

test('Nexus economy readiness propagates database failure and performs no fallback mutation', async () => {
  let calls = 0;
  const pool = {
    async query(sql) {
      calls += 1;
      assert.match(sql, /^SELECT /);
      throw new Error('database unavailable');
    }
  };

  await assert.rejects(inspectNexusEconomyReadiness({ pool }), /database unavailable/);
  assert.equal(calls, 1);
});
