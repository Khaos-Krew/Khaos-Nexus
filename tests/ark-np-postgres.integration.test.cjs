'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPostgresEconomyRuntime } = require('../src/economy-worker/postgres-runtime.cjs');
const { PostgresArkShop } = require('../src/economy-worker/ark-np-postgres.cjs');
const {
  dryRun,
  execute,
  ensureBatchSchema,
  reverseCredit,
  reconcile,
  SNAPSHOT_AT,
  AMOUNT,
  MINT_ID
} = require('../src/economy-worker/legacy-bank-flat.cjs');
const { sumMemberPointBalances } = require('../src/shared/economy-system-accounts.cjs');
const { deterministicEconomicIdentityId } = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');

const postgresUrl = process.env.NEXUS_TEST_POSTGRES_URL || '';
const local = (() => {
  if (!postgresUrl) return false;
  try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(postgresUrl).hostname); }
  catch { return false; }
})();
const skip = !postgresUrl || !local;
const BEFORE = '2026-10-01T00:00:00.000Z';
const AFTER = '2026-10-03T02:14:00.000Z';

async function openRuntime(label) {
  assert.ok(local, 'integration database must be local');
  const schema = `arknp_${label}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: postgresUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const env = {
    NEXUS_ECONOMY_DATABASE_URL: postgresUrl,
    NEXUS_ECONOMY_SCHEMA: schema,
    ARK_SHOP_ENABLED: 'true',
    ARK_SHOP_DRY_RUN: 'false',
    ARK_SHOP_DELIVERY_ENABLED: 'true',
    ARK_STARTER_KIT_ENABLED: 'true',
    NEXUS_ECONOMY_NP_SHOP_WRITES_ENABLED: 'true',
    NEXUS_LEGACY_BANK_FLAT_ENABLED: 'true',
    NEXUS_ECONOMY_QUARANTINE_DENYLIST: ''
  };
  const runtime = await createPostgresEconomyRuntime({ env, now: () => Date.parse(BEFORE) });
  return { admin, schema, env, runtime };
}

async function closeRuntime(opened) {
  if (!opened) return;
  await opened.runtime.close().catch(() => {});
  await opened.admin.query(`DROP SCHEMA IF EXISTS "${opened.schema}" CASCADE`).catch(() => {});
  await opened.admin.end().catch(() => {});
}

async function seedIdentity(pool, schema, { econId, status = 'verified', discord, eos, verifiedAt = BEFORE, createdAt = BEFORE }) {
  await pool.query(
    `INSERT INTO "${schema}".nexus_economic_identities (economic_identity_id, status, created_at)
     VALUES ($1, $2, $3)`,
    [econId, status, createdAt]
  );
  if (discord) {
    await pool.query(
      `INSERT INTO "${schema}".nexus_economic_identity_links
       (provider, external_id, economic_identity_id, verified_at, source)
       VALUES ('discord', $1, $2, $3, 'test')`,
      [discord, econId, verifiedAt]
    );
  }
  for (const id of eos || []) {
    await pool.query(
      `INSERT INTO "${schema}".nexus_economic_identity_links
       (provider, external_id, economic_identity_id, verified_at, source)
       VALUES ('eos', $1, $2, $3, 'test')`,
      [id, econId, verifiedAt]
    );
  }
  await pool.query(
    `INSERT INTO "${schema}".nexus_economy_wallets (economic_identity_id, currency, balance)
     VALUES ($1, 'NEXUS_POINTS', 0)`,
    [econId]
  );
}

async function balanceOf(pool, schema, econId) {
  const row = await pool.query(
    `SELECT balance FROM "${schema}".nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
    [econId]
  );
  return Number(row.rows?.[0]?.balance || 0);
}

