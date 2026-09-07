'use strict';

const crypto = require('node:crypto');

function cleanToken(value, label, pattern = /^[A-Za-z0-9:_-]{1,128}$/) {
  const result = String(value ?? '').trim();
  if (!pattern.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function canonicalRewardEntries(plans = []) {
  if (!Array.isArray(plans)) throw new Error('Protocol reward plans must be an array');
  const entries = plans.map((item) => {
    if (!item || !item.plan || item.plan.dryRun !== true || !Array.isArray(item.plan.actions)) {
      throw new Error('Protocol reward batch accepts dry-run plans only');
    }
    if (item.plan.actions.length !== 1) throw new Error('Protocol reward batch plan must contain exactly one action');
    const action = item.plan.actions[0];
    if (action.plugin !== 'RewardsAscended' || action.destructive !== true
      || !/^RA\.Reward [A-Za-z0-9_-]{4,96} [A-Za-z0-9:_-]{1,96}$/.test(String(action.command || ''))) {
      throw new Error('Protocol reward batch contains an invalid RewardsAscended action');
    }
    return {
      accountId: cleanToken(item.accountId, 'reward account id', /^[A-Za-z0-9:_-]{1,96}$/),
      rank: Math.max(1, Math.floor(Number(item.rank))),
      score: Math.max(0, Math.floor(Number(item.score) || 0)),
      rewardId: cleanToken(item.rewardId, 'reward id', /^[A-Za-z0-9:_-]{1,96}$/),
      protocolId: cleanToken(item.plan.protocolId, 'protocol id'),
      createdAt: Number(item.plan.createdAt),
      command: action.command
    };
  }).sort((a, b) => a.rank - b.rank || a.accountId.localeCompare(b.accountId));

  const accounts = new Set();
  const ranks = new Set();
  for (const entry of entries) {
    if (!Number.isFinite(entry.createdAt) || entry.createdAt < 0) throw new Error('Invalid Protocol reward plan time');
    if (accounts.has(entry.accountId)) throw new Error('Duplicate Protocol reward account');
    if (ranks.has(entry.rank)) throw new Error('Duplicate Protocol reward rank');
    accounts.add(entry.accountId);
    ranks.add(entry.rank);
  }
  return entries;
}

function batchDigest(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createRewardBatchManifest(rewardBatch, options = {}) {
  if (!rewardBatch || rewardBatch.dryRun !== true || !/^[a-f0-9]{64}$/i.test(String(rewardBatch.sealDigest || ''))) {
    throw new Error('Invalid Protocol season reward batch');
  }
  const payload = {
    version: 1,
    seasonId: cleanToken(rewardBatch.seasonId, 'season id', /^[A-Za-z0-9:_-]{1,96}$/),
    sealDigest: String(rewardBatch.sealDigest).toLowerCase(),
    createdAt: Number(options.createdAt ?? Date.now()),
    entries: canonicalRewardEntries(rewardBatch.plans)
  };
  if (!Number.isFinite(payload.createdAt) || payload.createdAt < 0) throw new Error('Invalid Protocol reward batch time');
  return Object.freeze({ ...payload, digest: batchDigest(payload), dryRun: true, executable: false });
}

function verifyRewardBatchManifest(manifest) {
  if (!manifest || Number(manifest.version) !== 1 || manifest.dryRun !== true || manifest.executable !== false
    || !/^[a-f0-9]{64}$/i.test(String(manifest.digest || ''))
    || !/^[a-f0-9]{64}$/i.test(String(manifest.sealDigest || ''))) return false;
  let payload;
  try {
    payload = {
      version: 1,
      seasonId: cleanToken(manifest.seasonId, 'season id', /^[A-Za-z0-9:_-]{1,96}$/),
      sealDigest: String(manifest.sealDigest).toLowerCase(),
      createdAt: Number(manifest.createdAt),
      entries: canonicalRewardEntries((manifest.entries || []).map((entry) => ({
        ...entry,
        plan: {
          dryRun: true,
          protocolId: entry.protocolId,
          createdAt: entry.createdAt,
          actions: [{ plugin: 'RewardsAscended', destructive: true, command: entry.command }]
        }
      })))
    };
    if (!Number.isFinite(payload.createdAt) || payload.createdAt < 0) return false;
  } catch {
    return false;
  }
  const expected = Buffer.from(batchDigest(payload), 'hex');
  const actual = Buffer.from(String(manifest.digest).toLowerCase(), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { canonicalRewardEntries, createRewardBatchManifest, verifyRewardBatchManifest };
