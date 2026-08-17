'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDiscordEntitlementPolicy,
  activeSkuIdsFromInteraction,
  resolveDiscordRank,
  featureAccess,
  assertFeatureAccess
} = require('../shared/discord-entitlement-policy.cjs');

const policy = normalizeDiscordEntitlementPolicy({
  enabled: true,
  defaultRank: 'member',
  ranks: [
    { id: 'member', name: 'Member', priority: 0, skuIds: [] },
    { id: 'adventurer', name: 'Adventurer', priority: 10, skuIds: ['111111'] },
    { id: 'legend', name: 'Legend', priority: 20, skuIds: ['222222'] }
  ],
  featureRanks: {
    'dnd.roll': 'adventurer',
    'dnd.session': 'legend'
  }
});

function interaction(userId, entitlements = []) {
  return { user: { id: userId }, entitlements };
}

test('Discord entitlement policy keeps monetization disabled by default', () => {
  const normalized = normalizeDiscordEntitlementPolicy();
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.defaultRank, 'member');
});

test('active entitlement SKUs ignore deleted, consumed and expired entries', () => {
  const now = Date.parse('2026-08-17T09:00:00Z');
  const ids = activeSkuIdsFromInteraction(interaction('42', [
    { skuId: '111111', endsAt: '2026-08-18T00:00:00Z' },
    { skuId: '222222', deleted: true },
    { skuId: '333333', consumed: true },
    { sku_id: '444444', ends_at: '2026-08-16T00:00:00Z' }
  ]), now);
  assert.deepEqual([...ids], ['111111']);
});

test('highest matching Discord Store rank wins', () => {
  const rank = resolveDiscordRank({
    policy,
    interaction: interaction('42', [{ skuId: '111111' }, { skuId: '222222' }])
  });
  assert.equal(rank.id, 'legend');
});

test('ungated features remain available while gated features require rank', () => {
  assert.equal(featureAccess({ policy, interaction: interaction('42'), feature: 'dnd.character' }).allowed, true);
  assert.equal(featureAccess({ policy, interaction: interaction('42'), feature: 'dnd.roll' }).allowed, false);
  assert.equal(featureAccess({ policy, interaction: interaction('42', [{ skuId: '111111' }]), feature: 'dnd.roll' }).allowed, true);
  assert.equal(featureAccess({ policy, interaction: interaction('42', [{ skuId: '111111' }]), feature: 'dnd.session' }).allowed, false);
});

test('configured owner always bypasses Discord Store gates', () => {
  const access = featureAccess({ policy, interaction: interaction('99'), ownerUserId: '99', feature: 'dnd.session' });
  assert.equal(access.allowed, true);
  assert.equal(access.reason, 'owner-bypass');
});

test('failed entitlement gate gives a rank-specific error', () => {
  assert.throws(
    () => assertFeatureAccess({ policy, interaction: interaction('42'), feature: 'dnd.session' }),
    (error) => error.code === 'DISCORD_ENTITLEMENT_REQUIRED' && /Legend/.test(error.message)
  );
});
