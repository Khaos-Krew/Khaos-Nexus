'use strict';

const crypto = require('node:crypto');
const {
  NexusEconomyPostgresRepository,
  sqlIdent,
  cleanExternalId
} = require('./nexus-economy-postgres-repository.cjs');

const LEGACY_STORE_VERSION = 1;
const LEGACY_CURRENCY = 'NEXUS_POINTS';

function deterministicEconomicIdentityId(discordUserId) {
  const discord = cleanExternalId(discordUserId, 'Discord user ID');
  const digest = crypto.createHash('sha256').update(`legacy-discord:${discord}`, 'utf8').digest('hex');
  return `econ_legacy_${digest.slice(0, 32)}`;
}

function validIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function validateLegacyState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Legacy economy state is required.');
  if (state.version !== LEGACY_STORE_VERSION) throw new Error('Unsupported legacy economy store version.');
  if (!state.accounts || typeof state.accounts !== 'object' || Array.isArray(state.accounts)) throw new Error('Legacy economy accounts are invalid.');
  if (!state.eosToDiscord || typeof state.eosToDiscord !== 'object' || Array.isArray(state.eosToDiscord)) throw new Error('Legacy EOS identity map is invalid.');
  if (!Array.isArray(state.ledger)) throw new Error('Legacy economy ledger is invalid.');
  if (!state.processed || typeof state.processed !== 'object' || Array.isArray(state.processed)) throw new Error('Legacy economy idempotency map is invalid.');
  return state;
}

