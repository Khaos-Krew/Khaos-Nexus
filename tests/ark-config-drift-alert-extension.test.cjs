'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INITIAL_DELAY_MS,
  outboundMessage,
  runCycle,
  startArkConfigDriftAlerts
} = require('../src/sentinel/ark-config-drift-alert-extension.cjs');

test('outbound drift alert disables mentions and bounds content', () => {
  const message = outboundMessage({ message: '@everyone ARK config drift detected.\n\n\nReview staff ops.' });
  assert.equal(message.content.includes('@everyone'), true);
  assert.deepEqual(message.allowedMentions, { parse: [] });
  assert.equal(message.content.includes('\n\n\n'), false);
  assert.equal(message.content.length <= 1800, true);
});

test('drift alert cycle reuses resolved staff channel and does not hardcode a destination', async () => {
  const sent = [];
  const channel = { id: 'staff-123', send: async (payload) => sent.push(payload) };
  const client = { guilds: { fetch: async (guildId) => ({ id: guildId }) } };
  const result = await runCycle(client, { discord: { guildId: 'guild-456' } }, {
    resolveStaffChannel: async (guild) => {
      assert.equal(guild.id, 'guild-456');
      return channel;
    },
    runAlerts: async ({ notify }) => {
      await notify({ message: '🟡 Genesis 1 ARK config drift detected (1 setting). Drifted keys: XPMultiplier.' });
      return [
        { serverId: 'gen1', alert: true, sent: true },
        { serverId: 'astraeos', alert: false, sent: false }
      ];
    }
  });
  assert.equal(result.channelId, 'staff-123');
  assert.equal(result.checked, 2);
  assert.equal(result.alerted, 1);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});

test('missing guild or staff channel fails closed without running drift checks', async () => {
  let calls = 0;
  const client = { guilds: { fetch: async () => ({ id: 'guild' }) } };
  const noGuild = await runCycle(client, { discord: {} }, { runAlerts: async () => { calls += 1; return []; } });
  assert.equal(noGuild.skipped, 'guild-not-configured');
  const noChannel = await runCycle(client, { discord: { guildId: 'guild' } }, {
    resolveStaffChannel: async () => null,
    runAlerts: async () => { calls += 1; return []; }
  });
  assert.equal(noChannel.skipped, 'staff-channel-not-found');
  assert.equal(calls, 0);
});

test('config drift coordinated startup preserves initial delay and configured interval', () => {
  const scheduled = [];
  const handle = () => ({ unref() {} });
  const originalLog = console.log;
  console.log = () => {};
  try {
    const monitor = startArkConfigDriftAlerts({}, {}, {
      intervalMs: 420_000,
      setTimeoutFn(fn, delay) {
        scheduled.push({ type: 'timeout', fn, delay });
        return handle();
      },
      setIntervalFn(fn, delay) {
        scheduled.push({ type: 'interval', fn, delay });
        return handle();
      }
    });
    assert.equal(monitor.intervalMs, 420_000);
    assert.deepEqual(scheduled.map(({ type, delay }) => ({ type, delay })), [
      { type: 'timeout', delay: INITIAL_DELAY_MS },
      { type: 'interval', delay: 420_000 }
    ]);
  } finally {
    console.log = originalLog;
  }
});
