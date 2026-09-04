'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DndDiscordProvisioningService,
  runtimeRequestError
} = require('../main/services/dnd-discord-provisioning-runtime.cjs');

function http(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    async text() { return payload === null || payload === undefined ? '' : JSON.stringify(payload); }
  };
}

function store() {
  return {
    getDndState() { return { campaigns: [], registeredApps: [], provisioningRecords: [] }; },
    getDiscordAppToken() { return 'protected-token'; }
  };
}

test('only Discord Unknown Channel is classified as a stale provisioning resource', () => {
  const stale = runtimeRequestError(404, { code: 10003, message: 'Unknown Channel' });
  assert.equal(stale.code, 'DISCORD_RESOURCE_STALE');
  assert.equal(stale.discordCode, 10003);

  const unknownGuild = runtimeRequestError(404, { code: 10004, message: 'Unknown Guild' });
  assert.equal(unknownGuild.code, 'DISCORD_REQUEST_FAILED');
  assert.equal(unknownGuild.discordCode, 10004);

  const generic = runtimeRequestError(404, { message: 'Not Found' });
  assert.equal(generic.code, 'DISCORD_REQUEST_FAILED');
});

test('runtime transport does not convert non-channel 404 responses into repair signals', async () => {
  const service = new DndDiscordProvisioningService({
    configStore: store(),
    logger: {},
    fetchImpl: async () => http(404, { code: 10004, message: 'Unknown Guild' }),
    sleep: async () => {}
  });

  await assert.rejects(
    () => service.discord('nexus-bot', '/guilds/12345/channels'),
    (error) => error.code === 'DISCORD_REQUEST_FAILED' && error.discordCode === 10004
  );
});

test('runtime transport preserves Unknown Channel as the explicit stale-resource recovery boundary', async () => {
  const service = new DndDiscordProvisioningService({
    configStore: store(),
    logger: {},
    fetchImpl: async () => http(404, { code: 10003, message: 'Unknown Channel' }),
    sleep: async () => {}
  });

  await assert.rejects(
    () => service.discord('nexus-bot', '/channels/22222'),
    (error) => error.code === 'DISCORD_RESOURCE_STALE' && error.discordCode === 10003
  );
});
