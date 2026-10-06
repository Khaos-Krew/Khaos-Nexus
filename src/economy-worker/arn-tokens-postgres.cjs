'use strict';

const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { arnFlags } = require('../shared/arn-flags.cjs');
const { memberIdentityHold } = require('../sentinel/nexus-economy-identity-hold.cjs');
const {
  CURRENCY,
  FEED_DEDUPE_MS,
  decideAward,
  feedKeyOf
} = require('../sentinel/arn-token-award.cjs');
const { ctDayStart, ctWeekStart, nextCtWeekStart } = require('../sentinel/arn-cache-rotation.cjs');

const DROP_SOURCE = 'arn_drop';
const SPEND_SOURCE = 'arn_cache';
const MIGRATION_ID = 'arn-tokens-main-ledger-currency';

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

function dropKey(messageId) {
  return `arn-drop:${String(messageId || '').trim()}`;
}

function spendKey(orderId) {
  return `arn-spend:${String(orderId || '').trim()}`;
}

function refundKey(orderId) {
  return `arn-refund:${String(orderId || '').trim()}`;
}

async function replaceCurrencyCheck(client, schemaName, table) {
  const found = await client.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2 AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%NEXUS_POINTS%'`,
    [schemaName, table]
  );
  const schema = sqlIdent(schemaName);
  for (const row of found.rows || []) {
    if (String(row.def || '').includes("'ARN_TOKENS'")) continue;
    const name = sqlIdent(row.conname);
    await client.query(`ALTER TABLE ${schema}.${sqlIdent(table)} DROP CONSTRAINT ${name}`);
    await client.query(
      `ALTER TABLE ${schema}.${sqlIdent(table)} ADD CONSTRAINT ${name} CHECK (currency IN ('NEXUS_COINS','NEXUS_POINTS','DINO_CACHE_TOKENS','ARN_TOKENS'))`
    );
  }
}

async function applyArnCurrencyMigration(pool, schemaName = 'public') {
  const schema = sqlIdent(schemaName);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${MIGRATION_ID}`]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.nexus_economy_schema_migrations (
         id TEXT PRIMARY KEY,
         row_count BIGINT NOT NULL DEFAULT 0,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    const existing = await client.query(
      `SELECT id FROM ${schema}.nexus_economy_schema_migrations WHERE id = $1`,
      [MIGRATION_ID]
    );
    if (!existing.rows?.[0]) {
      await replaceCurrencyCheck(client, schemaName, 'nexus_economy_wallets');
      await replaceCurrencyCheck(client, schemaName, 'nexus_economy_ledger');
      await replaceCurrencyCheck(client, schemaName, 'nexus_economy_orders');
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${schema}.nexus_economy_arn_events (
           event_key TEXT PRIMARY KEY,
           feed_key TEXT NOT NULL,
           economic_identity_id TEXT,
           outcome TEXT NOT NULL,
           roll INT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS nexus_economy_arn_events_feed_idx
         ON ${schema}.nexus_economy_arn_events (feed_key, created_at DESC)`
      );
      await client.query(
        `INSERT INTO ${schema}.nexus_economy_schema_migrations (id, row_count) VALUES ($1, 0)`,
        [MIGRATION_ID]
      );
    }
    await client.query('COMMIT');
    return { ok: true, applied: !existing.rows?.[0] };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  } finally {
    client.release();
  }
}

async function readDbNow(client) {
  const result = await client.query('SELECT NOW() AS now');
  const at = new Date(result.rows?.[0]?.now).getTime();
  if (!Number.isFinite(at)) throw new Error('ARN cap clock is unreadable.');
  return at;
}

async function resolveVerifiedEos(client, schema, { eosId = '', discordUserId = '' } = {}) {
  const result = await client.query(
    `SELECT i.economic_identity_id, i.status, i.hold_reason
     FROM ${schema}.nexus_economic_identities i
     JOIN ${schema}.nexus_economic_identity_links e
       ON e.economic_identity_id = i.economic_identity_id
      AND e.provider = 'eos' AND e.external_id = $1 AND e.verified_at IS NOT NULL
     JOIN ${schema}.nexus_economic_identity_links d
       ON d.economic_identity_id = i.economic_identity_id
      AND d.provider = 'discord' AND d.external_id = $2
     FOR UPDATE OF i`,
    [String(eosId || '').trim(), String(discordUserId || '').trim()]
  );
  const ids = [...new Set((result.rows || []).map((row) => row.economic_identity_id).filter(Boolean))];
  if (ids.length !== 1) return { rows: result.rows || [], economicIdentityId: '', missingRow: true };
  return { rows: result.rows || [], economicIdentityId: ids[0], missingRow: false, row: result.rows[0] };
}

