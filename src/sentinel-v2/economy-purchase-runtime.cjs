'use strict';

const { createNexusEconomyPurchaseActionRequest, ACTION_SOURCE } = require('../sentinel/nexus-economy-purchase-action-request.cjs');
const { deliverShopOrderWithRewardsAscended } = require('../sentinel/cluster-shop-rewards-delivery.cjs');
const { findOnlineServer } = require('../sentinel/ark-dino-box-delivery-worker.cjs');
const { ArkRconClient } = require('../sentinel/ark-rcon.cjs');

const CAPABILITY = 'economy.purchase.execute';

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function economySchema(env = process.env) {
  const value = String(env.NEXUS_ECONOMY_SCHEMA || 'public').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('NEXUS_ECONOMY_SCHEMA is invalid.');
  return `"${value}"`;
}

class EconomyPurchaseRuntime {
  constructor({ database, actionStore, actionGate, logger, env = process.env, findServer = findOnlineServer, deliver = deliverShopOrderWithRewardsAscended, clientFactory = (server) => new ArkRconClient(server) } = {}) {
    if (!database?.enabled) throw new Error('Economy purchase runtime requires the Sentinel database.');
    if (!actionStore?.enabled) throw new Error('Economy purchase runtime requires durable ActionStore persistence.');
    this.database = database;
    this.actionStore = actionStore;
    this.actionGate = actionGate;
    this.logger = logger;
    this.env = env;
    this.findServer = findServer;
    this.deliver = deliver;
    this.clientFactory = clientFactory;
    this.schema = economySchema(env);
    this.projectorEnabled = enabled(env.NEXUS_ECONOMY_OUTBOX_ENABLED);
    this.executionEnabled = enabled(env.NEXUS_ECONOMY_PURCHASE_EXECUTION_ENABLED);
  }

  status() {
    const gate = this.actionGate?.authorize?.({ capability: CAPABILITY, destructive: false }) || { allowed: false, reason: 'action-gate-unavailable' };
    return Object.freeze({
      projectorEnabled: this.projectorEnabled,
      executionEnabled: this.executionEnabled,
      executionAuthorized: this.executionEnabled && gate.allowed === true,
      authorizationReason: gate.reason
    });
  }

  async project(limit = 25) {
    if (!this.projectorEnabled) return { ok: true, skipped: 'projector-disabled', projected: 0 };
    const rows = await this.database.query(
      `SELECT record_id, order_id, record_data FROM ${this.schema}.nexus_economy_purchase_outbox WHERE projected_at IS NULL ORDER BY created_at ASC LIMIT $1`,
      [Math.max(1, Math.min(100, Number(limit) || 25))]
    );
    let projected = 0;
    const failures = [];
    for (const row of rows.rows || []) {
      try {
        const prepared = createNexusEconomyPurchaseActionRequest().prepare(row.record_data);
        if (!prepared.ok || !prepared.requestReady) throw new Error(`Purchase outbox projection rejected: ${prepared.reason}`);
        const action = await this.actionStore.request(prepared.actionRequest);
        if (!action?.persisted) throw new Error('Purchase action was not durably persisted.');
        const expected = prepared.actionRequest;
        if (
          action.actionId !== expected.actionId ||
          action.capability !== expected.capability ||
          action.source !== expected.source ||
          action.idempotencyKey !== expected.idempotencyKey ||
          action.request?.recordDigest !== expected.request.recordDigest
        ) {
          throw new Error('ActionStore idempotency collision does not match the purchase outbox record.');
        }
        await this.database.query(
          `UPDATE ${this.schema}.nexus_economy_purchase_outbox SET projected_action_id = COALESCE(projected_action_id,$2), projected_at = COALESCE(projected_at,NOW()), projection_error = NULL WHERE record_id = $1`,
          [row.record_id, action.actionId]
        );
        projected += 1;
      } catch (error) {
        failures.push({ recordId: row.record_id, error: String(error?.message || error).slice(0, 300) });
        await this.database.query(
          `UPDATE ${this.schema}.nexus_economy_purchase_outbox SET projection_attempts = projection_attempts + 1, projection_error = $2 WHERE record_id = $1`,
          [row.record_id, String(error?.message || error).slice(0, 1000)]
        ).catch(() => {});
      }
    }
    return { ok: failures.length === 0, projected, failures };
  }

