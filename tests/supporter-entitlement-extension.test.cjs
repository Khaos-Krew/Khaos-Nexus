'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ENTITLEMENT_EVENTS,
  INITIAL_DELAY_MS,
  PERIODIC_SYNC_MS,
  premiumEntitlementAuthority,
  supporterSyncSummary,
  runSupporterEntitlementSync
} = require('../src/sentinel/supporter-entitlement-extension.cjs');

const premiumConfig = {
  discord: {
    guildId: '123456789012345678',
    rankSkus: { 'cipher-runner': ['11111'] },
    rankRoles: { 'cipher-runner': '22222' }
  }
};

const serverShopConfig = {
  discord: {
    guildId: '123456789012345678',
    rankSkus: {},
    rankRoles: { 'cipher-runner': '22222' }
  }
};

test('supporter entitlement runtime is enabled only for Premium App rank authority', () => {
  assert.equal(premiumEntitlementAuthority(premiumConfig), true);
  assert.equal(premiumEntitlementAuthority(serverShopConfig), false);
});

test('runtime listens for all Discord entitlement lifecycle events', () => {
  assert.deepEqual(ENTITLEMENT_EVENTS, ['entitlementCreate', 'entitlementUpdate', 'entitlementDelete']);
});

test('startup and periodic reconciliation are bounded away from rapid polling', () => {
  assert.ok(INITIAL_DELAY_MS >= 30_000);
  assert.ok(PERIODIC_SYNC_MS >= 15 * 60_000);
});

test('Server Shop authority bypasses Premium App sync without touching Discord', async () => {
  const result = await runSupporterEntitlementSync({}, serverShopConfig);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'server-shop-roles-authoritative');
  assert.equal(result.changed, 0);
});

test('supporter sync summary is staff-safe and bounded to aggregate diagnostics', () => {
  const summary = supporterSyncSummary({
    ok: true,
    pages: 2,
    users: [{ userId: 'private-user' }],
    changed: 3,
    failures: 1,
    guildEntitlements: [{}],
    truncated: false
  });
  assert.match(summary, /pages=2/);
  assert.match(summary, /users=1/);
  assert.match(summary, /changes=3/);
  assert.doesNotMatch(summary, /private-user/);
});
