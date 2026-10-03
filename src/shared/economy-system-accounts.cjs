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

async function applySystemMintBalanceChecks(pool, schema = 'public') {
  const s = sqlIdent(schema);
  const found = await pool.query(
    `SELECT c.conname, r.relname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = $1 AND c.contype = 'c'
       AND r.relname IN ('nexus_economic_identities', 'nexus_economy_wallets', 'nexus_economy_ledger')`,
    [schema]
  );
  for (const row of found.rows || []) {
    const def = String(row.def || '');
    const constraint = sqlIdent(row.conname);
    if (row.relname === 'nexus_economic_identities' && /status/i.test(def) && !/'system'/.test(def)) {
      await pool.query(`ALTER TABLE ${s}.nexus_economic_identities DROP CONSTRAINT ${constraint}`);
      await pool.query(
        `ALTER TABLE ${s}.nexus_economic_identities ADD CONSTRAINT ${constraint} CHECK (status IN ('verified', 'restricted', 'disabled', 'system'))`
      );
    }
    if (row.relname === 'nexus_economy_wallets' && /balance/i.test(def) && !/system:mint:%/.test(def)) {
      await pool.query(`ALTER TABLE ${s}.nexus_economy_wallets DROP CONSTRAINT ${constraint}`);
      await pool.query(
        `ALTER TABLE ${s}.nexus_economy_wallets ADD CONSTRAINT ${constraint} CHECK (balance >= 0 OR economic_identity_id LIKE 'system:mint:%')`
      );
    }
    if (row.relname === 'nexus_economy_ledger' && /balance_after/i.test(def) && !/system:mint:%/.test(def)) {
      await pool.query(`ALTER TABLE ${s}.nexus_economy_ledger DROP CONSTRAINT ${constraint}`);
      await pool.query(
        `ALTER TABLE ${s}.nexus_economy_ledger ADD CONSTRAINT ${constraint} CHECK (balance_after >= 0 OR economic_identity_id LIKE 'system:mint:%')`
      );
    }
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
  applySystemMintBalanceChecks,
  memberPointSumSql,
  sumMemberPointBalances
};
