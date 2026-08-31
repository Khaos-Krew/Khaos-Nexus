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

test('unlinked Discord accounts fail closed before a spin can be recorded', async () => {
  let recorded = false;
  const service = new NexusSpinService({
    config: { ...config, enabled: true },
    store: {
      async resolveVerifiedLink() { return null; },
      async createSpinIfCooldownReady() { recorded = true; return { allowed: true }; },
    },
    pointsGateway: {},
    servers: [],
    rng: () => 0,
  });
  await assert.rejects(() => service.play({ discordId: '123', channelId: 'chan' }), (error) => error.code === 'NEXUS_SPIN_NOT_LINKED');
  assert.equal(recorded, false);
});

test('cooldown denial occurs before any payout side effect', async () => {
  let changedPoints = false;
  const service = new NexusSpinService({
    config: { ...config, enabled: true },
    store: {
      async resolveVerifiedLink() { return { discordId: '123', eosId: 'EOS-ABC', verified: true }; },
      async createSpinIfCooldownReady() { return { allowed: false, retryAfterSeconds: 3600, nextAllowedAt: '2026-09-01T00:00:00Z' }; },
    },
    pointsGateway: {
      async getBalance() { changedPoints = true; throw new Error('must not run'); },
    },
    servers: [],
    rng: () => 0,
  });
  await assert.rejects(() => service.play({ discordId: '123', channelId: 'chan' }), (error) => error.code === 'NEXUS_SPIN_COOLDOWN');
  assert.equal(changedPoints, false);
});
