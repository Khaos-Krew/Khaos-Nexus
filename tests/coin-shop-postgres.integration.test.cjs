'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { NexusEconomyPostgresRepository } = require('../src/sentinel/nexus-economy-postgres-repository.cjs');
const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');
const { PostgresCoinShop } = require('../src/economy-worker/coin-shop-postgres.cjs');
const { applyCoinShopMigration } = require('../src/economy-worker/coin-shop-migration.cjs');

const postgresUrl = process.env.NEXUS_TEST_POSTGRES_URL || '';
const local = (() => {
  if (!postgresUrl) return false;
  try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(postgresUrl).hostname); }
  catch { return false; }
})();
const skip = !postgresUrl || !local;
const DAY = Date.parse('2026-10-06T18:00:00.000Z');
const USER = '123456789012345678';
const STAFF = '424242424242424242';
const ECON = 'econ_coin_shop';

async function openShop(label) {
  assert.ok(local, 'integration database must be local');
  const schema = `coinshop_${label}_${crypto.randomBytes(3).toString('hex')}`;
  const pool = new Pool({ connectionString: postgresUrl, max: 6 });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(NexusEconomyPostgresRepository.schemaSql({ schema }));
  await applyCoinShopMigration({ pool, schema });
  let now = DAY;
  const shop = new PostgresCoinShop({
    pool,
    schema,
    now: () => now,
    env: {
      NEXUS_ECONOMY_COIN_SHOP_SPEND_ENABLED: 'true',
      NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '1000'
    }
  });
  await pool.query(
    `INSERT INTO "${schema}".nexus_economic_identities (economic_identity_id, status) VALUES ($1, 'verified')`,
    [ECON]
  );
  await pool.query(
    `INSERT INTO "${schema}".nexus_economic_identity_links
     (provider, external_id, economic_identity_id, verified_at, source)
     VALUES ('discord', $1, $2, $3, 'test')`,
    [USER, ECON, new Date(DAY).toISOString()]
  );
  await pool.query(
    `INSERT INTO "${schema}".nexus_economy_wallets (economic_identity_id, currency, balance) VALUES
     ($1, 'NEXUS_COINS', 2000),
     ($1, 'NEXUS_POINTS', 80)`,
    [ECON]
  );
  await pool.query(
    `INSERT INTO "${schema}".nexus_economic_identities (economic_identity_id, status) VALUES ('econ_coin_staff', 'verified')`
  );
  await pool.query(
    `INSERT INTO "${schema}".nexus_economic_identity_links
     (provider, external_id, economic_identity_id, verified_at, source)
     VALUES ('discord', $1, 'econ_coin_staff', $2, 'test')`,
    [STAFF, new Date(DAY).toISOString()]
  );
  return {
    pool,
    schema,
    shop,
    moveClock(ms) { now += ms; }
  };
}

async function closeShop(opened) {
  if (!opened) return;
  await opened.pool.query(`DROP SCHEMA IF EXISTS "${opened.schema}" CASCADE`).catch(() => {});
  await opened.pool.end().catch(() => {});
}

async function balances(pool, schema) {
  const rows = await pool.query(
    `SELECT currency, balance FROM "${schema}".nexus_economy_wallets WHERE economic_identity_id = $1`,
    [ECON]
  );
  const out = {};
  for (const row of rows.rows) out[row.currency] = Number(row.balance);
  return out;
}

test('postgres purchase debits Coins, replays once, and refuses a second nonce', { skip }, async () => {
  const opened = await openShop('buy');
  try {
    const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(quoted.ok, true, quoted.reason);
    const first = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
    assert.equal(first.ok, true, first.reason);
    assert.equal(first.balance, 2000 - 195);
    const replay = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.ledgerRef, first.ledgerRef);
    const other = await opened.shop.quote({ discordUserId: USER, sku: 'thm_nebula' });
    const left = opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: 'second-nonce' });
    const right = opened.shop.purchase({ discordUserId: USER, sku: 'thm_nebula', nonce: other.quote.nonce });
    assert.equal((await right).reason, 'in-flight');
    assert.equal((await left).reason, 'expired');
    const money = await balances(opened.pool, opened.schema);
    assert.equal(money.NEXUS_COINS, 2000 - 195);
    assert.equal(money.NEXUS_POINTS, 80);
    const ledger = await opened.pool.query(
      `SELECT currency, source, amount FROM "${opened.schema}".nexus_economy_ledger WHERE economic_identity_id = $1`,
      [ECON]
    );
    assert.equal(ledger.rowCount, 1);
    assert.equal(ledger.rows[0].currency, 'NEXUS_COINS');
    assert.equal(ledger.rows[0].source, 'sink:coin-shop');
    assert.equal(Number(ledger.rows[0].amount), -195);
    const pointsAttempt = await opened.shop.purchase({
      discordUserId: USER,
      sku: 'thm_nebula',
      nonce: other.quote.nonce,
      currency: 'NEXUS_POINTS'
    });
    assert.equal(pointsAttempt.reason, 'currency-rejected');
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_POINTS, 80);
  } finally {
    await closeShop(opened);
  }
});

