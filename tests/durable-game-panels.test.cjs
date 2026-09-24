'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PANEL_IDENTITIES,
  isForeignPanel,
  panelMatcher,
  upsertEmbed
} = require('../src/game-bots/panel-message.cjs');
const { reconcileArkClusterPanel, PANEL_TITLE, PANEL_MARKER } = require('../src/sentinel/ark-cluster-panel.cjs');
const { sendToButtonChannel } = require('../src/sentinel/sanctuary-bot.cjs');
const { roleMenuPayload, SanctuaryStore, allRoleNames } = require('../src/sentinel/sanctuary-suite.cjs');

const CHANNEL_ID = '1516640233389822111';
const BOT_ID = '111111111111111111';
const SENTINAL_ID = '222222222222222222';

function message(partial) {
  return {
    id: partial.id,
    author: partial.author,
    embeds: partial.embeds || [],
    createdTimestamp: partial.createdTimestamp || 0,
    edit: partial.edit,
    delete: partial.delete
  };
}

function channelFrom(messages, sent) {
  const list = [...messages];
  return {
    id: CHANNEL_ID,
    send: async (body) => {
      const created = message({
        id: `9000000000000000${sent.length + 1}`.slice(0, 18),
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        createdTimestamp: 100,
        edit: async () => {},
        delete: async () => {}
      });
      sent.push(body);
      list.push(created);
      return created;
    },
    messages: {
      fetch: async (arg) => {
        if (arg && typeof arg === 'object' && arg.limit) {
          return { values: () => list.values() };
        }
        return list.find((item) => item.id === arg) || null;
      }
    }
  };
}

function clientFor(channel) {
  return {
    user: { id: BOT_ID },
    channels: { fetch: async () => channel }
  };
}

