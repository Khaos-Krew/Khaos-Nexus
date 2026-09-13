'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createNexusEconomyPurchaseOutboxRecord } = require('../src/sentinel/nexus-economy-purchase-outbox-record.cjs');
const { EconomyPurchaseRuntime } = require('../src/sentinel-v2/economy-purchase-runtime.cjs');

function outboxRecord(orderId = 'shop_test') {
  const planDigest = createHash('sha256').update(orderId).digest('hex');
  return createNexusEconomyPurchaseOutboxRecord().prepare({
    ok: true, actionReady: true, queueWritePermitted: false, executionPermitted: false,
    schemaVersion: 2, actionId: `action_${planDigest.slice(0, 24)}`,
    type: 'nexus.economy.purchase', capability: 'economy.purchase.execute',
    subject: 'discord-user:123456789', correlationId: 'req_test_12345678', requestId: 'req_test_12345678',
    idempotencyKey: orderId, orderId, planId: 'plan_test_12345678',
    payload: { planId: 'plan_test_12345678', planDigest, discordUserId: '123456789', itemId: 'metal', quantity: 1,
      currency: 'Nexus Points', totalPrice: 40, projectedBalance: 60, fulfillment: 'rewards-ascended-item' }
  });
}

function executorDatabase() {
  const record = outboxRecord();
  const state = {
    actionStatus: 'requested', attemptStatus: null, paidOwnership: true,
    action: {
      action_id: record.actionId, capability: 'economy.purchase.execute', source: 'sentinel-v2.economy.purchase',
      actor: 'discord-user:123456789', subject: 'discord-user:123456789', destructive: false,
      status: 'requested', idempotency_key: record.orderId, correlation_id: record.requestId,
      request: { type: 'nexus.economy.purchase', orderId: record.orderId, payload: record.payload }
    },
    order: {
      orderId: record.orderId, type: 'BUY', status: 'PAID_QUEUED', discordUserId: '123456789', eosId: 'EOS_verified',
      quote: { itemId: 'metal', bundles: 1, totalPrice: 40, totalQuantity: 100, blueprint: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Metal.PrimalItemResource_Metal' }
    }
  };

  const query = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.startsWith('SELECT o.order_id')) return { rows: state.paidOwnership ? [{ order_id: state.order.orderId }] : [] };
    if (text.includes('FROM sentinel_actions') && text.includes("status = 'requested'")) return { rows: state.actionStatus === 'requested' ? [state.action] : [] };
    if (text.includes('COALESCE(MAX(attempt),0)')) return { rows: [{ attempt: 1 }] };
    if (text.startsWith('INSERT INTO sentinel_action_attempts')) { state.attemptStatus = 'running'; return { rows: [] }; }
    if (text.includes("UPDATE sentinel_actions SET status='running'")) { state.actionStatus = 'running'; return { rows: [] }; }
    if (text.startsWith('SELECT order_data FROM') && text.includes('nexus_economy_orders')) return { rows: [{ order_data: structuredClone(state.order) }] };
    if (text.startsWith('UPDATE') && text.includes('nexus_economy_orders SET order_data=')) { state.order = JSON.parse(params[1]); return { rows: [] }; }
    if (text.startsWith('UPDATE sentinel_action_attempts SET status=')) { state.attemptStatus = params[2]; return { rows: [] }; }
    if (text.includes("UPDATE sentinel_actions SET status='requested'")) { state.actionStatus = 'requested'; return { rows: [] }; }
    throw new Error(`Unexpected SQL in test: ${text}`);
  };

  return {
    enabled: true,
    state,
    query,
    async withClient(callback) { return callback({ query }); }
  };
}

