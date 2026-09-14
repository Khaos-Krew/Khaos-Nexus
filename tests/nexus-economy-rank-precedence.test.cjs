'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { resolveHighestRank, RANK_PRIORITY } = require('../src/sentinel/nexus-economy-rank-resolver.cjs');
const { highestConfiguredRankForMember, ArkAccountLinkService } = require('../src/sentinel/ark-account-linking.cjs');
const { NexusEconomyClient } = require('../src/sentinel/nexus-economy-client.cjs');
const { DEFAULT_ONLINE_POINTS, DEFAULT_OFFLINE_POINTS_PER_HOUR, DEFAULT_OFFLINE_CAP_HOURS } = require('../src/sentinel/nexus-economy-worker.cjs');
const { economyPerkForRank, OFFLINE_PASSIVE_CAP_HOURS } = require('../src/shared/nexus-economy-rank-perks.cjs');

const precedence = ['origin-founder', 'blackout-legend', 'khaos-warden', 'nexus-raider', 'cipher-runner', 'shadow-recruit'];
test('rank priority is explicit and immutable', () => {
  assert.deepEqual(RANK_PRIORITY, precedence);
  assert.ok(Object.isFrozen(RANK_PRIORITY));
});
for (const expected of precedence) {
  test(`Shadow Recruit with ${expected} resolves to ${expected} through the live sync path`, () => {
    const held = [...new Set(['shadow-recruit', expected])];
    for (const order of [held, [...held].reverse()]) {
      assert.equal(resolveHighestRank(order), expected);
      const roles = new Map(order.map((id, index) => [id, { id, name: id.replaceAll('-', ' '), position: 100 - index }]));
      // Only Shadow Recruit has a working saved mapping, matching production evidence.
      const config = { discord: { rankRoles: { 'shadow-recruit': 'shadow-recruit', [expected]: expected === 'shadow-recruit' ? expected : 'stale-id' } } };
      const member = { id: '123456789012345678', roles: { cache: roles } };
      assert.equal(highestConfiguredRankForMember(member, config).id, expected);
      const service = new ArkAccountLinkService({ store: { updateRank(discordUserId, rankId) { return { ok: true, profile: { discordUserId, rankId } }; } } });
      assert.equal(service.syncMemberRank(member, config).profile.rankId, expected);
      const mappedOnly = { discord: { rankRoles: Object.fromEntries(order.map(id => [id, id])) } };
      for (const role of roles.values()) role.name = 'Unrelated visual label';
      assert.equal(highestConfiguredRankForMember(member, mappedOnly).id, expected);
    }
  });
}

test('all higher ranks win independently of member role order', () => {
  assert.equal(resolveHighestRank([...precedence].reverse()), 'origin-founder');
  assert.equal(resolveHighestRank([]), 'shadow-recruit');
});

test('wallet reads cannot project a stale Shadow Recruit profile over an Origin Founder wallet', async (t) => {
  const requests = [];
  let response = { rankId: 'origin-founder', balance: 147 };
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = { url: process.env.NEXUS_ECONOMY_URL, token: process.env.NEXUS_ECONOMY_TOKEN };
  t.after(async () => {
    for (const [key, value] of [['NEXUS_ECONOMY_URL', previous.url], ['NEXUS_ECONOMY_TOKEN', previous.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise(resolve => server.close(resolve));
  });
  process.env.NEXUS_ECONOMY_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.NEXUS_ECONOMY_TOKEN = 'test-token';
  const client = new NexusEconomyClient({ identityStoreFactory: () => ({ profileByDiscord: () => ({ rankId: 'shadow-recruit', arkAccounts: [{ eosId: 'EOS_test12345' }] }) }) });
  assert.deepEqual(await client.wallet('123456789012345678'), { rankId: 'origin-founder', balance: 147 });
  assert.deepEqual(requests, [{ method: 'GET', url: '/wallet/123456789012345678' }]);
  response = { ok: true, balance: 147, writesEnabled: false, accrualPermitted: false };
  const member = { roles: { cache: new Map([
    ['recruit', { id: 'recruit', name: 'Shadow Recruit' }],
    ['founder', { id: 'founder', name: 'Origin Founder' }]
  ]) } };
  const wallet = await client.wallet('123456789012345678', { member });
  assert.deepEqual(wallet, { ...response, rankId: 'origin-founder', rankName: 'Origin Founder',
    activePoints: 10, activeIntervalMinutes: 5, passivePointsPerHour: 4, passiveCapHours: 48 });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(req => req.method === 'GET'));
});

test('Origin Founder economy configuration is 10 NP per five minutes and 4 NP per offline hour capped at 48 hours', () => {
  assert.equal(DEFAULT_ONLINE_POINTS['origin-founder'], 10);
  assert.equal(DEFAULT_OFFLINE_POINTS_PER_HOUR['origin-founder'], 4);
  assert.equal(DEFAULT_OFFLINE_CAP_HOURS, 48);
  const perk = economyPerkForRank('origin-founder');
  assert.equal(perk.onlinePointsPerFiveMinutes, 10);
  assert.equal(perk.offlinePointsPerHour, 4);
  assert.equal(OFFLINE_PASSIVE_CAP_HOURS, 48);
});