function planLegacyJsonMigration(input) {
  const state = validateLegacyState(structuredClone(input));
  const identities = [];
  const links = [];
  const wallets = [];
  const ledger = [];
  const tombstones = [];
  const accountByDiscord = new Map();
  const eosOwner = new Map();

  for (const [rawDiscord, account] of Object.entries(state.accounts)) {
    const discordUserId = cleanExternalId(rawDiscord, 'Discord user ID');
    if (!account || typeof account !== 'object' || String(account.discordUserId || discordUserId) !== discordUserId) {
      throw new Error(`Legacy account ${discordUserId} is inconsistent.`);
    }
    const balance = Number(account.balance);
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error(`Legacy balance for ${discordUserId} is invalid.`);
    const economicIdentityId = deterministicEconomicIdentityId(discordUserId);
    const eosIds = new Set((Array.isArray(account.eosIds) ? account.eosIds : []).map((value) => cleanExternalId(value, 'EOS ID')));
    accountByDiscord.set(discordUserId, { account, economicIdentityId, balance, eosIds });
  }

  for (const [rawEos, rawDiscord] of Object.entries(state.eosToDiscord)) {
    const eosId = cleanExternalId(rawEos, 'EOS ID');
    const discordUserId = cleanExternalId(rawDiscord, 'Discord user ID');
    if (!accountByDiscord.has(discordUserId)) throw new Error(`Legacy EOS ${eosId} points to a missing Discord account.`);
    const existing = eosOwner.get(eosId);
    if (existing && existing !== discordUserId) throw new Error(`Legacy EOS ${eosId} is linked to multiple Discord accounts.`);
    eosOwner.set(eosId, discordUserId);
    accountByDiscord.get(discordUserId).eosIds.add(eosId);
  }

  for (const [discordUserId, entry] of accountByDiscord) {
    for (const eosId of entry.eosIds) {
      const mapped = state.eosToDiscord[eosId];
      if (mapped && String(mapped) !== discordUserId) throw new Error(`Legacy EOS ${eosId} conflicts with account ${discordUserId}.`);
      const existing = eosOwner.get(eosId);
      if (existing && existing !== discordUserId) throw new Error(`Legacy EOS ${eosId} is linked to multiple Discord accounts.`);
      eosOwner.set(eosId, discordUserId);
    }
  }

  for (const [discordUserId, entry] of accountByDiscord) {
    const verified = entry.eosIds.size > 0;
    const linkedAt = validIso(entry.account.updatedAt) || validIso(entry.account.createdAt) || validIso(state.updatedAt);
    identities.push(Object.freeze({
      economicIdentityId: entry.economicIdentityId,
      status: verified ? 'verified' : 'restricted',
      legacyDiscordUserId: discordUserId
    }));
    links.push(Object.freeze({
      provider: 'discord',
      externalId: discordUserId,
      economicIdentityId: entry.economicIdentityId,
      verifiedAt: verified ? linkedAt : null,
      source: 'legacy-economy-json'
    }));
    for (const eosId of [...entry.eosIds].sort()) {
      links.push(Object.freeze({
        provider: 'eos',
        externalId: eosId,
        economicIdentityId: entry.economicIdentityId,
        verifiedAt: linkedAt,
        source: 'legacy-economy-json'
      }));
    }
    wallets.push(Object.freeze({
      economicIdentityId: entry.economicIdentityId,
      currency: LEGACY_CURRENCY,
      balance: entry.balance,
      legacyDiscordUserId: discordUserId
    }));
  }

  const processedByEntryId = new Map();
  for (const [key, rawEntryId] of Object.entries(state.processed)) {
    const idempotencyKey = String(key || '').trim();
    const entryId = String(rawEntryId || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 256 || !entryId) throw new Error('Legacy processed idempotency entry is invalid.');
    const list = processedByEntryId.get(entryId) || [];
    list.push(idempotencyKey);
    processedByEntryId.set(entryId, list);
  }

  const seenLedgerIds = new Set();
  for (const legacyEntry of state.ledger) {
    if (!legacyEntry || typeof legacyEntry !== 'object') throw new Error('Legacy ledger entry is invalid.');
    const legacyLedgerId = String(legacyEntry.id || '').trim();
    if (!legacyLedgerId || seenLedgerIds.has(legacyLedgerId)) throw new Error('Legacy ledger IDs must be unique and non-empty.');
    seenLedgerIds.add(legacyLedgerId);
    const discordUserId = cleanExternalId(legacyEntry.discordUserId, 'Ledger Discord user ID');
    const account = accountByDiscord.get(discordUserId);
    if (!account) throw new Error(`Legacy ledger entry ${legacyLedgerId} references a missing account.`);
    const amount = Number(legacyEntry.amount);
    const balanceAfter = Number(legacyEntry.balanceAfter);
    if (!Number.isSafeInteger(amount) || amount === 0) throw new Error(`Legacy ledger entry ${legacyLedgerId} has an invalid amount.`);
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) throw new Error(`Legacy ledger entry ${legacyLedgerId} has an invalid balance.`);
    const processedKeys = [...(processedByEntryId.get(legacyLedgerId) || [])].sort();
    const idempotencyKey = processedKeys.shift() || `legacy-ledger:${legacyLedgerId}`;
    ledger.push(Object.freeze({
      legacyLedgerId,
      economicIdentityId: account.economicIdentityId,
      currency: LEGACY_CURRENCY,
      amount,
      balanceAfter,
      type: String(legacyEntry.type || 'legacy').slice(0, 128),
      source: String(legacyEntry.source || 'legacy-economy-json').slice(0, 128),
      idempotencyKey,
      metadata: Object.freeze({ ...(legacyEntry.metadata || {}), legacyLedgerId, migratedFrom: 'nexus-economy.json' }),
      at: validIso(legacyEntry.at) || validIso(state.updatedAt)
    }));
    for (const key of processedKeys) tombstones.push(Object.freeze({ idempotencyKey: key, legacyLedgerId }));
  }

  for (const [legacyEntryId, keys] of processedByEntryId) {
    if (seenLedgerIds.has(legacyEntryId)) continue;
    for (const idempotencyKey of keys) tombstones.push(Object.freeze({ idempotencyKey, legacyLedgerId: legacyEntryId }));
  }

  for (const [discordUserId, entry] of accountByDiscord) {
    const accountEntries = ledger.filter((item) => item.economicIdentityId === entry.economicIdentityId);
    if (accountEntries.length) {
      const last = accountEntries.at(-1);
      if (last.balanceAfter !== entry.balance) {
        throw new Error(`Legacy wallet ${discordUserId} balance does not match its latest retained ledger balance.`);
      }
    }
  }

  return Object.freeze({
    sourceVersion: state.version,
    currency: LEGACY_CURRENCY,
    identities: Object.freeze(identities),
    links: Object.freeze(links),
    wallets: Object.freeze(wallets),
    ledger: Object.freeze(ledger),
    tombstones: Object.freeze(tombstones),
    counts: Object.freeze({
      identities: identities.length,
      links: links.length,
      wallets: wallets.length,
      ledgerEntries: ledger.length,
      idempotencyTombstones: tombstones.length
    })
  });
}

