'use strict';

const { arnFlags } = require('../shared/arn-flags.cjs');
const { sqlIdent } = require('./nexus-economy-postgres-repository.cjs');

const MIGRATE_SOURCE = 'arn_migrate';
const CURRENCY = 'ARN_TOKENS';
const DISCORD_ID = /^\d{5,25}$/;
const HOLDS_HINT = 'Run node scripts/apply-economy-sql-migrations.cjs before applying the ARN balance migration.';
const BLOCKING = new Set(['invalid', 'ambiguous', 'conflict']);
const WRITES = new Set(['credit', 'hold', 'release']);

function migrateKey(economicIdentityId) {
  return `arn-migrate:${economicIdentityId}`;
}

function discordOf(row) {
  return String(row?.discordUserId ?? row?.discord_user_id ?? '').trim();
}

function wholeBalance(value) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  const numeric = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function positiveAmount(value) {
  const amount = wholeBalance(value);
  if (amount == null || amount < 1) return null;
  return amount;
}

function metadataDiscord(row) {
  let meta = row?.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = {}; }
  }
  return String(meta?.discordUserId || row?.discordUserId || '').trim();
}

function idsFor(discord, identities) {
  const raw = identities instanceof Map ? identities.get(discord) : identities?.[discord];
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map((id) => String(id || '').trim()).filter(Boolean))];
}

function creditFor(economicIdentityId, credits) {
  const key = migrateKey(economicIdentityId);
  return (credits || []).find((row) => String(row.idempotency_key || row.idempotencyKey || '') === key) || null;
}

function holdFor(discord, holds) {
  return (holds || []).find((row) => discordOf(row) === discord) || null;
}

function summarize(rows) {
  const summary = {
    credit: 0,
    hold: 0,
    release: 0,
    duplicate: 0,
    holdExisting: 0,
    skip: 0,
    invalid: 0,
    ambiguous: 0,
    conflict: 0
  };
  for (const row of rows) {
    if (row.action === 'hold-existing') summary.holdExisting += 1;
    else if (Object.prototype.hasOwnProperty.call(summary, row.action)) summary[row.action] += 1;
  }
  return summary;
}

function classifyLinked(discord, amount, economicIdentityId, hold, credits) {
  const existing = creditFor(economicIdentityId, credits);
  if (existing) {
    const owner = metadataDiscord(existing);
    if (owner && owner !== discord) {
      return { discordUserId: discord, action: 'conflict', amount, economicIdentityId };
    }
    return { discordUserId: discord, action: 'duplicate', amount: positiveAmount(existing.amount) || amount, economicIdentityId };
  }
  if (hold?.status === 'credited') {
    return { discordUserId: discord, action: 'duplicate', amount: positiveAmount(hold.amount) || amount, economicIdentityId: hold.economic_identity_id || hold.economicIdentityId || economicIdentityId };
  }
  if (hold?.status === 'pending') {
    const held = positiveAmount(hold.amount);
    if (held == null) return { discordUserId: discord, action: 'invalid', amount: hold.amount, economicIdentityId };
    return { discordUserId: discord, action: 'release', amount: held, economicIdentityId };
  }
  return { discordUserId: discord, action: 'credit', amount, economicIdentityId };
}