test('postgres refund is once, refuses a held member, and clears the entitlement', { skip }, async () => {
  const opened = await openShop('refund');
  try {
    const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'thm_nebula' });
    const bought = await opened.shop.purchase({ discordUserId: USER, sku: 'thm_nebula', nonce: quoted.quote.nonce });
    assert.equal(bought.ok, true, bought.reason);
    const preview = await opened.shop.previewRefund({
      ledgerRef: bought.ledgerRef,
      reason: 'wrong theme',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(preview.ok, true, preview.reason);
    assert.equal(preview.duplicate, false);
    assert.equal(preview.sku, 'thm_nebula');
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000 - 285);
    const unsigned = await opened.shop.refund({ ledgerRef: bought.ledgerRef, reason: 'wrong theme', actor: USER });
    assert.equal(unsigned.reason, 'staff-required');
    const refunded = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'wrong theme',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(refunded.ok, true, refunded.reason);
    assert.equal(refunded.duplicate, false);
    const entitlement = await opened.pool.query(
      `SELECT status, equipped_at FROM "${opened.schema}".nexus_coin_shop_entitlements WHERE economic_identity_id = $1 AND sku = 'thm_nebula'`,
      [ECON]
    );
    assert.equal(entitlement.rows[0].status, 'refunded');
    assert.equal(entitlement.rows[0].equipped_at, null);
    const byShort = await opened.shop.refund({
      ledgerRef: `CS-${String(bought.ledgerId).padStart(4, '0')}`,
      reason: 'again',
      actor: USER,
      staffVerified: true
    });
    assert.equal(byShort.duplicate, true);
    const money = await balances(opened.pool, opened.schema);
    assert.equal(money.NEXUS_COINS, 2000);
    assert.equal(money.NEXUS_POINTS, 80);
    const credits = await opened.pool.query(
      `SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_economy_ledger WHERE entry_type = 'refund'`
    );
    assert.equal(credits.rows[0].n, 1);
  } finally {
    await closeShop(opened);
  }
});

test('a staff hold that commits during a purchase blocks the buy', { skip }, async () => {
  const opened = await openShop('midhold');
  try {
    await new PostgresEconomyAccrual({ pool: opened.pool, schema: opened.schema, now: () => DAY }).ensureSchema();
    const repository = new NexusEconomyPostgresRuntimeRepository({
      pool: opened.pool,
      schema: opened.schema,
      env: {},
      now: () => DAY
    });
    await repository.backfillLegacyRestrictedHolds();
    const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(quoted.ok, true, quoted.reason);
    let entered;
    const enteredGate = new Promise((resolve) => { entered = resolve; });
    let release;
    const releaseGate = new Promise((resolve) => { release = resolve; });
    opened.shop.beforeCoinShopLock = async () => {
      entered();
      await releaseGate;
    };
    const pending = opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
    await enteredGate;
    const held = await repository.placeStaffHold(USER, { reason: 'staff', heldBy: 'staff-test' });
    assert.equal(held.ok, true, held.reason);
    release();
    const result = await pending;
    assert.equal(result.reason, 'not-eligible');
    const money = await balances(opened.pool, opened.schema);
    assert.equal(money.NEXUS_COINS, 2000);
    assert.equal(money.NEXUS_POINTS, 80);
    const debits = await opened.pool.query(
      `SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_economy_ledger WHERE amount < 0`
    );
    assert.equal(debits.rows[0].n, 0);
  } finally {
    await closeShop(opened);
  }
});