test('two concurrent buys that together exceed the balance let exactly one through', { skip }, async () => {
  const opened = await openRuntime('buy');
  try {
    const { pool } = opened.runtime;
    const econId = 'econ_buyer';
    const discord = '200000000000000001';
    await seedIdentity(pool, opened.schema, { econId, discord, eos: ['EOSBUYER001'] });
    await pool.query(
      `UPDATE "${opened.schema}".nexus_economy_wallets SET balance = 200 WHERE economic_identity_id = $1`,
      [econId]
    );
    const shop = opened.runtime.worker.arkShop;
    const first = await shop.quote({ discordUserId: discord, sku: 'coastal' });
    const second = await shop.quote({ discordUserId: discord, sku: 'coastal' });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const [left, right] = await Promise.all([
      shop.buy({ discordUserId: discord, sku: 'coastal', nonce: first.quote.nonce }),
      shop.buy({ discordUserId: discord, sku: 'coastal', nonce: second.quote.nonce })
    ]);
    const succeeded = [left, right].filter((result) => result.ok);
    assert.equal(succeeded.length, 1);
    const balance = await balanceOf(pool, opened.schema, econId);
    assert.equal(balance, 50);
    assert.ok(balance >= 0);
  } finally {
    await closeRuntime(opened);
  }
});

