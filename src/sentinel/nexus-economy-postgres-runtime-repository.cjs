'use strict';

const { NexusEconomyPostgresRepository, sqlIdent, normalizeCurrency, cleanExternalId } = require('./nexus-economy-postgres-repository.cjs');
const { linkElevationHold, quarantineDenylist } = require('./nexus-economy-identity-hold.cjs');
const { deterministicEconomicIdentityId } = require('./nexus-economy-json-postgres-migration.cjs');
const { validDiscordId, validEosId } = require('./ark-identity-store.cjs');
const { assertO9EligibilityForVerifiedMint } = require('./nexus-economy-o9-eligibility.cjs');
const { isShadowRecruitEligibleRank } = require('../shared/ranks.cjs');

const SHADOW_RECRUIT_LINK_SOURCE = 'shadow-recruit-rank';
const PRIMARY_CURRENCIES = Object.freeze(['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']);
const FUNDED_LEDGER_CURRENCIES = Object.freeze(['NEXUS_POINTS', 'DINO_CACHE_TOKENS']);

function cleanHoldActor(value) {
  const actor = String(value || '').trim();
  if (!actor || actor.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9 ._@+-]*$/.test(actor)) {
    throw new Error('Actor is required.');
  }
  return actor;
}

function cleanHoldReason(value) {
  const reason = String(value || '').trim();
  if (!reason || reason.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(reason)) {
    throw new Error('Hold reason is required.');
  }
  return reason;
}

// Coin ledger rows, including community level-up, do not mark a Shadow Recruit.
function legacyReviewPredicates(schemaSql) {
  const funded = FUNDED_LEDGER_CURRENCIES.map((currency) => `'${currency}'`).join(', ');
  return {
    unmarkedRestricted: `i.status = 'restricted' AND (i.hold_reason IS NULL OR btrim(i.hold_reason) = '')`,
    verifiedLink: `EXISTS (
      SELECT 1 FROM ${schemaSql}.nexus_economic_identity_links AS l
      WHERE l.economic_identity_id = i.economic_identity_id
        AND l.provider IN ('eos', 'minecraft')
        AND l.verified_at IS NOT NULL
    )`,
    fundedLedger: `EXISTS (
      SELECT 1 FROM ${schemaSql}.nexus_economy_ledger AS g
      WHERE g.economic_identity_id = i.economic_identity_id
        AND g.currency IN (${funded})
    )`,
    fundedBalance: `EXISTS (
      SELECT 1 FROM ${schemaSql}.nexus_economy_wallets AS w
      WHERE w.economic_identity_id = i.economic_identity_id
        AND w.currency IN (${funded})
        AND w.balance > 0
    )`,
    coinLedger: `EXISTS (
      SELECT 1 FROM ${schemaSql}.nexus_economy_ledger AS c
      WHERE c.economic_identity_id = i.economic_identity_id
        AND c.currency = 'NEXUS_COINS'
    )`
  };
}

function holdAuditTableSql(schemaSql) {
  return `CREATE TABLE IF NOT EXISTS ${schemaSql}.nexus_economy_identity_hold_audit (
    audit_id BIGSERIAL PRIMARY KEY,
    economic_identity_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('place', 'lift')),
    hold_reason TEXT,
    prior_hold_reason TEXT,
    actor TEXT NOT NULL,
    checkpoint_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`;
}

function holdAuditIndexSql(schemaSql) {
  return `CREATE INDEX IF NOT EXISTS nexus_economy_identity_hold_audit_identity_idx ON ${schemaSql}.nexus_economy_identity_hold_audit (economic_identity_id, created_at DESC);`;
}

function migrationsTableSql(schemaSql) {
  return `CREATE TABLE IF NOT EXISTS ${schemaSql}.nexus_economy_schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    row_count INTEGER NOT NULL DEFAULT 0
  );`;
}