test('postgres refund waits on the identity row and refuses a hold', { skip }, async () => {
  const opened = await openShop('hold');
  try {
    const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    const bought = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
    assert.equal(bought.ok, true, bought.reason);
    const blocker = await opened.pool.connect();
    let refundResult = null;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT status, hold_reason FROM "${opened.schema}".nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
        [ECON]
      );
      const pending = opened.shop.refund({
        ledgerRef: bought.ledgerRef,
        reason: 'while locked',
        actor: STAFF,
        staffVerified: true
      });
      pending.then((result) => { refundResult = result; });
      let waiting = 0;
      for (let attempt = 0; attempt < 20 && waiting === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const locks = await opened.pool.query(
          `SELECT COUNT(*)::int AS n FROM pg_locks WHERE NOT granted`
        );
        waiting = locks.rows[0].n;
      }
      assert.equal(waiting > 0, true);
      assert.equal(refundResult, null);
      await blocker.query('ROLLBACK');
      refundResult = await pending;
    } finally {
      blocker.release();
    }
    assert.equal(refundResult?.ok, true, refundResult?.reason);
    const second = await openPurchase(opened, 'thm_circuit');
    await opened.pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identities SET hold_reason = 'staff' WHERE economic_identity_id = $1`,
      [ECON]
    );
    const quotedAgain = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(quotedAgain.reason, 'not-eligible');
    const heldRefund = await opened.shop.refund({
      ledgerRef: second.ledgerRef,
      reason: 'held member',
      actor: USER,
      staffVerified: true
    });
    assert.equal(heldRefund.reason, 'member-held');
    const money = await balances(opened.pool, opened.schema);
    assert.equal(money.NEXUS_COINS, 2000 - 315);
    assert.equal(money.NEXUS_POINTS, 80);
  } finally {
    await closeShop(opened);
  }
});

async function openPurchase(opened, sku) {
  const quoted = await opened.shop.quote({ discordUserId: USER, sku });
  assert.equal(quoted.ok, true, quoted.reason);
  const bought = await opened.shop.purchase({ discordUserId: USER, sku, nonce: quoted.quote.nonce });
  assert.equal(bought.ok, true, bought.reason);
  return bought;
}

test('postgres daily cap and refund window follow the database clock, and a missed revoke blocks the credit', { skip }, async () => {
  const opened = await openShop('clock');
  try {
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, 'NEXUS_COINS', -1400, 2000, 'purchase', 'sink:coin-shop', 'old-spend', '{"sku":"seed","price":1400}'::jsonb, NOW() - INTERVAL '2 days')`,
      [ECON]
    );
    const bought = await openPurchase(opened, 'ttl_night_owl');
    await opened.pool.query(
      `UPDATE "${opened.schema}".nexus_economy_ledger SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1`,
      [bought.ledgerId]
    );
    const late = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'too late',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(late.reason, 'refund-window');
    const current = await openPurchase(opened, 'thm_nebula');
    await opened.pool.query(
      `DELETE FROM "${opened.schema}".nexus_coin_shop_entitlements WHERE economic_identity_id = $1 AND sku = 'thm_nebula'`,
      [ECON]
    );
    const blocked = await opened.shop.refund({
      ledgerRef: current.ledgerRef,
      reason: 'entitlement already gone',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(blocked.reason, 'revoke-failed');
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, 'NEXUS_COINS', -1400, 2000, 'purchase', 'sink:coin-shop', 'today-spend', '{"sku":"seed-today","price":1400}'::jsonb, NOW())`,
      [ECON]
    );
    const capped = await opened.shop.quote({ discordUserId: USER, sku: 'thm_circuit' });
    assert.equal(capped.reason, 'daily-cap');
    const money = await balances(opened.pool, opened.schema);
    assert.equal(money.NEXUS_COINS, 2000 - 195 - 285);
    assert.equal(money.NEXUS_POINTS, 80);
  } finally {
    await closeShop(opened);
  }
});

test('postgres does not treat an mc-link discord source as membership verification', { skip }, async () => {
  const opened = await openShop('mclink');
  try {
    await opened.pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identities SET status = 'restricted' WHERE economic_identity_id = $1`,
      [ECON]
    );
    await opened.pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identity_links SET source = 'mc-link' WHERE provider = 'discord' AND external_id = $1`,
      [USER]
    );
    const restricted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(restricted.reason, 'not-eligible');
    await opened.pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identities SET status = 'verified' WHERE economic_identity_id = $1`,
      [ECON]
    );
    const stamped = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(stamped.reason, 'not-eligible');
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000);
    await opened.pool.query(
      `UPDATE "${opened.schema}".nexus_economic_identity_links SET source = 'sentinel-ownership-proof' WHERE provider = 'discord' AND external_id = $1`,
      [USER]
    );
    const allowed = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(allowed.ok, true, allowed.reason);
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000);
  } finally {
    await closeShop(opened);
  }
});

