'use strict';

const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');

function isSystemAccount(economicIdentityId) {
  return String(economicIdentityId || '').startsWith('system:');
}

function isMintAccount(economicIdentityId) {
  return String(economicIdentityId || '').startsWith('system:mint:');
}

function assertMemberAccount(economicIdentityId) {
  if (isSystemAccount(economicIdentityId)) {
    throw new Error('System accounts are not spendable.');
  }
}

function memberAccountSql(column) {
  const name = String(column || 'economic_identity_id');
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) throw new Error('Balance column is invalid.');
  return `${name} NOT LIKE 'system:%'`;
}

const SYSTEM_MINT_CHECK_LOCK = 'nexus-economy:system-mint-balance-checks';

const MINT_CHECK_SPECS = [
  {
    table: 'nexus_economic_identities',
    name: 'nexus_economic_identities_status_check',
    match: (def) => /\bstatus\b/i.test(def) && /verified/.test(def),
    exempt: (def) => /'system'/.test(def),
    check: "CHECK (status IN ('verified', 'restricted', 'disabled', 'system'))"
  },
  {
    table: 'nexus_economy_wallets',
    name: 'nexus_economy_wallets_balance_check',
    match: (def) => /\bbalance\b/i.test(def) && !/balance_after/i.test(def) && />=/.test(def),
    exempt: (def) => /system:mint:%/.test(def),
    check: "CHECK (balance >= 0 OR economic_identity_id LIKE 'system:mint:%')"
  },
  {
    table: 'nexus_economy_ledger',
    name: 'nexus_economy_ledger_balance_after_check',
    match: (def) => /balance_after/i.test(def) && />=/.test(def),
    exempt: (def) => /system:mint:%/.test(def),
    check: "CHECK (balance_after >= 0 OR economic_identity_id LIKE 'system:mint:%')"
  }
];

// Caller holds one open transaction. The advisory lock serializes concurrent
// legacy executes. An exempting constraint is left in place. Otherwise the
// strict check is dropped with IF EXISTS and the mint exemption is added
// NOT VALID, then VALIDATE, so member rows are still checked.
async function applySystemMintBalanceChecks(client, schema = 'public') {
  if (!client || typeof client.query !== 'function') throw new Error('Mint check migration requires a database client.');
  const s = sqlIdent(schema);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [SYSTEM_MINT_CHECK_LOCK]);
  const found = await client.query(
    `SELECT c.conname, r.relname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = $1 AND c.contype = 'c'
       AND r.relname IN ('nexus_economic_identities', 'nexus_economy_wallets', 'nexus_economy_ledger')`,
    [schema]
  );
  const rows = found.rows || [];
  for (const spec of MINT_CHECK_SPECS) {
    const matching = rows.filter((row) => row.relname === spec.table && spec.match(String(row.def || '')));
    if (matching.some((row) => spec.exempt(String(row.def || '')))) {
      for (const row of matching) {
        if (spec.exempt(String(row.def || ''))) continue;
        await client.query(`ALTER TABLE ${s}.${spec.table} DROP CONSTRAINT IF EXISTS ${sqlIdent(row.conname)}`);
      }
      continue;
    }
    for (const row of matching) {
      await client.query(`ALTER TABLE ${s}.${spec.table} DROP CONSTRAINT IF EXISTS ${sqlIdent(row.conname)}`);
    }
    const name = sqlIdent(spec.name);
    await client.query(`ALTER TABLE ${s}.${spec.table} ADD CONSTRAINT ${name} ${spec.check} NOT VALID`);
    await client.query(`ALTER TABLE ${s}.${spec.table} VALIDATE CONSTRAINT ${name}`);
  }
  return { ok: true };
}

function memberPointSumSql(schema = 'public') {
  const s = sqlIdent(schema);
  return `SELECT COALESCE(SUM(w.balance), 0)::bigint AS total
    FROM ${s}.nexus_economy_wallets w
    JOIN ${s}.nexus_economic_identities i ON i.economic_identity_id = w.economic_identity_id
    WHERE w.currency = 'NEXUS_POINTS'
      AND ${memberAccountSql('w.economic_identity_id')}
      AND i.status <> 'system'
      AND i.economic_identity_id NOT LIKE 'system:%'`;
}

async function sumMemberPointBalances(pool, schema = 'public') {
  const result = await pool.query(memberPointSumSql(schema));
  return Number(result.rows?.[0]?.total || 0);
}

module.exports = {
  isSystemAccount,
  isMintAccount,
  assertMemberAccount,
  memberAccountSql,
  SYSTEM_MINT_CHECK_LOCK,
  applySystemMintBalanceChecks,
  memberPointSumSql,
  sumMemberPointBalances
};
