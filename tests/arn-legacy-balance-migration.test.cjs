'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  planLegacyArnBalances,
  migrateLegacyArnBalances,
  migrateKey
} = require('../src/sentinel/arn-legacy-balance-migration.cjs');

const ENV = { ARN_ECONOMY_WRITES_ENABLED: 'true', ARN_DRY_RUN: 'true', ARN_TOKENS_ENABLED: 'false' };
const LINKED = '111111111111111111';
const OTHER = '222222222222222222';

function memoryPg(links = {}) {
  const state = { links, wallets: [], ledger: [], holds: [], missingHolds: false };
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push(text);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (/pg_advisory_xact_lock/.test(text)) return { rows: [] };
      if (/nexus_economy_arn_migration_holds/.test(text)) {
        if (state.missingHolds) {
          const error = new Error('relation "nexus_economy_arn_migration_holds" does not exist');
          error.code = '42P01';
          throw error;
        }
        if (/INSERT INTO/.test(text)) {
          if (!state.holds.some((row) => row.discord_user_id === params[0])) {
            state.holds.push({ discord_user_id: params[0], amount: params[1], status: 'pending', economic_identity_id: null });
          }
          return { rows: [] };
        }
        if (/UPDATE/.test(text)) {
          const hold = state.holds.find((row) => row.discord_user_id === params[0] && row.status === 'pending');
          if (hold) {
            hold.status = 'credited';
            hold.economic_identity_id = params[1];
          }
          return { rows: [] };
        }
        return { rows: state.holds };
      }
      if (/nexus_economic_identit/.test(text)) {
        const rows = [];
        for (const discord of params[0] || []) {
          for (const economicIdentityId of state.links[discord] || []) rows.push({ discord_user_id: discord, economic_identity_id: economicIdentityId });
        }
        return { rows };
      }
      if (/nexus_economy_ledger/.test(text)) {
        if (/INSERT INTO/.test(text)) {
          state.ledger.push({
            economic_identity_id: params[0],
            amount: params[1],
            balance_after: params[2],
            idempotency_key: params[3],
            metadata: JSON.parse(params[4]),
            source: 'arn_migrate'
          });
          return { rows: [] };
        }
        if (/idempotency_key = \$1/.test(text)) {
          const row = state.ledger.find((entry) => entry.idempotency_key === params[0]);
          return { rows: row ? [row] : [] };
        }
        return { rows: state.ledger };
      }
      if (/nexus_economy_wallets/.test(text)) {
        if (/INSERT INTO/.test(text)) {
          state.wallets.push({ economic_identity_id: params[0], balance: params[1] });
          return { rows: [] };
        }
        if (/UPDATE/.test(text)) {
          const wallet = state.wallets.find((row) => row.economic_identity_id === params[0]);
          if (wallet) wallet.balance = params[1];
          return { rows: [] };
        }
        const wallet = state.wallets.find((row) => row.economic_identity_id === params[0]);
        return { rows: wallet ? [wallet] : [] };
      }
      throw new Error(`unexpected sql: ${text}`);
    }
  };
  return { state, client, queries };
}