function migrationSupportSql({ schema = 'public' } = {}) {
  const s = sqlIdent(schema);
  return [
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_idempotency_tombstones (`,
    '  idempotency_key TEXT PRIMARY KEY,',
    '  legacy_entry_id TEXT,',
    "  source TEXT NOT NULL DEFAULT 'legacy-economy-json',",
    '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');'
  ].join('\n');
}

async function applyLegacyJsonMigration({ pool, state, schema = 'public', dryRun = true } = {}) {
  const plan = planLegacyJsonMigration(state);
  if (dryRun) return Object.freeze({ ok: true, dryRun: true, applied: false, plan });
  if (!pool || typeof pool.connect !== 'function') throw new Error('Postgres pool is required to apply the migration.');
  const s = sqlIdent(schema);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(NexusEconomyPostgresRepository.schemaSql({ schema }));
    await client.query(migrationSupportSql({ schema }));

    for (const identity of plan.identities) {
      await client.query(
        `INSERT INTO ${s}.nexus_economic_identities (economic_identity_id, status) VALUES ($1,$2) ON CONFLICT (economic_identity_id) DO NOTHING`,
        [identity.economicIdentityId, identity.status]
      );
    }

    for (const link of plan.links) {
      const inserted = await client.query(
        `INSERT INTO ${s}.nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source)\n` +
        `VALUES ($1,$2,$3,$4,$5) ON CONFLICT (provider, external_id) DO NOTHING RETURNING economic_identity_id`,
        [link.provider, link.externalId, link.economicIdentityId, link.verifiedAt, link.source]
      );
      if (!inserted.rows?.[0]) {
        const existing = await client.query(
          `SELECT economic_identity_id FROM ${s}.nexus_economic_identity_links WHERE provider = $1 AND external_id = $2`,
          [link.provider, link.externalId]
        );
        if (existing.rows?.[0]?.economic_identity_id !== link.economicIdentityId) {
          throw new Error(`Identity link conflict for ${link.provider}:${link.externalId}.`);
        }
      }
    }

    for (const wallet of plan.wallets) {
      const inserted = await client.query(
        `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance) VALUES ($1,$2,$3)\n` +
        `ON CONFLICT (economic_identity_id, currency) DO NOTHING RETURNING balance`,
        [wallet.economicIdentityId, wallet.currency, wallet.balance]
      );
      if (!inserted.rows?.[0]) {
        const existing = await client.query(
          `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = $2 FOR UPDATE`,
          [wallet.economicIdentityId, wallet.currency]
        );
        if (Number(existing.rows?.[0]?.balance) !== wallet.balance) {
          throw new Error(`Wallet migration conflict for ${wallet.economicIdentityId}:${wallet.currency}.`);
        }
      }
    }

    for (const entry of plan.ledger) {
      const inserted = await client.query(
        `INSERT INTO ${s}.nexus_economy_ledger\n` +
        `(economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)\n` +
        `VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,COALESCE($9::timestamptz,NOW()))\n` +
        `ON CONFLICT (idempotency_key) DO NOTHING RETURNING economic_identity_id, currency, amount, balance_after`,
        [entry.economicIdentityId, entry.currency, entry.amount, entry.balanceAfter, entry.type, entry.source, entry.idempotencyKey, JSON.stringify(entry.metadata), entry.at]
      );
      if (!inserted.rows?.[0]) {
        const existing = await client.query(
          `SELECT economic_identity_id, currency, amount, balance_after FROM ${s}.nexus_economy_ledger WHERE idempotency_key = $1`,
          [entry.idempotencyKey]
        );
        const row = existing.rows?.[0];
        if (!row || row.economic_identity_id !== entry.economicIdentityId || row.currency !== entry.currency || Number(row.amount) !== entry.amount || Number(row.balance_after) !== entry.balanceAfter) {
          throw new Error(`Ledger idempotency conflict for ${entry.idempotencyKey}.`);
        }
      }
    }

    for (const tombstone of plan.tombstones) {
      await client.query(
        `INSERT INTO ${s}.nexus_economy_idempotency_tombstones (idempotency_key, legacy_entry_id) VALUES ($1,$2)\n` +
        `ON CONFLICT (idempotency_key) DO NOTHING`,
        [tombstone.idempotencyKey, tombstone.legacyLedgerId]
      );
    }

    await client.query('COMMIT');
    return Object.freeze({ ok: true, dryRun: false, applied: true, plan });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  LEGACY_STORE_VERSION,
  LEGACY_CURRENCY,
  deterministicEconomicIdentityId,
  validateLegacyState,
  planLegacyJsonMigration,
  migrationSupportSql,
  applyLegacyJsonMigration
};
