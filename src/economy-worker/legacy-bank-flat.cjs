'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const { execSync } = require('node:child_process');
const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { deterministicEconomicIdentityId } = require('../sentinel/nexus-economy-json-postgres-migration.cjs');
const { quarantineDenylist } = require('../sentinel/nexus-economy-wallet-core.cjs');
const { applySystemMintBalanceChecks, sumMemberPointBalances, SYSTEM_MINT_CHECK_LOCK } = require('../shared/economy-system-accounts.cjs');

const BATCH_NAME = 'legacy-bank-flat-2026-10';
const AMOUNT = 1500;
const MINT_ID = 'system:mint:legacy-bank-flat';
const SNAPSHOT_AT = '2026-10-03T01:14:00.000Z';
const SOURCE = 'legacy_bank_flat';
// Compiled ceiling. --approved-count cannot raise it. The snapshot list is not
// stored in the repo, so this constant is the code limit until a reviewed change.
const MAX_LEGACY_FLAT_GRANTS = 4096;
const MAX_LEGACY_FLAT_TOTAL = MAX_LEGACY_FLAT_GRANTS * AMOUNT;

function legacyBankFlatEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env?.NEXUS_LEGACY_BANK_FLAT_ENABLED ?? '').trim().toLowerCase());
}

function hashPrefix(hash) {
  return String(hash || '').slice(0, 8);
}

