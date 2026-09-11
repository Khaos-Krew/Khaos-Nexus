'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  classifyAdapterCommand,
  buildAdapterCommandContract
} = require('../src/sentinel/nexus-protocol-adapter-command-contract.cjs');

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function fixture(command, plugin, idempotencyKey = null) {
  const action = { actionId: 'action-1', index: 0, plugin, command, idempotencyKey };
  const envelope = { actions: [action] };
  const permit = {
    protocolId: 'dark-zone', serverId: 'ark-1', actionId: 'action-1', actionIndex: 0,
    adapter: plugin, commandDigest: hash(command), permitDigest: 'a'.repeat(64),
    allowed: true, issuedAt: 1000, expiresAt: 5000,
    requiresCommandRevalidation: true, requiresReceiptPersistence: true,
    executesCommand: false, mutatesServerConfiguration: false
  };
  return { action, envelope, permit };
}

test('approved reload contracts remain read-only and non-idempotent', () => {
  for (const [plugin, command] of [
    ['EventCountdown', 'EventCountdown.Reload'],
    ['RewardsAscended', 'RA.Reload'],
    ['CousinCustomRates', 'CousinCustomRates.Reload']
  ]) {
    const { permit, envelope } = fixture(command, plugin);
    const contract = buildAdapterCommandContract(permit, envelope, { checkedAt: 2000 });
    assert.equal(contract.operation, 'reload');
    assert.equal(contract.mutating, false);
    assert.equal(contract.requiresIdempotencyKey, false);
    assert.equal(contract.executesCommand, false);
    assert.equal(contract.mutatesServerConfiguration, false);
    assert.equal(contract.grantsRetryAuthority, false);
  }
});

test('RewardsAscended grants and rate activation require bound idempotency', () => {
  for (const [plugin, command] of [
    ['RewardsAscended', 'RA.Reward EOS_123 reward_alpha'],
    ['CousinCustomRates', 'changerates weekend5x']
  ]) {
    const { permit, envelope } = fixture(command, plugin, 'protocol:action:0001');
    const contract = buildAdapterCommandContract(permit, envelope, { checkedAt: 2000 });
    assert.equal(contract.mutating, true);
    assert.equal(contract.requiresIdempotencyKey, true);
    assert.match(contract.idempotencyKeyDigest, /^[a-f0-9]{64}$/);
    assert.equal(contract.requiresReceiptPersistence, true);
  }
});

test('command substitution after permit issuance fails closed', () => {
  const { permit, envelope } = fixture('RA.Reload', 'RewardsAscended');
  envelope.actions[0].command = 'RA.Reward EOS_123 reward_alpha';
  assert.throws(() => buildAdapterCommandContract(permit, envelope, { checkedAt: 2000 }), /no longer matches permit/);
});

test('unknown commands and mutating actions without idempotency fail closed', () => {
  assert.throws(() => classifyAdapterCommand({ plugin: 'RewardsAscended', command: 'RA.Delete all' }), /outside the approved/);
  const { permit, envelope } = fixture('changerates weekend5x', 'CousinCustomRates');
  assert.throws(() => buildAdapterCommandContract(permit, envelope, { checkedAt: 2000 }), /idempotency/);
});

test('expired permits and authority escalation are rejected by preparation boundary', () => {
  const { permit, envelope } = fixture('EventCountdown.Reload', 'EventCountdown');
  assert.throws(() => buildAdapterCommandContract(permit, envelope, { checkedAt: 6000 }), /outside permit window/);
  assert.throws(() => buildAdapterCommandContract({ ...permit, executesCommand: true }, envelope, { checkedAt: 2000 }), /not eligible/);
});