test('persisted panel id is edited and not sent again', async () => {
  const edited = [];
  const sent = [];
  const existing = message({
    id: '333333333333333333',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board' }],
    edit: async (body) => { edited.push(body); }
  });
  const channel = channelFrom([existing], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, existing.id, {
    embeds: [{ title: 'Fissure Relay Board', description: 'updated' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(result.edited, true);
  assert.equal(result.created, false);
  assert.equal(result.messageId, existing.id);
  assert.equal(sent.length, 0);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].embeds[0].description, 'updated');
});

test('missing panel id reuses this bot message and persists that id', async () => {
  const edited = [];
  const sent = [];
  const existing = message({
    id: '444444444444444444',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Official ASA Network', footer: { text: 'old' } }],
    createdTimestamp: 5,
    edit: async (body) => { edited.push(body); },
    delete: async () => { throw new Error('canonical deleted'); }
  });
  const channel = channelFrom([existing], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Official ASA Network', description: 'online' }]
  }, { panel: 'official', botId: BOT_ID });
  assert.equal(sent.length, 0);
  assert.equal(edited.length, 1);
  assert.equal(result.created, false);
  assert.equal(result.messageId, existing.id);
});

test('missing panel id creates once when the channel has no matching panel', async () => {
  const sent = [];
  const channel = channelFrom([], sent);
  const first = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Fissure Relay Board', description: 'first' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(first.created, true);
  assert.match(first.messageId, /^\d{17,20}$/);
  const second = await upsertEmbed(clientFor(channel), CHANNEL_ID, first.messageId, {
    embeds: [{ title: 'Fissure Relay Board', description: 'second' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(second.edited, true);
  assert.equal(second.messageId, first.messageId);
});

test('a Sentinal panel is migrated once because this bot cannot edit it', async () => {
  const deleted = [];
  const sent = [];
  const legacy = message({
    id: '555555555555555555',
    author: { id: SENTINAL_ID, bot: true },
    embeds: [{ title: 'WARFRAME • FISSURES', footer: { text: 'Nexus Sentinal • Live Feed • warframe:fissures:v3' } }],
    createdTimestamp: 1,
    edit: async () => { throw Object.assign(new Error('Cannot edit a message authored by another user'), { code: 50005 }); },
    delete: async () => { deleted.push(legacy.id); }
  });
  const channel = channelFrom([legacy], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Fissure Relay Board', description: 'adopted' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(result.created, true);
  assert.equal(result.migrated, true);
  assert.equal(result.foreignRemoved, 1);
  assert.deepEqual(deleted, [legacy.id]);
  assert.notEqual(result.messageId, legacy.id);

  const again = await upsertEmbed(clientFor(channel), CHANNEL_ID, result.messageId, {
    embeds: [{ title: 'Fissure Relay Board', description: 'refresh' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(again.edited, true);
  assert.equal(again.messageId, result.messageId);
});

test('member messages with the same title are left in place', async () => {
  const deleted = [];
  const sent = [];
  const member = message({
    id: '666666666666666666',
    author: { id: '777777777777777777', bot: false },
    embeds: [{ title: 'Official ASA Network' }],
    delete: async () => { deleted.push(member.id); }
  });
  const channel = channelFrom([member], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Official ASA Network' }]
  }, { panel: 'official', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(deleted.length, 0);
  assert.equal(result.foreignRemoved, 0);
  assert.equal(isForeignPanel(member, BOT_ID), false);
  assert.equal(panelMatcher(PANEL_IDENTITIES.official)(member), true);
});

test('duplicate panels from earlier redeploys collapse to one message', async () => {
  const deleted = [];
  const edited = [];
  const sent = [];
  const older = message({
    id: '121212121212121212',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board' }],
    createdTimestamp: 1,
    edit: async () => { throw new Error('older edited'); },
    delete: async () => { deleted.push(older.id); }
  });
  const newer = message({
    id: '131313131313131313',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board' }],
    createdTimestamp: 9,
    edit: async (body) => { edited.push(body); },
    delete: async () => { deleted.push(newer.id); }
  });
  const channel = channelFrom([older, newer], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Fissure Relay Board', description: 'one' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 0);
  assert.equal(result.messageId, newer.id);
  assert.equal(edited.length, 1);
  assert.deepEqual(deleted, [older.id]);
});

test('sanctuary role menu startup reuses the button-channel panel', async () => {
  const edited = [];
  let sent = 0;
  const buttonId = '1541540948239060992';
  const existing = {
    id: '888888888888888888',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Sanctuary Nexus roles', footer: { text: 'Sanctuary Nexus • self-roles' } }],
    createdTimestamp: 3,
    edit: async (payload) => { edited.push(payload); },
    delete: async () => {}
  };
  const roles = new Map(allRoleNames().map((name, index) => [String(index + 1), { id: String(1700000000000000000n + BigInt(index)), name }]));
  const guild = {
    roles: { cache: { values: () => roles.values(), find: (fn) => [...roles.values()].find(fn) } },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } } }
  };
  const discord = {
    user: { id: BOT_ID },
    channels: {
      fetch: async () => ({
        send: async () => { sent += 1; return { id: '999999999999999999' }; },
        messages: {
          fetch: async (arg) => {
            if (arg && arg.limit) return { values: () => [existing].values() };
            return arg === existing.id ? existing : null;
          }
        }
      })
    }
  };
  const { syncRoleMenu } = require('../src/sentinel/sanctuary-bot.cjs');
  const store = new SanctuaryStore();
  const result = await syncRoleMenu({ env: { SANCTUARY_BUTTON_CHANNEL_ID: buttonId }, client: discord, store }, guild);
  assert.equal(result.posted, true);
  assert.equal(result.updated, true);
  assert.equal(sent, 0);
  assert.equal(edited.length, 1);
  assert.match(edited[0].embeds[0].title, /Sanctuary Nexus roles/);
  assert.equal(store.panelId('roles'), existing.id);
  assert.equal(roleMenuPayload([]).embeds[0].footer.text, 'Sanctuary Nexus • self-roles');
});

test('sanctuary group posts still send a new button-channel message', async () => {
  let sent = 0;
  const result = await sendToButtonChannel({
    channels: {
      fetch: async () => ({
        send: async () => { sent += 1; return { id: '141414141414141414' }; },
        messages: { fetch: async () => { throw new Error('group posts do not reuse the role menu'); } }
      })
    }
  }, { SANCTUARY_BUTTON_CHANNEL_ID: CHANNEL_ID }, { content: 'group' });
  assert.equal(result.posted, true);
  assert.equal(result.updated, false);
  assert.equal(sent, 1);
});

test('ARK cluster panel adopts a Sentinal message once and then edits', async () => {
  const deleted = [];
  const sent = [];
  const edited = [];
  const legacy = {
    id: '151515151515151515',
    author: { id: SENTINAL_ID, bot: true },
    embeds: [{ title: PANEL_TITLE, footer: { text: PANEL_MARKER } }],
    createdTimestamp: 1,
    delete: async () => { deleted.push(legacy.id); }
  };
  const payload = { embeds: [{ title: PANEL_TITLE, description: 'live', footer: { text: PANEL_MARKER } }], components: [] };
  const channel = {
    id: CHANNEL_ID,
    send: async (body) => {
      const created = {
        id: '161616161616161616',
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        components: body.components,
        pinned: false,
        pin: async () => { created.pinned = true; },
        edit: async (next) => { edited.push(next); created.embeds = next.embeds; },
        delete: async () => { deleted.push(created.id); }
      };
      sent.push(body);
      channel.recent.push(created);
      return created;
    },
    messages: { fetch: async () => ({ values: () => channel.recent.values() }) },
    recent: [legacy]
  };
  const saved = [];
  const registry = { setMeta: (meta) => saved.push(meta) };
  const first = await reconcileArkClusterPanel(channel, payload, { botId: BOT_ID, registry });
  assert.equal(sent.length, 1);
  assert.equal(first.created, true);
  assert.equal(first.migrated, true);
  assert.equal(first.foreignRemoved, 1);
  assert.deepEqual(deleted, [legacy.id]);
  assert.equal(saved.at(-1).panelMessageId, '161616161616161616');

  const second = await reconcileArkClusterPanel(channel, payload, { botId: BOT_ID, registry });
  assert.equal(sent.length, 1);
  assert.equal(second.created, false);
  assert.equal(second.message.id, '161616161616161616');

  const savedOnly = {
    id: '171717171717171717',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: PANEL_TITLE, footer: { text: PANEL_MARKER }, description: 'stored' }],
    components: payload.components,
    pinned: true,
    edit: async (next) => { savedOnly.embeds = next.embeds; }
  };
  const quiet = {
    id: CHANNEL_ID,
    send: async () => { throw new Error('stored panel id should be edited'); },
    messages: {
      fetch: async (arg) => {
        if (arg && arg.limit) return { values: () => [].values() };
        return arg === savedOnly.id ? savedOnly : null;
      }
    }
  };
  const stored = await reconcileArkClusterPanel(quiet, payload, {
    botId: BOT_ID,
    registry: { getMeta: () => ({ panelMessageId: savedOnly.id }), setMeta: () => {} }
  });
  assert.equal(stored.created, false);
  assert.equal(stored.updated, true);
  assert.equal(stored.message.id, savedOnly.id);
});