function hashesEqual(expected, actual) {
  const left = Buffer.from(String(expected ?? ''), 'utf8');
  const right = Buffer.from(String(actual ?? ''), 'utf8');
  if (left.length !== right.length) {
    const sample = left.length ? left : Buffer.from('0');
    crypto.timingSafeEqual(sample, Buffer.alloc(sample.length));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function canonicalListHash({ rows, eligibleCount, total, batchName = BATCH_NAME, snapshotAt = SNAPSHOT_AT } = {}) {
  const header = { batchName, snapshotAt, amountPerGrant: AMOUNT, eligibleCount, total };
  const body = (rows || [])
    .filter((row) => row.skipReason === '' && Number(row.amount) === AMOUNT)
    .map((row) => [row.econId, row.discordUserId, row.eosIds, row.amount, row.skipReason]);
  return crypto.createHash('sha256').update(JSON.stringify({ header, rows: body })).digest('hex');
}

function denylistDigest(ids) {
  const lines = [...ids].map((id) => String(id)).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

function readDenylist(env = process.env, reader) {
  if (typeof reader === 'function') return reader(env);
  return quarantineDenylist(env);
}

function verifiedBefore(links, snapshotMs) {
  return (links || [])
    .filter((link) => {
      const at = Date.parse(link.verifiedAt);
      return Number.isFinite(at) && at <= snapshotMs;
    })
    .map((link) => String(link.id))
    .sort();
}

function classifyPopulation(identities, { denylist = new Set(), priorKeys = new Set(), snapshotAt = SNAPSHOT_AT } = {}) {
  const snapshotMs = Date.parse(snapshotAt);
  const deny = denylist instanceof Set ? denylist : new Set(denylist || []);
  const prior = priorKeys instanceof Set ? priorKeys : new Set(priorKeys || []);
  const list = (identities || [])
    .map((identity) => ({
      econId: String(identity.econId || ''),
      status: String(identity.status || ''),
      createdAt: identity.createdAt,
      discord: identity.discord || [],
      eos: identity.eos || []
    }))
    .filter((identity) => identity.econId && !identity.econId.startsWith('system:'));

  const snapshotIds = new Set(list.filter((identity) => {
    const created = Date.parse(identity.createdAt);
    return Number.isFinite(created) && created <= snapshotMs;
  }).map((identity) => identity.econId));
  const allDiscord = new Set();
  for (const identity of list) {
    if (!snapshotIds.has(identity.econId)) continue;
    for (const id of verifiedBefore(identity.discord, snapshotMs)) allDiscord.add(id);
  }
  const carried = new Map();
  const discordOwners = new Map();
  const eosOwners = new Map();
  for (const identity of list) {
    if (!snapshotIds.has(identity.econId)) continue;
    const ids = new Set(verifiedBefore(identity.discord, snapshotMs));
    for (const discordId of allDiscord) {
      try {
        if (identity.econId === deterministicEconomicIdentityId(discordId)) ids.add(discordId);
      } catch {
        // A discord id that cannot be an economic id is not a human key.
      }
    }
    carried.set(identity.econId, ids);
    for (const id of ids) {
      if (!discordOwners.has(id)) discordOwners.set(id, new Set());
      discordOwners.get(id).add(identity.econId);
    }
    for (const id of verifiedBefore(identity.eos, snapshotMs)) {
      if (!eosOwners.has(id)) eosOwners.set(id, new Set());
      eosOwners.get(id).add(identity.econId);
    }
  }

  function shares(identity) {
    for (const id of carried.get(identity.econId) || []) {
      if ((discordOwners.get(id)?.size || 0) > 1) return true;
    }
    for (const link of identity.eos) {
      if ((eosOwners.get(String(link.id))?.size || 0) > 1) return true;
    }
    return false;
  }

  const rows = list.map((identity) => {
    const discordVerified = verifiedBefore(identity.discord, snapshotMs);
    const eosVerified = verifiedBefore(identity.eos, snapshotMs);
    const created = Date.parse(identity.createdAt);
    const duplicateHuman = shares(identity);
    let skip = '';
    if (identity.status === 'disabled') skip = 'disabled';
    else if (identity.status === 'restricted' || deny.has(identity.econId)) skip = 'quarantined';
    else if (identity.status !== 'verified') skip = 'not_verified';
    else if (!Number.isFinite(created) || created > snapshotMs) skip = 'not_verified';
    else if (!discordVerified.length || !eosVerified.length) skip = 'not_verified';
    else if (prior.has(identity.econId)) skip = 'already_credited';
    else if (duplicateHuman) skip = 'duplicate_human';
    const shownDiscord = discordVerified[0] || (identity.discord || []).map((link) => String(link.id)).sort()[0] || '';
    return {
      econId: identity.econId,
      discordUserId: shownDiscord,
      eosIds: eosVerified,
      amount: skip ? 0 : AMOUNT,
      skipReason: skip,
      duplicateHuman
    };
  }).sort((left, right) => left.econId < right.econId ? -1 : left.econId > right.econId ? 1 : 0);

  const eligibleCount = rows.filter((row) => row.skipReason === '' && row.amount === AMOUNT).length;
  const total = eligibleCount * AMOUNT;
  return {
    rows,
    eligibleCount,
    total,
    hash: canonicalListHash({ rows, eligibleCount, total, snapshotAt }),
    snapshotAt,
    denylistHash: denylistDigest(deny)
  };
}

function evaluateExecuteGate({
  envHash = '',
  computedHash = '',
  complete = false,
  eligibleCount = 0,
  total = 0,
  approvedCount = null,
  approvedTotal = null,
  denylistError = null,
  grantAmounts = []
} = {}) {
  if (denylistError) return { ok: false, reason: 'denylist-read-error' };
  if (!String(envHash || '').trim()) return { ok: false, reason: 'missing-env' };
  if (complete) return { ok: false, reason: 'batch-complete' };
  if (!hashesEqual(envHash, computedHash)) return { ok: false, reason: 'hash-mismatch' };
  if (!Number.isInteger(eligibleCount) || !Number.isInteger(total) || total !== eligibleCount * AMOUNT) {
    return { ok: false, reason: 'total-mismatch' };
  }
  if (eligibleCount > MAX_LEGACY_FLAT_GRANTS || total > MAX_LEGACY_FLAT_TOTAL) {
    return { ok: false, reason: 'hard-cap' };
  }
  if (!Number.isInteger(approvedCount) || !Number.isInteger(approvedTotal)) return { ok: false, reason: 'missing-ceiling' };
  if (approvedCount > MAX_LEGACY_FLAT_GRANTS || approvedTotal > MAX_LEGACY_FLAT_TOTAL) {
    return { ok: false, reason: 'hard-cap' };
  }
  if (eligibleCount > approvedCount || total > approvedTotal) return { ok: false, reason: 'ceiling' };
  if (grantAmounts.some((amount) => amount !== AMOUNT)) return { ok: false, reason: 'grant-amount' };
  return { ok: true };
}

function logDecision(reason, envHash) {
  console.warn(`[legacy-bank-flat] ${reason} approved-prefix=${hashPrefix(envHash) || 'none'}`);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows) {
  const lines = rows.map((row) => [row.econId, row.discordUserId, row.eosIds.join('|'), row.amount, row.skipReason].map(csvCell).join(','));
  return `econId,discordUserId,eosIds,amount,skipReason\n${lines.join('\n')}\n`;
}

function commitSha() {
  if (String(process.env.NEXUS_COMMIT_SHA || '').trim()) return String(process.env.NEXUS_COMMIT_SHA).trim();
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function ensureBatchSchema(pool, schema, env = process.env) {
  if (!legacyBankFlatEnabled(env)) {
    const error = new Error('legacy-bank-flat-disabled');
    error.code = 'legacy-bank-flat-disabled';
    throw error;
  }
  const s = sqlIdent(schema);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [SYSTEM_MINT_CHECK_LOCK]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_batches (
        batch_name TEXT PRIMARY KEY,
        list_hash TEXT NOT NULL,
        approval_ref TEXT NOT NULL,
        approved_count INTEGER NOT NULL,
        approved_total BIGINT NOT NULL,
        operator TEXT NOT NULL,
        host TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )`
    );
    await applySystemMintBalanceChecks(client, schema);
    await client.query(
      `INSERT INTO ${s}.nexus_economic_identities (economic_identity_id, status)
       VALUES ($1, 'system')
       ON CONFLICT (economic_identity_id) DO UPDATE SET status = 'system', updated_at = NOW()`,
      [MINT_ID]
    );
    await client.query(
      `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance)
       VALUES ($1, 'NEXUS_POINTS', 0) ON CONFLICT (economic_identity_id, currency) DO NOTHING`,
      [MINT_ID]
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    if (error.code === '55P03' || error.code === 'lock-timeout') {
      const timeout = new Error('lock-timeout');
      timeout.code = 'lock-timeout';
      throw timeout;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function loadPopulation(pool, schema, cutoff) {
  const s = sqlIdent(schema);
  const links = await pool.query(
    `SELECT i.economic_identity_id, i.status, i.created_at, l.provider, l.external_id, l.verified_at
     FROM ${s}.nexus_economic_identities i
     JOIN ${s}.nexus_economic_identity_links l ON l.economic_identity_id = i.economic_identity_id
     WHERE l.provider IN ('discord', 'eos') AND i.economic_identity_id NOT LIKE 'system:%'`
  );
  const grouped = new Map();
  for (const row of links.rows || []) {
    let identity = grouped.get(row.economic_identity_id);
    if (!identity) {
      identity = {
        econId: row.economic_identity_id,
        status: row.status,
        createdAt: row.created_at,
        discord: [],
        eos: []
      };
      grouped.set(row.economic_identity_id, identity);
    }
    const link = { id: row.external_id, verifiedAt: row.verified_at };
    if (row.provider === 'discord') identity.discord.push(link);
    if (row.provider === 'eos') identity.eos.push(link);
  }
  const prior = await pool.query(
    `SELECT economic_identity_id FROM ${s}.nexus_economy_ledger
     WHERE idempotency_key LIKE 'legacy-bank-flat:%'
       AND idempotency_key NOT LIKE 'legacy-bank-flat-contra:%'
       AND idempotency_key NOT LIKE 'legacy-bank-flat-reversal:%'
       AND ($1::timestamptz IS NULL OR created_at < $1::timestamptz)`,
    [cutoff]
  );
  return {
    identities: [...grouped.values()],
    priorKeys: new Set((prior.rows || []).map((row) => row.economic_identity_id))
  };
}

async function audit(client, schema, { operator, host, sha, batchName, econId, amount, key, result }) {
  const s = sqlIdent(schema);
  await client.query(
    `INSERT INTO ${s}.nexus_mc_action_audit (audit_id, action, actor, reason, result, subject, created_at)
     VALUES ($1, 'legacy_bank_flat', $2, $3, $4, $5, NOW())`,
    [crypto.randomUUID(), operator, JSON.stringify({ host, commitSha: sha, batchName, amount, key }), result, econId]
  );
}

async function grantOne(pool, schema, row, context) {
  const s = sqlIdent(schema);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${row.econId}:NEXUS_POINTS`]);
    let freshDeny;
    try {
      freshDeny = readDenylist(context.env, context.readDenylist);
    } catch (error) {
      await client.query('ROLLBACK');
      const wrapped = new Error('denylist-read-error');
      wrapped.code = 'denylist-read-error';
      throw wrapped;
    }
    const status = await client.query(
      `SELECT status FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1`,
      [row.econId]
    );
    const current = String(status.rows?.[0]?.status || '');
    if (current !== 'verified' || freshDeny.has(row.econId)) {
      await audit(client, schema, { ...context, econId: row.econId, amount: 0, key: `legacy-bank-flat:${row.econId}`, result: 'skipped' });
      await client.query('COMMIT');
      return { outcome: 'skipped' };
    }
    const key = `legacy-bank-flat:${row.econId}`;
    await client.query(
      `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance)
       VALUES ($1, 'NEXUS_POINTS', 0) ON CONFLICT DO NOTHING`,
      [row.econId]
    );
    const wallet = await client.query(
      `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
      [row.econId]
    );
    const currentBalance = Number(wallet.rows?.[0]?.balance || 0);
    const next = currentBalance + AMOUNT;
    const inserted = await client.query(
      `INSERT INTO ${s}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, 'NEXUS_POINTS', $2, $3, 'credit', $4, $5, $6::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [row.econId, AMOUNT, next, SOURCE, key, JSON.stringify({
        batchId: context.batchName,
        snapshotAt: SNAPSHOT_AT,
        ownerApprovalRef: context.approvalRef,
        dryRunListHash: context.listHash,
        denylistHash: context.denylistHash,
        eosIds: row.eosIds,
        contra: MINT_ID
      })]
    );
    if (!inserted.rowCount) {
      await audit(client, schema, { ...context, econId: row.econId, amount: AMOUNT, key, result: 'noop' });
      await client.query('COMMIT');
      return { outcome: 'noop' };
    }
    await client.query(
      `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
       WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
      [row.econId, next]
    );
    const mintWallet = await client.query(
      `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
      [MINT_ID]
    );
    const mintNext = Number(mintWallet.rows?.[0]?.balance || 0) - AMOUNT;
    const contraKey = `legacy-bank-flat-contra:${row.econId}`;
    const contra = await client.query(
      `INSERT INTO ${s}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, 'NEXUS_POINTS', $2, $3, 'debit', 'legacy_bank_flat_contra', $4, $5::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [MINT_ID, -AMOUNT, mintNext, contraKey, JSON.stringify({ econId: row.econId, batchId: context.batchName })]
    );
    if (!contra.rowCount) {
      throw Object.assign(new Error('contra-insert-missing'), { code: 'contra-insert-missing' });
    }
    await client.query(
      `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
       WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
      [MINT_ID, mintNext]
    );
    await audit(client, schema, { ...context, econId: row.econId, amount: AMOUNT, key, result: 'credited' });
    await client.query('COMMIT');
    return { outcome: 'credited' };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  } finally {
    client.release();
  }
}