test('postgres refuses a refund when the staff actor has no economic identity', { skip }, async () => {
  const stranger = '623456789012345678';
  const opened = await openShop('unlinked');
  try {
    const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    const bought = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
    assert.equal(bought.ok, true, bought.reason);
    const missing = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'no staff link',
      actor: stranger,
      staffVerified: true
    });
    assert.equal(missing.reason, 'staff-unlinked');
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000 - 195);
    const active = await opened.pool.query(
      `SELECT status FROM "${opened.schema}".nexus_coin_shop_entitlements WHERE economic_identity_id = $1 AND sku = 'ttl_night_owl'`,
      [ECON]
    );
    assert.equal(active.rows[0].status, 'active');
    await opened.pool.query(`ALTER TABLE "${opened.schema}".nexus_economic_identity_links RENAME TO nexus_economic_identity_links_hidden`);
    try {
      const broken = await opened.shop.refund({
        ledgerRef: bought.ledgerRef,
        reason: 'lookup failed',
        actor: STAFF,
        staffVerified: true
      });
      assert.equal(broken.reason, 'staff-unlinked');
    } finally {
      await opened.pool.query(`ALTER TABLE "${opened.schema}".nexus_economic_identity_links_hidden RENAME TO nexus_economic_identity_links`);
    }
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000 - 195);
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_POINTS, 80);
  } finally {
    await closeShop(opened);
  }
});

test('postgres blocks a refund from a Discord alt of the buyer', { skip }, async () => {
  const ALT = '523456789012345678';
  const opened = await openShop('altrefund');
  try {
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_economic_identity_links
       (provider, external_id, economic_identity_id, verified_at, source)
       VALUES ('discord', $1, $2, $3, 'test')`,
      [ALT, ECON, new Date(DAY).toISOString()]
    );
    const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    const bought = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
    assert.equal(bought.ok, true, bought.reason);
    const alt = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'alt of the buyer',
      actor: ALT,
      staffVerified: true
    });
    assert.equal(alt.reason, 'self-refund');
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000 - 195);
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_POINTS, 80);
    const row = await opened.pool.query(
      `SELECT status FROM "${opened.schema}".nexus_coin_shop_entitlements WHERE economic_identity_id = $1 AND sku = 'ttl_night_owl'`,
      [ECON]
    );
    assert.equal(row.rows[0].status, 'active');
    const staff = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'different identity',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(staff.ok, true, staff.reason);
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000);
  } finally {
    await closeShop(opened);
  }
});

test('postgres replay of a refunded receipt does not strip a re-bought copy', { skip }, async () => {
  const opened = await openShop('replay');
  try {
    const firstQuote = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    const first = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: firstQuote.quote.nonce });
    assert.equal(first.ok, true, first.reason);
    const refunded = await opened.shop.refund({
      ledgerRef: first.ledgerRef,
      reason: 'wrong theme',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(refunded.ok, true, refunded.reason);
    const secondQuote = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    const second = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: secondQuote.quote.nonce });
    assert.equal(second.ok, true, second.reason);
    assert.notEqual(second.ledgerRef, first.ledgerRef);
    const equipped = await opened.shop.markEquipped({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(equipped.ok, true, equipped.reason);
    const before = await opened.pool.query(
      `SELECT status, ledger_id, equipped_at
       FROM "${opened.schema}".nexus_coin_shop_entitlements
       WHERE economic_identity_id = $1 AND sku = 'ttl_night_owl'`,
      [ECON]
    );
    assert.equal(before.rows[0].status, 'active');
    assert.ok(before.rows[0].equipped_at);
    const replay = await opened.shop.refund({
      ledgerRef: first.ledgerRef,
      reason: 'replay the old receipt',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.duplicate, true);
    const after = await opened.pool.query(
      `SELECT status, ledger_id, equipped_at
       FROM "${opened.schema}".nexus_coin_shop_entitlements
       WHERE economic_identity_id = $1 AND sku = 'ttl_night_owl'`,
      [ECON]
    );
    assert.equal(after.rows[0].status, 'active');
    assert.equal(String(after.rows[0].ledger_id), String(before.rows[0].ledger_id));
    assert.equal(new Date(after.rows[0].equipped_at).toISOString(), new Date(before.rows[0].equipped_at).toISOString());
    const money = await balances(opened.pool, opened.schema);
    assert.equal(money.NEXUS_COINS, 2000 - 195);
    assert.equal(money.NEXUS_POINTS, 80);
    const refunds = await opened.pool.query(
      `SELECT COUNT(*)::int AS n FROM "${opened.schema}".nexus_economy_ledger WHERE entry_type = 'refund'`
    );
    assert.equal(refunds.rows[0].n, 1);
  } finally {
    await closeShop(opened);
  }
});

test('postgres blocks a self-refund and a staff actor past 10 refunds today', { skip }, async () => {
  const opened = await openShop('staffcap');
  try {
    const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    const bought = await opened.shop.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
    assert.equal(bought.ok, true, bought.reason);
    const own = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'my own purchase',
      actor: USER,
      staffVerified: true
    });
    assert.equal(own.reason, 'self-refund');
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000 - 195);
    const active = await opened.pool.query(
      `SELECT status FROM "${opened.schema}".nexus_coin_shop_entitlements WHERE economic_identity_id = $1 AND sku = 'ttl_night_owl'`,
      [ECON]
    );
    assert.equal(active.rows[0].status, 'active');
    for (let index = 0; index < 10; index += 1) {
      await opened.pool.query(
        `INSERT INTO "${opened.schema}".nexus_coin_shop_audit (audit_id, action, actor, reason, sku, created_at)
         VALUES ($1, 'refund', $2, 'earlier', 'ttl_night_owl', NOW())`,
        [`cap-${index}`, STAFF]
      );
    }
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_coin_shop_audit (audit_id, action, actor, reason, sku, created_at)
       VALUES ('cap-old', 'refund', $1, 'older', 'ttl_night_owl', NOW() - INTERVAL '2 days')`,
      [STAFF]
    );
    const capped = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'eleventh today',
      actor: STAFF,
      staffVerified: true
    });
    assert.equal(capped.reason, 'refund-cap');
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000 - 195);
    const other = '323456789012345678';
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_economic_identities (economic_identity_id, status) VALUES ('econ_coin_third', 'verified')`
    );
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_economic_identity_links
       (provider, external_id, economic_identity_id, verified_at, source)
       VALUES ('discord', $1, 'econ_coin_third', $2, 'test')`,
      [other, new Date(DAY).toISOString()]
    );
    const allowed = await opened.shop.refund({
      ledgerRef: bought.ledgerRef,
      reason: 'different staff',
      actor: other,
      staffVerified: true
    });
    assert.equal(allowed.ok, true, allowed.reason);
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000);
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_POINTS, 80);
  } finally {
    await closeShop(opened);
  }
});

