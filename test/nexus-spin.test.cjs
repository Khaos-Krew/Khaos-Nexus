'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config/nexus-spin.json');
const { totalWeight, rollReward, freezeSpin } = require('../bot/nexus-spin/spin-engine.cjs');
const { renderResourceCommand, creditPointsVerified, NexusSpinService } = require('../bot/nexus-spin/spin-service.cjs');

test('Nexus Spin reward table is exactly 10,000 tickets with a 0.25% Cache Token jackpot', () => {
  assert.equal(totalWeight(config.rewards), 10000);
  const jackpot = config.rewards.find((reward) => reward.type === 'cache_token');
  assert.ok(jackpot);
  assert.equal(jackpot.weight, 25);
  assert.equal(jackpot.weight / totalWeight(config.rewards), 0.0025);
});

test('daily free spin is configured for a 24-hour cooldown and point spins cost 100 by default', () => {
  assert.equal(config.cooldownSeconds, 86400);
  assert.equal(config.pointSpinCost, 100);
});

test('weighted roll is deterministic at table boundaries', () => {
  assert.equal(rollReward(config.rewards, () => 0).id, 'points_25');
  assert.equal(rollReward(config.rewards, () => 0.999999).id, 'cache_token');
});

test('spin identity and reward are frozen before payout or Discord reveal', () => {
  const spin = freezeSpin({
    discordId: '123',
    eosId: 'EOS-ABC',
    reward: config.rewards[1],
    now: () => Date.UTC(2026, 7, 31, 23, 45, 0),
  });
  assert.match(spin.spinId, /^NS-/);
  assert.equal(spin.reward.id, 'points_50');
  assert.equal(Object.isFrozen(spin), true);
  assert.equal(Object.isFrozen(spin.reward), true);
});

test('resource delivery command is configuration-driven and requires all safety placeholders', () => {
  const row = { spin_id: 'NS-1', eos_id: 'EOS-ABC', resource_key: 'metal_ingot', amount: 500 };
  const command = renderResourceCommand('VerifiedCommand player={eosId} resource={resourceKey} amount={amount} receipt={spinId}', row);
  assert.match(command, /EOS-ABC/);
  assert.match(command, /metal_ingot/);
  assert.match(command, /amount=500/);
  assert.match(command, /receipt=NS-1/);
  assert.throws(() => renderResourceCommand('Give {eosId}', row), /must include/);
});

test('point credit verifies the ArkShop balance after ChangePoints', async () => {
  let reads = 0;
  const server = { id: 'ark1', name: 'ARK 1' };
  const gateway = {
    async getBalance() {
      reads += 1;
      return { balance: reads === 1 ? 100 : 150, server };
    },
    async executeOnArk(command) {
      assert.equal(command, 'ChangePoints EOS-ABC 50');
      return { server, response: 'OK' };
    },
  };
  const result = await creditPointsVerified(gateway, 'EOS-ABC', 50);
  assert.equal(result.beforeBalance, 100);
  assert.equal(result.afterBalance, 150);
});

test('unlinked Discord accounts fail closed before a spin can be recorded or charged', async () => {
  let recorded = false;
  let charged = false;
  const service = new NexusSpinService({
    config: { ...config, enabled: true },
    store: {
      async resolveVerifiedLink() { return null; },
      async createSpinIfCooldownReady() { recorded = true; return { allowed: true }; },
    },
    pointsGateway: {
      async debitPoints() { charged = true; },
    },
    servers: [],
    rng: () => 0,
  });
  await assert.rejects(() => service.play({ discordId: '123', channelId: 'chan', mode: 'points' }), (error) => error.code === 'NEXUS_SPIN_NOT_LINKED');
  assert.equal(recorded, false);
  assert.equal(charged, false);
});

test('free-spin cooldown denial occurs before any payout side effect and does not spend points', async () => {
  let charged = false;
  const service = new NexusSpinService({
    config: { ...config, enabled: true },
    store: {
      async resolveVerifiedLink() { return { discordId: '123', eosId: 'EOS-ABC', verified: true }; },
      async createSpinIfCooldownReady() { return { allowed: false, retryAfterSeconds: 3600, nextAllowedAt: '2026-09-01T00:00:00Z' }; },
    },
    pointsGateway: {
      async debitPoints() { charged = true; },
    },
    servers: [],
    rng: () => 0,
  });
  await assert.rejects(() => service.play({ discordId: '123', channelId: 'chan' }), (error) => {
    assert.equal(error.code, 'NEXUS_SPIN_COOLDOWN');
    assert.equal(error.pointSpinCost, 100);
    return true;
  });
  assert.equal(charged, false);
});

test('point-funded spin charges verified Nexus Points without touching the free-spin cooldown', async () => {
  let cooldownTouched = false;
  let paidSpinRecorded = null;
  const service = new NexusSpinService({
    config: { ...config, enabled: true, pointSpinCost: 100 },
    store: {
      async resolveVerifiedLink() { return { discordId: '123', eosId: 'EOS-ABC', verified: true }; },
      async createSpinIfCooldownReady() { cooldownTouched = true; throw new Error('must not run'); },
      async createPaidSpin(spin, cost, payment) { paidSpinRecorded = { spin, cost, payment }; return { spin_id: spin.spinId }; },
    },
    pointsGateway: {
      async debitPoints({ eosId, cost }) {
        assert.equal(eosId, 'EOS-ABC');
        assert.equal(cost, 100);
        return { beforeBalance: 500, afterBalance: 400, serverId: 'ark1', serverName: 'ARK 1' };
      },
      async refundPoints() { throw new Error('refund must not run'); },
    },
    servers: [],
    rng: () => 0,
  });
  service.applyFreshReward = async () => ({ status: 'REWARDED', mode: 'points' });

  const result = await service.play({ discordId: '123', channelId: 'chan', mode: 'points' });
  assert.equal(cooldownTouched, false);
  assert.equal(result.spinMode, 'POINTS');
  assert.equal(result.spinCost, 100);
  assert.equal(result.payment.afterBalance, 400);
  assert.equal(paidSpinRecorded.cost, 100);
});

test('point-funded spin is refunded if its ledger record cannot be created', async () => {
  let refunded = false;
  const service = new NexusSpinService({
    config: { ...config, enabled: true, pointSpinCost: 100 },
    store: {
      async resolveVerifiedLink() { return { discordId: '123', eosId: 'EOS-ABC', verified: true }; },
      async createPaidSpin() { throw new Error('database unavailable'); },
    },
    pointsGateway: {
      async debitPoints() { return { beforeBalance: 500, afterBalance: 400, serverId: 'ark1', serverName: 'ARK 1' }; },
      async refundPoints({ eosId, cost }) {
        assert.equal(eosId, 'EOS-ABC');
        assert.equal(cost, 100);
        refunded = true;
        return { beforeBalance: 400, afterBalance: 500 };
      },
    },
    servers: [],
    rng: () => 0,
  });

  await assert.rejects(() => service.play({ discordId: '123', channelId: 'chan', mode: 'points' }), (error) => error.code === 'NEXUS_SPIN_PAYMENT_REFUNDED');
  assert.equal(refunded, true);
});