async function reconcile(pool, schema, expectedGrants) {
  const s = sqlIdent(schema);
  const members = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM ${s}.nexus_economy_ledger
     WHERE economic_identity_id NOT LIKE 'system:%'
       AND source = $1
       AND (
         metadata->>'batchId' = $2
         OR idempotency_key LIKE 'legacy-bank-flat-reversal:%'
       )`,
    [SOURCE, BATCH_NAME]
  );
  const contraRows = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM ${s}.nexus_economy_ledger
     WHERE economic_identity_id = $1
       AND source = 'legacy_bank_flat_contra'
       AND (
         idempotency_key LIKE 'legacy-bank-flat-contra:%'
         OR idempotency_key LIKE 'legacy-bank-flat-contra-reversal:%'
       )`,
    [MINT_ID]
  );
  const mint = await pool.query(
    `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
    [MINT_ID]
  );
  const credits = Number(members.rows?.[0]?.total || 0);
  const contra = Number(contraRows.rows?.[0]?.total || 0);
  const mintBalance = Number(mint.rows?.[0]?.balance || 0);
  const expected = expectedGrants * AMOUNT;
  const memberBalances = await sumMemberPointBalances(pool, schema);
  return {
    ok: credits === -contra && contra === -expected && mintBalance === contra,
    credits,
    contra,
    mintBalance,
    expected,
    memberBalances
  };
}

async function buildList(pool, schema, { env = process.env, readDenylist: reader, cutoff = null } = {}) {
  let denylist;
  try {
    denylist = readDenylist(env, reader);
  } catch (error) {
    const wrapped = new Error('denylist-read-error');
    wrapped.code = 'denylist-read-error';
    throw wrapped;
  }
  const loaded = await loadPopulation(pool, schema, cutoff);
  return classifyPopulation(loaded.identities, { denylist, priorKeys: loaded.priorKeys });
}

async function schemaReady(client, schema) {
  const names = ['nexus_economic_identities', 'nexus_economic_identity_links', 'nexus_economy_wallets', 'nexus_economy_ledger'];
  for (const name of names) {
    const found = await client.query('SELECT to_regclass($1) AS reg', [`${schema}.${name}`]);
    if (!found.rows?.[0]?.reg) return false;
  }
  return true;
}

async function dryRun({ pool, schema = 'public', env = process.env, operator = '', readDenylist: reader } = {}) {
  if (!String(operator || '').trim()) return { ok: false, reason: 'operator-required' };
  const client = await pool.connect();
  let list;
  try {
    await client.query('BEGIN READ ONLY');
    if (!await schemaReady(client, schema)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'schema-missing' };
    }
    list = await buildList(client, schema, { env, readDenylist: reader, cutoff: null });
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    if (error.code === 'denylist-read-error') return { ok: false, reason: 'denylist-read-error' };
    if (error.code === '42P01' || error.code === '3D000') return { ok: false, reason: 'schema-missing' };
    throw error;
  } finally {
    client.release();
  }
  return {
    ok: true,
    operator: String(operator).trim(),
    snapshotAt: SNAPSHOT_AT,
    batchName: BATCH_NAME,
    eligibleCount: list.eligibleCount,
    total: list.total,
    hash: list.hash,
    denylistHash: list.denylistHash,
    rows: list.rows,
    csv: toCsv(list.rows)
  };
}

async function execute({
  pool,
  schema = 'public',
  env = process.env,
  operator = '',
  approvalRef = '',
  approvedCount = null,
  approvedTotal = null,
  readDenylist: reader,
  afterGrant = null
} = {}) {
  const envHash = String(env.NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH || '').trim();
  if (!legacyBankFlatEnabled(env)) return { ok: false, reason: 'legacy-bank-flat-disabled' };
  if (!String(operator || '').trim()) return { ok: false, reason: 'operator-required' };
  if (!String(approvalRef || '').trim()) return { ok: false, reason: 'approval-required' };
  if (!envHash) {
    logDecision('missing-env', '');
    return { ok: false, reason: 'missing-env' };
  }
  const { ensureMinecraftSchema } = require('./mc-points-postgres.cjs');
  const ready = await ensureMinecraftSchema({ pool, schema });
  if (!ready.ok) return ready;
  try {
    await ensureBatchSchema(pool, schema, env);
  } catch (error) {
    if (error.code === 'lock-timeout') {
      logDecision('lock-timeout', envHash);
      return { ok: false, reason: 'lock-timeout' };
    }
    throw error;
  }
  const s = sqlIdent(schema);
  const existing = await pool.query(`SELECT * FROM ${s}.nexus_economy_batches WHERE batch_name = $1`, [BATCH_NAME]);
  const marker = existing.rows?.[0] || null;
  if (marker?.completed_at) {
    logDecision('batch-complete', envHash);
    return { ok: false, reason: 'batch-complete' };
  }
  let list;
  try {
    list = await buildList(pool, schema, { env, readDenylist: reader, cutoff: marker?.started_at || null });
  } catch (error) {
    if (error.code === 'denylist-read-error') {
      logDecision('denylist-read-error', envHash);
      return { ok: false, reason: 'denylist-read-error' };
    }
    throw error;
  }
  const gate = evaluateExecuteGate({
    envHash,
    computedHash: list.hash,
    complete: false,
    eligibleCount: list.eligibleCount,
    total: list.total,
    approvedCount,
    approvedTotal,
    grantAmounts: list.rows.filter((row) => row.skipReason === '').map((row) => row.amount)
  });
  if (!gate.ok) {
    logDecision(gate.reason, envHash);
    return { ok: false, reason: gate.reason };
  }
  if (marker && !hashesEqual(marker.list_hash, list.hash)) {
    logDecision('hash-mismatch', envHash);
    return { ok: false, reason: 'hash-mismatch' };
  }
  const sha = commitSha();
  const host = os.hostname();
  if (!marker) {
    await pool.query(
      `INSERT INTO ${s}.nexus_economy_batches
       (batch_name, list_hash, approval_ref, approved_count, approved_total, operator, host, commit_sha, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [BATCH_NAME, list.hash, approvalRef, approvedCount, approvedTotal, String(operator).trim(), host, sha]
    );
  }
  const context = {
    env,
    readDenylist: reader,
    operator: String(operator).trim(),
    host,
    sha,
    batchName: BATCH_NAME,
    approvalRef,
    listHash: list.hash,
    denylistHash: list.denylistHash
  };
  let skipped = 0;
  let credited = 0;
  let noop = 0;
  for (const row of list.rows.filter((entry) => entry.skipReason === '')) {
    const result = await grantOne(pool, schema, row, context);
    if (result.outcome === 'skipped') skipped += 1;
    else if (result.outcome === 'credited') credited += 1;
    else noop += 1;
    if (typeof afterGrant === 'function') await afterGrant(result);
  }
  const expectedGrants = list.eligibleCount - skipped;
  const check = await reconcile(pool, schema, expectedGrants);
  if (!check.ok) {
    logDecision('reconcile-mismatch', envHash);
    return { ok: false, reason: 'reconcile-mismatch', credited, skipped, noop, reconcile: check };
  }
  await pool.query(
    `UPDATE ${s}.nexus_economy_batches SET completed_at = NOW() WHERE batch_name = $1 AND completed_at IS NULL`,
    [BATCH_NAME]
  );
  logDecision('complete', envHash);
  return { ok: true, credited, skipped, noop, eligibleCount: list.eligibleCount, reconcile: check };
}