test('postgres quotes are rate limited and expired quotes are pruned', { skip }, async () => {
  const opened = await openShop('quote');
  try {
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_coin_shop_quotes
       (nonce, discord_user_id, economic_identity_id, sku, price, expected_balance, expires_at)
       VALUES ('stale', $1, $2, 'ttl_night_owl', 195, 2000, $3)`,
      [USER, ECON, new Date(DAY - 1000).toISOString()]
    );
    const week = 7 * 24 * 60 * 60 * 1000;
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_coin_shop_attempts (economic_identity_id, created_at) VALUES ($1, $2)`,
      [ECON, new Date(DAY - week - 1000).toISOString()]
    );
    for (let index = 0; index < 5; index += 1) {
      const quoted = await opened.shop.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
      assert.equal(quoted.ok, true, quoted.reason);
    }
    const stale = await opened.pool.query(
      `SELECT 1 FROM "${opened.schema}".nexus_coin_shop_quotes WHERE nonce = 'stale'`
    );
    assert.equal(stale.rowCount, 0);
    const oldAttempts = await opened.pool.query(
      `SELECT created_at FROM "${opened.schema}".nexus_coin_shop_attempts WHERE created_at < $1`,
      [new Date(DAY - week).toISOString()]
    );
    assert.equal(oldAttempts.rowCount, 0);
    const recentAt = new Date(DAY - 60 * 1000).toISOString();
    await opened.pool.query(
      `INSERT INTO "${opened.schema}".nexus_coin_shop_attempts (economic_identity_id, created_at) VALUES ($1, $2)`,
      [ECON, recentAt]
    );
    const blocked = await opened.shop.quote({ discordUserId: USER, sku: 'thm_nebula' });
    assert.equal(blocked.reason, 'rate-limited');
    const recentAttempts = await opened.pool.query(
      `SELECT 1 FROM "${opened.schema}".nexus_coin_shop_attempts WHERE created_at = $1`,
      [recentAt]
    );
    assert.equal(recentAttempts.rowCount, 1);
    assert.equal((await balances(opened.pool, opened.schema)).NEXUS_COINS, 2000);
  } finally {
    await closeShop(opened);
  }
});
