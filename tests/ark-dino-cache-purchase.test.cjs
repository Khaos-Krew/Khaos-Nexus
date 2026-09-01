'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePointsResponse, buildDinoDepotCommand, assertDeliverableRoll, classifyDeliveryResponse, DinoCacheRedemptionProcessor } = require('../src/sentinel/ark-dino-cache-purchase.cjs');

class MemoryStore {
  constructor() { this.row = null; this.rollWrites = 0; this.claims = 0; this.reveals = 0; }
  async ingestPurchase(p) {
    if (!this.row) this.row = { id: 'tx-1', source_system: p.sourceSystem, source_server_id: p.sourceServerId, source_transaction_id: p.sourceTransactionId, player_eos_id: p.playerEosId, server_id: p.serverId, cache_type: p.cacheType, nexus_point_cost: p.pointCost, state: 'PURCHASED' };
    return { row: { ...this.row }, inserted: this.row.state === 'PURCHASED' };
  }
  async persistRoll(id, roll) { this.rollWrites += 1; Object.assign(this.row, { species: roll.species, variant: roll.variant, blueprint: roll.blueprint, rolled_level: roll.level, state: 'SEALED' }); return { ...this.row }; }
  async revealOwned(id, eosIds) {
    if (this.row.state !== 'SEALED') return { ...this.row };
    if (!eosIds.includes(this.row.player_eos_id)) throw new Error('different linked ARK account');
    this.reveals += 1; this.row.state = 'REVEALED'; return { ...this.row };
  }
  async claimDelivery() { if (!['REVEALED', 'RETRY'].includes(this.row.state)) return { ...this.row }; this.claims += 1; this.row.state = 'DELIVERING'; return { ...this.row }; }
  async markDelivered() { this.row.state = 'DELIVERED'; return { ...this.row }; }
  async markFailed(id, failure_class, error_message) { Object.assign(this.row, { state: 'FAILED', failure_class, error_message }); return { ...this.row }; }
}

const receipt = { sourceSystem: 'arkshop-mysql', sourceServerId: '1', sourceTransactionId: '42', sourceItemName: 'nexus_cache_coastal', playerEosId: '0002abc12345', serverId: 'gen1', mapName: 'Genesis Part 1', cacheType: 'coastal', pointCost: 800 };

test('Dino Depot command is targeted and restricted to cache levels', () => {
  const command = buildDinoDepotCommand({ eosId: receipt.playerEosId, blueprint: '/Game/PrimalEarth/Dinos/Para/Para_Character_BP.Para_Character_BP', level: 275 });
  assert.equal(command, 'ScriptCommand SpawnDinoInBall -p=0002abc12345 -t=/Game/PrimalEarth/Dinos/Para/Para_Character_BP.Para_Character_BP -l=275 -i=1 -a=1');
  assert.throws(() => buildDinoDepotCommand({ eosId: receipt.playerEosId, blueprint: '/Game/PrimalEarth/Dinos/Para/Para_Character_BP.Para_Character_BP', level: 199 }), /200 to 300/);
});

test('purchase fixes the reward once but sealed rewards cannot deliver before reveal', async () => {
  const store = new MemoryStore(); const commands = [];
  const processor = new DinoCacheRedemptionProcessor({ store, rngSecret: 'x'.repeat(32), rconForServer: () => ({ execute: async (command) => { commands.push(command); return 'ok'; } }) });
  const sealed = await processor.acceptVerifiedPurchase(receipt);
  assert.equal(sealed.state, 'SEALED'); assert.equal(sealed.newlySealed, true); assert.equal(store.rollWrites, 1); assert.equal(commands.length, 0);
  const duplicate = await processor.acceptVerifiedPurchase(receipt);
  assert.equal(duplicate.state, 'SEALED'); assert.equal(duplicate.newlySealed, false); assert.equal(store.rollWrites, 1);
  const blocked = await processor.deliver(duplicate);
  assert.equal(blocked.state, 'SEALED'); assert.equal(store.claims, 0); assert.equal(commands.length, 0);
  const revealed = await processor.reveal(duplicate.id, [receipt.playerEosId]);
  assert.equal(revealed.state, 'REVEALED'); assert.equal(store.reveals, 1);
  const delivered = await processor.deliver(revealed);
  assert.equal(delivered.state, 'DELIVERED'); assert.equal(store.claims, 1); assert.equal(commands.length, 1);
  assert.equal((await processor.deliver(delivered)).state, 'DELIVERED'); assert.equal(commands.length, 1);
});

test('reveal refuses a cache owned by another linked ARK account', async () => {
  const store = new MemoryStore();
  const processor = new DinoCacheRedemptionProcessor({ store, rngSecret: 'q'.repeat(32), rconForServer: () => ({ execute: async () => 'ok' }) });
  const sealed = await processor.acceptVerifiedPurchase(receipt);
  await assert.rejects(() => processor.reveal(sealed.id, ['another_eos_12345']), /different linked ARK account/);
  assert.equal(store.row.state, 'SEALED');
  assert.equal(store.claims, 0);
});

test('lost or empty RCON acknowledgements fail closed without automatic retry after reveal', async () => {
  for (const execute of [async () => { throw new Error('timeout'); }, async () => '']) {
    const store = new MemoryStore();
    const processor = new DinoCacheRedemptionProcessor({ store, rngSecret: 'y'.repeat(32), rconForServer: () => ({ execute }) });
    const sealed = await processor.acceptVerifiedPurchase(receipt);
    const revealed = await processor.reveal(sealed.id, [receipt.playerEosId]);
    const result = await processor.deliver(revealed);
    assert.equal(result.state, 'FAILED'); assert.equal(result.failure_class, 'AMBIGUOUS');
    assert.equal(store.claims, 1);
  }
});

test('price mismatch blocks a receipt before reveal or delivery', async () => {
  const store = new MemoryStore();
  const processor = new DinoCacheRedemptionProcessor({ store, rngSecret: 'z'.repeat(32), rconForServer: () => ({ execute: async () => 'ok' }) });
  const result = await processor.acceptVerifiedPurchase({ ...receipt, pointCost: 799 });
  assert.equal(result.state, 'FAILED'); assert.equal(result.failure_class, 'PRICE_MISMATCH'); assert.equal(store.claims, 0); assert.equal(store.reveals, 0);
});

test('delivery response classification and legacy points parser are bounded', () => {
  assert.equal(parsePointsResponse('Player points: 1234'), 1234);
  assert.equal(classifyDeliveryResponse('ok').outcome, 'DELIVERED');
  assert.equal(classifyDeliveryResponse('').outcome, 'AMBIGUOUS');
  assert.equal(classifyDeliveryResponse('Unknown command').outcome, 'FAILED');
  assert.throws(() => assertDeliverableRoll({ variant: 'normal', variantFallback: false, shiny: true }), /not deliverable/);
});
