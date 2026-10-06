'use strict';

const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { arnFlags } = require('../shared/arn-flags.cjs');
const { resolveCachePayment } = require('../shared/dino-cache-currency.cjs');
const { memberIdentityHold } = require('../sentinel/nexus-economy-identity-hold.cjs');
const {
  PUBLIC_ROTATION_SECRET,
  ctDayStart,
  ctWeekStart,
  nextCtWeekStart
} = require('../sentinel/arn-cache-rotation.cjs');
const {
  CURRENCY,
  FEED_DEDUPE_MS,
  decideAward,
  feedKeyOf,
  gameEventKey,
  oddsRoll,
  staleReport
} = require('../sentinel/arn-token-award.cjs');

const DROP_SOURCE = 'arn_drop';
const SPEND_SOURCE = 'arn_cache';
const ADJUST_SOURCE = 'arn_adjust';
const MIGRATION_ID = 'arn-tokens-main-ledger-currency';
const CONTROL_MIGRATION_ID = 'arn-tokens-control';
const RECONCILE_GRACE_MS = 15 * 60 * 1000;
const DRY_ROLL_SEED = 'arn-tokens-v1';

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

function dropKey(parsed) {
  return gameEventKey(parsed);
}

function spendKey(orderId) {
  return `arn-spend:${String(orderId || '').trim()}`;
}

function refundKey(orderId) {
  return `arn-refund:${String(orderId || '').trim()}`;
}

function adjustKey(idempotencyKey) {
  return `arn-adjust:${String(idempotencyKey || '').trim()}`;
}

function deliverKey(orderId) {
  return `arn-deliver:${String(orderId || '').trim()}`;
}

function orderIdFromSpendKey(key) {
  const value = String(key || '');
  return value.startsWith('arn-spend:') ? value.slice('arn-spend:'.length) : '';
}

function workerFlags(input = {}) {
  return arnFlags(input.workerEnv || process.env);
}

