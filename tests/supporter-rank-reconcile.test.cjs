'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planSupporterRankReconciliation } = require('../src/sentinel/supporter-rank-reconcile.cjs');

const config = {
  discord: {
    rankRoles: {
      'shadow-recruit': '10000',
      'cipher-runner': '20000',
      'nexus-raider': '30000',
      'khaos-warden': '40000',
      'blackout-legend': '50000',
      'origin-founder': '90000'
    },
    rankSkus: {
      'cipher-runner': ['sku-cipher'],
      'nexus-raider': ['sku-raider'],
      'khaos-warden': ['sku-warden'],
      'blackout-legend': ['sku-blackout'],
      'origin-founder': ['sku-founder-should-be-ignored']
    }
  }
};

function entitlement(skuId, extra = {}) {
  return { sku_id: skuId, ...extra };
}

test('selects highest active purchasable entitlement and removes stale paid ranks', () => {
  const plan = planSupporterRankReconciliation({
    currentRoleIds: ['20000', '30000', '10000', '90000', '77777'],
    entitlements: [entitlement('sku-cipher'), entitlement('sku-warden')],
    config
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.selectedRankId, 'khaos-warden');
  assert.deepEqual(plan.addRoleIds, ['40000']);
  assert.deepEqual(plan.removeRoleIds.sort(), ['20000', '30000']);
  assert.equal(plan.removeRoleIds.includes('10000'), false, 'Shadow Recruit must not be treated as paid');
  assert.equal(plan.removeRoleIds.includes('90000'), false, 'Origin Founder must never be changed by entitlement reconciliation');
  assert.equal(plan.removeRoleIds.includes('77777'), false, 'Unrelated roles must be untouched');
});

test('expired and deleted entitlements do not grant a paid rank', () => {
  const plan = planSupporterRankReconciliation({
    currentRoleIds: ['50000', '90000'],
    entitlements: [
      entitlement('sku-blackout', { deleted: true }),
      entitlement('sku-warden', { ends_at: '2020-01-01T00:00:00.000Z' })
    ],
    config
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.selectedRankId, '');
  assert.deepEqual(plan.addRoleIds, []);
  assert.deepEqual(plan.removeRoleIds, ['50000']);
  assert.equal(plan.removeRoleIds.includes('90000'), false);
});

test('is idempotent when member already has only the entitled paid rank', () => {
  const plan = planSupporterRankReconciliation({
    currentRoleIds: ['30000', '10000'],
    entitlements: [entitlement('sku-raider')],
    config
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.addRoleIds, []);
  assert.deepEqual(plan.removeRoleIds, []);
});

test('fails closed when the selected paid rank has no configured Discord role', () => {
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.discord.rankRoles['blackout-legend'];
  const plan = planSupporterRankReconciliation({
    currentRoleIds: ['20000'],
    entitlements: [entitlement('sku-blackout')],
    config: missing
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'missing-rank-role-mapping');
  assert.deepEqual(plan.addRoleIds, []);
  assert.deepEqual(plan.removeRoleIds, []);
});

test('Origin Founder SKU mapping cannot become a purchasable entitlement', () => {
  const plan = planSupporterRankReconciliation({
    currentRoleIds: ['90000'],
    entitlements: [entitlement('sku-founder-should-be-ignored')],
    config
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.selectedRankId, '');
  assert.deepEqual(plan.addRoleIds, []);
  assert.deepEqual(plan.removeRoleIds, []);
});