function runtimeFixture({ findServer, deliver } = {}) {
  const database = executorDatabase();
  const completed = [];
  const actionStore = {
    enabled: true,
    async request(input) { return { ...input, persisted: true }; },
    async complete(actionId, result) { completed.push({ actionId, ...result }); database.state.actionStatus = result.status; return { actionId, status: result.status, persisted: true }; }
  };
  const actionGate = { authorize: () => ({ allowed: true, reason: 'allowed' }) };
  const runtime = new EconomyPurchaseRuntime({
    database, actionStore, actionGate,
    env: { NEXUS_ECONOMY_OUTBOX_ENABLED: 'true', NEXUS_ECONOMY_PURCHASE_EXECUTION_ENABLED: 'true' },
    findServer: findServer || (async () => ({ prefix: 'ARK_GEN1', server: {} })),
    deliver: deliver || (async () => ({ configured: { rewardId: 'NexusShop_test' }, result: { response: 'Player rewarded!' }, outcome: { state: 'DELIVERED', details: 'Player rewarded!' } })),
    clientFactory: () => ({})
  });
  return { runtime, database, completed };
}

test('projector persists one ActionStore request then marks the outbox row projected', async () => {
  const record = outboxRecord('shop_project');
  const updates = [];
  const database = {
    enabled: true,
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('SELECT record_id')) return { rows: [{ record_id: record.recordId, order_id: record.orderId, record_data: record }] };
      updates.push({ text, params }); return { rows: [] };
    }
  };
  const requested = [];
  const actionStore = { enabled: true, async request(input) { requested.push(input); return { ...input, persisted: true }; } };
  const runtime = new EconomyPurchaseRuntime({ database, actionStore, actionGate: { authorize: () => ({ allowed: false, reason: 'disabled' }) }, env: { NEXUS_ECONOMY_OUTBOX_ENABLED: 'true' } });
  const result = await runtime.project();
  assert.equal(result.ok, true);
  assert.equal(result.projected, 1);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].idempotencyKey, record.orderId);
  assert.match(updates[0].text, /projected_action_id/);
});

test('offline player releases the claimed action for a safe retry without sending', async () => {
  const { runtime, database, completed } = runtimeFixture({ findServer: async () => null, deliver: async () => { throw new Error('must not send'); } });
  const result = await runtime.executeOne();
  assert.equal(result.skipped, 'player-offline');
  assert.equal(database.state.order.status, 'PLAYER_OFFLINE');
  assert.equal(database.state.actionStatus, 'requested');
  assert.equal(completed.length, 0);
});

test('ambiguous reward send is held for manual review and is never auto-requeued', async () => {
  const { runtime, database, completed } = runtimeFixture({ deliver: async () => ({
    configured: { rewardId: 'NexusShop_test' }, result: null,
    outcome: { state: 'SENT_UNCONFIRMED', failureClass: 'REWARDS_ASCENDED_RCON_AMBIGUOUS', details: 'transport ambiguous' }
  }) });
  const result = await runtime.executeOne();
  assert.equal(result.state, 'SENT_UNCONFIRMED');
  assert.equal(result.retrySafe, false);
  assert.equal(database.state.order.status, 'SENT_UNCONFIRMED');
  assert.equal(completed[0].status, 'sent-unconfirmed');
  assert.equal(completed[0].result.retrySafe, false);
});

test('acknowledged reward completes both durable action and economy order', async () => {
  const { runtime, database, completed } = runtimeFixture();
  const result = await runtime.executeOne();
  assert.equal(result.ok, true);
  assert.equal(result.state, 'DELIVERED');
  assert.equal(database.state.order.status, 'DELIVERED');
  assert.equal(completed[0].status, 'succeeded');
});

test('revoked ownership or missing debit prevents reward delivery', async () => {
  let sent = 0;
  const { runtime, database } = runtimeFixture({ deliver: async () => { sent += 1; } });
  database.state.paidOwnership = false;
  const result = await runtime.executeOne();
  assert.equal(result.ok, false);
  assert.equal(sent, 0);
  assert.equal(database.state.order.status, 'PAID_QUEUED');
});

test('a delivered action cannot be delivered twice', async () => {
  const { runtime } = runtimeFixture();
  assert.equal((await runtime.executeOne()).state, 'DELIVERED');
  assert.equal((await runtime.executeOne()).skipped, 'none-requested');
});