test('starter kit dry-run does not burn the grant and a live claim stores notional points only', { skip }, async () => {
  const opened = await openRuntime('kit');
  try {
    const { pool } = opened.runtime;
    const discord = '200000000000000002';
    await seedIdentity(pool, opened.schema, { econId: 'econ_kit', discord, eos: ['EOSKIT00001'] });
    const dry = new PostgresArkShop({
      pool,
      schema: opened.schema,
      env: { ...opened.env, ARK_SHOP_DRY_RUN: 'true' },
      now: () => Date.parse(BEFORE),
      tenureOf: async () => Date.parse('2020-01-01T00:00:00.000Z')
    });
    await dry.ensureSchema();
    const preview = await dry.claimStarterKit({ discordUserId: discord });
    assert.equal(preview.reason, 'ark-shop-dry-run');
    const grants = await pool.query(`SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_mc_grants`);
    assert.equal(grants.rows[0].n, 0);
    const shop = new PostgresArkShop({
      pool,
      schema: opened.schema,
      env: opened.env,
      now: () => Date.parse(BEFORE),
      tenureOf: async () => Date.parse('2020-01-01T00:00:00.000Z')
    });
    const claimed = await shop.claimStarterKit({ discordUserId: discord, accountCreatedAt: 1, guildJoinedAtMs: 1 });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.order.price, 0);
    assert.equal(claimed.order.metadata.notionalNp, 150);
    assert.notEqual(claimed.order.metadata.accountCreatedAt, new Date(1).toISOString());
    const ledger = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_economy_ledger WHERE economic_identity_id = 'econ_kit'`
    );
    assert.equal(ledger.rows[0].n, 0);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_kit'), 0);
  } finally {
    await closeRuntime(opened);
  }
});

test('legacy flat credit refuses a swapped list, holds duplicates, and resumes a crash without a second credit', { skip }, async () => {
  const opened = await openRuntime('flat');
  try {
    const { pool } = opened.runtime;
    const discordA = '200000000000000011';
    const discordB = '200000000000000012';
    await seedIdentity(pool, opened.schema, { econId: 'econ_a', discord: discordA, eos: ['EOSFLAT0001'] });
    await seedIdentity(pool, opened.schema, { econId: 'econ_b', discord: discordB, eos: ['EOSFLAT0002'] });
    const sharedDiscord = '143909213712809984';
    const legacyId = deterministicEconomicIdentityId(sharedDiscord);
    await seedIdentity(pool, opened.schema, {
      econId: legacyId,
      status: 'restricted',
      discord: sharedDiscord,
      eos: ['EOSLEGACY01']
    });
    await seedIdentity(pool, opened.schema, { econId: 'econ_owner', discord: '200000000000000013', eos: ['EOSOWNER001'] });
    await pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identities SET economic_identity_id = economic_identity_id WHERE economic_identity_id = $1`,
      [legacyId]
    );
    const lateDiscord = '200000000000000014';
    await seedIdentity(pool, opened.schema, {
      econId: 'econ_late',
      discord: lateDiscord,
      eos: ['EOSLATE0001'],
      verifiedAt: AFTER
    });
    const preview = await dryRun({ pool, schema: opened.schema, operator: 'warden-test' });
    assert.equal(preview.ok, true);
    const mintBefore = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_economic_identities WHERE economic_identity_id LIKE 'system:%'`
    );
    assert.equal(mintBefore.rows[0].n, 0);
    const batchTable = await pool.query('SELECT to_regclass($1) AS reg', [`${opened.schema}.nexus_economy_batches`]);
    assert.equal(batchTable.rows[0].reg, null);
    const byId = Object.fromEntries(preview.rows.map((row) => [row.econId, row]));
    assert.equal(byId.econ_a.amount, AMOUNT);
    assert.equal(byId.econ_b.amount, AMOUNT);
    assert.equal(byId[legacyId].skipReason, 'quarantined');
    assert.equal(byId.econ_late.skipReason, 'not_verified');
    assert.equal(preview.eligibleCount, 3);

    await pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identity_links
       SET economic_identity_id = CASE economic_identity_id WHEN 'econ_a' THEN 'econ_b' ELSE 'econ_a' END
       WHERE economic_identity_id IN ('econ_a', 'econ_b')`
    );
    const swapped = await dryRun({ pool, schema: opened.schema, operator: 'warden-test' });
    assert.equal(swapped.eligibleCount, preview.eligibleCount);
    assert.notEqual(swapped.hash, preview.hash);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    let refused;
    try {
      refused = await execute({
        pool,
        schema: opened.schema,
        env: { ...opened.env, NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH: preview.hash },
        operator: 'warden-test',
        approvalRef: 'not-the-owner-ref',
        approvedCount: preview.eligibleCount,
        approvedTotal: preview.total
      });
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(refused.reason, 'hash-mismatch');
    assert.equal(warnings.some((line) => line.includes(preview.hash)), false);
    assert.equal(warnings.some((line) => line.includes(preview.hash.slice(0, 8))), true);
    const marker = await pool.query(`SELECT * FROM "${opened.schema}".nexus_economy_batches`);
    assert.equal(marker.rowCount, 0);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_a'), 0);

    await pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identity_links
       SET economic_identity_id = CASE economic_identity_id WHEN 'econ_a' THEN 'econ_b' ELSE 'econ_a' END
       WHERE economic_identity_id IN ('econ_a', 'econ_b')`
    );
    const approved = await dryRun({ pool, schema: opened.schema, operator: 'warden-test' });
    assert.equal(approved.hash, preview.hash);
    let crashed = false;
    await assert.rejects(execute({
      pool,
      schema: opened.schema,
      env: { ...opened.env, NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH: approved.hash },
      operator: 'warden-test',
      approvalRef: 'test-approval',
      approvedCount: approved.eligibleCount,
      approvedTotal: approved.total,
      afterGrant: async () => {
        if (!crashed) {
          crashed = true;
          throw new Error('crash-mid-run');
        }
      }
    }));
    const incomplete = await pool.query(
      `SELECT completed_at FROM "${opened.schema}".nexus_economy_batches WHERE batch_name = 'legacy-bank-flat-2026-10'`
    );
    assert.equal(incomplete.rows[0].completed_at, null);
    const resumed = await execute({
      pool,
      schema: opened.schema,
      env: { ...opened.env, NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH: approved.hash },
      operator: 'warden-test',
      approvalRef: 'test-approval',
      approvedCount: approved.eligibleCount,
      approvedTotal: approved.total
    });
    assert.equal(resumed.ok, true);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_a'), 1500);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_b'), 1500);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_owner'), 1500);
    assert.equal(await balanceOf(pool, opened.schema, legacyId), 0);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_late'), 0);
    const mintStatus = await pool.query(
      `SELECT status FROM "${opened.schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [MINT_ID]
    );
    assert.equal(mintStatus.rows[0].status, 'system');
    assert.equal(await balanceOf(pool, opened.schema, MINT_ID), -4500);
    assert.equal(await sumMemberPointBalances(pool, opened.schema), 4500);
    const net = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM "${opened.schema}".nexus_economy_ledger WHERE currency = 'NEXUS_POINTS'`
    );
    assert.equal(Number(net.rows[0].total), 0);
    await assert.rejects(pool.query(
      `UPDATE "${opened.schema}".nexus_economy_wallets SET balance = -1 WHERE economic_identity_id = 'econ_a'`
    ));
    await pool.query(
      `INSERT INTO "${opened.schema}".nexus_economic_identities (economic_identity_id, status) VALUES ('system:other', 'system')`
    );
    await pool.query(
      `INSERT INTO "${opened.schema}".nexus_economy_wallets (economic_identity_id, currency, balance) VALUES ('system:other', 'NEXUS_POINTS', 0)`
    );
    await assert.rejects(pool.query(
      `UPDATE "${opened.schema}".nexus_economy_wallets SET balance = -1 WHERE economic_identity_id = 'system:other'`
    ));
    const again = await execute({
      pool,
      schema: opened.schema,
      env: { ...opened.env, NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH: approved.hash },
      operator: 'warden-test',
      approvalRef: 'test-approval',
      approvedCount: approved.eligibleCount,
      approvedTotal: approved.total
    });
    assert.equal(again.reason, 'batch-complete');
    assert.equal(await balanceOf(pool, opened.schema, 'econ_a'), 1500);
    const spent = await reverseCredit({
      pool,
      schema: opened.schema,
      econId: 'econ_a',
      operator: 'warden-test',
      confirm: true,
      env: opened.env
    });
    assert.equal(spent.reversed, true);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_a'), 0);
    assert.equal(await balanceOf(pool, opened.schema, MINT_ID), -3000);
    const second = await reverseCredit({
      pool,
      schema: opened.schema,
      econId: 'econ_a',
      operator: 'warden-test',
      confirm: true,
      env: opened.env
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.reversed, false);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_a'), 0);
    assert.equal(await balanceOf(pool, opened.schema, MINT_ID), -3000);
    const books = await reconcile(pool, opened.schema, 2);
    assert.equal(books.ok, true);
    assert.equal(books.credits, -books.contra);
    await pool.query(`UPDATE "${opened.schema}".nexus_economy_wallets SET balance = 100 WHERE economic_identity_id = 'econ_b'`);
    const flagged = await reverseCredit({
      pool,
      schema: opened.schema,
      econId: 'econ_b',
      operator: 'warden-test',
      confirm: true,
      env: opened.env
    });
    assert.equal(flagged.flagged, true);
    assert.equal(flagged.reversed, false);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_b'), 100);
    await seedIdentity(pool, opened.schema, { econId: 'econ_none', discord: '200000000000000099', eos: ['EOSNONE0001'] });
    await pool.query(
      `UPDATE "${opened.schema}".nexus_economy_wallets SET balance = 1500 WHERE economic_identity_id = 'econ_none'`
    );
    const missingCredit = await reverseCredit({
      pool,
      schema: opened.schema,
      econId: 'econ_none',
      operator: 'warden-test',
      confirm: true,
      env: opened.env
    });
    assert.equal(missingCredit.reason, 'credit-missing');
    assert.equal(missingCredit.reversed, false);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_none'), 1500);
  } finally {
    await closeRuntime(opened);
  }
});

test('duplicate humans are held on both sides and a denylist failure writes nothing', { skip }, async () => {
  const opened = await openRuntime('hold');
  try {
    const { pool } = opened.runtime;
    await seedIdentity(pool, opened.schema, { econId: 'econ_left', discord: '200000000000000021', eos: ['EOSHOLD0001'] });
    await seedIdentity(pool, opened.schema, { econId: 'econ_right', discord: '200000000000000022', eos: ['EOSHOLD0002'] });
    await assert.rejects(pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identity_links SET external_id = 'EOSHOLD0001' WHERE external_id = 'EOSHOLD0002'`
    ));
    const discord = '143909213712809984';
    const legacyId = deterministicEconomicIdentityId(discord);
    await seedIdentity(pool, opened.schema, { econId: 'econ_human', discord, eos: ['EOSHUMAN001'] });
    await seedIdentity(pool, opened.schema, {
      econId: legacyId,
      status: 'verified',
      discord: '200000000000000023',
      eos: ['EOSHUMAN002']
    });
    const preview = await dryRun({ pool, schema: opened.schema, operator: 'warden-test' });
    const left = preview.rows.find((row) => row.econId === 'econ_left');
    const human = preview.rows.find((row) => row.econId === 'econ_human');
    const legacy = preview.rows.find((row) => row.econId === legacyId);
    assert.equal(left.skipReason, '');
    assert.equal(human.skipReason, 'duplicate_human');
    assert.equal(legacy.skipReason, 'duplicate_human');
    const blocked = await execute({
      pool,
      schema: opened.schema,
      env: { ...opened.env, NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH: preview.hash },
      operator: 'warden-test',
      approvalRef: 'test-approval',
      approvedCount: preview.eligibleCount,
      approvedTotal: preview.total,
      readDenylist: () => { throw new Error('denylist down'); }
    });
    assert.equal(blocked.reason, 'denylist-read-error');
    const rows = await pool.query(`SELECT * FROM "${opened.schema}".nexus_economy_batches`);
    assert.equal(rows.rowCount, 0);
    assert.equal(await balanceOf(pool, opened.schema, 'econ_left'), 0);
    assert.equal(SNAPSHOT_AT, '2026-10-03T01:14:00.000Z');
  } finally {
    await closeRuntime(opened);
  }
});