  async executeOne() {
    if (!this.executionEnabled) return { ok: true, skipped: 'execution-disabled' };
    const auth = this.actionGate?.authorize?.({ capability: CAPABILITY, destructive: false }) || { allowed: false, reason: 'action-gate-unavailable' };
    if (!auth.allowed) return { ok: true, skipped: `action-${auth.reason}` };

    const claimed = await this.#claim();
    if (!claimed) return { ok: true, skipped: 'none-requested' };
    const { action, attempt } = claimed;
    const orderId = String(action.request?.orderId || '').trim();
    try {
      const order = await this.#loadOrder(orderId);
      this.#validateActionOrder(action, order);

      const target = await this.findServer(order.eosId, this.env);
      if (!target) {
        await this.#updateOrder(orderId, 'PLAYER_OFFLINE', '', 'Linked player is not online on an eligible ARK map.');
        await this.#releaseForRetry(action.actionId, attempt, 'waiting-player');
        return { ok: true, skipped: 'player-offline', actionId: action.actionId, orderId };
      }

      await this.#updateOrder(orderId, 'DELIVERY_IN_PROGRESS');
      let delivery;
      try {
        delivery = await this.deliver({
          prefix: target.prefix,
          order,
          client: this.clientFactory(target.server, target.prefix),
          env: this.env
        });
      } catch (error) {
        if (error?.beforeRewardSend === true) {
          await this.#updateOrder(orderId, 'DELIVERY_FAILED', '', String(error?.message || error));
          await this.#releaseForRetry(action.actionId, attempt, 'safe-pre-send-failure');
          return { ok: false, retryable: true, actionId: action.actionId, orderId, error: String(error?.message || error) };
        }
        throw error;
      }

      const outcome = delivery?.outcome || {};
      if (outcome.state === 'DELIVERED') {
        const receipt = `${target.prefix}:${delivery.configured?.rewardId || 'reward'}:${String(delivery.result?.response || 'Player rewarded!').slice(0, 200)}`;
        await this.#updateOrder(orderId, 'DELIVERED', receipt, '');
        const completed = await this.actionStore.complete(action.actionId, { status: 'succeeded', attempt, result: { orderId, server: target.prefix, rewardId: delivery.configured?.rewardId || null, state: 'DELIVERED' } });
        return { ok: true, executed: true, action: completed, orderId, state: 'DELIVERED' };
      }

      if (outcome.state === 'SENT_UNCONFIRMED') {
        await this.#updateOrder(orderId, 'SENT_UNCONFIRMED', '', outcome.details || 'Reward send is ambiguous; manual verification required.');
        const completed = await this.actionStore.complete(action.actionId, { status: 'sent-unconfirmed', attempt, result: { orderId, server: target.prefix, rewardId: delivery.configured?.rewardId || null, state: 'SENT_UNCONFIRMED', retrySafe: false, details: outcome.details || '' } });
        return { ok: false, executed: true, action: completed, orderId, state: 'SENT_UNCONFIRMED', retrySafe: false };
      }

      await this.#updateOrder(orderId, 'DELIVERY_FAILED', '', outcome.details || 'RewardsAscended rejected the reward.');
      const completed = await this.actionStore.complete(action.actionId, { status: 'failed', attempt, result: { orderId, server: target.prefix, rewardId: delivery.configured?.rewardId || null, state: 'DELIVERY_FAILED', retrySafe: false, details: outcome.details || '' } });
      return { ok: false, executed: true, action: completed, orderId, state: 'DELIVERY_FAILED', retrySafe: false };
    } catch (error) {
      await this.actionStore.complete(action.actionId, { status: 'failed', attempt, error, result: { orderId, retrySafe: false } }).catch(() => {});
      this.logger?.error?.('sentinel.economy.purchase_execution_failed', { actionId: action.actionId, orderId, error: { message: String(error?.message || error) } });
      return { ok: false, executed: true, actionId: action.actionId, orderId, error };
    }
  }