function holdOf(row, env) {
  if (!row) return { outcome: 'identity-unresolved' };
  return memberIdentityHold({
    status: row.status,
    holdReason: row.hold_reason || '',
    economicIdentityId: row.economic_identity_id,
    missingRow: false,
    env
  });
}

async function awardDropWithClient(client, input = {}) {
  const schemaName = input.schema || 'public';
  const schema = sqlIdent(schemaName);
  const flags = arnFlags(input.env || {});
  const messageId = String(input.messageId || '').trim();
  const parsed = input.parsed || {};
  await client.query('BEGIN');
  try {
    const at = await readDbNow(client);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`arn-message:${messageId}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`arn-name:${String(parsed.playerName || '').trim()}`]);
    const identity = await resolveVerifiedEos(client, schema, input);
    const bounds = windows(at);
    let day = 0;
    let week = 0;
    if (identity.economicIdentityId) {
      const counts = await client.query(
        `-- arn-cap-count
         SELECT
           COUNT(*) FILTER (WHERE created_at >= $2 AND created_at < $3) AS day_count,
           COUNT(*) FILTER (WHERE created_at >= $4 AND created_at < $5) AS week_count
         FROM ${schema}.nexus_economy_ledger
         WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'
           AND source = '${DROP_SOURCE}' AND entry_type = 'credit' AND amount > 0`,
        [identity.economicIdentityId, new Date(bounds.dayStart).toISOString(), new Date(bounds.dayEnd).toISOString(), new Date(bounds.weekStart).toISOString(), new Date(bounds.weekEnd).toISOString()]
      );
      day = Number(counts.rows?.[0]?.day_count || 0);
      week = Number(counts.rows?.[0]?.week_count || 0);
    }
    const prior = await client.query(
      `SELECT event_key, outcome, roll, economic_identity_id, created_at
       FROM ${schema}.nexus_economy_arn_events WHERE event_key = $1`,
      [dropKey(messageId)]
    );
    const priorRow = prior.rows?.[0] || null;
    const feed = await client.query(
      `SELECT event_key, outcome, economic_identity_id, created_at
       FROM ${schema}.nexus_economy_arn_events
       WHERE feed_key = $1 AND event_key <> $2 AND created_at > $3
       ORDER BY created_at ASC LIMIT 1`,
      [feedKeyOf(parsed), dropKey(messageId), new Date(at - FEED_DEDUPE_MS).toISOString()]
    );
    const feedRow = feed.rows?.[0] || null;
    const account = identity.economicIdentityId ? {
      playerName: parsed.playerName,
      eosId: input.eosId,
      discordUserId: input.discordUserId,
      economicIdentityId: identity.economicIdentityId,
      status: identity.row?.status || '',
      holdReason: identity.row?.hold_reason || '',
      missingRow: false
    } : {
      playerName: parsed.playerName,
      eosId: input.eosId,
      discordUserId: input.discordUserId,
      economicIdentityId: '',
      missingRow: true
    };
    const observations = [];
    if (priorRow) {
      observations.push({
        messageId,
        outcome: priorRow.outcome,
        feedKey: feedKeyOf(parsed),
        at,
        economicIdentityId: priorRow.economic_identity_id || ''
      });
    } else if (feedRow) {
      observations.push({
        messageId: String(feedRow.event_key || ''),
        outcome: feedRow.outcome,
        feedKey: feedKeyOf(parsed),
        at: new Date(feedRow.created_at).getTime(),
        economicIdentityId: feedRow.economic_identity_id || ''
      });
    }
    const decision = decideAward({
      observations,
      ledger: [],
      seededCredits: identity.economicIdentityId ? { economicIdentityId: identity.economicIdentityId, day, week } : null
    }, {
      ...input,
      at,
      accounts: [account],
      creditsEnabled: flags.creditsEnabled === true,
      env: input.env || {},
      dayStart: bounds.dayStart,
      dayEnd: bounds.dayEnd,
      weekStart: bounds.weekStart,
      weekEnd: bounds.weekEnd
    });
    const persistEvent = flags.creditsEnabled === true && !decision.duplicate && decision.observation;
    if (persistEvent) {
      await client.query(
        `INSERT INTO ${schema}.nexus_economy_arn_events
         (event_key, feed_key, economic_identity_id, outcome, roll, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          dropKey(messageId),
          decision.observation.feedKey || feedKeyOf(parsed),
          decision.observation.economicIdentityId || null,
          decision.observation.outcome,
          decision.observation.roll,
          new Date(at).toISOString()
        ]
      );
    }
    if (decision.wroteLedger && decision.ledgerRow) {
      const current = await client.query(
        `SELECT balance FROM ${schema}.nexus_economy_wallets
         WHERE economic_identity_id = $1 AND currency = '${CURRENCY}' FOR UPDATE`,
        [decision.ledgerRow.economicIdentityId]
      );
      const before = Number(current.rows?.[0]?.balance || 0);
      const after = before + 1;
      if (!current.rows?.[0]) {
        await client.query(
          `INSERT INTO ${schema}.nexus_economy_wallets (economic_identity_id, currency, balance)
           VALUES ($1, '${CURRENCY}', $2)`,
          [decision.ledgerRow.economicIdentityId, after]
        );
      } else {
        await client.query(
        `UPDATE ${schema}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
         WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'`,
        [decision.ledgerRow.economicIdentityId, after]
        );
      }
      await client.query(
        `INSERT INTO ${schema}.nexus_economy_ledger
         (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
         VALUES ($1, '${CURRENCY}', 1, $2, 'credit', '${DROP_SOURCE}', $3, $4::jsonb, $5)`,
        [
          decision.ledgerRow.economicIdentityId,
          after,
          dropKey(messageId),
          JSON.stringify({ reason: DROP_SOURCE, kind: parsed.kind, feedKey: feedKeyOf(parsed), roll: decision.observation.roll }),
          new Date(at).toISOString()
        ]
      );
    }
    await client.query('COMMIT');
    return { ...decision, wroteLedger: decision.wroteLedger === true, at };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function previewIdentityWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  await client.query('BEGIN');
  try {
    const at = await readDbNow(client);
    const identity = await resolveVerifiedEos(client, schema, input);
    await client.query('ROLLBACK');
    return {
      ok: true,
      at,
      economicIdentityId: identity.economicIdentityId,
      status: identity.row?.status || '',
      holdReason: identity.row?.hold_reason || '',
      missingRow: identity.missingRow === true,
      wroteLedger: false
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function loadSpendIdentity(client, schema, discordUserId) {
  const result = await client.query(
    `SELECT DISTINCT i.economic_identity_id, i.status, i.hold_reason
     FROM ${schema}.nexus_economic_identities i
     JOIN ${schema}.nexus_economic_identity_links d
       ON d.economic_identity_id = i.economic_identity_id
      AND d.provider = 'discord' AND d.external_id = $1
     JOIN ${schema}.nexus_economic_identity_links e
       ON e.economic_identity_id = i.economic_identity_id
      AND e.provider = 'eos' AND e.verified_at IS NOT NULL
     FOR UPDATE OF i`,
    [String(discordUserId || '').trim()]
  );
  const ids = [...new Set((result.rows || []).map((row) => row.economic_identity_id))];
  if (ids.length !== 1) return { ok: false, reason: ids.length ? 'ambiguous' : 'unlinked', debited: false };
  return { ok: true, row: result.rows[0], economicIdentityId: ids[0] };
}

async function spendWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const orderId = String(input.orderId || '').trim();
  const flags = arnFlags(input.env || {});
  await client.query('BEGIN');
  try {
    if (!orderId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'malformed', debited: false };
    }
    if (flags.creditsEnabled !== true) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'dry-run', debited: false, wroteLedger: false };
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [spendKey(orderId)]);
    const existing = await client.query(
      `SELECT id, balance_after, economic_identity_id FROM ${schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
      [spendKey(orderId)]
    );
    if (existing.rows?.[0]) {
      await client.query('COMMIT');
      return { ok: true, duplicate: true, debited: false, economicIdentityId: existing.rows[0].economic_identity_id, balance: Number(existing.rows[0].balance_after) };
    }
    const identity = await loadSpendIdentity(client, schema, input.discordUserId);
    if (!identity.ok) {
      await client.query('ROLLBACK');
      return identity;
    }
    const blocked = holdOf(identity.row, input.env || {});
    if (blocked) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'held', debited: false, economicIdentityId: identity.economicIdentityId };
    }
    const wallet = await client.query(
      `SELECT balance FROM ${schema}.nexus_economy_wallets
       WHERE economic_identity_id = $1 AND currency = '${CURRENCY}' FOR UPDATE`,
      [identity.economicIdentityId]
    );
    const before = Number(wallet.rows?.[0]?.balance || 0);
    if (!Number.isSafeInteger(before) || before < 1) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'insufficient', debited: false, balance: Math.max(0, before), economicIdentityId: identity.economicIdentityId };
    }
    const after = before - 1;
    await client.query(
      `UPDATE ${schema}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
       WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'`,
      [identity.economicIdentityId, after]
    );
    await client.query(
      `INSERT INTO ${schema}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, '${CURRENCY}', -1, $2, 'debit', '${SPEND_SOURCE}', $3, $4::jsonb, NOW())`,
      [
        identity.economicIdentityId,
        after,
        spendKey(orderId),
        JSON.stringify({
          reason: SPEND_SOURCE,
          orderId,
          rotationVersion: input.rotation?.version || input.rotation?.id || '',
          weights: (input.rotation?.entries || []).map((entry) => ({ name: entry.name, rarity: entry.rarity, weight: entry.weight }))
        })
      ]
    );
    await client.query('COMMIT');
    return { ok: true, debited: true, economicIdentityId: identity.economicIdentityId, balance: after, orderId };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function refundWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const orderId = String(input.orderId || '').trim();
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [refundKey(orderId)]);
    const existing = await client.query(
      `SELECT id FROM ${schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
      [refundKey(orderId)]
    );
    if (existing.rows?.[0]) {
      await client.query('COMMIT');
      return { ok: true, duplicate: true, refunded: false };
    }
    const spent = await client.query(
      `SELECT economic_identity_id FROM ${schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
      [spendKey(orderId)]
    );
    const economicIdentityId = spent.rows?.[0]?.economic_identity_id || input.economicIdentityId || '';
    if (!economicIdentityId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-spent', refunded: false };
    }
    const wallet = await client.query(
      `SELECT balance FROM ${schema}.nexus_economy_wallets
       WHERE economic_identity_id = $1 AND currency = '${CURRENCY}' FOR UPDATE`,
      [economicIdentityId]
    );
    const before = Number(wallet.rows?.[0]?.balance || 0);
    const after = before + 1;
    await client.query(
      `UPDATE ${schema}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
       WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'`,
      [economicIdentityId, after]
    );
    await client.query(
      `INSERT INTO ${schema}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, '${CURRENCY}', 1, $2, 'credit', '${SPEND_SOURCE}', $3, $4::jsonb, NOW())`,
      [economicIdentityId, after, refundKey(orderId), JSON.stringify({ reason: 'arn_cache_refund', orderId })]
    );
    await client.query('COMMIT');
    return { ok: true, refunded: true, economicIdentityId, balance: after };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function balanceForDiscord(client, discordUserId, schemaName = 'public') {
  const schema = sqlIdent(schemaName);
  const identity = await client.query(
    `SELECT DISTINCT i.economic_identity_id
     FROM ${schema}.nexus_economic_identities i
     JOIN ${schema}.nexus_economic_identity_links d
       ON d.economic_identity_id = i.economic_identity_id
      AND d.provider = 'discord' AND d.external_id = $1
     JOIN ${schema}.nexus_economic_identity_links e
       ON e.economic_identity_id = i.economic_identity_id
      AND e.provider = 'eos' AND e.verified_at IS NOT NULL`,
    [String(discordUserId || '').trim()]
  );
  const ids = [...new Set((identity.rows || []).map((row) => row.economic_identity_id).filter(Boolean))];
  if (ids.length !== 1) return 0;
  const result = await client.query(
    `SELECT balance FROM ${schema}.nexus_economy_wallets
     WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'`,
    [ids[0]]
  );
  return Number(result.rows?.[0]?.balance || 0);
}

function createArnLedger({ pool, schema = 'public', env = process.env } = {}) {
  async function withClient(fn) {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
  return {
    preview(input = {}) {
      return withClient((client) => previewIdentityWithClient(client, { ...input, schema, env }));
    },
    drop(input = {}) {
      return withClient((client) => awardDropWithClient(client, { ...input, schema, env: input.env || env }));
    },
    spend(input = {}) {
      return withClient((client) => spendWithClient(client, { ...input, schema, env: input.env || env }));
    },
    refund(input = {}) {
      return withClient((client) => refundWithClient(client, { ...input, schema }));
    },
    async balance(discordUserId) {
      const client = await pool.connect();
      try {
        return { ok: true, balance: await balanceForDiscord(client, discordUserId, schema), currency: CURRENCY };
      } finally {
        client.release();
      }
    }
  };
}

module.exports = {
  CURRENCY,
  DROP_SOURCE,
  MIGRATION_ID,
  dropKey,
  spendKey,
  refundKey,
  windows,
  applyArnCurrencyMigration,
  awardDropWithClient,
  previewIdentityWithClient,
  spendWithClient,
  refundWithClient,
  balanceForDiscord,
  createArnLedger
};
