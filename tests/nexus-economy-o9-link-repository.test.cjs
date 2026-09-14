'use strict';

/**
 * Repository-level O9 link gates (WARDEN R2).
 * Covers: Discord stub unresolved → restricted commit (no elevation);
 * already-verified re-link never demoted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
const { O9_DISCORD_MEMBERSHIP_VERIFIED_STUB } = require('../src/sentinel/nexus-economy-o9-eligibility.cjs');

function fakePool(handler) {
  const calls = [];
  const client = {
    async query(text, params = []) {
      calls.push({ scope: 'client', text, params });
      return handler(text, params, 'client', calls);
    },
    release() { calls.push({ scope: 'release' }); }
  };
  return {
    calls,
    pool: {
      async connect() { calls.push({ scope: 'connect' }); return client; },
      async query(text, params = []) {
        calls.push({ scope: 'pool', text, params });
        return handler(text, params, 'pool', calls);
      }
    }
  };
}

const discordUserId = '123456789012345678';
const eosId = 'EOS_PROOF_12345678';
const verifiedAt = '2026-09-14T22:00:00.000Z';

test('O9 repository: new link with Discord stub unresolved commits restricted and does not elevate', async () => {
  let statusRow = { status: 'restricted' };
  const { pool, calls } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /LOCK TABLE/.test(text)) return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE/.test(text)) return { rows: [] };
    if (/INSERT INTO .*nexus_economic_identities/.test(text)) return { rows: [] };
    if (/SELECT status FROM .*nexus_economic_identities/.test(text)) return { rows: [statusRow] };
    if (/INSERT INTO .*nexus_economic_identity_links/.test(text)) return { rows: [] };
    if (/UPDATE .*nexus_economic_identities SET status = 'verified'/.test(text)) {
      statusRow = { status: 'verified' };
      return { rows: [] };
    }
    return { rows: [] };
  });

  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.linkVerifiedIdentity({ discordUserId, eosId, verifiedAt });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'restricted');
  assert.equal(result.eligibility, O9_DISCORD_MEMBERSHIP_VERIFIED_STUB);
  assert.equal(result.duplicate, undefined);
  assert.ok(result.economicIdentityId);

  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  assert.equal(calls.some((c) => /SET status = 'verified'/.test(c.text || '')), false);
  assert.equal(calls.some((c) => c.text === 'ROLLBACK'), false);
  assert.equal(calls.at(-1).scope, 'release');

  const linkInserts = calls.filter((c) => /INSERT INTO .*nexus_economic_identity_links/.test(c.text || ''));
  assert.equal(linkInserts.length, 2);
});

test('O9 repository: already-verified re-link stays verified and never demotes', async () => {
  const { pool, calls } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /LOCK TABLE/.test(text)) return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE/.test(text)) {
      return {
        rows: [
          { provider: 'discord', external_id: discordUserId, economic_identity_id: 'econ_verified_1', verified_at: verifiedAt },
          { provider: 'eos', external_id: eosId, economic_identity_id: 'econ_verified_1', verified_at: verifiedAt }
        ]
      };
    }
    if (/INSERT INTO .*nexus_economic_identities/.test(text)) return { rows: [] };
    if (/SELECT status FROM .*nexus_economic_identities/.test(text)) return { rows: [{ status: 'verified' }] };
    if (/INSERT INTO .*nexus_economic_identity_links/.test(text)) return { rows: [] };
    if (/UPDATE .*nexus_economic_identities SET status/.test(text)) {
      throw new Error('unexpected status UPDATE on verified re-link');
    }
    return { rows: [] };
  });

  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.linkVerifiedIdentity({ discordUserId, eosId, verifiedAt });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.status, 'verified');
  assert.equal(result.economicIdentityId, 'econ_verified_1');

  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  assert.equal(calls.some((c) => /SET status = 'verified'/.test(c.text || '')), false);
  assert.equal(calls.some((c) => /SET status = 'restricted'/.test(c.text || '')), false);
  assert.equal(calls.some((c) => c.text === 'ROLLBACK'), false);
  assert.equal(calls.at(-1).scope, 'release');
});

test('O9 repository: missing EOS ids are rejected before transaction work', async () => {
  const { pool, calls } = fakePool(() => ({ rows: [] }));
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  await assert.rejects(
    repository.linkVerifiedIdentity({ discordUserId, eosId: 'short', verifiedAt }),
    /Invalid verified identity/
  );
  assert.equal(calls.some((c) => c.scope === 'connect'), false);
});