  async #claim() {
    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const found = await client.query(`
          SELECT action_id, capability, source, actor, subject, destructive, status, idempotency_key, correlation_id, request
          FROM sentinel_actions
          WHERE capability = $1 AND source = $2 AND status = 'requested'
          ORDER BY requested_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `, [CAPABILITY, ACTION_SOURCE]);
        const row = found.rows?.[0];
        if (!row) { await client.query('COMMIT'); return null; }
        const attempts = await client.query('SELECT COALESCE(MAX(attempt),0) + 1 AS attempt FROM sentinel_action_attempts WHERE action_id = $1', [row.action_id]);
        const attempt = Number(attempts.rows?.[0]?.attempt || 1);
        await client.query(`
          INSERT INTO sentinel_action_attempts (action_id, attempt, status) VALUES ($1,$2,'running')
          ON CONFLICT (action_id, attempt) DO UPDATE SET status='running', started_at=NOW(), finished_at=NULL, error=NULL
        `, [row.action_id, attempt]);
        await client.query("UPDATE sentinel_actions SET status='running', completed_at=NULL WHERE action_id=$1", [row.action_id]);
        await client.query('COMMIT');
        return {
          attempt,
          action: {
            actionId: String(row.action_id), capability: row.capability, source: row.source,
            actor: row.actor || undefined, subject: row.subject || undefined,
            destructive: Boolean(row.destructive), status: 'running',
            idempotencyKey: row.idempotency_key || undefined,
            correlationId: row.correlation_id || undefined,
            request: row.request || {}
          }
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async #loadOrder(orderId) {
    if (!orderId) throw new Error('Purchase action is missing orderId.');
    const result = await this.database.query(`SELECT order_data FROM ${this.schema}.nexus_economy_orders WHERE order_id=$1`, [orderId]);
    const order = result.rows?.[0]?.order_data;
    if (!order) throw new Error(`Economy order not found: ${orderId}`);
    return order;
  }

  #validateActionOrder(action, order) {
    const request = action.request || {};
    const payload = request.payload || {};
    if (action.capability !== CAPABILITY || action.source !== ACTION_SOURCE) throw new Error('Purchase action source or capability is invalid.');
    if (request.type !== 'nexus.economy.purchase' || payload.fulfillment !== 'rewards-ascended-item') throw new Error('Purchase action contract is invalid.');
    if (String(request.orderId || '') !== String(order.orderId || '')) throw new Error('Purchase action order identity does not match the authoritative economy order.');
    if (order.type !== 'BUY') throw new Error('Purchase action does not reference a buy order.');
    if (!['PAID_QUEUED', 'PLAYER_OFFLINE', 'DELIVERY_FAILED'].includes(order.status)) throw new Error(`Purchase order is not executable from ${order.status}.`);
    if (String(order.discordUserId) !== String(payload.discordUserId) || String(order.quote?.itemId) !== String(payload.itemId) || Number(order.quote?.bundles) !== Number(payload.quantity) || Number(order.quote?.totalPrice) !== Number(payload.totalPrice)) {
      throw new Error('Purchase action does not match the authoritative economy order.');
    }
  }

  async #updateOrder(orderId, status, deliveryReceipt = '', error = '') {
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const found = await client.query(`SELECT order_data FROM ${this.schema}.nexus_economy_orders WHERE order_id=$1 FOR UPDATE`, [orderId]);
        const order = found.rows?.[0]?.order_data;
        if (!order) throw new Error(`Economy order not found: ${orderId}`);
        order.status = status;
        order.updatedAt = new Date().toISOString();
        if (deliveryReceipt) order.deliveryReceipt = String(deliveryReceipt).slice(0, 500);
        if (error) order.deliveryError = String(error).slice(0, 500);
        if (status === 'DELIVERED') order.deliveredAt = order.updatedAt;
        await client.query(`UPDATE ${this.schema}.nexus_economy_orders SET order_data=$2::jsonb WHERE order_id=$1`, [orderId, JSON.stringify(order)]);
        await client.query('COMMIT');
      } catch (error_) {
        await client.query('ROLLBACK');
        throw error_;
      }
    });
  }

  async #releaseForRetry(actionId, attempt, status) {
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('UPDATE sentinel_action_attempts SET status=$3, finished_at=NOW() WHERE action_id=$1 AND attempt=$2', [actionId, attempt, status]);
        await client.query("UPDATE sentinel_actions SET status='requested', completed_at=NULL WHERE action_id=$1", [actionId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
}

function registerEconomyPurchaseJobs(scheduler, runtime, { projectEveryMs = 5000, executeEveryMs = 10000 } = {}) {
  scheduler.register({
    name: 'economy.purchase.outbox-projector', owner: 'economy',
    trigger: { type: 'interval', everyMs: projectEveryMs, jitterMs: 500 }, timeoutMs: 30000, concurrency: 1, retry: { attempts: 1, baseDelayMs: 500, maxDelayMs: 2000 },
    run: () => runtime.project()
  });
  scheduler.register({
    name: 'economy.purchase.executor', owner: 'economy',
    trigger: { type: 'interval', everyMs: executeEveryMs, jitterMs: 1000 }, timeoutMs: 45000, concurrency: 1, retry: { attempts: 0 },
    run: () => runtime.executeOne()
  });
}

module.exports = { CAPABILITY, EconomyPurchaseRuntime, registerEconomyPurchaseJobs, economySchema, enabled };