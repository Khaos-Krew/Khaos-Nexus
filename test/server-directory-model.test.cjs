'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  availableServerTypes,
  normalizeServerRecord,
  sanitizePublic,
  monetizationRisk,
  offlinePolicy,
  validateOnceHumanId
} = require('../shared/server-directory-model.cjs');

test('members cannot create Nexus Official listings', () => {
  assert.throws(() => normalizeServerRecord({
    ownerType: 'nexus-official', gameId: 'once-human', serverType: 'once-human-custom', serverName: 'Test', customServerId: '10101801696'
  }, { canCreateOfficial: false }), /servers\.official\.create/);
});

test('staff can create Nexus Official Once Human listing', () => {
  const record = normalizeServerRecord({
    ownerType: 'nexus-official', gameId: 'once-human', serverType: 'once-human-custom', serverName: 'Khaos Nexus Once Human', customServerId: '10101801696'
  }, { canCreateOfficial: true });
  assert.equal(record.ownerType, 'nexus-official');
  assert.equal(record.customServerId, '10101801696');
});

test('Once Human validation rejects nonnumeric IDs', () => {
  assert.equal(validateOnceHumanId('10101801696'), '10101801696');
  assert.throws(() => validateOnceHumanId('OH-10101801696'), /8-20 digits/);
});

test('Minecraft exposes dedicated and Realm profiles', () => {
  const ids = availableServerTypes('minecraft').map((item) => item.id);
  assert.deepEqual(ids, ['minecraft-java', 'minecraft-bedrock', 'minecraft-realm-java', 'minecraft-realm-bedrock']);
});

test('public projection strips protected join/admin data', () => {
  const record = normalizeServerRecord({
    ownerType: 'community', gameId: 'minecraft', serverType: 'minecraft-realm-bedrock', serverName: 'Realm', realmOwner: 'Owner', realmInviteCode: 'secret-code', realmShareLink: 'https://example.invalid/private', adminNotes: 'private', monetization: {}
  }, { canCreateOfficial: false });
  const publicRecord = sanitizePublic(record);
  assert.equal(publicRecord.realmInviteCode, undefined);
  assert.equal(publicRecord.realmShareLink, undefined);
  assert.equal(publicRecord.adminNotes, undefined);
  assert.equal(publicRecord.monetization, undefined);
  assert.equal(publicRecord.vetting, undefined);
});

test('pay-to-win and paid entry are automatic vetting blockers', () => {
  const risk = monetizationRisk({ sellsGameplayAdvantages: true, requiresPaymentToJoin: true });
  assert.equal(risk.pass, false);
  assert.equal(risk.blockers.length, 2);
});

test('cost recovery can pass with disclosure', () => {
  const risk = monetizationRisk({ acceptsDonations: true, monthlyOperatingCost: 100, expectedMonthlyRevenue: 50, disclosure: 'Voluntary donations offset hosting costs only.' });
  assert.equal(risk.pass, true);
  assert.equal(risk.blockers.length, 0);
});

test('servers without automatic health are not auto-delisted', () => {
  const record = normalizeServerRecord({ ownerType: 'community', gameId: 'once-human', serverType: 'once-human-custom', serverName: 'OH', customServerId: '10101801696', monetization: {} }, { canCreateOfficial: false });
  record.health.offlineSince = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  assert.equal(offlinePolicy(record).action, 'none');
});

test('probeable community server is delisted after configured threshold', () => {
  const record = normalizeServerRecord({ ownerType: 'community', gameId: 'ark', serverType: 'generic', serverName: 'ARK', host: '127.0.0.1', monetization: {} }, { canCreateOfficial: false });
  record.health.offlineSince = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
  assert.equal(offlinePolicy(record, Date.now(), { delistAfterHours: 72, suspendAfterHours: 168 }).action, 'delist');
});