test('starter kit records every linked EOS so a relink cannot claim a second kit', { skip }, async () => {
  const opened = await openRuntime('k4');
  try {
    const { pool } = opened.runtime;
    const discord = '200000000000000201';
    const otherDiscord = '200000000000000202';
    await seedIdentity(pool, opened.schema, { econId: 'econ_multi', discord, eos: ['EOSE1000001', 'EOSE2000002'] });
    const shop = new PostgresArkShop({
      pool,
      schema: opened.schema,
      env: opened.env,
      now: () => Date.parse(BEFORE),
      tenureOf: async () => Date.parse('2020-01-01T00:00:00.000Z')
    });
    const claimed = await shop.claimStarterKit({ discordUserId: discord });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.duplicate, undefined);
    const grants = await pool.query(
      `SELECT eos_id FROM "${opened.schema}".nexus_mc_grants WHERE economic_identity_id = 'econ_multi' ORDER BY eos_id`
    );
    assert.deepEqual(grants.rows.map((row) => row.eos_id), ['EOSE1000001', 'EOSE2000002']);
    await seedIdentity(pool, opened.schema, { econId: 'econ_relink', discord: otherDiscord, eos: [] });
    await pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identity_links SET economic_identity_id = 'econ_relink' WHERE external_id = 'EOSE2000002'`
    );
    const again = await shop.claimStarterKit({ discordUserId: otherDiscord });
    assert.equal(again.duplicate, true);
    assert.equal(again.reason, 'already-claimed');
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_mc_grants`);
    assert.equal(count.rows[0].n, 2);
    await assert.rejects(
      () => pool.query(
        `INSERT INTO "${opened.schema}".nexus_mc_grants
         (grant_id, kind, economic_identity_id, mc_uuid, eos_id, kit_version, order_id, status, provider, kit_anchor)
         VALUES ('second-anchor', 'ark_starter_kit', 'econ_multi', 'EOSE3000003', 'EOSE3000003', '1', 'order-extra', 'PAID', 'ark', TRUE)`
      ),
      (error) => error.code === '23505'
    );
    await assert.rejects(
      () => pool.query(
        `INSERT INTO "${opened.schema}".nexus_mc_grants
         (grant_id, kind, economic_identity_id, mc_uuid, eos_id, kit_version, order_id, status, provider, kit_anchor)
         VALUES ('second-eos', 'ark_starter_kit', 'econ_relink', 'EOSE2000002', 'EOSE2000002', '1', 'order-eos', 'PAID', 'ark', FALSE)`
      ),
      (error) => error.code === '23505'
    );
    const still = await pool.query(`SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_mc_grants`);
    assert.equal(still.rows[0].n, 2);
  } finally {
    await closeRuntime(opened);
  }
});