function planLegacyArnBalances({ wallets = [], identities = {}, holds = [], credits = [] } = {}) {
  const rows = [];
  const positive = new Set();
  for (const wallet of wallets) {
    const discord = discordOf(wallet);
    const balance = wholeBalance(wallet.balance);
    if (!DISCORD_ID.test(discord) || balance == null) {
      rows.push({ discordUserId: discord, action: 'invalid', amount: wallet.balance });
      continue;
    }
    if (positive.has(discord)) {
      rows.push({ discordUserId: discord, action: 'invalid', amount: balance });
      continue;
    }
    if (balance === 0) {
      rows.push({ discordUserId: discord, action: 'skip', amount: 0 });
      continue;
    }
    positive.add(discord);
    const ids = idsFor(discord, identities);
    const hold = holdFor(discord, holds);
    if (ids.length === 0) {
      if (hold?.status === 'credited') {
        rows.push({ discordUserId: discord, action: 'duplicate', amount: positiveAmount(hold.amount) || balance, economicIdentityId: hold.economic_identity_id || hold.economicIdentityId || '' });
      } else if (hold?.status === 'pending') {
        const held = positiveAmount(hold.amount);
        rows.push(held == null
          ? { discordUserId: discord, action: 'invalid', amount: hold.amount }
          : { discordUserId: discord, action: 'hold-existing', amount: held });
      } else {
        rows.push({ discordUserId: discord, action: 'hold', amount: balance });
      }
      continue;
    }
    if (ids.length > 1) {
      rows.push({ discordUserId: discord, action: 'ambiguous', amount: balance, economicIdentityIds: ids });
      continue;
    }
    rows.push(classifyLinked(discord, balance, ids[0], hold, credits));
  }

  for (const hold of holds || []) {
    const discord = discordOf(hold);
    if (String(hold.status || '') !== 'pending' || positive.has(discord)) continue;
    const held = positiveAmount(hold.amount);
    if (!DISCORD_ID.test(discord) || held == null) {
      rows.push({ discordUserId: discord, action: 'invalid', amount: hold.amount });
      continue;
    }
    const ids = idsFor(discord, identities);
    if (ids.length === 0) continue;
    if (ids.length > 1) {
      rows.push({ discordUserId: discord, action: 'ambiguous', amount: held, economicIdentityIds: ids });
      continue;
    }
    const existing = creditFor(ids[0], credits);
    if (existing) {
      const owner = metadataDiscord(existing);
      rows.push(owner && owner !== discord
        ? { discordUserId: discord, action: 'conflict', amount: held, economicIdentityId: ids[0] }
        : { discordUserId: discord, action: 'duplicate', amount: positiveAmount(existing.amount) || held, economicIdentityId: ids[0] });
      continue;
    }
    rows.push({ discordUserId: discord, action: 'release', amount: held, economicIdentityId: ids[0] });
  }

  const shared = new Map();
  for (const row of rows) {
    if (row.action !== 'credit' && row.action !== 'release') continue;
    if (!shared.has(row.economicIdentityId)) shared.set(row.economicIdentityId, []);
    shared.get(row.economicIdentityId).push(row);
  }
  for (const group of shared.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.action = 'ambiguous';
      row.economicIdentityIds = [row.economicIdentityId];
    }
  }

  return { rows, summary: summarize(rows), blocked: rows.some((row) => BLOCKING.has(row.action)) };
}

function candidateDiscordIds(wallets, holds) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    if (!DISCORD_ID.test(id) || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const wallet of wallets) {
    const balance = wholeBalance(wallet.balance);
    if (balance != null && balance > 0) add(discordOf(wallet));
  }
  for (const hold of holds || []) {
    if (String(hold.status || '') === 'pending') add(discordOf(hold));
  }
  return ids;
}

async function loadHolds(client, schemaSql) {
  const result = await client.query(
    `SELECT discord_user_id, amount, economic_identity_id, status
     FROM ${schemaSql}.nexus_economy_arn_migration_holds`
  );
  return result.rows || [];
}

async function loadIdentities(client, schemaSql, discordIds) {
  const map = Object.create(null);
  for (const id of discordIds) map[id] = [];
  if (!discordIds.length) return map;
  const result = await client.query(
    `SELECT d.external_id AS discord_user_id, i.economic_identity_id
     FROM ${schemaSql}.nexus_economic_identities i
     JOIN ${schemaSql}.nexus_economic_identity_links d
       ON d.economic_identity_id = i.economic_identity_id
      AND d.provider = 'discord' AND d.external_id = ANY($1::text[])
     JOIN ${schemaSql}.nexus_economic_identity_links e
       ON e.economic_identity_id = i.economic_identity_id
      AND e.provider = 'eos' AND e.verified_at IS NOT NULL`,
    [discordIds]
  );
  for (const row of result.rows || []) {
    const discord = String(row.discord_user_id || '');
    if (!map[discord]) map[discord] = [];
    if (row.economic_identity_id) map[discord].push(row.economic_identity_id);
  }
  return map;
}

async function loadCredits(client, schemaSql) {
  const result = await client.query(
    `SELECT idempotency_key, economic_identity_id, amount, metadata
     FROM ${schemaSql}.nexus_economy_ledger
     WHERE currency = '${CURRENCY}' AND source = '${MIGRATE_SOURCE}'`
  );
  return result.rows || [];
}

async function readMigrationState(client, schemaSql, wallets, options) {
  let holdsTableReady = options.holdsTableReady !== false;
  let holds = options.holds;
  if (holds == null) {
    if (!client) holds = [];
    else {
      try {
        await client.query(`SELECT 1 AS ok FROM ${schemaSql}.nexus_economy_arn_migration_holds LIMIT 0`);
        holds = await loadHolds(client, schemaSql);
        holdsTableReady = true;
      } catch (error) {
        if (error?.code !== '42P01') throw error;
        holds = [];
        holdsTableReady = false;
      }
    }
  }
  let identities = options.resolutions || options.identitiesByDiscord;
  if (identities == null) {
    identities = client ? await loadIdentities(client, schemaSql, candidateDiscordIds(wallets, holds)) : {};
  }
  let credits = options.credits;
  if (credits == null) credits = client ? await loadCredits(client, schemaSql) : [];
  return { holds, holdsTableReady, identities, credits };
}

