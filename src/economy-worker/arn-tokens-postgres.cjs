'use strict';

const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { arnFlags } = require('../shared/arn-flags.cjs');
const {
  CURRENCY,
  decideAward,
  exactNameMatches
} = require('../sentinel/arn-token-award.cjs');
const { ctDayStart, ctWeekStart, nextCtWeekStart } = require('../sentinel/arn-cache-rotation.cjs');

function windows(at) {
  const dayStart = ctDayStart(at);
  const weekStart = ctWeekStart(at);
  return {
    dayStart,
    weekStart,
    dayEnd: ctDayStart(dayStart + (26 * 60 * 60 * 1000)),
    weekEnd: nextCtWeekStart(weekStart)
  };
}

function schemaSql(schema = 'public') {
  const s = sqlIdent(schema);
  return [
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_arn_wallets (`,
    '  economic_identity_id TEXT PRIMARY KEY,',
    '  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0)',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_arn_ledger (`,
    '  message_id TEXT PRIMARY KEY,',
    '  economic_identity_id TEXT NOT NULL,',
    `  currency TEXT NOT NULL CHECK (currency = '${CURRENCY}'),`,
    '  delta BIGINT NOT NULL CHECK (delta <> 0),',
    '  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),',
    '  created_at TIMESTAMPTZ NOT NULL',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_arn_observations (`,
    '  message_id TEXT PRIMARY KEY,',
    '  outcome TEXT NOT NULL,',
    '  economic_identity_id TEXT,',
    '  amount INT NOT NULL DEFAULT 0,',
    '  roll INT,',
    '  created_at TIMESTAMPTZ NOT NULL,',
    "  details JSONB NOT NULL DEFAULT '{}'::jsonb",
    ');'
  ].join('\n');
}

function schemaStatements(schema = 'public') {
  return schemaSql(schema).split(/;\s*/).map((part) => part.trim()).filter(Boolean);
}

let livePool = null;

async function awardLiveReport(input = {}) {
  const env = input.env || process.env;
  if (!arnFlags(env).creditsEnabled) return null;
  const { postgresEnabled, databaseUrl } = require('./postgres-runtime.cjs');
  const connectionString = databaseUrl(env);
  if (!postgresEnabled(env) || !connectionString) return null;
  const { Pool } = require('pg');
  if (!livePool) {
    livePool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  }
  const schema = String(input.schema || env.NEXUS_ECONOMY_SCHEMA || 'public').trim() || 'public';
  const client = await livePool.connect();
  try {
    for (const statement of schemaStatements(schema)) {
      await client.query(statement);
    }
    return await awardWithClient(client, { ...input, env, schema });
  } finally {
    client.release();
  }
}

async function awardWithClient(client, input = {}) {
  const schema = input.schema || 'public';
  const s = sqlIdent(schema);
  const at = Number(input.now || Date.now());
  const flags = arnFlags(input.env || {});
  const bounds = windows(at);
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`arn-message:${input.messageId}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`arn-name:${String(input.parsed?.playerName || input.playerName || '').trim()}`]);
    const accounts = await input.loadAccounts();
    const matches = exactNameMatches(accounts, input.parsed?.playerName || '');
    let identityRow = null;
    if (matches.length === 1) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${matches[0].economicIdentityId}:${CURRENCY}`]);
      const locked = await client.query(
        `SELECT status, hold_reason FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
        [matches[0].economicIdentityId]
      );
      identityRow = locked.rows?.[0] || null;
      matches[0] = {
        ...matches[0],
        status: identityRow?.status || '',
        holdReason: identityRow?.hold_reason || '',
        missingRow: !identityRow
      };
    }
    const prior = await client.query(
      `SELECT message_id, outcome, amount, economic_identity_id, EXTRACT(EPOCH FROM created_at) * 1000 AS at FROM ${s}.nexus_arn_observations WHERE message_id = $1`,
      [input.messageId]
    );
    const priorRow = prior.rows?.[0] || null;
    let day = 0;
    let week = 0;
    const econId = matches.length === 1 ? matches[0].economicIdentityId : '';
    if (econId) {
      const counts = await client.query(
        `-- arn-cap-count
         SELECT
           COUNT(*) FILTER (WHERE created_at >= $2 AND created_at < $3) AS day_count,
           COUNT(*) FILTER (WHERE created_at >= $4 AND created_at < $5) AS week_count
         FROM ${s}.nexus_arn_observations
         WHERE economic_identity_id = $1 AND outcome IN ('would-credit', 'credited')`,
        [econId, new Date(bounds.dayStart).toISOString(), new Date(bounds.dayEnd).toISOString(), new Date(bounds.weekStart).toISOString(), new Date(bounds.weekEnd).toISOString()]
      );
      day = Number(counts.rows?.[0]?.day_count || 0);
      week = Number(counts.rows?.[0]?.week_count || 0);
    }
    const state = {
      observations: priorRow ? [{
        messageId: priorRow.message_id,
        outcome: priorRow.outcome,
        amount: Number(priorRow.amount || 0),
        economicIdentityId: priorRow.economic_identity_id || '',
        at: Number(priorRow.at || at)
      }] : [],
      ledger: [],
      seededCredits: econId ? { economicIdentityId: econId, day, week } : null
    };
    const decision = decideAward(state, {
      ...input,
      at,
      accounts: matches.length === 1 ? [matches[0]] : accounts,
      creditsEnabled: flags.creditsEnabled,
      env: input.env || {},
      dayStart: bounds.dayStart,
      dayEnd: bounds.dayEnd,
      weekStart: bounds.weekStart,
      weekEnd: bounds.weekEnd
    });
    if (!decision.duplicate && decision.observation) {
      await client.query(
        `INSERT INTO ${s}.nexus_arn_observations (message_id, outcome, economic_identity_id, amount, roll, created_at, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          decision.observation.messageId,
          decision.observation.outcome,
          decision.observation.economicIdentityId || null,
          decision.observation.amount || 0,
          decision.observation.roll,
          new Date(at).toISOString(),
          JSON.stringify({ kind: decision.observation.kind, playerName: decision.observation.playerName, reason: decision.observation.reason || '' })
        ]
      );
    }
    if (decision.wroteLedger && decision.ledgerRow) {
      const current = await client.query(
        `SELECT balance FROM ${s}.nexus_arn_wallets WHERE economic_identity_id = $1 FOR UPDATE`,
        [decision.ledgerRow.economicIdentityId]
      );
      const before = Number(current.rows?.[0]?.balance || 0);
      const after = before + decision.ledgerRow.delta;
      await client.query(
        `INSERT INTO ${s}.nexus_arn_wallets (economic_identity_id, balance) VALUES ($1, $2)
         ON CONFLICT (economic_identity_id) DO UPDATE SET balance = EXCLUDED.balance`,
        [decision.ledgerRow.economicIdentityId, after]
      );
      await client.query(
        `INSERT INTO ${s}.nexus_arn_ledger (message_id, economic_identity_id, currency, delta, balance_after, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [decision.ledgerRow.messageId, decision.ledgerRow.economicIdentityId, CURRENCY, decision.ledgerRow.delta, after, new Date(at).toISOString()]
      );
    }
    await client.query('COMMIT');
    return { ...decision, wroteLedger: decision.wroteLedger === true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

module.exports = {
  CURRENCY,
  schemaSql,
  schemaStatements,
  awardWithClient,
  awardLiveReport,
  windows
};