test('boot leaves member balance checks strict and four migrations serialize', { skip }, async () => {
  const opened = await openRuntime('mint4');
  try {
    const checks = () => opened.admin.query(
      `SELECT r.relname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = $1 AND c.contype = 'c'
         AND r.relname IN ('nexus_economic_identities', 'nexus_economy_wallets', 'nexus_economy_ledger')`,
      [opened.schema]
    );
    const before = await checks();
    assert.equal(before.rows.some((row) => /system:mint/.test(row.def)), false);
    const mc = await opened.admin.query('SELECT to_regclass($1) AS name', [`${opened.schema}.nexus_mc_grants`]);
    assert.equal(mc.rows[0].name, null);
    await Promise.all([0, 1, 2, 3].map(() => ensureBatchSchema(opened.runtime.pool, opened.schema, opened.env)));
    const after = await checks();
    const wallet = after.rows.filter((row) => row.relname === 'nexus_economy_wallets' && /system:mint:%/.test(row.def));
    const ledger = after.rows.filter((row) => row.relname === 'nexus_economy_ledger' && /system:mint:%/.test(row.def));
    assert.equal(wallet.length, 1);
    assert.equal(ledger.length, 1);
    await opened.runtime.pool.query(
      `INSERT INTO "${opened.schema}".nexus_economic_identities (economic_identity_id, status) VALUES ('econ_member', 'verified')`
    );
    await opened.runtime.pool.query(
      `INSERT INTO "${opened.schema}".nexus_economy_wallets (economic_identity_id, currency, balance) VALUES ('econ_member', 'NEXUS_POINTS', 0)`
    );
    await assert.rejects(
      () => opened.runtime.pool.query(`UPDATE "${opened.schema}".nexus_economy_wallets SET balance = -1 WHERE economic_identity_id = 'econ_member'`),
      (error) => error.code === '23514'
    );
    await opened.runtime.pool.query(`UPDATE "${opened.schema}".nexus_economy_wallets SET balance = -1500 WHERE economic_identity_id = $1`, [MINT_ID]);
  } finally {
    await closeRuntime(opened);
  }
});

