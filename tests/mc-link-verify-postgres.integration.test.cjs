'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { Pool } = require('pg');
const { createPostgresEconomyRuntime } = require('../src/economy-worker/postgres-runtime.cjs');
const { createEconomyServer } = require('../src/economy-worker/server.cjs');
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
    const discordSource = await admin.query(
      `SELECT source FROM "${schema}".nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1`,
      [DISCORD]
    );
    assert.equal(discordSource.rows[0].source, 'mc-link');

    const beforeArkQuote = await runtime.worker.arkShop.quote({ discordUserId: DISCORD, sku: 'coastal' });
    assert.equal(beforeArkQuote.reason, 'minecraft-only');
    const beforeArkKit = await runtime.worker.arkShop.claimStarterKit({ discordUserId: DISCORD, joinedAt: JOINED });
    assert.equal(beforeArkKit.reason, 'minecraft-only');

    const populationLinks = await admin.query(
      `SELECT i.economic_identity_id, i.status, i.created_at, l.provider, l.external_id, l.verified_at
       FROM "${schema}".nexus_economic_identities i
       JOIN "${schema}".nexus_economic_identity_links l ON l.economic_identity_id = i.economic_identity_id
       WHERE i.economic_identity_id = $1 AND l.provider IN ('discord', 'eos')`,
      [econId]
    );
    const populationIdentity = {
      econId,
      status: populationLinks.rows[0].status,
      createdAt: populationLinks.rows[0].created_at,
      discord: [],
      eos: []
    };
    for (const row of populationLinks.rows) {
      const link = { id: row.external_id, verifiedAt: row.verified_at };
      if (row.provider === 'discord') populationIdentity.discord.push(link);
      else populationIdentity.eos.push(link);
    }
    const population = classifyPopulation([populationIdentity]);
    assert.equal(population.rows[0].amount, 0);
    assert.notEqual(population.rows[0].amount, AMOUNT);

    const httpRuntime = createEconomyServer({
      worker: runtime.worker,
      shop: runtime.shop,
      token: 'sentinal-token',
      writesEnabled: true,
      mcRoutesEnabled: true
    });
    await new Promise((resolve) => httpRuntime.server.listen(0, '127.0.0.1', resolve));
    try {
      const postWallet = (pathname, body) => new Promise((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify(body));
        const req = http.request({
          host: '127.0.0.1',
          port: httpRuntime.server.address().port,
          path: pathname,
          method: 'POST',
          headers: { authorization: 'Bearer sentinal-token', 'content-type': 'application/json', 'content-length': payload.length }
        }, (res) => {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
        });
        req.on('error', reject);
        req.end(payload);
      });
      const coinSpend = await postWallet('/wallet/spend', { discordUserId: DISCORD, amount: 1, orderId: 'http-coins', currency: 'NEXUS_COINS', idempotencyKey: 'http-coins' });
      const pointSpend = await postWallet('/wallet/spend', { discordUserId: DISCORD, amount: 1, orderId: 'http-points', currency: 'NEXUS_POINTS', idempotencyKey: 'http-points' });
      const credited = await postWallet('/wallet/credit', { discordUserId: DISCORD, amount: 1, idempotencyKey: 'http-credit', currency: 'NEXUS_POINTS' });
      for (const response of [coinSpend, pointSpend, credited]) {
        assert.equal(response.body.ok, false);
        assert.equal(response.body.reason || response.body.error, 'verified-identity-required');
      }
    } finally {
      httpRuntime.server.close();
    }

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

    const proved = await admin.query(
      `SELECT source, verified_at FROM "${schema}".nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1`,
      [DISCORD]
    );
    assert.ok(proved.rows[0].verified_at);
    assert.equal(proved.rows[0].source, 'sentinel-ownership-proof');
    const arkQuote = await runtime.worker.arkShop.quote({ discordUserId: DISCORD, sku: 'coastal' });
    assert.equal(arkQuote.reason, 'restricted');
    const arkKit = await runtime.worker.arkShop.claimStarterKit({ discordUserId: DISCORD, joinedAt: JOINED });
    assert.equal(arkKit.reason, 'restricted');

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
    // Postgres marks a presence older than 3 minutes offline before it counts the gap.
    // Steps stay inside that window. Thirteen 2-minute steps are 26 minutes: five
    // shadow-recruit intervals (10 NP) and more than the kit's 15 minutes.
    await runtime.worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
    for (let step = 0; step < 13; step += 1) {
      advance(2 * 60 * 1000);
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
    await admin.query(
      `UPDATE "${schema}".nexus_mc_orders SET created_at = NOW() - INTERVAL '25 hours', status = 'DELIVERY_FAILED', order_data = jsonb_set(order_data, '{status}', '"DELIVERY_FAILED"') WHERE order_id = $1`,
      [bought.order.orderId]
    );
    const tooLate = await points.refund({
      orderId: bought.order.orderId,
      reason: 'outside the day',
      actor: '444444444444444444',
      writesEnabled: true,
      staffAuthorized: true
    });
    assert.equal(tooLate.reason, 'refund-window');
    await admin.query(
      `UPDATE "${schema}".nexus_economic_identities SET hold_reason = 'staff' WHERE economic_identity_id = $1`,
      [econId]
    );
    await admin.query(
      `UPDATE "${schema}".nexus_mc_orders SET created_at = NOW() WHERE order_id = $1`,
      [bought.order.orderId]
    );
    const heldRefund = await points.refund({
      orderId: bought.order.orderId,
      reason: 'held buyer',
      actor: '444444444444444444',
      writesEnabled: true,
      staffAuthorized: true
    });
    assert.equal(heldRefund.reason, 'account-hold');
    const stillPaid = await admin.query(`SELECT status FROM "${schema}".nexus_mc_orders WHERE order_id = $1`, [bought.order.orderId]);
    assert.equal(stillPaid.rows[0].status, 'DELIVERY_FAILED');
    await admin.query(
      `UPDATE "${schema}".nexus_economic_identities SET hold_reason = NULL WHERE economic_identity_id = $1`,
      [econId]
    );
    const preview = await points.refundPreview({
      orderId: bought.order.orderId,
      reason: 'preview only',
      actor: '444444444444444444',
      staffAuthorized: true
    });
    assert.equal(preview.ok, true, preview.reason);
    assert.equal(preview.preview, true);
    assert.equal((await admin.query(`SELECT status FROM "${schema}".nexus_mc_orders WHERE order_id = $1`, [bought.order.orderId])).rows[0].status, 'DELIVERY_FAILED');
    const staffRefund = await points.refund({
      orderId: bought.order.orderId,
      reason: 'within the day',
      actor: '444444444444444444',
      writesEnabled: true,
      staffAuthorized: true
    });
    assert.equal(staffRefund.ok, true, staffRefund.reason);

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