async function flagSpentCredit({ pool, schema = 'public', econId, operator = '', env = process.env } = {}) {
  if (!legacyBankFlatEnabled(env)) return { ok: false, reason: 'legacy-bank-flat-disabled' };
  if (!String(operator || '').trim() || !String(econId || '').trim()) return { ok: false, reason: 'operator-required' };
  const s = sqlIdent(schema);
  const wallet = await pool.query(
    `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
    [econId]
  );
  const balance = Number(wallet.rows?.[0]?.balance || 0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await audit(client, schema, {
      operator: String(operator).trim(),
      host: os.hostname(),
      sha: commitSha(),
      batchName: BATCH_NAME,
      econId,
      amount: AMOUNT,
      key: `legacy-bank-flat:${econId}`,
      result: balance >= AMOUNT ? 'reversal-available' : 'spent-flagged'
    });
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
  if (balance < AMOUNT) {
    console.warn(`[legacy-bank-flat] spent credit needs an owner decision econ=${econId} balance=${balance}`);
    return { ok: true, flagged: true, balance, clawedBack: false };
  }
  return { ok: true, flagged: false, balance, clawedBack: false };
}

async function reverseCredit({ pool, schema = 'public', econId, operator = '', confirm = false, env = process.env } = {}) {
  if (!legacyBankFlatEnabled(env)) return { ok: false, reason: 'legacy-bank-flat-disabled' };
  if (!confirm) return { ok: false, reason: 'confirmation-required' };
  if (!String(operator || '').trim() || !String(econId || '').trim()) return { ok: false, reason: 'operator-required' };
  const s = sqlIdent(schema);
  const client = await pool.connect();
  const creditKey = `legacy-bank-flat:${econId}`;
  const reversalKey = `legacy-bank-flat-reversal:${econId}`;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${econId}:NEXUS_POINTS`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${MINT_ID}:NEXUS_POINTS`]);
    const original = await client.query(
      `SELECT id FROM ${s}.nexus_economy_ledger
       WHERE idempotency_key = $1 AND economic_identity_id = $2 AND source = $3 AND entry_type = 'credit' AND amount = $4`,
      [creditKey, econId, SOURCE, AMOUNT]
    );
    if (!original.rowCount) {
      await audit(client, schema, {
        operator: String(operator).trim(),
        host: os.hostname(),
        sha: commitSha(),
        batchName: BATCH_NAME,
        econId,
        amount: 0,
        key: reversalKey,
        result: 'credit-missing'
      });
      await client.query('COMMIT');
      return { ok: false, reason: 'credit-missing', reversed: false };
    }
    const already = await client.query(
      `SELECT id FROM ${s}.nexus_economy_ledger WHERE idempotency_key = $1`,
      [reversalKey]
    );
    if (already.rowCount) {
      await client.query('COMMIT');
      const current = await client.query(
        `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
        [econId]
      );
      return { ok: true, duplicate: true, reversed: false, balance: Number(current.rows?.[0]?.balance || 0) };
    }
    const wallet = await client.query(
      `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
      [econId]
    );
    const balance = Number(wallet.rows?.[0]?.balance || 0);
    if (balance < AMOUNT) {
      await audit(client, schema, {
        operator: String(operator).trim(),
        host: os.hostname(),
        sha: commitSha(),
        batchName: BATCH_NAME,
        econId,
        amount: 0,
        key: `legacy-bank-flat-reversal:${econId}`,
        result: 'spent-flagged'
      });
      await client.query('COMMIT');
      console.warn(`[legacy-bank-flat] spent credit needs an owner decision econ=${econId} balance=${balance}`);
      return { ok: true, flagged: true, reversed: false, balance };
    }
    const next = balance - AMOUNT;
    const key = `legacy-bank-flat-reversal:${econId}`;
    const inserted = await client.query(
      `INSERT INTO ${s}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, 'NEXUS_POINTS', $2, $3, 'debit', $4, $5, $6::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [econId, -AMOUNT, next, SOURCE, key, JSON.stringify({ reverses: `legacy-bank-flat:${econId}`, actor: operator })]
    );
    if (!inserted.rowCount) {
      await client.query('COMMIT');
      return { ok: true, duplicate: true, reversed: false, balance };
    }
    await client.query(
      `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
       WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
      [econId, next]
    );
    const contraKey = `legacy-bank-flat-contra:${econId}`;
    const contraOriginal = await client.query(
      `SELECT id FROM ${s}.nexus_economy_ledger
       WHERE idempotency_key = $1 AND economic_identity_id = $2 AND source = 'legacy_bank_flat_contra' AND amount = $3`,
      [contraKey, MINT_ID, -AMOUNT]
    );
    if (!contraOriginal.rowCount) {
      throw Object.assign(new Error('contra-insert-missing'), { code: 'contra-insert-missing' });
    }
    const mint = await client.query(
      `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
      [MINT_ID]
    );
    const mintBalance = Number(mint.rows?.[0]?.balance || 0);
    const mintNext = mintBalance + AMOUNT;
    const contraReversalKey = `legacy-bank-flat-contra-reversal:${econId}`;
    const contra = await client.query(
      `INSERT INTO ${s}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, 'NEXUS_POINTS', $2, $3, 'credit', 'legacy_bank_flat_contra', $4, $5::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [MINT_ID, AMOUNT, mintNext, contraReversalKey, JSON.stringify({ econId, reverses: contraKey })]
    );
    if (!contra.rowCount) {
      throw Object.assign(new Error('contra-insert-missing'), { code: 'contra-insert-missing' });
    }
    await client.query(
      `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
       WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
      [MINT_ID, mintNext]
    );
    await audit(client, schema, {
      operator: String(operator).trim(),
      host: os.hostname(),
      sha: commitSha(),
      batchName: BATCH_NAME,
      econId,
      amount: AMOUNT,
      key,
      result: 'reversed'
    });
    await client.query('COMMIT');
    return { ok: true, reversed: true, flagged: false, balance: next };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  BATCH_NAME,
  AMOUNT,
  MAX_LEGACY_FLAT_GRANTS,
  MINT_ID,
  SNAPSHOT_AT,
  SOURCE,
  hashPrefix,
  legacyBankFlatEnabled,
  hashesEqual,
  canonicalListHash,
  denylistDigest,
  classifyPopulation,
  evaluateExecuteGate,
  toCsv,
  dryRun,
  execute,
  flagSpentCredit,
  reverseCredit,
  reconcile,
  grantOne,
  ensureBatchSchema
};
