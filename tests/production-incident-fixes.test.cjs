'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { Scheduler } = require('../src/sentinel-v2/scheduler.cjs');
const { registerArkHealthJob } = require('../src/sentinel-v2/ark-health-adapter.cjs');
const { registerArkRconPlayersJob } = require('../src/sentinel-v2/ark-rcon-read-adapter.cjs');
const { ArkShadowRuntime } = require('../src/sentinel-v2/ark-shadow-runtime.cjs');
const { registerEconomyPurchaseJobs } = require('../src/sentinel-v2/economy-purchase-runtime.cjs');
const { createSentinalAdminServer } = require('../src/sentinel/admin-server.cjs');
const { resolveSharedListenerPorts } = require('../src/sentinel/listener-ports.cjs');
const { EventFeedPublisher, feedsFor } = require('../src/sentinel/event-feed.cjs');
const { sweepManagedPanels } = require('../src/sentinel/persistent-panel-extension.cjs');
const { ensureClanMarker } = require('../src/game-bots/vanguard/panels.cjs');
const { XUR_VENDOR_HASH, renderXur } = require('../src/game-bots/vanguard/panels/xur.cjs');

test('worker boot intervals pass the everyMs >= 1000 guard', () => {
  const scheduler = new Scheduler();
  registerArkHealthJob(scheduler, {
    adapter: { async inspectMany() { return []; } },
    servers: [],
    intervalMs: 300000,
    jitterMs: 30000
  });
  registerArkRconPlayersJob(scheduler, {
    adapter: { async listPlayers() { return { ok: true }; } },
    servers: [],
    intervalMs: 300000,
    jitterMs: 30000
  });
  const shadow = new ArkShadowRuntime({
    scheduler,
    registry: { list() { return []; } },
    v2Adapter: { async inspectMany() { return []; } },
    legacyReader: { async inspectMany() { return []; } },
    comparison: { async hydrate() { return {}; }, async compare() { return {}; } }
  });
  shadow.register({ intervalMs: 300000, jitterMs: 30000 });
  registerEconomyPurchaseJobs(scheduler, { async project() {}, async executeOne() {} });

  const jobs = scheduler.list();
  assert.ok(jobs.length >= 4);
  for (const job of jobs) {
    assert.equal(job.trigger.type, 'interval');
    assert.ok(job.trigger.everyMs >= 1000, `${job.name} everyMs`);
  }
  assert.throws(
    () => scheduler.register({ name: 'too-fast', trigger: { type: 'interval', everyMs: 999 }, run: async () => {} }),
    /everyMs >= 1000/
  );
});

test('admin port collision moves the backend off 0.0.0.0:3210 and warns once', async () => {
  const ports = resolveSharedListenerPorts({
    PORT: '3210',
    NEXUS_SENTINAL_ADMIN_TOKEN: 'a'.repeat(40),
    NEXUS_BACKEND_PORT: '3210'
  });
  assert.equal(ports.adminPort, '3210');
  assert.equal(ports.backendPort, '3212');
  assert.equal(ports.movedBackend, true);
  assert.match(ports.warning, /0\.0\.0\.0:3210/);
  assert.match(ports.warning, /127\.0\.0\.1:3212/);

  const separate = resolveSharedListenerPorts({ PORT: '8080', NEXUS_SENTINAL_ADMIN_TOKEN: 'a'.repeat(40) });
  assert.equal(separate.movedBackend, false);
  assert.equal(separate.backendPort, '3210');
  assert.equal(separate.adminPort, '8080');

  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const port = blocker.address().port;
  const warnings = [];
  const admin = createSentinalAdminServer({
    host: '127.0.0.1',
    port,
    logger: { warn: (message) => warnings.push(String(message)), log() {}, error() {} }
  });
  const first = await admin.start();
  const second = await admin.start();
  assert.equal(first.skipped, 'address-in-use');
  assert.equal(second.skipped, 'address-in-use');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /already in use/);
  assert.match(warnings[0], /duplicate listener/);
  await new Promise((resolve) => blocker.close(resolve));
});