class NexusEconomyPostgresRuntimeRepository extends NexusEconomyPostgresRepository {
  constructor(options = {}) {
    super(options);
    this.schemaName = String(options.schema || 'public').trim() || 'public';
    this.runtimeSchema = sqlIdent(this.schemaName);
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
  }

  // Close the passive cursor so held time cannot be paid on the next lazy read.
  async #checkpointAccrual(client, economicIdentityId, atMs = this.now()) {
    const s = this.runtimeSchema;
    const atIso = new Date(atMs).toISOString();
    await client.query(
      `INSERT INTO ${s}.nexus_economy_accrual_state (economic_identity_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [economicIdentityId]
    );
    await client.query(
      `UPDATE ${s}.nexus_economy_accrual_state SET online = false, online_since = NULL, offline_since = $2, last_passive_at = $2, last_presence_at = $2, last_accounting_at = $2, online_uncredited_ms = 0, updated_at = NOW() WHERE economic_identity_id = $1`,
      [economicIdentityId, atIso]
    );
    return atIso;
  }

  // Called only after the runtime verifies the Sentinel proof. No balance changes.
  // O9: elevates a freshly minted row, or an existing restricted row with no hold marker,
  // only when assertO9EligibilityForVerifiedMint passes. Already-verified rows are never demoted.
  // Restricted-with-marker, quarantined, disabled, and a missing row stay held.
  async linkVerifiedIdentity({ discordUserId, eosId, verifiedAt, discordMembershipVerified } = {}) {
    if (!validDiscordId(discordUserId) || !validEosId(eosId) || !Number.isFinite(Date.parse(verifiedAt))) throw new Error('Invalid verified identity.');
    const s = this.runtimeSchema;
    const env = this.env || process.env;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize link ownership changes with each other and migration inserts.
      await client.query(`LOCK TABLE ${s}.nexus_economic_identity_links IN SHARE ROW EXCLUSIVE MODE`);
      const links = await client.query(
        `SELECT provider, external_id, economic_identity_id, verified_at FROM ${s}.nexus_economic_identity_links WHERE (provider = 'discord' AND external_id = $1) OR (provider = 'eos' AND external_id = $2) FOR UPDATE`,
        [discordUserId, eosId]
      );
      const discord = links.rows.find((row) => row.provider === 'discord');
      const eos = links.rows.find((row) => row.provider === 'eos');
      const economicIdentityId = discord?.economic_identity_id || deterministicEconomicIdentityId(discordUserId);
      if (eos && eos.economic_identity_id !== economicIdentityId) throw new Error('EOS identity is already owned by another economic identity.');
      await client.query(
        `INSERT INTO ${s}.nexus_economic_identities (economic_identity_id, status) VALUES ($1, 'restricted') ON CONFLICT DO NOTHING RETURNING economic_identity_id`,
        [economicIdentityId]
      );
      const identity = await client.query(
        `SELECT status, hold_reason, held_by FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
        [economicIdentityId]
      );
      const priorStatus = identity.rows[0]?.status;
      let holdReason = identity.rows[0]?.hold_reason || '';
      let stamped = false;
      if (quarantineDenylist(env).has(economicIdentityId) && !String(holdReason || '').trim()) {
        await client.query(
          `UPDATE ${s}.nexus_economic_identities SET hold_reason = 'quarantine', updated_at = NOW() WHERE economic_identity_id = $1 AND (hold_reason IS NULL OR btrim(hold_reason) = '')`,
          [economicIdentityId]
        );
        holdReason = 'quarantine';
        stamped = true;
        await this.#checkpointAccrual(client, economicIdentityId);
      }
      const held = linkElevationHold({
        status: priorStatus,
        holdReason,
        economicIdentityId,
        missingRow: !identity.rows[0],
        env
      });
      if (held) {
        if (stamped) await client.query('COMMIT');
        else await client.query('ROLLBACK');
        return { ...held, status: priorStatus || null, holdReason: holdReason || null, economicIdentityId };
      }
      for (const [provider, externalId] of [['discord', discordUserId], ['eos', eosId]]) {
        await client.query(
          `INSERT INTO ${s}.nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source) VALUES ($1,$2,$3,$4,'sentinel-ownership-proof') ON CONFLICT (provider, external_id) DO UPDATE SET verified_at = COALESCE(nexus_economic_identity_links.verified_at, EXCLUDED.verified_at), source = CASE WHEN nexus_economic_identity_links.verified_at IS NULL THEN EXCLUDED.source ELSE nexus_economic_identity_links.source END`,
          [provider, externalId, economicIdentityId, verifiedAt]
        );
      }
      // Idempotent re-link: never demote an already-verified identity, but still run O9.
      if (priorStatus === 'verified') {
        const already = assertO9EligibilityForVerifiedMint({ discordUserId, eosId, verifiedAt, discordMembershipVerified });
        if (!already.ok) {
          await client.query('ROLLBACK');
          return { ok: false, status: 'verified', eligibility: already.reason, economicIdentityId };
        }
        await client.query('COMMIT');
        return { ok: true, duplicate: true, status: 'verified', economicIdentityId };
      }
      const eligibility = assertO9EligibilityForVerifiedMint({ discordUserId, eosId, verifiedAt, discordMembershipVerified });
      if (!eligibility.ok) {
        // Commit restricted + links; do not elevate to verified.
        await client.query('COMMIT');
        return { ok: true, status: 'restricted', eligibility: eligibility.reason, economicIdentityId };
      }
      await client.query(
        `UPDATE ${s}.nexus_economic_identities SET status = 'verified', hold_reason = NULL, held_by = NULL, updated_at = NOW() WHERE economic_identity_id = $1`,
        [economicIdentityId]
      );
      await client.query('COMMIT');
      return { ok: true, duplicate: Boolean(discord?.verified_at && eos?.verified_at), status: 'verified', economicIdentityId };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  }


  // O9 revoke path: verified → restricted; links retained; no wipe; no money-flag dependency.
  async demoteVerifiedIdentityToRestricted(discordUserId) {
    if (!validDiscordId(discordUserId)) throw new Error('Invalid discord user id.');
    const s = this.runtimeSchema;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const link = await client.query(
        `SELECT economic_identity_id FROM ${s}.nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1 FOR UPDATE`,
        [discordUserId]
      );
      if (!link.rows[0]) {
        await client.query('COMMIT');
        return { ok: true, skipped: 'no-identity', status: null };
      }
      const economicIdentityId = link.rows[0].economic_identity_id;
      const identity = await client.query(
        `SELECT status FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
        [economicIdentityId]
      );
      const priorStatus = identity.rows[0]?.status || null;
      if (priorStatus !== 'verified') {
        await client.query('COMMIT');
        return { ok: true, skipped: 'not-verified', status: priorStatus, economicIdentityId };
      }
      await client.query(
        `UPDATE ${s}.nexus_economic_identities SET status = 'restricted', hold_reason = 'o9-demote', held_by = NULL, updated_at = NOW() WHERE economic_identity_id = $1`,
        [economicIdentityId]
      );
      await this.#checkpointAccrual(client, economicIdentityId);
      await client.query('COMMIT');
      return { ok: true, status: 'restricted', holdReason: 'o9-demote', priorStatus: 'verified', economicIdentityId };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }


  // Shadow Recruit empty primary wallet mint (LEDGER §5.3). No EOS; no verified elevation; no grants.
  async ensureShadowRecruitWallet(discordUserId, rankId = 'shadow-recruit', { env = process.env } = {}) {
    if (!isShadowRecruitEligibleRank(rankId)) {
      return { ok: true, skipped: 'rank-not-eligible', rankId: String(rankId || '') };
    }
    if (!validDiscordId(discordUserId)) throw new Error('Invalid discord user id.');
    const discord = String(discordUserId);
    const rank = String(rankId || 'shadow-recruit').trim().toLowerCase() || 'shadow-recruit';
    const deny = quarantineDenylist(env);
    const s = this.runtimeSchema;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE ${s}.nexus_economic_identity_links IN SHARE ROW EXCLUSIVE MODE`);
      const existing = await client.query(
        `SELECT economic_identity_id, verified_at, source FROM ${s}.nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1 FOR UPDATE`,
        [discord]
      );
      const economicIdentityId = existing.rows[0]?.economic_identity_id || deterministicEconomicIdentityId(discord);
      if (deny.has(economicIdentityId)) {
        await client.query(
          `INSERT INTO ${s}.nexus_economic_identities (economic_identity_id, status, hold_reason) VALUES ($1, 'restricted', 'quarantine') ON CONFLICT (economic_identity_id) DO UPDATE SET hold_reason = COALESCE(NULLIF(btrim(${s}.nexus_economic_identities.hold_reason), ''), 'quarantine'), updated_at = NOW()`,
          [economicIdentityId]
        );
        await this.#checkpointAccrual(client, economicIdentityId);
        await client.query('COMMIT');
        return { ok: false, rejected: 'quarantine-denylist', economicIdentityId, holdReason: 'quarantine' };
      }
      await client.query(
        `INSERT INTO ${s}.nexus_economic_identities (economic_identity_id, status) VALUES ($1, 'restricted') ON CONFLICT DO NOTHING`,
        [economicIdentityId]
      );
      const identity = await client.query(
        `SELECT status FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
        [economicIdentityId]
      );
      const status = identity.rows[0]?.status || null;
      if (status === 'disabled') {
        await client.query('ROLLBACK');
        return { ok: false, rejected: 'disabled', economicIdentityId, status };
      }
      // UPSERT discord link: verified_at NULL on insert; never overwrite existing verified_at; never insert EOS.
      await client.query(
        `INSERT INTO ${s}.nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source)
         VALUES ('discord', $1, $2, NULL, $3)
         ON CONFLICT (provider, external_id) DO UPDATE SET
           economic_identity_id = EXCLUDED.economic_identity_id,
           verified_at = nexus_economic_identity_links.verified_at,
           source = CASE
             WHEN nexus_economic_identity_links.verified_at IS NOT NULL THEN nexus_economic_identity_links.source
             ELSE EXCLUDED.source
           END`,
        [discord, economicIdentityId, SHADOW_RECRUIT_LINK_SOURCE]
      );
      // Leave status=verified if already; do not elevate restricted → verified here.
      const walletsCreated = [];
      const walletsExisting = [];
      for (const currency of PRIMARY_CURRENCIES) {
        const inserted = await client.query(
          `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance)
           SELECT $1, $2, 0 WHERE EXISTS (
             SELECT 1 FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 AND status IN ('verified', 'restricted')
           )
           ON CONFLICT (economic_identity_id, currency) DO NOTHING
           RETURNING currency`,
          [economicIdentityId, normalizeCurrency(currency)]
        );
        if (inserted.rowCount) walletsCreated.push(currency);
        else walletsExisting.push(currency);
      }
      await client.query(
        `INSERT INTO ${s}.nexus_economy_accrual_state (economic_identity_id, rank_id)
         VALUES ($1, $2)
         ON CONFLICT (economic_identity_id) DO UPDATE SET rank_id = EXCLUDED.rank_id, updated_at = NOW()`,
        [economicIdentityId, rank]
      );
      await client.query('COMMIT');
      console.log(`[Nexus Economy] shadow_recruit_wallet_ensured identity=${economicIdentityId} status=${status} discord=${discord} rank=${rank}`);
      return {
        ok: true,
        economicIdentityId,
        status,
        rankId: rank,
        walletsCreated,
        walletsExisting,
        source: SHADOW_RECRUIT_LINK_SOURCE
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async #lockIdentity(client, economicIdentityId) {
    const locked = await client.query(
      `SELECT economic_identity_id, status, hold_reason, held_by FROM ${this.runtimeSchema}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
      [economicIdentityId]
    );
    return locked.rows[0] || null;
  }

  async #insertHoldAudit(client, { economicIdentityId, action, holdReason, priorHoldReason, actor, checkpointAt }) {
    const inserted = await client.query(
      `INSERT INTO ${this.runtimeSchema}.nexus_economy_identity_hold_audit
        (economic_identity_id, action, hold_reason, prior_hold_reason, actor, checkpoint_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING audit_id`,
      [economicIdentityId, action, holdReason, priorHoldReason, actor, checkpointAt]
    );
    return inserted.rows[0]?.audit_id ?? null;
  }

  async #applyPlace(client, row, { marker, actor }) {
    const economicIdentityId = row.economic_identity_id;
    const prior = String(row.hold_reason || '').trim() || null;
    await client.query(
      `UPDATE ${this.runtimeSchema}.nexus_economic_identities SET hold_reason = $2, held_by = $3, updated_at = NOW() WHERE economic_identity_id = $1`,
      [economicIdentityId, marker, actor]
    );
    const checkpointAt = await this.#checkpointAccrual(client, economicIdentityId);
    const auditId = await this.#insertHoldAudit(client, {
      economicIdentityId,
      action: 'place',
      holdReason: marker,
      priorHoldReason: prior,
      actor,
      checkpointAt
    });
    console.log(`[Nexus Economy] identity_hold_applied identity=${economicIdentityId} reason=${marker} by=${actor} audit=${auditId}`);
    return { ok: true, economicIdentityId, holdReason: marker, heldBy: actor, priorHoldReason: prior, checkpointAt, auditId, status: row.status || null };
  }

  async #applyLift(client, row, { actor }) {
    const economicIdentityId = row.economic_identity_id;
    const prior = String(row.hold_reason || '').trim();
    const status = row.status || null;
    if (!prior) return { ok: true, skipped: 'not-marked', status, economicIdentityId };
    await client.query(
      `UPDATE ${this.runtimeSchema}.nexus_economic_identities SET hold_reason = NULL, held_by = NULL, updated_at = NOW() WHERE economic_identity_id = $1`,
      [economicIdentityId]
    );
    const checkpointAt = await this.#checkpointAccrual(client, economicIdentityId);
    const auditId = await this.#insertHoldAudit(client, {
      economicIdentityId,
      action: 'lift',
      holdReason: null,
      priorHoldReason: prior,
      actor,
      checkpointAt
    });
    console.log(`[Nexus Economy] identity_hold_lifted identity=${economicIdentityId} prior=${prior} status=${status} by=${actor} audit=${auditId}`);
    return { ok: true, lifted: true, status, priorReason: prior, economicIdentityId, checkpointAt, auditId, actor };
  }

  // One-time. A later staff lift is not marked again.
  // Coin ledger history is not a reason. The audit table is created before any row is marked.
  async backfillLegacyRestrictedHolds() {
    const s = this.runtimeSchema;
    const migrationId = 'legacy-review-restricted-holds';
    const predicates = legacyReviewPredicates(s);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`nexus-economy:${migrationId}`]);
      await client.query(migrationsTableSql(s));
      await client.query(holdAuditTableSql(s));
      await client.query(holdAuditIndexSql(s));
      const existing = await client.query(
        `SELECT id, row_count FROM ${s}.nexus_economy_schema_migrations WHERE id = $1`,
        [migrationId]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { ok: true, skipped: 'already-applied', marked: 0, previouslyMarked: Number(existing.rows[0].row_count) };
      }
      const updated = await client.query(
        `UPDATE ${s}.nexus_economic_identities AS i
         SET hold_reason = 'legacy-review', updated_at = NOW()
         WHERE ${predicates.unmarkedRestricted}
           AND (${predicates.verifiedLink} OR ${predicates.fundedLedger} OR ${predicates.fundedBalance})
         RETURNING i.economic_identity_id`
      );
      const marked = Number(updated.rowCount || 0);
      await client.query(
        `INSERT INTO ${s}.nexus_economy_schema_migrations (id, row_count) VALUES ($1, $2)`,
        [migrationId, marked]
      );
      await client.query('COMMIT');
      console.log(`[Nexus Economy] legacy_review_hold_backfill marked=${marked}`);
      return { ok: true, marked };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async #holdReasonColumnExists(client) {
    const found = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'nexus_economic_identities' AND column_name = 'hold_reason'
       LIMIT 1`,
      [this.schemaName]
    );
    return Boolean(found.rows[0]);
  }

  // SELECT only. ROLLBACK so the session cannot leave a write behind.
  async #readOnly(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const result = await fn(client);
      await client.query('ROLLBACK');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  // Read-only. A pre-migration table has no hold_reason column; every restricted row counts as unmarked.
  async previewLegacyRestrictedHolds() {
    return this.#readOnly(async (client) => {
      const holdReasonColumn = await this.#holdReasonColumnExists(client);
      const sql = NexusEconomyPostgresRuntimeRepository.legacyReviewPreviewSql({
        schema: this.schemaName,
        holdReasonColumn
      });
      const result = await client.query(sql);
      const row = result.rows[0] || {};
      return {
        ok: true,
        dryRun: true,
        readOnly: true,
        holdReasonColumn,
        wouldMark: Number(row.would_mark || 0),
        byReason: {
          verifiedEosOrMinecraftLink: Number(row.verified_eos_or_minecraft_link || 0),
          npOrCacheTokenLedger: Number(row.np_or_cache_token_ledger || 0),
          nonzeroNpOrCacheTokenBalance: Number(row.nonzero_np_or_cache_token_balance || 0),
          excludedCoinLedgerOnly: Number(row.excluded_coin_ledger_only || 0)
        },
        sql
      };
    });
  }

  async placeIdentityHold(economicIdentityId, { reason = 'staff', heldBy = null } = {}) {
    const identityId = cleanExternalId(economicIdentityId, 'Economic identity ID');
    const marker = cleanHoldReason(reason || 'staff');
    const actor = cleanHoldActor(heldBy);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.#lockIdentity(client, identityId);
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'identity-not-found', economicIdentityId: identityId };
      }
      const result = await this.#applyPlace(client, row, { marker, actor });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async liftIdentityHoldById(economicIdentityId, { actor = null } = {}) {
    const identityId = cleanExternalId(economicIdentityId, 'Economic identity ID');
    const who = cleanHoldActor(actor);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.#lockIdentity(client, identityId);
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'identity-not-found', economicIdentityId: identityId };
      }
      const result = await this.#applyLift(client, row, { actor: who });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async listIdentityHolds({ limit = 200 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    return this.#readOnly(async (client) => {
      const holdReasonColumn = await this.#holdReasonColumnExists(client);
      if (!holdReasonColumn) return { ok: true, readOnly: true, holdReasonColumn: false, holds: [] };
      const result = await client.query(
        `SELECT economic_identity_id, status, hold_reason, held_by, updated_at
         FROM ${this.runtimeSchema}.nexus_economic_identities
         WHERE hold_reason IS NOT NULL AND btrim(hold_reason) <> ''
         ORDER BY updated_at DESC NULLS LAST, economic_identity_id
         LIMIT $1`,
        [safeLimit]
      );
      return {
        ok: true,
        readOnly: true,
        holdReasonColumn: true,
        holds: (result.rows || []).map((row) => ({
          economicIdentityId: row.economic_identity_id,
          status: row.status,
          holdReason: row.hold_reason,
          heldBy: row.held_by,
          updatedAt: row.updated_at
        }))
      };
    });
  }

  async placeStaffHold(discordUserId, { reason = 'staff', heldBy = null } = {}) {
    if (!validDiscordId(discordUserId)) throw new Error('Invalid discord user id.');
    const marker = cleanHoldReason(reason || 'staff');
    const actor = cleanHoldActor(heldBy);
    const s = this.runtimeSchema;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const link = await client.query(
        `SELECT economic_identity_id FROM ${s}.nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1 FOR UPDATE`,
        [String(discordUserId)]
      );
      if (!link.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'wallet-not-found' };
      }
      const economicIdentityId = link.rows[0].economic_identity_id;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`coin-shop:${economicIdentityId}`]);
      const row = await this.#lockIdentity(client, economicIdentityId);
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'identity-not-found', economicIdentityId: link.rows[0].economic_identity_id };
      }
      const result = await this.#applyPlace(client, row, { marker, actor });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async liftIdentityHold(discordUserId, { actor = null } = {}) {
    if (!validDiscordId(discordUserId)) throw new Error('Invalid discord user id.');
    const who = cleanHoldActor(actor);
    const s = this.runtimeSchema;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const link = await client.query(
        `SELECT economic_identity_id FROM ${s}.nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1 FOR UPDATE`,
        [String(discordUserId)]
      );
      if (!link.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'wallet-not-found' };
      }
      const row = await this.#lockIdentity(client, link.rows[0].economic_identity_id);
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'identity-not-found', economicIdentityId: link.rows[0].economic_identity_id };
      }
      const result = await this.#applyLift(client, row, { actor: who });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async getOrder(orderId) {
    const result = await this.pool.query(
      `SELECT order_data FROM ${this.runtimeSchema}.nexus_economy_orders WHERE order_id = $1`,
      [String(orderId)]
    );
    return result.rows?.[0]?.order_data || null;
  }

  async listOrdersByStatus(statuses, limit = 100) {
    const safeStatuses = [...new Set((statuses || []).map((value) => String(value).trim()).filter(Boolean))];
    if (!safeStatuses.length) return [];
    const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
    const result = await this.pool.query(
      `SELECT order_data FROM ${this.runtimeSchema}.nexus_economy_orders ` +
      `WHERE order_data->>'status' = ANY($1::text[]) ORDER BY created_at ASC LIMIT $2`,
      [safeStatuses, safeLimit]
    );
    const { isMinecraftShopOrder } = require('../economy-worker/mc-points-service.cjs');
    return (result.rows || []).map((row) => row.order_data).filter((order) => order && !isMinecraftShopOrder(order));
  }

  async updateOrderDelivery({ orderId, status, deliveryReceipt = '', error = '' } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT order_data FROM ${this.runtimeSchema}.nexus_economy_orders WHERE order_id = $1 FOR UPDATE`,
        [String(orderId)]
      );
      const order = found.rows?.[0]?.order_data;
      const { isMinecraftShopOrder } = require('../economy-worker/mc-points-service.cjs');
      if (!order || order.type !== 'BUY' || isMinecraftShopOrder(order)) throw new Error('Buy order not found.');
      if (order.status === 'DELIVERED') {
        await client.query('COMMIT');
        return { ok: true, duplicate: true, order };
      }
      const allowedFrom = new Set(['PAID_QUEUED', 'PLAYER_OFFLINE', 'DELIVERY_IN_PROGRESS', 'SENT_UNCONFIRMED', 'DELIVERY_FAILED']);
      if (!allowedFrom.has(order.status)) throw new Error(`Buy order cannot transition from ${order.status}.`);
      order.status = String(status);
      if (deliveryReceipt) order.deliveryReceipt = deliveryReceipt;
      if (error) order.deliveryError = error;
      if (order.status === 'DELIVERED') order.deliveredAt = new Date().toISOString();
      order.updatedAt = new Date().toISOString();
      await client.query(
        `UPDATE ${this.runtimeSchema}.nexus_economy_orders SET order_data = $2::jsonb WHERE order_id = $1`,
        [String(orderId), JSON.stringify(order)]
      );
      await client.query('COMMIT');
      return { ok: true, duplicate: false, order };
    } catch (error_) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error_;
    } finally {
      client.release();
    }
  }

  async listUnprojectedOutbox(limit = 25) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const result = await this.pool.query(
      `SELECT record_id, order_id, record_data FROM ${this.runtimeSchema}.nexus_economy_purchase_outbox ` +
      `WHERE projected_at IS NULL ORDER BY created_at ASC LIMIT $1`,
      [safeLimit]
    );
    return (result.rows || []).map((row) => ({ recordId: row.record_id, orderId: row.order_id, record: row.record_data }));
  }

  async markOutboxProjected(recordId, actionId) {
    const result = await this.pool.query(
      `UPDATE ${this.runtimeSchema}.nexus_economy_purchase_outbox ` +
      `SET projected_action_id = COALESCE(projected_action_id, $2), projected_at = COALESCE(projected_at, NOW()), projection_error = NULL ` +
      `WHERE record_id = $1 RETURNING record_id, projected_action_id, projected_at`,
      [String(recordId), String(actionId)]
    );
    return result.rows?.[0] || null;
  }

  async markOutboxProjectionError(recordId, error) {
    await this.pool.query(
      `UPDATE ${this.runtimeSchema}.nexus_economy_purchase_outbox ` +
      `SET projection_attempts = projection_attempts + 1, projection_error = $2 WHERE record_id = $1`,
      [String(recordId), String(error?.message || error || 'projection failed').slice(0, 1000)]
    );
  }

  static legacyReviewPreviewSql({ schema = 'public', holdReasonColumn = true } = {}) {
    const s = sqlIdent(schema);
    const predicates = legacyReviewPredicates(s);
    const unmarked = holdReasonColumn ? predicates.unmarkedRestricted : `i.status = 'restricted'`;
    return `SELECT
  count(*) FILTER (WHERE ${predicates.verifiedLink} OR ${predicates.fundedLedger} OR ${predicates.fundedBalance}) AS would_mark,
  count(*) FILTER (WHERE ${predicates.verifiedLink}) AS verified_eos_or_minecraft_link,
  count(*) FILTER (WHERE ${predicates.fundedLedger}) AS np_or_cache_token_ledger,
  count(*) FILTER (WHERE ${predicates.fundedBalance}) AS nonzero_np_or_cache_token_balance,
  count(*) FILTER (WHERE ${predicates.coinLedger} AND NOT (${predicates.verifiedLink}) AND NOT (${predicates.fundedLedger}) AND NOT (${predicates.fundedBalance})) AS excluded_coin_ledger_only
FROM ${s}.nexus_economic_identities AS i
WHERE ${unmarked}`;
  }

  static runtimeSchemaSql({ schema = 'public' } = {}) {
    const s = sqlIdent(schema);
    return [
      NexusEconomyPostgresRepository.schemaSql({ schema }),
      `ALTER TABLE ${s}.nexus_economic_identities ADD COLUMN IF NOT EXISTS hold_reason TEXT;`,
      `ALTER TABLE ${s}.nexus_economic_identities ADD COLUMN IF NOT EXISTS held_by TEXT;`,
      holdAuditTableSql(s),
      holdAuditIndexSql(s),
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projected_action_id TEXT;`,
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projected_at TIMESTAMPTZ;`,
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projection_attempts INTEGER NOT NULL DEFAULT 0;`,
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projection_error TEXT;`,
      `CREATE INDEX IF NOT EXISTS nexus_economy_purchase_outbox_projection_idx ON ${s}.nexus_economy_purchase_outbox (projected_at, created_at);`
    ].join('\n');
  }
}

module.exports = { NexusEconomyPostgresRuntimeRepository, SHADOW_RECRUIT_LINK_SOURCE, quarantineDenylist };
