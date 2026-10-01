'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const { buildStatusText, helpText } = require('../../src/game-bots/ops-spine.cjs');
const { prepareVanguardEnv } = require('../../src/game-bots/vanguard/entry.cjs');
const {
  BRAND,
  DISCLAIMER,
  degradedEmbed,
  ownsFooter,
  panelFooter,
  upsertOwnedPanel
} = require('../../src/game-bots/vanguard/panels.cjs');
const { SETUP_CHANNELS, planSetup, resolvedChannels, vanguardCommandBuilder } = require('../../src/game-bots/vanguard/commands/setup.cjs');
const { lfgCommandBuilder } = require('../../src/game-bots/vanguard/lfg/lfg-commands.cjs');

const CATEGORY = '1516640233389822042';
const CHANNEL = '1516640233389822111';
const BOT_ID = '111111111111111111';
const FOREIGN_ID = '222222222222222222';
const LFG = '1516640233389822222';

function message(partial) {
  const row = {
    id: partial.id,
    author: partial.author,
    embeds: partial.embeds || [],
    createdTimestamp: partial.createdTimestamp || 1,
    deleted: false,
    edit: partial.edit,
    delete: partial.delete
  };
  if (!row.edit) {
    row.edit = async (body) => {
      row.embeds = body.embeds;
      return row;
    };
  }
  if (!row.delete) row.delete = async () => { row.deleted = true; };
  return row;
}

test('panel footer is exact, own-bot only, and does not delete foreign messages', async () => {
  const footer = panelFooter('lfg-board');
  assert.equal(footer, `${BRAND} • Nexus Vanguard • lfg-board • v1 • ${DISCLAIMER}`);
  assert.match(footer, /Many Worlds One Nexus/);
  assert.match(footer, /Not affiliated with or endorsed by Bungie/);
  const foreign = message({
    id: '333333333333333333',
    author: { id: FOREIGN_ID, bot: true },
    embeds: [{ footer: { text: footer }, title: 'Vanguard • Fireteam Board' }]
  });
  const userCopy = message({
    id: '444444444444444444',
    author: { id: '555555555555555555', bot: false },
    embeds: [{ footer: { text: footer } }]
  });
  assert.equal(ownsFooter(foreign, BOT_ID, footer), false);
  assert.equal(ownsFooter(userCopy, BOT_ID, footer), false);
  const degraded = degradedEmbed({ asOf: '2026-10-01T00:00:00Z', detail: 'kept' });
  assert.match(degraded.description, /Bungie data unavailable \(as of 2026-10-01T00:00:00Z\)/);
  assert.match(degraded.description, /kept/);

  const sent = [];
  const list = [foreign, userCopy];
  const channel = {
    id: CHANNEL,
    send: async (body) => {
      const created = message({
        id: `90000000000000000${sent.length + 1}`,
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        createdTimestamp: 50
      });
      sent.push(body);
      list.push(created);
      return created;
    },
    messages: {
      fetch: async (arg) => {
        if (arg && typeof arg === 'object') return { values: () => list.values() };
        return list.find((item) => item.id === arg) || null;
      }
    }
  };
  const client = { user: { id: BOT_ID }, channels: { fetch: async () => channel } };
  const first = await upsertOwnedPanel(client, {
    channelId: CHANNEL,
    panelId: 'lfg-board',
    embed: { title: 'Vanguard • Fireteam Board', description: 'No open fireteams.' },
    botId: BOT_ID
  });
  assert.equal(first.created, true);
  assert.equal(sent.length, 1);
  assert.equal(foreign.deleted, false);
  assert.equal(userCopy.deleted, false);
  assert.equal(sent[0].embeds[0].footer.text, footer);

  const second = await upsertOwnedPanel(client, {
    channelId: CHANNEL,
    messageId: first.messageId,
    panelId: 'lfg-board',
    embed: { title: 'Vanguard • Fireteam Board', description: 'One fireteam.' },
    botId: BOT_ID
  });
  assert.equal(second.created, false);
  assert.equal(second.edited, true);
  assert.equal(sent.length, 1);
  assert.equal(foreign.deleted, false);
  assert.equal(list.find((item) => item.id === first.messageId).embeds[0].description, 'One fireteam.');
});

