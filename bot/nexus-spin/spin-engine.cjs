'use strict';

const crypto = require('node:crypto');

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function validateRewards(rewards) {
  if (!Array.isArray(rewards) || rewards.length === 0) throw new Error('Nexus Spin requires at least one reward.');
  const ids = new Set();
  for (const reward of rewards) {
    const id = String(reward?.id || '').trim();
    if (!id) throw new Error('Every Nexus Spin reward requires an id.');
    if (ids.has(id)) throw new Error(`Duplicate Nexus Spin reward id: ${id}`);
    ids.add(id);
    positiveInteger(reward.weight, `Weight for ${id}`);
    if (!['points', 'resource', 'cache_token'].includes(reward.type)) throw new Error(`Unsupported Nexus Spin reward type: ${reward.type}`);
    if (reward.type !== 'cache_token') positiveInteger(reward.amount, `Amount for ${id}`);
    if (reward.type === 'resource' && !String(reward.resourceKey || '').trim()) throw new Error(`Resource reward ${id} requires resourceKey.`);
  }
  return true;
}

function totalWeight(rewards) {
  validateRewards(rewards);
  return rewards.reduce((sum, reward) => sum + positiveInteger(reward.weight, `Weight for ${reward.id}`), 0);
}

function secureUnitRandom() {
  return crypto.randomInt(0, 0x100000000) / 0x100000000;
}

function rollReward(rewards, rng = secureUnitRandom) {
  const total = totalWeight(rewards);
  const unit = Math.min(Math.max(Number(rng()) || 0, 0), 0.9999999999999999);
  let cursor = Math.floor(unit * total);
  for (const reward of rewards) {
    cursor -= reward.weight;
    if (cursor < 0) return Object.freeze({ ...reward });
  }
  return Object.freeze({ ...rewards[rewards.length - 1] });
}

function createSpinId(now = Date.now()) {
  return `NS-${Number(now).toString(36).toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function freezeSpin({ discordId, eosId, reward, now = Date.now }) {
  if (!discordId || !eosId || !reward) throw new Error('discordId, eosId, and reward are required to freeze a Nexus Spin.');
  return Object.freeze({
    spinId: createSpinId(now()),
    discordId: String(discordId),
    eosId: String(eosId),
    reward: Object.freeze({ ...reward }),
    createdAt: new Date(now()).toISOString(),
  });
}

module.exports = { validateRewards, totalWeight, rollReward, createSpinId, freezeSpin, secureUnitRandom };