function metaOf(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function workerRoll(env, eventKey, creditsEnabled) {
  if (creditsEnabled === true) {
    const secret = String(env.ARN_ROTATION_SECRET || '').trim();
    if (secret.length < 32 || secret === PUBLIC_ROTATION_SECRET) {
      const error = new Error('ARN_ROTATION_SECRET is required.');
      error.code = 'arn-rotation-secret-missing';
      throw error;
    }
    return oddsRoll(secret, eventKey);
  }
  return oddsRoll(DRY_ROLL_SEED, eventKey);
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

async function readPaused(client, schema) {
  const result = await client.query(
    `SELECT paused FROM ${schema}.nexus_economy_arn_control WHERE id = 'arn' FOR UPDATE`
  );
  return result.rows?.[0]?.paused === true;
}

async function awardDropWithClient(client, input = {}) {
  const schemaName = input.schema || 'public';
  const schema = sqlIdent(schemaName);
  const flags = workerFlags(input);
  const parsed = input.parsed || {};
  const eventKey = gameEventKey(parsed);
  const discordMessageId = String(input.messageId || '').trim();
  if (!eventKey) return { outcome: 'event-unkeyed', wroteLedger: false };
  const workerEnv = input.workerEnv || process.env;
  await client.query('BEGIN');
  try {
    const at = await readDbNow(client);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`arn-message:${eventKey}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`arn-name:${String(parsed.playerName || '').trim()}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['arn-control']);
    if (flags.creditsEnabled === true && await readPaused(client, schema)) {
      await client.query('ROLLBACK');
      return { outcome: 'paused', wroteLedger: false, at };
    }
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
      [eventKey]
    );
    const priorRow = prior.rows?.[0] || null;
    const feed = await client.query(
      `SELECT event_key, outcome, economic_identity_id, created_at
       FROM ${schema}.nexus_economy_arn_events
       WHERE feed_key = $1 AND event_key <> $2 AND created_at > $3
       ORDER BY created_at ASC LIMIT 1`,
      [feedKeyOf(parsed), eventKey, new Date(at - FEED_DEDUPE_MS).toISOString()]
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
        messageId: eventKey,
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
    const createdAt = Number(input.createdAt);
    const stale = Number.isFinite(createdAt) ? staleReport(createdAt, at, workerEnv) : flags.creditsEnabled === true;
    const decision = decideAward({
      observations,
      ledger: [],
      seededCredits: identity.economicIdentityId ? { economicIdentityId: identity.economicIdentityId, day, week } : null
    }, {
      messageId: eventKey,
      parsed,
      at,
      accounts: [account],
      creditsEnabled: flags.creditsEnabled === true,
      env: workerEnv,
      dayStart: bounds.dayStart,
      dayEnd: bounds.dayEnd,
      weekStart: bounds.weekStart,
      weekEnd: bounds.weekEnd,
      roll: workerRoll(workerEnv, eventKey, flags.creditsEnabled === true),
      stale
    });
    const persistEvent = flags.creditsEnabled === true && !decision.duplicate && decision.observation;
    if (persistEvent) {
      await client.query(
        `INSERT INTO ${schema}.nexus_economy_arn_events
         (event_key, feed_key, economic_identity_id, outcome, roll, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          eventKey,
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
          eventKey,
          JSON.stringify({
            reason: DROP_SOURCE,
            kind: parsed.kind,
            tribeName: parsed.tribeName || '',
            eventId: parsed.eventId || '',
            feedKey: feedKeyOf(parsed),
            roll: decision.observation.roll,
            discordMessageId
          }),
          new Date(at).toISOString()
        ]
      );
    }
    await client.query('COMMIT');
    return { ...decision, wroteLedger: decision.wroteLedger === true, at, eventKey };
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
    `SELECT i.economic_identity_id, i.status, i.hold_reason, e.external_id AS eos_id
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
  const rows = result.rows || [];
  const ids = [...new Set(rows.map((row) => row.economic_identity_id).filter(Boolean))];
  const eosIds = [...new Set(rows.map((row) => String(row.eos_id || '').trim()).filter(Boolean))];
  if (ids.length !== 1 || eosIds.length !== 1) {
    return { ok: false, reason: ids.length || eosIds.length ? 'ambiguous' : 'unlinked', debited: false };
  }
  const row = rows.find((item) => item.economic_identity_id === ids[0]) || rows[0];
  return { ok: true, row, economicIdentityId: ids[0], eosId: eosIds[0] };
}

async function deliveryMarker(client, schema, orderId) {
  const result = await client.query(
    `SELECT event_key FROM ${schema}.nexus_economy_arn_events WHERE event_key = $1`,
    [deliverKey(orderId)]
  );
  return Boolean(result.rows?.[0]);
}

async function spendWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const orderId = String(input.orderId || '').trim();
  const flags = workerFlags(input);
  const pay = resolveCachePayment(input.cacheId || 'arn', input.currency || 'ARN_TOKENS');
  if (!pay.ok || pay.currency !== 'ARN_TOKENS') {
    return { ok: false, reason: 'currency-not-accepted', cacheId: pay.cacheId, currency: pay.currency, accepted: pay.accepted, debited: false };
  }
  if (flags.creditsEnabled !== true) {
    return { ok: false, reason: 'dry-run', debited: false, wroteLedger: false };
  }
  await client.query('BEGIN');
  try {
    if (!orderId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'malformed', debited: false };
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [spendKey(orderId)]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['arn-control']);
    const existing = await client.query(
      `SELECT id, balance_after, economic_identity_id, metadata FROM ${schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
      [spendKey(orderId)]
    );
    if (existing.rows?.[0]) {
      const spentRow = existing.rows[0];
      const metadata = metaOf(spentRow.metadata);
      const refunded = await client.query(
        `SELECT id FROM ${schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
        [refundKey(orderId)]
      );
      const delivered = await deliveryMarker(client, schema, orderId);
      const alreadyRefunded = Boolean(refunded.rows?.[0]);
      await client.query('COMMIT');
      return {
        ok: true,
        duplicate: true,
        debited: false,
        resumable: alreadyRefunded !== true && delivered !== true,
        delivered,
        refunded: alreadyRefunded,
        eosId: String(metadata.eosId || ''),
        economicIdentityId: spentRow.economic_identity_id,
        balance: Number(spentRow.balance_after),
        orderId
      };
    }
    if (await readPaused(client, schema)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'paused', debited: false };
    }
    const identity = await loadSpendIdentity(client, schema, input.discordUserId);
    if (!identity.ok) {
      await client.query('ROLLBACK');
      return identity;
    }
    const blocked = holdOf(identity.row, input.workerEnv || process.env);
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
          eosId: identity.eosId,
          rotationVersion: input.rotation?.version || input.rotation?.id || '',
          weights: (input.rotation?.entries || []).map((entry) => ({ name: entry.name, rarity: entry.rarity, weight: entry.weight }))
        })
      ]
    );
    await client.query('COMMIT');
    return { ok: true, debited: true, economicIdentityId: identity.economicIdentityId, eosId: identity.eosId, balance: after, orderId };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function refundWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const orderId = String(input.orderId || '').trim();
  const flags = workerFlags(input);
  if (flags.creditsEnabled !== true) {
    return { ok: false, reason: 'dry-run', refunded: false, wroteLedger: false };
  }
  await client.query('BEGIN');
  try {
    if (!orderId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'malformed', refunded: false };
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [spendKey(orderId)]);
    const existing = await client.query(
      `SELECT id FROM ${schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
      [refundKey(orderId)]
    );
    if (existing.rows?.[0]) {
      await client.query('COMMIT');
      return { ok: true, duplicate: true, refunded: false };
    }
    const spent = await client.query(
      `SELECT economic_identity_id, amount, currency, entry_type, source
       FROM ${schema}.nexus_economy_ledger
       WHERE idempotency_key = $1 AND entry_type = 'debit' AND amount < 0
         AND currency = '${CURRENCY}' AND source = '${SPEND_SOURCE}'`,
      [spendKey(orderId)]
    );
    if ((spent.rows || []).length !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-spent', refunded: false };
    }
    const row = spent.rows[0];
    const spentAmount = Number(row.amount);
    const economicIdentityId = String(row.economic_identity_id || '');
    if (row.currency !== CURRENCY || row.entry_type !== 'debit' || row.source !== SPEND_SOURCE || !economicIdentityId || !Number.isInteger(spentAmount) || spentAmount >= 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-spent', refunded: false };
    }
    if (await deliveryMarker(client, schema, orderId)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'delivered', refunded: false, economicIdentityId };
    }
    const identity = await client.query(
      `SELECT economic_identity_id, status, hold_reason
       FROM ${schema}.nexus_economic_identities
       WHERE economic_identity_id = $1
       FOR UPDATE`,
      [economicIdentityId]
    );
    const identityRow = (identity.rows || []).find((item) => item.economic_identity_id === economicIdentityId) || null;
    const blocked = holdOf(identityRow, input.workerEnv || process.env);
    if (blocked) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'held', refunded: false, economicIdentityId };
    }
    const credit = -spentAmount;
    const wallet = await client.query(
      `SELECT balance FROM ${schema}.nexus_economy_wallets
       WHERE economic_identity_id = $1 AND currency = '${CURRENCY}' FOR UPDATE`,
      [economicIdentityId]
    );
    const before = Number(wallet.rows?.[0]?.balance || 0);
    const after = before + credit;
    if (!wallet.rows?.[0]) {
      await client.query(
        `INSERT INTO ${schema}.nexus_economy_wallets (economic_identity_id, currency, balance)
         VALUES ($1, '${CURRENCY}', $2)`,
        [economicIdentityId, after]
      );
    } else {
      await client.query(
        `UPDATE ${schema}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
         WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'`,
        [economicIdentityId, after]
      );
    }
    await client.query(
      `INSERT INTO ${schema}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, '${CURRENCY}', $2, $3, 'credit', '${SPEND_SOURCE}', $4, $5::jsonb, NOW())`,
      [economicIdentityId, credit, after, refundKey(orderId), JSON.stringify({ reason: 'arn_cache_refund', orderId, spendAmount: spentAmount })]
    );
    await client.query('COMMIT');
    return { ok: true, refunded: true, economicIdentityId, amount: credit, balance: after };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function confirmDeliveryWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const orderId = String(input.orderId || '').trim();
  const flags = workerFlags(input);
  if (flags.creditsEnabled !== true) return { ok: false, reason: 'dry-run', confirmed: false };
  await client.query('BEGIN');
  try {
    if (!orderId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'malformed', confirmed: false };
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [spendKey(orderId)]);
    const spent = await client.query(
      `SELECT economic_identity_id FROM ${schema}.nexus_economy_ledger
       WHERE idempotency_key = $1 AND entry_type = 'debit' AND amount < 0
         AND currency = '${CURRENCY}' AND source = '${SPEND_SOURCE}'`,
      [spendKey(orderId)]
    );
    if ((spent.rows || []).length !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not-spent', confirmed: false };
    }
    const marker = deliverKey(orderId);
    const prior = await client.query(
      `SELECT event_key FROM ${schema}.nexus_economy_arn_events WHERE event_key = $1`,
      [marker]
    );
    if (!prior.rows?.[0]) {
      await client.query(
        `INSERT INTO ${schema}.nexus_economy_arn_events
         (event_key, feed_key, economic_identity_id, outcome, roll, created_at)
         VALUES ($1, $2, $3, 'delivered', NULL, NOW())`,
        [marker, 'deliver', spent.rows[0].economic_identity_id]
      );
    }
    await client.query('COMMIT');
    return { ok: true, confirmed: true, duplicate: Boolean(prior.rows?.[0]), orderId };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function reconcileWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const flags = workerFlags(input);
  if (flags.creditsEnabled !== true) return { ok: false, reason: 'dry-run', refunded: 0 };
  const graceMs = Number.isFinite(Number(input.graceMs)) && Number(input.graceMs) >= 0
    ? Number(input.graceMs)
    : RECONCILE_GRACE_MS;
  await client.query('BEGIN');
  let keys = [];
  try {
    const at = await readDbNow(client);
    const cutoff = new Date(at - graceMs).toISOString();
    const found = await client.query(
      `SELECT idempotency_key
       FROM ${schema}.nexus_economy_ledger
       WHERE currency = '${CURRENCY}' AND source = '${SPEND_SOURCE}'
         AND entry_type = 'debit' AND amount < 0
         AND idempotency_key LIKE 'arn-spend:%'
         AND created_at < $1`,
      [cutoff]
    );
    keys = (found.rows || []).map((row) => row.idempotency_key).filter(Boolean);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
  let refunded = 0;
  for (const key of keys) {
    const orderId = orderIdFromSpendKey(key);
    if (!orderId) continue;
    if (await deliveryMarker(client, schema, orderId)) continue;
    const result = await refundWithClient(client, { ...input, orderId, schema: input.schema || 'public' });
    if (result?.refunded === true) refunded += 1;
  }
  return { ok: true, refunded, scanned: keys.length };
}