test('setup plans the owner channel names and env ids win', () => {
  assert.deepEqual(SETUP_CHANNELS.map((item) => item.name), ['lfg', 'fireteam-finder', 'panels', 'staff-alerts', 'lobby']);
  for (const spec of SETUP_CHANNELS) assert.doesNotMatch(spec.name, /destiny|vanguard/i);
  assert.equal(SETUP_CHANNELS.find((item) => item.key === 'jtcLobby').type, ChannelType.GuildVoice);

  const created = planSetup({ channels: [], env: {}, categoryId: CATEGORY, saved: {} });
  assert.ok(created.every((item) => item.action === 'create'));

  const planned = planSetup({
    channels: [
      { id: LFG, name: 'lfg', parentId: CATEGORY, type: ChannelType.GuildText },
      { id: '1516640233389823333', name: 'lfg', parentId: '1516602943670059108', type: ChannelType.GuildText }
    ],
    env: { VANGUARD_STAFF_ALERT_CHANNEL_ID: '1516640233389824444', VANGUARD_JTC_LOBBY_CHANNEL_ID: 'lobby-nope' },
    categoryId: CATEGORY,
    saved: {}
  });
  assert.equal(planned.find((item) => item.key === 'lfg').action, 'reuse');
  assert.equal(planned.find((item) => item.key === 'lfg').id, LFG);
  assert.equal(planned.find((item) => item.key === 'staffAlerts').action, 'env');
  assert.equal(planned.find((item) => item.key === 'jtcLobby').action, 'invalid');
  assert.equal(planned.find((item) => item.key === 'panels').action, 'create');

  const resolved = resolvedChannels(
    { VANGUARD_LFG_CHANNEL_ID: LFG },
    { lfg: '1516640233389825555', jtcLobby: '1516640233389826666' }
  );
  assert.equal(resolved.lfg, LFG);
  assert.equal(resolved.jtcLobby, '1516640233389826666');
});

test('status and command registration stay secret-free and inside discord limits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-status-'));
  const token = `M${'a'.repeat(23)}.abcdef.${'b'.repeat(27)}`;
  const env = {
    VANGUARD_DATA_DIR: dir,
    VANGUARD_DISCORD_TOKEN: token,
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY,
    VANGUARD_JTC_LOBBY_CHANNEL_ID: '1516640233389822777',
    BUNGIE_API_KEY: 'secret-bungie-key',
    RAILWAY_GIT_COMMIT_SHA: 'abc1234def56789'
  };
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const prepared = prepareVanguardEnv({ ...env });
    assert.equal(prepared.DISCORD_BOT_TOKEN, token);
    assert.equal(prepared.NEXUS_DATA_DIR, dir);
    assert.equal(logs.some((line) => line.includes(token)), false);
    assert.match(logs.join('\n'), /token=present/);

    let probed = false;
    const text = await buildStatusText({
      bot: 'vanguard',
      client: { isReady: () => true },
      env,
      probe: () => { probed = true; return { label: 'Healthy' }; }
    });
    assert.equal(probed, false);
    assert.match(text, /Nexus Vanguard status/);
    assert.match(text, /Discord: ready/);
    assert.match(text, /Category gate: ok/);
    assert.match(text, /Data dir: writable/);
    assert.match(text, /Join-to-create: lobby configured/);
    assert.match(text, /No Bungie calls/);
    assert.match(text, /Many Worlds One Nexus/);
    assert.match(text, /Not affiliated with or endorsed by Bungie/);
    assert.match(text, /Deploy `abc1234`/);
    assert.doesNotMatch(text, new RegExp(token));
    assert.doesNotMatch(text, /secret-bungie-key/);
    assert.doesNotMatch(text, new RegExp(CATEGORY));
    assert.doesNotMatch(text, /Sentinel/);
    assert.match(helpText('vanguard'), /Nexus Sentinal/);

    const names = [lfgCommandBuilder().toJSON(), vanguardCommandBuilder().toJSON()];
    assert.deepEqual(names.map((command) => command.name), ['lfg', 'vanguard']);
    for (const command of names) {
      assert.ok(command.description.length <= 100);
      const options = command.options || [];
      for (const option of options) {
        assert.ok(option.description.length <= 100);
        for (const nested of option.options || []) assert.ok(nested.description.length <= 100);
      }
    }
  } finally {
    console.log = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