test('two staff refunds at the daily cap cannot both land', { skip }, async () => {
  const opened = await openRuntime('cap');
  try {
    const { pool } = opened.runtime;
    const actor = '300000000000000099';
    const shop = new PostgresArkShop({
      pool,
      schema: opened.schema,
      env: { ...opened.env, NEXUS_OWNER_USER_IDS: actor },
      now: () => Date.now()
    });
    await shop.ensureSchema();
    for (let index = 0; index < 9; index += 1) {
      await pool.query(
        `INSERT INTO "${opened.schema}".nexus_mc_refund_audit (order_id, actor, reason, amount, provider)
         VALUES ($1, $2, 'seed', 0, 'ark')`,
        [`seed-${index}`, actor]
      );
    }
    for (const orderId of ['order-left', 'order-right']) {
      const order = { orderId, discordUserId: '200000000000000301', status: 'SENT_UNCONFIRMED', price: 0, sku: 'coastal' };
      await pool.query(
        `INSERT INTO "${opened.schema}".nexus_mc_orders (order_id, nonce, order_data, status, price, provider)
         VALUES ($1, $2, $3::jsonb, 'SENT_UNCONFIRMED', 0, 'ark')`,
        [orderId, orderId, JSON.stringify(order)]
      );
    }
    const [left, right] = await Promise.all([
      shop.refund({ orderId: 'order-left', reason: 'checked the log', actor, staff: true }),
      shop.refund({ orderId: 'order-right', reason: 'checked the log', actor, staff: true })
    ]);
    const succeeded = [left, right].filter((result) => result.ok);
    const capped = [left, right].filter((result) => result.reason === 'staff-refund-cap');
    assert.equal(succeeded.length, 1);
    assert.equal(capped.length, 1);
    const audits = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_mc_refund_audit WHERE actor = $1`,
      [actor]
    );
    assert.equal(audits.rows[0].n, 10);
  } finally {
    await closeRuntime(opened);
  }
});

test('a locked hold blocks ARK buy, kit, and auto refund, and the old kit index is gone', { skip }, async () => {
  const opened = await openRuntime('hold');
  try {
    const { pool } = opened.runtime;
    const shop = opened.runtime.worker.arkShop;
    const ready = await shop.ensureSchema();
    assert.equal(ready.ok, true);
    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'nexus_mc_grants' ORDER BY indexname`,
      [opened.schema]
    );
    const names = indexes.rows.map((row) => row.indexname);
    assert.equal(names.includes('nexus_mc_grants_kind_eos'), false);
    assert.equal(names.includes('nexus_mc_grants_one_starter_per_eos'), true);
    assert.equal(names.includes('nexus_mc_grants_one_starter_per_identity'), true);
    const discord = '200000000000000401';
    await seedIdentity(pool, opened.schema, { econId: 'econ_held', discord, eos: ['EOSHELD0001'], status: 'restricted' });
    await pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identities SET hold_reason = 'staff' WHERE economic_identity_id = 'econ_held'`
    );
    await pool.query(
      `UPDATE "${opened.schema}".nexus_economy_wallets SET balance = 500 WHERE economic_identity_id = 'econ_held'`
    );
    const quote = await shop.quote({ discordUserId: discord, sku: 'coastal' });
    assert.equal(quote.reason, 'account-hold');
    await pool.query(
      `INSERT INTO "${opened.schema}".nexus_mc_quotes
       (nonce, discord_user_id, economic_identity_id, mc_uuid, sku, bundles, qty, price, item_id, catalog_version, catalog_hash, signature, expires_at, provider)
       VALUES ('held-quote', $1, 'econ_held', 'EOSHELD0001', 'coastal', 1, 1, 150, 'coastal', 'test', 'test', '', '2099-01-01T00:00:00.000Z', 'ark')`,
      [discord]
    );
    const bought = await shop.buy({ discordUserId: discord, sku: 'coastal', nonce: 'held-quote' });
    assert.equal(bought.reason, 'account-hold');
    assert.equal(await balanceOf(pool, opened.schema, 'econ_held'), 500);
    const claimed = await shop.claimStarterKit({ discordUserId: discord });
    assert.equal(claimed.reason, 'account-hold');
    const order = {
      orderId: 'held-order',
      discordUserId: discord,
      economicIdentityId: 'econ_held',
      status: 'PAID',
      price: 150,
      sku: 'coastal',
      paidAt: '2020-01-01T00:00:00.000Z'
    };
    await pool.query(
      `INSERT INTO "${opened.schema}".nexus_mc_orders (order_id, nonce, order_data, status, price, provider)
       VALUES ('held-order', 'held-nonce', $1::jsonb, 'PAID', 150, 'ark')`,
      [JSON.stringify(order)]
    );
    const refunded = await shop.refund({ orderId: 'held-order', reason: 'auto-14d', actor: 'auto', staff: false });
    assert.equal(refunded.reason, 'account-hold');
    assert.equal(await balanceOf(pool, opened.schema, 'econ_held'), 500);
    const unmarked = '200000000000000402';
    await seedIdentity(pool, opened.schema, { econId: 'econ_shadow', discord: unmarked, eos: ['EOSSHADOW1'], status: 'restricted' });
    const shadow = await shop.quote({ discordUserId: unmarked, sku: 'coastal' });
    assert.equal(shadow.reason, 'restricted');
    assert.notEqual(shadow.reason, 'account-hold');
  } finally {
    await closeRuntime(opened);
  }
});