async function setPausedWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const flags = workerFlags(input);
  if (flags.arnEconomyWritesEnabled !== true || flags.dryRun !== false) {
    return { ok: false, reason: 'dry-run', wroteLedger: false };
  }
  const paused = input.paused === true;
  const actor = String(input.actor || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  const reason = String(input.reason || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['arn-control']);
    await client.query(
      `INSERT INTO ${schema}.nexus_economy_arn_control (id, paused, actor, reason, updated_at)
       VALUES ('arn', $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE
       SET paused = EXCLUDED.paused, actor = EXCLUDED.actor, reason = EXCLUDED.reason, updated_at = NOW()`,
      [paused, actor, reason]
    );
    await client.query('COMMIT');
    return { ok: true, paused, wroteLedger: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function adjustWithClient(client, input = {}) {
  const schema = sqlIdent(input.schema || 'public');
  const flags = workerFlags(input);
  if (flags.creditsEnabled !== true) return { ok: false, reason: 'dry-run', wroteLedger: false };
  const delta = Number(input.delta);
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!Number.isInteger(delta) || delta === 0 || !idempotencyKey) {
    return { ok: false, reason: 'malformed', wroteLedger: false };
  }
  const key = adjustKey(idempotencyKey);
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    const existing = await client.query(
      `SELECT id, balance_after FROM ${schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
      [key]
    );
    if (existing.rows?.[0]) {
      await client.query('COMMIT');
      return { ok: true, duplicate: true, wroteLedger: false, balance: Number(existing.rows[0].balance_after) };
    }
    const identity = await loadSpendIdentity(client, schema, input.discordUserId);
    if (!identity.ok) {
      await client.query('ROLLBACK');
      return { ...identity, wroteLedger: false };
    }
    const blocked = holdOf(identity.row, input.workerEnv || process.env);
    if (blocked) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'held', wroteLedger: false, economicIdentityId: identity.economicIdentityId };
    }
    const wallet = await client.query(
      `SELECT balance FROM ${schema}.nexus_economy_wallets
       WHERE economic_identity_id = $1 AND currency = '${CURRENCY}' FOR UPDATE`,
      [identity.economicIdentityId]
    );
    const before = Number(wallet.rows?.[0]?.balance || 0);
    const after = before + delta;
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || after < 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'insufficient', wroteLedger: false, balance: Math.max(0, before) };
    }
    if (!wallet.rows?.[0]) {
      await client.query(
        `INSERT INTO ${schema}.nexus_economy_wallets (economic_identity_id, currency, balance)
         VALUES ($1, '${CURRENCY}', $2)`,
        [identity.economicIdentityId, after]
      );
    } else {
      await client.query(
        `UPDATE ${schema}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
         WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'`,
        [identity.economicIdentityId, after]
      );
    }
    await client.query(
      `INSERT INTO ${schema}.nexus_economy_ledger
       (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
       VALUES ($1, '${CURRENCY}', $2, $3, $4, '${ADJUST_SOURCE}', $5, $6::jsonb, NOW())`,
      [
        identity.economicIdentityId,
        delta,
        after,
        delta > 0 ? 'credit' : 'debit',
        key,
        JSON.stringify({
          reason: ADJUST_SOURCE,
          actor: String(input.actor || '').slice(0, 80),
          note: String(input.reason || '').slice(0, 300)
        })
      ]
    );
    await client.query('COMMIT');
    return { ok: true, wroteLedger: true, balance: after, amount: delta, economicIdentityId: identity.economicIdentityId };
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

function bindWorkerInput(input, env) {
  const body = { ...(input || {}) };
  delete body.env;
  delete body.workerEnv;
  delete body.roll;
  delete body.seed;
  delete body.creditsEnabled;
  delete body.graceMs;
  body.workerEnv = env;
  return body;
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
      return withClient((client) => previewIdentityWithClient(client, { ...bindWorkerInput(input, env), schema }));
    },
    drop(input = {}) {
      return withClient((client) => awardDropWithClient(client, { ...bindWorkerInput(input, env), schema }));
    },
    spend(input = {}) {
      return withClient((client) => spendWithClient(client, { ...bindWorkerInput(input, env), schema }));
    },
    refund(input = {}) {
      return withClient((client) => refundWithClient(client, { ...bindWorkerInput(input, env), schema }));
    },
    confirm(input = {}) {
      return withClient((client) => confirmDeliveryWithClient(client, { ...bindWorkerInput(input, env), schema }));
    },
    reconcile(input = {}) {
      return withClient((client) => reconcileWithClient(client, { ...bindWorkerInput(input, env), schema }));
    },
    pause(input = {}) {
      return withClient((client) => setPausedWithClient(client, { ...bindWorkerInput(input, env), schema }));
    },
    adjust(input = {}) {
      return withClient((client) => adjustWithClient(client, { ...bindWorkerInput(input, env), schema }));
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
  SPEND_SOURCE,
  ADJUST_SOURCE,
  MIGRATION_ID,
  CONTROL_MIGRATION_ID,
  RECONCILE_GRACE_MS,
  dropKey,
  spendKey,
  refundKey,
  adjustKey,
  deliverKey,
  windows,
  awardDropWithClient,
  previewIdentityWithClient,
  spendWithClient,
  refundWithClient,
  confirmDeliveryWithClient,
  reconcileWithClient,
  setPausedWithClient,
  adjustWithClient,
  balanceForDiscord,
  createArnLedger
};