test('legacy ARN dry run reports the credit and writes nothing', async () => {
  let queries = 0;
  let frozen = 0;
  const result = await migrateLegacyArnBalances({
    apply: false,
    wallets: [{ discordUserId: LINKED, balance: 3 }],
    resolutions: { [LINKED]: ['econ-1'] },
    holds: [],
    credits: [],
    client: { async query() { queries += 1; throw new Error('wrote'); } },
    freezeWallet: async () => { frozen += 1; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.rows[0].action, 'credit');
  assert.equal(result.rows[0].amount, 3);
  assert.equal(result.rows[0].economicIdentityId, 'econ-1');
  assert.equal(queries, 0);
  assert.equal(frozen, 0);
});

test('legacy ARN apply stays closed when ARN economy writes are off', async () => {
  let queries = 0;
  const result = await migrateLegacyArnBalances({
    apply: true,
    env: {},
    wallets: [{ discordUserId: LINKED, balance: 5 }],
    client: { async query() { queries += 1; return { rows: [] }; } },
    freezeWallet: async () => { throw new Error('froze'); }
  });
  assert.deepEqual(result, { ok: false, reason: 'writes-disabled', applied: false });
  assert.equal(queries, 0);
});

test('legacy ARN apply credits a linked balance once and keeps the hold amount', async () => {
  const pg = memoryPg({ [LINKED]: [] });
  let frozen = 0;
  const freezeWallet = async () => { frozen += 1; };
  const held = await migrateLegacyArnBalances({
    apply: true,
    env: ENV,
    wallets: [{ discord_user_id: LINKED, balance: '4' }],
    client: pg.client,
    freezeWallet
  });
  assert.equal(held.ok, true);
  assert.equal(held.applied, true);
  assert.equal(held.rows[0].action, 'hold');
  assert.equal(pg.state.ledger.length, 0);
  assert.equal(pg.state.holds[0].status, 'pending');
  assert.equal(pg.state.holds[0].amount, 4);
  assert.equal(frozen, 1);

  const stillHeld = await migrateLegacyArnBalances({
    apply: true,
    env: ENV,
    wallets: [{ discord_user_id: LINKED, balance: 9 }],
    client: pg.client,
    freezeWallet
  });
  assert.equal(stillHeld.rows[0].action, 'hold-existing');
  assert.equal(stillHeld.rows[0].amount, 4);
  assert.equal(pg.state.holds.length, 1);
  assert.equal(pg.state.ledger.length, 0);

  pg.state.links[LINKED] = ['econ-1', 'econ-1'];
  const released = await migrateLegacyArnBalances({
    apply: true,
    env: ENV,
    wallets: [{ discord_user_id: LINKED, balance: 9 }],
    client: pg.client,
    freezeWallet
  });
  assert.equal(released.rows[0].action, 'release');
  assert.equal(released.rows[0].amount, 4);
  assert.equal(pg.state.ledger.length, 1);
  assert.equal(pg.state.ledger[0].amount, 4);
  assert.equal(pg.state.ledger[0].balance_after, 4);
  assert.equal(pg.state.ledger[0].idempotency_key, migrateKey('econ-1'));
  assert.equal(pg.state.ledger[0].source, 'arn_migrate');
  assert.deepEqual(pg.state.ledger[0].metadata, { reason: 'arn_migrate', discordUserId: LINKED, legacyBalance: 4 });
  assert.equal(pg.state.wallets[0].balance, 4);
  assert.equal(pg.state.holds[0].status, 'credited');
  assert.equal(pg.state.holds[0].economic_identity_id, 'econ-1');
  assert.match(pg.queries.find((sql) => /INSERT INTO/.test(sql) && /nexus_economy_ledger/.test(sql)), /'arn_migrate'/);

  const replay = await migrateLegacyArnBalances({
    apply: true,
    env: ENV,
    wallets: [{ discord_user_id: LINKED, balance: 9 }],
    client: pg.client,
    freezeWallet
  });
  assert.equal(replay.rows[0].action, 'duplicate');
  assert.equal(pg.state.ledger.length, 1);
  assert.equal(pg.state.wallets[0].balance, 4);
  assert.equal(frozen, 4);
});

test('legacy ARN apply refuses a shared identity, invalid rows, and a missing hold table', async () => {
  const shared = memoryPg({ [LINKED]: ['econ-same'], [OTHER]: ['econ-same'] });
  let frozen = 0;
  const blocked = await migrateLegacyArnBalances({
    apply: true,
    env: ENV,
    wallets: [
      { discordUserId: LINKED, balance: 2 },
      { discordUserId: OTHER, balance: 3 }
    ],
    client: shared.client,
    freezeWallet: async () => { frozen += 1; }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'blocked');
  assert.equal(blocked.applied, false);
  assert.equal(blocked.rows.every((row) => row.action === 'ambiguous'), true);
  assert.equal(shared.state.ledger.length, 0);
  assert.equal(shared.state.holds.length, 0);
  assert.equal(frozen, 0);
  assert.equal(shared.queries.some((sql) => sql === 'BEGIN'), false);

  const invalid = await migrateLegacyArnBalances({
    apply: true,
    env: ENV,
    wallets: [{ discordUserId: 'nope', balance: 5 }, { discordUserId: LINKED, balance: -1 }, { discordUserId: OTHER, balance: 0 }],
    resolutions: { [OTHER]: ['econ-2'] },
    holds: [],
    credits: [],
    freezeWallet: async () => { frozen += 1; }
  });
  assert.equal(invalid.reason, 'blocked');
  assert.deepEqual(invalid.rows.map((row) => row.action), ['invalid', 'invalid', 'skip']);
  assert.equal(frozen, 0);

  const missing = memoryPg({ [LINKED]: ['econ-1'] });
  missing.state.missingHolds = true;
  const refused = await migrateLegacyArnBalances({
    apply: true,
    env: ENV,
    wallets: [{ discordUserId: LINKED, balance: 1 }],
    client: missing.client,
    freezeWallet: async () => { frozen += 1; }
  });
  assert.equal(refused.reason, 'holds-table-missing');
  assert.equal(refused.applied, false);
  assert.match(refused.message, /apply-economy-sql-migrations/);
  assert.equal(frozen, 0);

  const report = await migrateLegacyArnBalances({
    apply: false,
    wallets: [{ discordUserId: LINKED, balance: 1 }],
    client: missing.client
  });
  assert.equal(report.ok, true);
  assert.equal(report.holdsTableReady, false);
  assert.equal(report.rows[0].action, 'credit');
});

test('legacy ARN planning skips zero, collapses one identity, and conflicts on another Discord key', () => {
  const same = planLegacyArnBalances({
    wallets: [{ discordUserId: LINKED, balance: 2 }, { discordUserId: OTHER, balance: 0 }],
    identities: { [LINKED]: ['econ-1', 'econ-1'] },
    holds: [],
    credits: []
  });
  assert.deepEqual(same.rows.map((row) => row.action), ['credit', 'skip']);
  const conflict = planLegacyArnBalances({
    wallets: [{ discordUserId: LINKED, balance: 2 }],
    identities: { [LINKED]: ['econ-1'] },
    holds: [],
    credits: [{ idempotency_key: 'arn-migrate:econ-1', amount: 2, metadata: { discordUserId: OTHER } }]
  });
  assert.equal(conflict.blocked, true);
  assert.equal(conflict.rows[0].action, 'conflict');
  const ambiguous = planLegacyArnBalances({
    wallets: [{ discordUserId: LINKED, balance: 2 }],
    identities: { [LINKED]: ['econ-1', 'econ-2'] },
    holds: [],
    credits: []
  });
  assert.equal(ambiguous.rows[0].action, 'ambiguous');
  assert.equal(ambiguous.rows.some((row) => row.action === 'hold'), false);
});

test('legacy ARN migration is a staff script and is not wired into boot', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src/sentinel/arn-legacy-balance-migration.cjs'), 'utf8');
  const identitySql = source.slice(source.indexOf('SELECT d.external_id'), source.indexOf('nexus_economy_ledger', source.indexOf('SELECT d.external_id')));
  assert.doesNotMatch(identitySql, /DISTINCT|FOR UPDATE/);
  const script = fs.readFileSync(path.join(root, 'scripts/migrate-legacy-arn-balances.cjs'), 'utf8');
  assert.match(script, /--apply/);
  assert.match(script, /nexus_arn_wallet_freeze/);
  assert.match(script, /balance <> 0/);
  assert.doesNotMatch(script, /ArnTokenLedger|connectMysql\(/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['economy:arn-migrate'], 'node scripts/migrate-legacy-arn-balances.cjs');
  assert.doesNotMatch(`${pkg.scripts.start} ${pkg.scripts.sentinel} ${pkg.scripts['economy-worker']}`, /arn-migrate/);
  for (const rel of [
    'src/economy-worker/entry.cjs',
    'src/sentinel/entry.cjs',
    'src/economy-worker/postgres-runtime.cjs',
    'src/economy-worker/arn-tokens-postgres.cjs',
    'scripts/apply-economy-sql-migrations.cjs'
  ]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, rel), 'utf8'), /migrateLegacyArnBalances|migrate-legacy-arn-balances/);
  }
  const doc = fs.readFileSync(path.join(root, 'docs/ops/ARN_TOKENS_LEDGER.md'), 'utf8');
  assert.doesNotMatch(doc, /pending-owner-decision/);
  assert.match(doc, /arn-migrate:<econId>/);
  assert.match(doc, /ARN_ECONOMY_WRITES_ENABLED/);
});
