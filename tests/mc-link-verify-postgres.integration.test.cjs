'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPostgresEconomyRuntime } = require('../src/economy-worker/postgres-runtime.cjs');
const { classifyPopulation, AMOUNT } = require('../src/economy-worker/legacy-bank-flat.cjs');
const { deterministicEconomicIdentityId } = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');
const { FIRST_PLAY_MS } = require('../src/shared/mc-starter-kit.cjs');

const postgresUrl = process.env.NEXUS_TEST_POSTGRES_URL || '';
const local = (() => {
  if (!postgresUrl) return false;
  try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(postgresUrl).hostname); }
  catch { return false; }
})();
const skip = !postgresUrl || !local;

const DISCORD = '111111111111111111';
const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const EOS = 'EOSMCBLOCK1';
const LINK_SECRET = 'mc-link-code-hmac-secret-32chars!';
const JOINED = Date.parse('2020-01-15T00:00:00.000Z');

async function openRuntime() {
  assert.ok(local, 'integration database must be local');
  const schema = `mclink_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: postgresUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  let now = Date.parse('2026-10-05T18:00:00.000Z');
  const env = {
    NEXUS_ECONOMY_DATABASE_URL: postgresUrl,
    NEXUS_ECONOMY_SCHEMA: schema,
    MC_POINTS_ENABLED: 'true',
    MC_PLAYTIME_NP_ENABLED: 'true',
    MC_PLAYTIME_DRY_RUN: 'false',
    MC_SHOP_ENABLED: 'true',
    MC_SHOP_DRY_RUN: 'false',
    MC_STARTER_KIT_ENABLED: 'true',
    MC_LINK_CODE_SECRET: LINK_SECRET,
    ARK_SHOP_ENABLED: 'true',
    ARK_SHOP_DRY_RUN: 'false',
    ARK_STARTER_KIT_ENABLED: 'true',
    NEXUS_ECONOMY_NP_SHOP_WRITES_ENABLED: 'true',
    NEXUS_ECONOMY_WRITES_ENABLED: 'true'
  };
  const runtime = await createPostgresEconomyRuntime({ env, now: () => now });
  return {
    admin,
    schema,
    runtime,
    advance(ms) { now += ms; }
  };
}

async function closeRuntime(opened) {
  if (!opened) return;
  await opened.runtime.close().catch(() => {});
  await opened.admin.query(`DROP SCHEMA IF EXISTS "${opened.schema}" CASCADE`).catch(() => {});
  await opened.admin.end().catch(() => {});
}

test('a restricted Minecraft link stays restricted on postgres and opens only Minecraft features', { skip }, async () => {
  const opened = await openRuntime();
  try {
    const { runtime, admin, schema, advance } = opened;
    const points = runtime.worker.minecraft;
    const challenge = await points.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
    assert.equal(challenge.ok, true, challenge.reason);
    const confirmed = await points.confirm({ discordUserId: DISCORD, code: challenge.code });
    assert.equal(confirmed.ok, true, confirmed.reason);
    const econId = deterministicEconomicIdentityId(DISCORD);
    assert.equal(confirmed.economicIdentityId, econId);

    const identity = await admin.query(
      `SELECT i.status, d.verified_at AS discord_verified_at, l.verified_at AS mc_verified_at
       FROM "${schema}".nexus_economic_identities i
       JOIN "${schema}".nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id
       LEFT JOIN "${schema}".nexus_mc_links l ON l.economic_identity_id = i.economic_identity_id
       WHERE d.provider = 'discord' AND d.external_id = $1`,
      [DISCORD]
    );
    assert.equal(identity.rows[0].status, 'restricted');
    assert.equal(identity.rows[0].discord_verified_at, null);
    assert.ok(identity.rows[0].mc_verified_at);

    const refused = await runtime.repository.linkVerifiedIdentity({
      discordUserId: DISCORD,
      eosId: EOS,
      verifiedAt: '2026-10-05T18:00:00.000Z',
      discordMembershipVerified: false
    });
    assert.equal(refused.status, 'restricted');
    const afterArk = await admin.query(
      `SELECT status FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [econId]
    );
    assert.equal(afterArk.rows[0].status, 'restricted');

    const arkQuote = await runtime.worker.arkShop.quote({ discordUserId: DISCORD, sku: 'coastal' });
    assert.equal(arkQuote.ok, false);
    const arkKit = await runtime.worker.arkShop.claimStarterKit({ discordUserId: DISCORD, joinedAt: JOINED });
    assert.equal(arkKit.ok, false);

    await assert.rejects(
      () => runtime.worker.spend({
        discordUserId: DISCORD,
        amount: 1,
        orderId: 'coin-spend-1',
        idempotencyKey: 'coin-spend-1',
        currency: 'NEXUS_COINS'
      }),
      /Verified economic identity is required/
    );
    await assert.rejects(
      () => runtime.worker.credit({
        discordUserId: DISCORD,
        amount: 1,
        idempotencyKey: 'coin-credit-1',
        currency: 'NEXUS_COINS'
      }),
      /Verified economic identity is required/
    );
    const population = classifyPopulation([{
      econId,
      status: 'restricted',
      createdAt: '2026-01-01T00:00:00.000Z',
      discord: [{ id: DISCORD, verifiedAt: null }],
      eos: []
    }]);
    assert.equal(population.rows[0].amount, 0);
    assert.notEqual(population.rows[0].amount, AMOUNT);

    await runtime.worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
    for (let step = 0; step < 6; step += 1) {
      advance(5 * 60 * 1000);
      const earned = await runtime.worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
      assert.equal(earned.ok, true, earned.reason);
    }
    const balance = await runtime.worker.balance(DISCORD);
    assert.ok(balance >= 10, `balance ${balance}`);

    const quoted = await points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
    assert.equal(quoted.ok, true, quoted.reason);
    const bought = await points.buy({
      discordUserId: DISCORD,
      sku: 'mc_logs64',
      bundles: 1,
      nonce: quoted.quote.nonce,
      writesEnabled: true
    });
    assert.equal(bought.ok, true, bought.reason);
    assert.equal(bought.order.source, 'mc-shop');

    const playtime = await admin.query(
      `SELECT playtime_ms FROM "${schema}".nexus_mc_links WHERE mc_uuid = $1`,
      [UUID]
    );
    assert.ok(Number(playtime.rows[0].playtime_ms) >= FIRST_PLAY_MS);
    const kit = await points.claimStarterKit({ discordUserId: DISCORD, tenureOf: async () => JOINED });
    assert.equal(kit.ok, true, kit.reason);
    assert.equal(kit.order.source, 'starter-kit');

    const still = await admin.query(
      `SELECT i.status, d.verified_at FROM "${schema}".nexus_economic_identities i
       JOIN "${schema}".nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id
       WHERE d.provider = 'discord' AND d.external_id = $1`,
      [DISCORD]
    );
    assert.equal(still.rows[0].status, 'restricted');
  } finally {
    await closeRuntime(opened);
  }
});
