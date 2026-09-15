'use strict';

/**
 * Repository-level O9 link gates (WARDEN R2).
 * Covers: Discord verify missing → restricted commit (no elevation);
 * proof claim true → may elevate; already-verified re-link never demoted; revoke demote.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');

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

test('O9 repository: new link without Discord claim commits restricted and does not elevate', async () => {
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
  assert.equal(result.eligibility, 'discord-verify-required');
  assert.ok(result.economicIdentityId);
  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  assert.equal(calls.some((c) => /SET status = 'verified'/.test(c.text || '')), false);
});

test('O9 repository: Discord claim true elevates to verified', async () => {
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
  const result = await repository.linkVerifiedIdentity({
    discordUserId, eosId, verifiedAt, discordMembershipVerified: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'verified');
  assert.ok(calls.some((c) => /SET status = 'verified'/.test(c.text || '')));
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
  assert.equal(calls.some((c) => /SET status = 'restricted'/.test(c.text || '')), false);
});

test('O9 repository: demoteVerifiedIdentityToRestricted demotes verified only', async () => {
  let status = 'verified';
  const { pool, calls } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE provider = 'discord'/.test(text)) {
      return { rows: [{ economic_identity_id: 'econ_1' }] };
    }
    if (/SELECT status FROM .*nexus_economic_identities/.test(text)) return { rows: [{ status }] };
    if (/UPDATE .*nexus_economic_identities SET status = 'restricted'/.test(text)) {
      status = 'restricted';
      return { rows: [] };
    }
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.demoteVerifiedIdentityToRestricted(discordUserId);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'restricted');
  assert.equal(result.priorStatus, 'verified');
  assert.ok(calls.some((c) => /SET status = 'restricted'/.test(c.text || '')));
});
