'use strict';

const { NexusEconomyPostgresRepository, sqlIdent } = require('./nexus-economy-postgres-repository.cjs');
const { deterministicEconomicIdentityId } = require('./nexus-economy-json-postgres-migration.cjs');
const { validDiscordId, validEosId } = require('./ark-identity-store.cjs');

class NexusEconomyPostgresRuntimeRepository extends NexusEconomyPostgresRepository {
  constructor(options = {}) {
    super(options);
    this.runtimeSchema = sqlIdent(options.schema || 'public');
  }

  // Called only after the runtime verifies the Sentinel proof. No balance changes.
  async linkVerifiedIdentity({ discordUserId, eosId, verifiedAt } = {}) {
    if (!validDiscordId(discordUserId) || !validEosId(eosId) || !Number.isFinite(Date.parse(verifiedAt))) throw new Error('Invalid verified identity.');
    const s = this.runtimeSchema;
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
      await client.query(`INSERT INTO ${s}.nexus_economic_identities (economic_identity_id, status) VALUES ($1, 'restricted') ON CONFLICT DO NOTHING`, [economicIdentityId]);
      const identity = await client.query(`SELECT status FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`, [economicIdentityId]);
      if (identity.rows[0]?.status === 'disabled') throw new Error('Economic identity is disabled.');
      for (const [provider, externalId] of [['discord', discordUserId], ['eos', eosId]]) {
        await client.query(
          `INSERT INTO ${s}.nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source) VALUES ($1,$2,$3,$4,'sentinel-ownership-proof') ON CONFLICT (provider, external_id) DO UPDATE SET verified_at = COALESCE(nexus_economic_identity_links.verified_at, EXCLUDED.verified_at)`,
          [provider, externalId, economicIdentityId, verifiedAt]
        );
      }
      await client.query(`UPDATE ${s}.nexus_economic_identities SET status = 'verified', updated_at = NOW() WHERE economic_identity_id = $1`, [economicIdentityId]);
      await client.query('COMMIT');
      return { ok: true, duplicate: Boolean(discord?.verified_at && eos?.verified_at), economicIdentityId };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
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
    return (result.rows || []).map((row) => row.order_data).filter(Boolean);
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
      if (!order || order.type !== 'BUY') throw new Error('Buy order not found.');
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

  static runtimeSchemaSql({ schema = 'public' } = {}) {
    const s = sqlIdent(schema);
    return [
      NexusEconomyPostgresRepository.schemaSql({ schema }),
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projected_action_id TEXT;`,
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projected_at TIMESTAMPTZ;`,
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projection_attempts INTEGER NOT NULL DEFAULT 0;`,
      `ALTER TABLE ${s}.nexus_economy_purchase_outbox ADD COLUMN IF NOT EXISTS projection_error TEXT;`,
      `CREATE INDEX IF NOT EXISTS nexus_economy_purchase_outbox_projection_idx ON ${s}.nexus_economy_purchase_outbox (projected_at, created_at);`
    ].join('\n');
  }
}

module.exports = { NexusEconomyPostgresRuntimeRepository };
