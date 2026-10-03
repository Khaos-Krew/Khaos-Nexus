'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { createPostgresEconomyRuntime } = require('../src/economy-worker/postgres-runtime.cjs');
const { deterministicEconomicIdentityId } = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');
const { MEMBER_HOLD_MESSAGE } = require('../src/sentinel/nexus-economy-identity-hold.cjs');

const MESSAGE = MEMBER_HOLD_MESSAGE;

test('real Postgres hold marker, Shadow Recruit coins, and lazy accrual checkpoint', { skip: !process.env.NEXUS_TEST_POSTGRES_URL }, async () => {
  const url = process.env.NEXUS_TEST_POSTGRES_URL;
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname), 'integration database must be local');
  const schema = `hold_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  const shadow = '211111111111111111';
  const marked = '311111111111111111';
  const deniedDiscord = '411111111111111111';
  const deniedId = deterministicEconomicIdentityId(deniedDiscord);
  let now = Date.parse('2026-10-01T12:00:00.000Z');
  let runtime;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const env = {
      NEXUS_ECONOMY_DATABASE_URL: url,
      NEXUS_ECONOMY_SCHEMA: schema,
      NEXUS_ECONOMY_IDENTITY_LINKS_ENABLED: 'true',
      NEXUS_ECONOMY_QUARANTINE_DENYLIST: deniedId
    };
    runtime = await createPostgresEconomyRuntime({ env, now: () => now });
    const { repository, walletCore, accrual } = runtime;

    await repository.ensureShadowRecruitWallet(shadow, 'shadow-recruit', { env });
    const elevated = await repository.linkVerifiedIdentity({
      discordUserId: shadow,
      eosId: 'EOS_SHADOW_LINK_01',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    assert.equal(elevated.ok, true);
    assert.equal(elevated.status, 'verified');
    const shadowRow = await runtime.pool.query(
      `SELECT status, hold_reason FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [elevated.economicIdentityId]
    );
    assert.equal(shadowRow.rows[0].status, 'verified');
    assert.equal(shadowRow.rows[0].hold_reason, null);

    const recruit = '511111111111111111';
    const recruited = await repository.ensureShadowRecruitWallet(recruit, 'shadow-recruit', { env });
    assert.equal(recruited.ok, true);
    assert.equal(recruited.status, 'restricted');
    await runtime.pool.query(
      `UPDATE "${schema}".nexus_economy_wallets SET balance = 40 WHERE economic_identity_id = $1 AND currency = 'NEXUS_COINS'`,
      [recruited.economicIdentityId]
    );
    await assert.rejects(
      () => walletCore.spend({
        discordUserId: recruit,
        amount: 5,
        orderId: 'shadow_coins',
        currency: 'NEXUS_COINS'
      }),
      (error) => {
        assert.equal(error.message, 'Verified economic identity is required.');
        assert.doesNotMatch(error.message, /on hold/);
        return true;
      }
    );
    await assert.rejects(
      () => walletCore.credit({
        discordUserId: recruit,
        amount: 1,
        idempotencyKey: 'shadow_coin_credit',
        currency: 'NEXUS_COINS'
      }),
      /Verified economic identity is required/
    );
    await assert.rejects(
      () => walletCore.spend({ discordUserId: recruit, amount: 1, orderId: 'shadow_np', currency: 'NEXUS_POINTS' }),
      (error) => {
        assert.equal(error.message, 'Verified economic identity is required.');
        assert.doesNotMatch(error.message, /on hold/);
        return true;
      }
    );

    await repository.linkVerifiedIdentity({
      discordUserId: marked,
      eosId: 'EOS_MARKED_HOLD_01',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    await accrual.syncRank(marked, 'cipher-runner');
    const identity = await repository.getIdentityByLink('discord', marked);
    await runtime.pool.query(
      `UPDATE "${schema}".nexus_economy_accrual_state SET online = false, offline_since = $2, last_passive_at = $2, last_presence_at = $2, last_accounting_at = $2 WHERE economic_identity_id = $1`,
      [identity.economic_identity_id, new Date(now - 10 * 3_600_000).toISOString()]
    );
    await runtime.pool.query(
      `UPDATE "${schema}".nexus_economy_wallets SET balance = 20 WHERE economic_identity_id = $1 AND currency = 'NEXUS_COINS'`,
      [identity.economic_identity_id]
    );
    const applied = await repository.placeStaffHold(marked, { reason: 'staff', heldBy: 'staff-test' });
    assert.equal(applied.checkpointAt, new Date(now).toISOString());
    const relink = await repository.linkVerifiedIdentity({
      discordUserId: marked,
      eosId: 'EOS_MARKED_HOLD_01',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    assert.equal(relink.ok, false);
    assert.equal(relink.reason, 'account-hold');
    assert.equal(relink.message, MESSAGE);
    const markedCoins = await walletCore.spend({ discordUserId: marked, amount: 1, orderId: 'marked_coins', currency: 'NEXUS_COINS' });
    assert.equal(markedCoins.reason, 'account-hold');
    assert.equal(markedCoins.message, MESSAGE);
    const markedNp = await walletCore.spend({ discordUserId: marked, amount: 1, orderId: 'marked_np', currency: 'NEXUS_POINTS' });
    assert.equal(markedNp.reason, 'account-hold');
    assert.equal(markedNp.message, MESSAGE);

    now += 5 * 3_600_000;
    const lifted = await repository.liftIdentityHold(marked, { actor: 'staff-test' });
    const holdAudits = await runtime.pool.query(
      `SELECT action, prior_hold_reason, actor, checkpoint_at FROM "${schema}".nexus_economy_identity_hold_audit WHERE economic_identity_id = $1 ORDER BY audit_id`,
      [identity.economic_identity_id]
    );
    assert.deepEqual(holdAudits.rows.map((row) => row.action), ['place', 'lift']);
    assert.equal(holdAudits.rows[0].actor, 'staff-test');
    assert.equal(holdAudits.rows[1].prior_hold_reason, 'staff');
    assert.equal(new Date(holdAudits.rows[1].checkpoint_at).toISOString(), lifted.checkpointAt);
    assert.equal(lifted.lifted, true);
    assert.equal(lifted.checkpointAt, new Date(now).toISOString());
    const paid = await accrual.accrueOffline(marked);
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal(paid.credited, 0);
    now += 3_600_000;
    const nextHour = await accrual.accrueOffline(marked);
    assert.equal(nextHour.credited, 4);

    await runtime.pool.query(
      `UPDATE "${schema}".nexus_economic_identities SET status = 'disabled', hold_reason = NULL, held_by = NULL WHERE economic_identity_id = $1`,
      [identity.economic_identity_id]
    );
    const disabledLink = await repository.linkVerifiedIdentity({
      discordUserId: marked,
      eosId: 'EOS_MARKED_HOLD_01',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    assert.equal(disabledLink.reason, 'account-hold');
    const disabledSpend = await walletCore.spend({ discordUserId: marked, amount: 1, orderId: 'disabled_coins', currency: 'NEXUS_COINS' });
    assert.equal(disabledSpend.message, MESSAGE);

    const denied = await repository.ensureShadowRecruitWallet(deniedDiscord, 'shadow-recruit', { env });
    assert.equal(denied.rejected, 'quarantine-denylist');
    const deniedLink = await repository.linkVerifiedIdentity({
      discordUserId: deniedDiscord,
      eosId: 'EOS_DENIED_HOLD_01',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    assert.equal(deniedLink.ok, false);
    assert.equal(deniedLink.message, MESSAGE);
    await runtime.pool.query(
      `INSERT INTO "${schema}".nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source)
       VALUES ('discord', $1, $2, NOW(), 'test')
       ON CONFLICT (provider, external_id) DO UPDATE SET economic_identity_id = EXCLUDED.economic_identity_id`,
      [deniedDiscord, deniedId]
    );
    await runtime.pool.query(
      `UPDATE "${schema}".nexus_economy_wallets SET balance = 9 WHERE economic_identity_id = $1 AND currency = 'NEXUS_COINS'`,
      [deniedId]
    );
    const deniedSpend = await walletCore.spend({ discordUserId: deniedDiscord, amount: 1, orderId: 'denied_coins', currency: 'NEXUS_COINS' });
    assert.equal(deniedSpend.message, MESSAGE);
    const deniedNp = await walletCore.spend({ discordUserId: deniedDiscord, amount: 1, orderId: 'denied_np', currency: 'NEXUS_POINTS' });
    assert.equal(deniedNp.message, MESSAGE);
  } finally {
    if (runtime) await runtime.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});

test('real Postgres legacy-review backfill marks a funded restricted row and leaves an empty Shadow Recruit unmarked', { skip: !process.env.NEXUS_TEST_POSTGRES_URL }, async () => {
  const url = process.env.NEXUS_TEST_POSTGRES_URL;
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname), 'integration database must be local');
  const schema = `legacy_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
  const legacyId = 'econ_legacy_064c274f0fbe961a05cd66263ed214b3';
  const legacyDiscord = '143900000000000984';
  const shadowDiscord = '611111111111111111';
  const shadowId = 'econ_shadow_empty_review';
  const coinsDiscord = '711111111111111111';
  const coinsId = 'econ_coins_only_review';
  const levelDiscord = '811111111111111111';
  const levelId = 'econ_shadow_level_coins';
  let now = Date.parse('2026-10-01T12:00:00.000Z');
  let runtime;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map((part) => String(part)).join(' '));
    originalLog(...args);
  };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(NexusEconomyPostgresRuntimeRepository.runtimeSchemaSql({ schema }));
    await admin.query(
      `INSERT INTO "${schema}".nexus_economic_identities (economic_identity_id, status) VALUES ($1, 'restricted'), ($2, 'restricted'), ($3, 'restricted'), ($4, 'restricted')`,
      [legacyId, shadowId, coinsId, levelId]
    );
    await admin.query(
      `INSERT INTO "${schema}".nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source) VALUES
        ('discord', $2, $1, NOW(), 'legacy-economy-json'),
        ('eos', '0002a40e00000001', $1, NOW(), 'legacy-economy-json'),
        ('discord', $4, $3, NULL, 'shadow-recruit-rank'),
        ('discord', $6, $5, NULL, 'shadow-recruit-rank'),
        ('discord', $8, $7, NULL, 'shadow-recruit-rank')`,
      [legacyId, legacyDiscord, shadowId, shadowDiscord, coinsId, coinsDiscord, levelId, levelDiscord]
    );
    await admin.query(
      `INSERT INTO "${schema}".nexus_economy_wallets (economic_identity_id, currency, balance) VALUES
        ($1, 'NEXUS_POINTS', 147),
        ($1, 'NEXUS_COINS', 0),
        ($1, 'DINO_CACHE_TOKENS', 0),
        ($2, 'NEXUS_POINTS', 0),
        ($2, 'NEXUS_COINS', 0),
        ($2, 'DINO_CACHE_TOKENS', 0),
        ($3, 'NEXUS_COINS', 12),
        ($3, 'NEXUS_POINTS', 0),
        ($4, 'NEXUS_COINS', 25),
        ($4, 'NEXUS_POINTS', 0),
        ($4, 'DINO_CACHE_TOKENS', 0)`,
      [legacyId, shadowId, coinsId, levelId]
    );
    await admin.query(
      `INSERT INTO "${schema}".nexus_economy_ledger
        (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key)
       VALUES ($1, 'NEXUS_POINTS', 147, 147, 'credit', 'legacy-economy-json', $2)`,
      [legacyId, `legacy:${legacyId}`]
    );
    await admin.query(
      `INSERT INTO "${schema}".nexus_economy_ledger
        (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key)
       VALUES ($1, 'NEXUS_COINS', 25, 25, 'credit', 'community-level-up', $2)`,
      [levelId, `level:${levelId}`]
    );
    const previewRepository = new NexusEconomyPostgresRuntimeRepository({ pool: admin, schema });
    const preview = await previewRepository.previewLegacyRestrictedHolds();
    assert.equal(preview.dryRun, true);
    assert.equal(preview.wouldMark, 1);
    assert.equal(preview.byReason.verifiedEosOrMinecraftLink, 1);
    assert.equal(preview.byReason.npOrCacheTokenLedger, 1);
    assert.equal(preview.byReason.nonzeroNpOrCacheTokenBalance, 1);
    assert.equal(preview.byReason.excludedCoinLedgerOnly, 1);
    assert.match(preview.sql, /g\.currency IN \('NEXUS_POINTS', 'DINO_CACHE_TOKENS'\)/);
    assert.doesNotMatch(preview.sql.slice(0, preview.sql.indexOf('c.currency')), /NEXUS_COINS/);
    runtime = await createPostgresEconomyRuntime({
      env: {
        NEXUS_ECONOMY_DATABASE_URL: url,
        NEXUS_ECONOMY_SCHEMA: schema,
        NEXUS_ECONOMY_IDENTITY_LINKS_ENABLED: 'true'
      },
      now: () => now
    });
    assert.match(logs.join('\n'), /legacy_review_hold_backfill marked=1/);
    const rows = await runtime.pool.query(
      `SELECT economic_identity_id, status, hold_reason FROM "${schema}".nexus_economic_identities ORDER BY economic_identity_id`
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.economic_identity_id, row]));
    assert.equal(byId[legacyId].status, 'restricted');
    assert.equal(byId[legacyId].hold_reason, 'legacy-review');
    assert.equal(byId[shadowId].hold_reason, null);
    assert.equal(byId[coinsId].hold_reason, null);
    assert.equal(byId[levelId].status, 'restricted');
    assert.equal(byId[levelId].hold_reason, null);

    const linked = await runtime.repository.linkVerifiedIdentity({
      discordUserId: legacyDiscord,
      eosId: '0002a40e00000001',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    assert.equal(linked.ok, false);
    assert.equal(linked.reason, 'account-hold');
    assert.equal(linked.message, MESSAGE);
    const still = await runtime.pool.query(
      `SELECT status, hold_reason FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [legacyId]
    );
    assert.equal(still.rows[0].status, 'restricted');
    assert.equal(still.rows[0].hold_reason, 'legacy-review');

    const coinSpend = await runtime.walletCore.spend({
      discordUserId: legacyDiscord, amount: 1, orderId: 'legacy_coins', currency: 'NEXUS_COINS'
    });
    assert.equal(coinSpend.reason, 'account-hold');
    assert.equal(coinSpend.message, MESSAGE);
    const pointSpend = await runtime.walletCore.spend({
      discordUserId: legacyDiscord, amount: 1, orderId: 'legacy_np', currency: 'NEXUS_POINTS'
    });
    assert.equal(pointSpend.reason, 'account-hold');
    assert.equal(pointSpend.message, MESSAGE);
    const accrued = await runtime.accrual.accrueOffline(legacyDiscord);
    assert.equal(accrued.reason, 'account-hold');
    assert.equal(accrued.credited, 0);
    assert.equal(await runtime.walletCore.balance(legacyDiscord, 'NEXUS_POINTS'), 147);

    const elevated = await runtime.repository.linkVerifiedIdentity({
      discordUserId: shadowDiscord,
      eosId: 'EOS_EMPTY_SHADOW_01',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    assert.equal(elevated.ok, true);
    assert.equal(elevated.status, 'verified');
    const shadowRow = await runtime.pool.query(
      `SELECT status, hold_reason FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [shadowId]
    );
    assert.equal(shadowRow.rows[0].status, 'verified');
    assert.equal(shadowRow.rows[0].hold_reason, null);

    const levelLinked = await runtime.repository.linkVerifiedIdentity({
      discordUserId: levelDiscord,
      eosId: 'EOS_LEVEL_SHADOW_01',
      verifiedAt: new Date(now).toISOString(),
      discordMembershipVerified: true
    });
    assert.equal(levelLinked.ok, true, JSON.stringify(levelLinked));
    assert.equal(levelLinked.status, 'verified');
    const levelRow = await runtime.pool.query(
      `SELECT status, hold_reason FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [levelId]
    );
    assert.equal(levelRow.rows[0].status, 'verified');
    assert.equal(levelRow.rows[0].hold_reason, null);

    await runtime.pool.query(
      `UPDATE "${schema}".nexus_economic_identities SET hold_reason = NULL WHERE economic_identity_id = $1`,
      [legacyId]
    );
    const again = await runtime.repository.backfillLegacyRestrictedHolds();
    assert.equal(again.skipped, 'already-applied');
    assert.equal(again.marked, 0);
    const lifted = await runtime.pool.query(
      `SELECT hold_reason FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [legacyId]
    );
    assert.equal(lifted.rows[0].hold_reason, null);
  } finally {
    console.log = originalLog;
    if (runtime) await runtime.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});

function runIdentityHold(args, env) {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'identity-hold.cjs'), ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  const line = String(result.stdout || '').trim().split('\n').filter((row) => row.startsWith('{')).pop();
  let json = null;
  if (line) json = JSON.parse(line);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test('real Postgres identity-hold script places, lists, audits, checkpoints, and lifts', { skip: !process.env.NEXUS_TEST_POSTGRES_URL }, async () => {
  const url = process.env.NEXUS_TEST_POSTGRES_URL;
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname), 'integration database must be local');
  const schema = `cli_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  const identityId = 'econ_cli_hold_review';
  const env = {
    NEXUS_ECONOMY_DATABASE_URL: url,
    NEXUS_ECONOMY_SCHEMA: schema
  };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const { NexusEconomyPostgresRuntimeRepository } = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
    await admin.query(NexusEconomyPostgresRuntimeRepository.runtimeSchemaSql({ schema }));
    await admin.query(
      `INSERT INTO "${schema}".nexus_economic_identities (economic_identity_id, status) VALUES ($1, 'restricted')`,
      [identityId]
    );
    const dry = runIdentityHold(['--dry-run'], env);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(dry.json.dryRun, true);
    assert.equal(dry.json.wouldMark, 0);
    const unchanged = await admin.query(
      `SELECT hold_reason FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [identityId]
    );
    assert.equal(unchanged.rows[0].hold_reason, null);

    const placed = runIdentityHold(['place', '--identity', identityId, '--reason', 'legacy-review', '--actor', 'ops-lead'], env);
    assert.equal(placed.status, 0, `${placed.stderr}\n${placed.stdout}`);
    assert.equal(placed.json.ok, true);
    assert.equal(placed.json.holdReason, 'legacy-review');
    assert.ok(placed.json.auditId);
    const held = await admin.query(
      `SELECT status, hold_reason, held_by FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [identityId]
    );
    assert.equal(held.rows[0].status, 'restricted');
    assert.equal(held.rows[0].hold_reason, 'legacy-review');
    assert.equal(held.rows[0].held_by, 'ops-lead');
    const cursor = await admin.query(
      `SELECT online, online_uncredited_ms, offline_since, last_passive_at, last_presence_at, last_accounting_at
       FROM "${schema}".nexus_economy_accrual_state WHERE economic_identity_id = $1`,
      [identityId]
    );
    assert.equal(cursor.rows[0].online, false);
    assert.equal(Number(cursor.rows[0].online_uncredited_ms), 0);
    const checkpoint = new Date(placed.json.checkpointAt).toISOString();
    for (const column of ['offline_since', 'last_passive_at', 'last_presence_at', 'last_accounting_at']) {
      assert.equal(new Date(cursor.rows[0][column]).toISOString(), checkpoint);
    }

    const listed = runIdentityHold(['list'], env);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(listed.json.holds.length, 1);
    assert.equal(listed.json.holds[0].economicIdentityId, identityId);
    assert.equal(listed.json.holds[0].holdReason, 'legacy-review');

    const lifted = runIdentityHold(['lift', '--identity', identityId, '--actor', 'ops-lead'], env);
    assert.equal(lifted.status, 0, `${lifted.stderr}\n${lifted.stdout}`);
    assert.equal(lifted.json.lifted, true);
    assert.equal(lifted.json.priorReason, 'legacy-review');
    const cleared = await admin.query(
      `SELECT hold_reason, held_by FROM "${schema}".nexus_economic_identities WHERE economic_identity_id = $1`,
      [identityId]
    );
    assert.equal(cleared.rows[0].hold_reason, null);
    assert.equal(cleared.rows[0].held_by, null);
    const audits = await admin.query(
      `SELECT action, hold_reason, prior_hold_reason, actor, checkpoint_at
       FROM "${schema}".nexus_economy_identity_hold_audit WHERE economic_identity_id = $1 ORDER BY audit_id`,
      [identityId]
    );
    assert.deepEqual(audits.rows.map((row) => row.action), ['place', 'lift']);
    assert.equal(audits.rows[0].hold_reason, 'legacy-review');
    assert.equal(audits.rows[0].actor, 'ops-lead');
    assert.equal(audits.rows[1].prior_hold_reason, 'legacy-review');
    assert.equal(audits.rows[1].actor, 'ops-lead');
    assert.equal(new Date(audits.rows[1].checkpoint_at).toISOString(), new Date(lifted.json.checkpointAt).toISOString());
    const after = await admin.query(
      `SELECT online, last_passive_at FROM "${schema}".nexus_economy_accrual_state WHERE economic_identity_id = $1`,
      [identityId]
    );
    assert.equal(after.rows[0].online, false);
    assert.equal(new Date(after.rows[0].last_passive_at).toISOString(), new Date(lifted.json.checkpointAt).toISOString());
    const empty = runIdentityHold(['list'], env);
    assert.equal(empty.json.holds.length, 0);
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