test('removed CoD and DbD paths are skipped and other feed failures still log', async () => {
  const active = feedsFor({});
  assert.equal(active.some((feed) => feed.moduleId === 'callofduty'), false);
  assert.equal(active.some((feed) => feed.moduleId === 'deadbydaylight'), false);
  assert.equal(active.some((feed) => feed.moduleId === 'diablo4'), true);

  const errors = [];
  let invoked = 0;
  const publisher = new EventFeedPublisher({
    backend: { async invoke() { invoked += 1; throw new Error('provider down'); } },
    state: { getModuleSetup() { return { consoleChannelId: '1', textChannels: [{ name: 'cod-news', id: '1' }] }; } },
    client: { channels: { async fetch() { throw new Error('should not fetch'); } } },
    logger: { error: (...args) => errors.push(args.map(String).join(' ')), warn() {}, log() {} }
  });
  const cod = await publisher.publish({ moduleId: 'callofduty', channelName: 'cod-news', actions: ['news'] });
  const dbd = await publisher.publish({ moduleId: 'deadbydaylight', channelName: 'dbd-hub', actions: ['news'] });
  assert.equal(cod.skipped, 'removed-game');
  assert.equal(dbd.skipped, 'removed-game');
  assert.equal(invoked, 0);
  assert.equal(errors.length, 0);

  const failing = new EventFeedPublisher({
    state: { getModuleSetup() { throw new Error('state exploded'); } },
    logger: { error: (...args) => errors.push(args.map(String).join(' ')), warn() {}, log() {} },
    client: { channels: { async fetch() { return null; } } },
    backend: { async invoke() { return { ok: true }; } }
  });
  await failing.publish({ moduleId: 'diablo4', channelName: 'diablo-news', actions: ['news'] });
  assert.ok(errors.some((line) => line.includes('diablo4') && line.includes('state exploded')));

  const fetched = [];
  await sweepManagedPanels({
    guilds: { async fetch() { return {}; } },
    channels: { async fetch(id) { fetched.push(String(id)); return null; } }
  }, {
    config: {
      discord: { guildId: 'guild-1' },
      modules: {
        callofduty: { enabled: true, channelId: 'cod-channel' },
        deadbydaylight: { enabled: true, channelId: 'dbd-channel' },
        diablo4: { enabled: true, channelId: 'dia-channel' }
      }
    },
    state: {
      listModuleSetups() {
        return {
          callofduty: { consoleChannelId: 'cod-channel' },
          deadbydaylight: { consoleChannelId: 'dbd-channel' }
        };
      },
      getModuleSetup(id) {
        return this.listModuleSetups()[id] || null;
      }
    },
    backend: { async modules() { return { modules: [] }; } },
    logger: { warn(message) { throw new Error(String(message)); }, log() {}, error() {} }
  });
  assert.deepEqual(fetched, ['dia-channel']);
});

test('vanguard clan join link uses the Clan Profile URL', () => {
  const rewritten = ensureClanMarker('clan:5453042', 'Join: https://www.bungie.net/en/ClanV2/Index?groupId=5453042');
  assert.match(rewritten, /https:\/\/www\.bungie\.net\/7\/en\/Clan\/Profile\/5453042/);
  assert.doesNotMatch(rewritten, /ClanV2/);
  assert.equal((rewritten.match(/^Join:/gm) || []).length, 1);
});

test('xur Leaves renders the API timestamp as a Discord relative time', () => {
  const unix = 1791306000;
  const embed = renderXur({
    vendors: {
      Response: {
        vendors: {
          data: {
            [String(XUR_VENDOR_HASH)]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: unix }
          }
        }
      }
    },
    now: Date.parse('2026-10-01T22:00:00Z')
  });
  assert.equal(embed.present, true);
  assert.match(embed.description, new RegExp(`⏳ Leaves <t:${unix}:R>`));
  assert.doesNotMatch(embed.description, /\d{1,2}:\d{2}|CT|AM|PM/);

  const zoned = renderXur({
    vendors: {
      Response: {
        vendors: {
          data: {
            [String(XUR_VENDOR_HASH)]: {
              vendorHash: XUR_VENDOR_HASH,
              enabled: true,
              nextRefreshDate: '2026-10-06T17:00:00'
            }
          }
        }
      }
    },
    now: Date.parse('2026-10-01T22:00:00Z')
  });
  assert.match(zoned.description, new RegExp(`⏳ Leaves <t:${unix}:R>`));
});
