'use strict';

const { rankById } = require('../shared/ranks.cjs');
const { economyPerkForRank, OFFLINE_PASSIVE_CAP_HOURS } = require('../shared/nexus-economy-rank-perks.cjs');
const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');

const ONLINE_INTERVAL_MS = 5 * 60_000;
const MAX_ACCOUNTING_GAP_MS = ONLINE_INTERVAL_MS * 2;
const PRESENCE_TTL_MS = 3 * 60_000;

function cleanExternalId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function cleanServer(value) {
  return String(value || 'ark').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'ark';
}

function cleanRank(value) {
  const id = String(value || '').trim().toLowerCase();
  return rankById(id)?.id || 'shadow-recruit';
}

function millis(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

class PostgresEconomyAccrual {
  constructor({ pool, schema = 'public', now = Date.now } = {}) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('Postgres pool is required.');
    this.pool = pool;
    this.schema = sqlIdent(schema);
    this.now = typeof now === 'function' ? now : Date.now;
  }

  async ensureSchema() {
    const s = this.schema;
    await this.pool.query([
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_accrual_state (`,
      `  economic_identity_id TEXT PRIMARY KEY REFERENCES ${s}.nexus_economic_identities(economic_identity_id) ON DELETE CASCADE,`,
      `  rank_id TEXT NOT NULL DEFAULT 'shadow-recruit',`,
      `  online BOOLEAN NOT NULL DEFAULT FALSE,`,
      `  online_since TIMESTAMPTZ,`,
      `  online_uncredited_ms BIGINT NOT NULL DEFAULT 0 CHECK (online_uncredited_ms >= 0),`,
      `  online_credit_cursor BIGINT NOT NULL DEFAULT 0 CHECK (online_credit_cursor >= 0),`,
      `  last_accounting_at TIMESTAMPTZ,`,
      `  last_presence_at TIMESTAMPTZ,`,
      `  offline_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),`,
      `  last_passive_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),`,
      `  passive_credit_cursor BIGINT NOT NULL DEFAULT 0 CHECK (passive_credit_cursor >= 0),`,
      `  presence_by_server JSONB NOT NULL DEFAULT '{}'::jsonb,`,
      `  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      `);`,
      `CREATE INDEX IF NOT EXISTS nexus_economy_accrual_state_online_idx ON ${s}.nexus_economy_accrual_state (online, updated_at);`
    ].join('\n'));
  }

  async syncRank(discordUserId, rankId) {
    const discord = cleanExternalId(discordUserId, 'Discord user ID');
    const rank = cleanRank(rankId);
    const s = this.schema;
    // Allow verified OR restricted (Shadow Recruit empty wallets with verified_at null).
    const result = await this.pool.query(
      `INSERT INTO ${s}.nexus_economy_accrual_state (economic_identity_id, rank_id) ` +
      `SELECT i.economic_identity_id, $2 FROM ${s}.nexus_economic_identity_links d ` +
      `JOIN ${s}.nexus_economic_identities i ON i.economic_identity_id = d.economic_identity_id ` +
      `WHERE d.provider = 'discord' AND d.external_id = $1 ` +
      `AND i.status IN ('verified', 'restricted') ` +
      `ON CONFLICT (economic_identity_id) DO UPDATE SET rank_id = EXCLUDED.rank_id, updated_at = NOW() ` +
      `RETURNING economic_identity_id, rank_id`,
      [discord, rank]
    );
    return result.rows?.[0] || null;
  }

  async #resolveByEos(client, eosId) {
    const eos = cleanExternalId(eosId, 'EOS ID');
    const result = await client.query(
      `SELECT i.economic_identity_id, d.external_id AS discord_user_id ` +
      `FROM ${this.schema}.nexus_economic_identity_links e ` +
      `JOIN ${this.schema}.nexus_economic_identities i ON i.economic_identity_id = e.economic_identity_id ` +
      `JOIN ${this.schema}.nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id ` +
      `WHERE e.provider = 'eos' AND e.external_id = $1 AND e.verified_at IS NOT NULL ` +
      `AND d.provider = 'discord' AND d.verified_at IS NOT NULL AND i.status = 'verified' LIMIT 1`,
      [eos]
    );
    return result.rows?.[0] || null;
  }

  async #resolveByDiscord(client, discordUserId) {
    const discord = cleanExternalId(discordUserId, 'Discord user ID');
    const result = await client.query(
      `SELECT i.economic_identity_id, d.external_id AS discord_user_id ` +
      `FROM ${this.schema}.nexus_economic_identity_links d ` +
      `JOIN ${this.schema}.nexus_economic_identities i ON i.economic_identity_id = d.economic_identity_id ` +
      `WHERE d.provider = 'discord' AND d.external_id = $1 AND d.verified_at IS NOT NULL ` +
      `AND i.status = 'verified' LIMIT 1`,
      [discord]
    );
    return result.rows?.[0] || null;
  }

  // Active/playtime credits only reach here via recordPresence → #resolveByEos (EOS verified_at required).
  // accrueOffline → #resolveByDiscord (verified) then #accruePassive (EOS hard-gate). No Discord-only credit.
  async #lockStateAndWallet(client, economicIdentityId, rankId = null) {
    const s = this.schema;
    const rank = cleanRank(rankId);
    await client.query(
      `INSERT INTO ${s}.nexus_economy_accrual_state (economic_identity_id, rank_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [economicIdentityId, rank]
    );
    if (rankId != null) {
      await client.query(`UPDATE ${s}.nexus_economy_accrual_state SET rank_id = $2, updated_at = NOW() WHERE economic_identity_id = $1`, [economicIdentityId, rank]);
    }
    const stateResult = await client.query(`SELECT * FROM ${s}.nexus_economy_accrual_state WHERE economic_identity_id = $1 FOR UPDATE`, [economicIdentityId]);
    await client.query(
      `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance) VALUES ($1,'NEXUS_POINTS',0) ON CONFLICT DO NOTHING`,
      [economicIdentityId]
    );
    const walletResult = await client.query(
      `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
      [economicIdentityId]
    );
    if (!stateResult.rows?.[0] || !walletResult.rows?.[0]) throw new Error('Verified economic identity is required.');
    return { state: stateResult.rows[0], balance: Number(walletResult.rows[0].balance) };
  }

  async #appendCredit(client, { economicIdentityId, balance, amount, type, source, key, metadata, at }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return balance;
    const next = balance + amount;
    if (!Number.isSafeInteger(next)) throw new Error('Wallet balance exceeds the supported range.');
    const inserted = await client.query(
      `INSERT INTO ${this.schema}.nexus_economy_ledger ` +
      `(economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at) ` +
      `VALUES ($1,'NEXUS_POINTS',$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [economicIdentityId, amount, next, type, source, key, JSON.stringify(metadata || {}), at]
    );
    if (!inserted.rowCount) return balance;
    await client.query(
      `UPDATE ${this.schema}.nexus_economy_wallets SET balance = $2, updated_at = NOW() WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
      [economicIdentityId, next]
    );
    return next;
  }

  async #hasVerifiedEosLink(client, economicIdentityId) {
    const result = await client.query(
      `SELECT 1 FROM ${this.schema}.nexus_economic_identity_links ` +
      `WHERE economic_identity_id = $1 AND provider = 'eos' AND external_id IS NOT NULL AND verified_at IS NOT NULL LIMIT 1`,
      [economicIdentityId]
    );
    return Boolean(result.rows?.[0]);
  }

  async #accruePassive(client, state, economicIdentityId, balance, nowMs) {
    if (state.online) return { balance, credited: 0 };
    // OWNER lock: passive NP hard-requires linked ARK EOS (verified_at NOT NULL).
    // No credit and no cursor advance that implies credit when EOS missing.
    const eosLinked = await this.#hasVerifiedEosLink(client, economicIdentityId);
    if (!eosLinked) {
      console.warn(`[Nexus Economy] passive_blocked_no_eos identity=${economicIdentityId}`);
      return { balance, credited: 0, blocked: 'passive_blocked_no_eos' };
    }
    const perk = economyPerkForRank(state.rank_id);
    const rate = Number(perk.offlinePointsPerHour || 0);
    if (rate <= 0) return { balance, credited: 0 };
    const start = millis(state.last_passive_at) ?? millis(state.offline_since) ?? nowMs;
    const cappedMs = Math.min(Math.max(0, nowMs - start), OFFLINE_PASSIVE_CAP_HOURS * 3_600_000);
    const hours = Math.floor(cappedMs / 3_600_000);
    if (hours <= 0) return { balance, credited: 0 };
    const amount = hours * rate;
    const cursor = Number(state.passive_credit_cursor || 0) + 1;
    const endMs = start + hours * 3_600_000;
    const key = `passive:${economicIdentityId}:${cursor}`;
    const nextBalance = await this.#appendCredit(client, {
      economicIdentityId,
      balance,
      amount,
      type: 'passive-income',
      source: 'paid-rank',
      key,
      metadata: { rankId: state.rank_id, hours, ratePerHour: rate },
      at: new Date(nowMs).toISOString()
    });
    state.passive_credit_cursor = cursor;
    state.last_passive_at = new Date(endMs).toISOString();
    if (nextBalance !== balance) {
      console.log(`[Nexus Economy] passive_credited identity=${economicIdentityId} amount=${amount}`);
    }
    return { balance: nextBalance, credited: nextBalance === balance ? 0 : amount };
  }

  async recordPresence({ eosId, online, rankId, server = 'ark' } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await this.#resolveByEos(client, eosId);
      if (!identity) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'unlinked-player' };
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${identity.economic_identity_id}:NEXUS_POINTS`]);
      const locked = await this.#lockStateAndWallet(client, identity.economic_identity_id, rankId);
      const state = locked.state;
      let balance = locked.balance;
      const nowMs = this.now();
      const nowIso = new Date(nowMs).toISOString();
      const serverKey = cleanServer(server);
      const lastPresenceMs = millis(state.last_presence_at);
      const staleOnline = state.online === true && lastPresenceMs != null && nowMs - lastPresenceMs > PRESENCE_TTL_MS;
      if (staleOnline) {
        const inferredOfflineMs = lastPresenceMs + PRESENCE_TTL_MS;
        state.online = false;
        state.online_since = null;
        state.offline_since = new Date(inferredOfflineMs).toISOString();
        state.last_passive_at = state.offline_since;
      }
      const wasOnline = state.online === true;
      let uncredited = Math.max(0, Number(state.online_uncredited_ms || 0));

      if (wasOnline) {
        const previous = millis(state.last_accounting_at) ?? nowMs;
        uncredited += Math.max(0, Math.min(nowMs - previous, MAX_ACCOUNTING_GAP_MS));
      }
      state.last_accounting_at = nowIso;

      while (uncredited >= ONLINE_INTERVAL_MS) {
        const perk = economyPerkForRank(state.rank_id);
        const amount = Number(perk.onlinePointsPerFiveMinutes || 0);
        const cursor = Number(state.online_credit_cursor || 0) + 1;
        if (amount > 0) {
          balance = await this.#appendCredit(client, {
            economicIdentityId: identity.economic_identity_id,
            balance,
            amount,
            type: 'playtime',
            source: serverKey,
            key: `playtime:${identity.economic_identity_id}:${cursor}`,
            metadata: { rankId: state.rank_id, intervalMinutes: ONLINE_INTERVAL_MS / 60_000 },
            at: nowIso
          });
        }
        state.online_credit_cursor = cursor;
        uncredited -= ONLINE_INTERVAL_MS;
      }

      const presence = state.presence_by_server && typeof state.presence_by_server === 'object' ? state.presence_by_server : {};
      presence[serverKey] = { online: Boolean(online), eosId: String(eosId), at: nowIso };
      const isOnline = Object.values(presence).some((entry) => entry?.online === true && (millis(entry.at) ?? 0) >= nowMs - PRESENCE_TTL_MS);
      state.presence_by_server = presence;
      state.online = isOnline;
      state.last_presence_at = nowIso;

      if (!wasOnline && isOnline) {
        const passiveState = { ...state, online: false };
        const passive = await this.#accruePassive(client, passiveState, identity.economic_identity_id, balance, nowMs);
        balance = passive.balance;
        state.last_passive_at = passiveState.last_passive_at;
        state.passive_credit_cursor = passiveState.passive_credit_cursor;
        state.online_since = nowIso;
        state.offline_since = null;
        state.last_accounting_at = nowIso;
      } else if (wasOnline && !isOnline) {
        state.offline_since = nowIso;
        state.last_passive_at = nowIso;
        state.online_since = null;
        state.last_accounting_at = nowIso;
      }

      state.online_uncredited_ms = Math.max(0, Math.floor(uncredited));
      await client.query(
        `UPDATE ${this.schema}.nexus_economy_accrual_state SET ` +
        `rank_id=$2, online=$3, online_since=$4, online_uncredited_ms=$5, online_credit_cursor=$6, ` +
        `last_accounting_at=$7, last_presence_at=$8, offline_since=$9, last_passive_at=$10, ` +
        `passive_credit_cursor=$11, presence_by_server=$12::jsonb, updated_at=NOW() WHERE economic_identity_id=$1`,
        [identity.economic_identity_id, state.rank_id, state.online, state.online_since, state.online_uncredited_ms,
          state.online_credit_cursor, state.last_accounting_at, state.last_presence_at, state.offline_since,
          state.last_passive_at, state.passive_credit_cursor, JSON.stringify(state.presence_by_server)]
      );
      await client.query('COMMIT');
      return { ok: true, online: state.online, server: serverKey, balance, rankId: state.rank_id };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async accrueOffline(discordUserId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await this.#resolveByDiscord(client, discordUserId);
      if (!identity) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'wallet-not-found' };
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${identity.economic_identity_id}:NEXUS_POINTS`]);
      const locked = await this.#lockStateAndWallet(client, identity.economic_identity_id);
      const state = locked.state;
      const nowMs = this.now();
      const lastPresenceMs = millis(state.last_presence_at);
      if (state.online === true && lastPresenceMs != null && nowMs - lastPresenceMs > PRESENCE_TTL_MS) {
        const inferredOfflineMs = lastPresenceMs + PRESENCE_TTL_MS;
        state.online = false;
        state.online_since = null;
        state.offline_since = new Date(inferredOfflineMs).toISOString();
        state.last_passive_at = state.offline_since;
      }
      const passive = await this.#accruePassive(client, state, identity.economic_identity_id, locked.balance, nowMs);
      await client.query(
        `UPDATE ${this.schema}.nexus_economy_accrual_state SET online=$2, online_since=$3, offline_since=$4, last_passive_at=$5, passive_credit_cursor=$6, updated_at=NOW() WHERE economic_identity_id=$1`,
        [identity.economic_identity_id, state.online, state.online_since, state.offline_since, state.last_passive_at, state.passive_credit_cursor]
      );
      await client.query('COMMIT');
      return { ok: true, credited: passive.credited, balance: passive.balance, rankId: state.rank_id, online: state.online === true };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { ONLINE_INTERVAL_MS, PRESENCE_TTL_MS, PostgresEconomyAccrual };