async function applyPlan(client, schemaSql, plan) {
  await client.query('BEGIN');
  try {
    for (const row of plan.rows) {
      if (row.action === 'credit' || row.action === 'release') {
        const key = migrateKey(row.economicIdentityId);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        const existing = await client.query(
          `SELECT metadata FROM ${schemaSql}.nexus_economy_ledger WHERE idempotency_key = $1`,
          [key]
        );
        const prior = existing.rows?.[0];
        if (prior) {
          const owner = metadataDiscord(prior);
          if (owner && owner !== row.discordUserId) {
            const error = new Error('ARN migrate key belongs to another Discord user.');
            error.code = 'arn-migrate-conflict';
            throw error;
          }
        } else {
          const current = await client.query(
            `SELECT balance FROM ${schemaSql}.nexus_economy_wallets
             WHERE economic_identity_id = $1 AND currency = '${CURRENCY}' FOR UPDATE`,
            [row.economicIdentityId]
          );
          const before = Number(current.rows?.[0]?.balance || 0);
          const after = before + Number(row.amount);
          if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || after < 0) {
            throw new Error('ARN migrate balance is invalid.');
          }
          if (!current.rows?.[0]) {
            await client.query(
              `INSERT INTO ${schemaSql}.nexus_economy_wallets (economic_identity_id, currency, balance)
               VALUES ($1, '${CURRENCY}', $2)`,
              [row.economicIdentityId, after]
            );
          } else {
            await client.query(
              `UPDATE ${schemaSql}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
               WHERE economic_identity_id = $1 AND currency = '${CURRENCY}'`,
              [row.economicIdentityId, after]
            );
          }
          await client.query(
            `INSERT INTO ${schemaSql}.nexus_economy_ledger
             (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata)
             VALUES ($1, '${CURRENCY}', $2, $3, 'credit', '${MIGRATE_SOURCE}', $4, $5::jsonb)`,
            [row.economicIdentityId, row.amount, after, key, JSON.stringify({
              reason: MIGRATE_SOURCE,
              discordUserId: row.discordUserId,
              legacyBalance: row.amount
            })]
          );
        }
        if (row.action === 'release') {
          await client.query(
            `UPDATE ${schemaSql}.nexus_economy_arn_migration_holds
             SET status = 'credited', economic_identity_id = $2, credited_at = NOW()
             WHERE discord_user_id = $1 AND status = 'pending'`,
            [row.discordUserId, row.economicIdentityId]
          );
        }
      } else if (row.action === 'hold') {
        await client.query(
          `INSERT INTO ${schemaSql}.nexus_economy_arn_migration_holds (discord_user_id, amount, status)
           VALUES ($1, $2, 'pending')
           ON CONFLICT (discord_user_id) DO NOTHING`,
          [row.discordUserId, row.amount]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

async function migrateLegacyArnBalances(options = {}) {
  const apply = options.apply === true;
  const env = options.env || process.env;
  if (apply && arnFlags(env).arnEconomyWritesEnabled !== true) {
    return { ok: false, reason: 'writes-disabled', applied: false };
  }
  const wallets = Array.isArray(options.wallets) ? options.wallets : [];
  const client = options.client || null;
  const schemaSql = sqlIdent(options.schema || 'public');
  const state = await readMigrationState(client, schemaSql, wallets, options);
  const plan = planLegacyArnBalances({
    wallets,
    identities: state.identities,
    holds: state.holds,
    credits: state.credits
  });
  const report = {
    holdsTableReady: state.holdsTableReady,
    blocked: plan.blocked,
    rows: plan.rows,
    summary: plan.summary
  };
  if (!apply) return { ok: true, applied: false, dryRun: true, ...report };
  if (plan.blocked) return { ok: false, reason: 'blocked', applied: false, ...report };
  if (!state.holdsTableReady) {
    return { ok: false, reason: 'holds-table-missing', applied: false, message: HOLDS_HINT, ...report };
  }
  const needsWrite = plan.rows.some((row) => WRITES.has(row.action));
  if (needsWrite && !client) return { ok: false, reason: 'ledger-unavailable', applied: false, ...report };
  if (needsWrite) {
    try {
      await applyPlan(client, schemaSql, plan);
    } catch (error) {
      if (error?.code === '42P01') {
        return { ok: false, reason: 'holds-table-missing', applied: false, message: HOLDS_HINT, ...report };
      }
      if (error?.code === 'arn-migrate-conflict') {
        return { ok: false, reason: 'conflict', applied: false, blocked: true, ...report };
      }
      throw error;
    }
  }
  if (typeof options.freezeWallet === 'function') {
    try {
      await options.freezeWallet();
    } catch (error) {
      return { ok: false, reason: 'freeze-failed', applied: true, message: String(error?.message || error), ...report };
    }
  }
  return { ok: true, applied: true, dryRun: false, ...report };
}

module.exports = {
  MIGRATE_SOURCE,
  migrateKey,
  planLegacyArnBalances,
  migrateLegacyArnBalances
};
